#!/usr/bin/env node
/**
 * skill-demote.mjs — ADR-025 qe-diet Phase 3: reversible skill demotion MECHANISM.
 *
 * Moves a skill directory OUT of the catalog (into the top-level `skills-optional/`,
 * which is outside all 8 `plugin.json` skill globs) and back, WITHOUT deleting it.
 * Phase 3 ships this tool but demotes NOTHING (the manifest starts `demoted: {}`).
 *
 * Design (see TASK_REQUEST_02c1e4ba.md):
 *  - Move-not-delete: `fs.renameSync` (same-device atomic) only. EXDEV → reject,
 *    NEVER copy+unlink (that is a delete path).
 *  - Atomic: rename first, then write manifest; on manifest-write failure, rename
 *    back (rollback) and fail. A skill is never lost.
 *  - Exact restore: the manifest records the precise original relative path
 *    (e.g. skills/coding-experts/quality/Qvitest) — restore never reconstructs
 *    from the basename.
 *  - Path containment uses path-SEGMENT comparison, not string startsWith
 *    (`skills-optional` must NOT count as inside `skills/`).
 *  - tier:core skills are refused (parser mirrors check-skill-tiers.mjs).
 *  - [UNVERIFIED — requires runtime confirmation] that `skills-optional/` is
 *    excluded from Claude Code's live catalog; statically it is outside the globs.
 *
 * Pure functions are exported with an injectable config for the self-contained
 * guard (scripts/check-skill-demote.mjs). Zero dependencies, Node built-ins only.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST_VERSION = 1;
const OPTIONAL_DIR = 'skills-optional';

const SYNC_REMINDER =
  'Reminder: run node scripts/sync-metadata.mjs after real skill moves, then node scripts/check-metadata-drift.mjs.';

/** A controlled, user-facing failure (CLI maps to stderr + non-zero exit). */
export class DemoteError extends Error {}

/**
 * Build a config bag. Overrides let the guard point at a fixture repo and inject
 * fs ops to simulate EXDEV / write failures.
 * @param {string} repoRoot
 * @param {object} [overrides]
 * @returns {object}
 */
export function makeConfig(repoRoot, overrides = {}) {
  return {
    repoRoot,
    pluginJsonPath: overrides.pluginJsonPath || join(repoRoot, '.claude-plugin', 'plugin.json'),
    optionalDir: overrides.optionalDir || join(repoRoot, OPTIONAL_DIR),
    manifestPath: overrides.manifestPath || join(repoRoot, OPTIONAL_DIR, 'DEMOTED.json'),
    intentGatePath: overrides.intentGatePath || join(repoRoot, 'core', 'INTENT_GATE.md'),
    rename: overrides.rename || renameSync,
    writeManifest: overrides.writeManifest || writeFileSync,
  };
}

/**
 * Parse the routing targets declared in core/INTENT_GATE.md (3rd table column).
 * Mirrors check-skill-routing.mjs extraction: multi-target cells split on '/',
 * markdown/bold/parenthetical stripped, wildcard '*' preserved. Returns a Set of
 * target strings (e.g. "Qcommit", "Qgrad-*"). Empty set if the file is absent.
 */
export function intentGateTargets(cfg) {
  let content;
  try { content = readFileSync(cfg.intentGatePath, 'utf8'); } catch { return new Set(); }
  const targets = new Set();
  const rowRe = /^\|[^|]+\|[^|]+\|([^|]+)\|/gm;
  let m;
  while ((m = rowRe.exec(content)) !== null) {
    const cell = m[1].trim();
    if (cell === 'Routing Target' || cell.startsWith('---') || cell.startsWith('Refer to')) continue;
    for (const part of cell.split('/').map((p) => p.trim()).filter(Boolean)) {
      let clean = part.replace(/`/g, '').replace(/\s+\(.*\)$/, '').replace(/\*\*/g, '').trim();
      if (clean && /^[A-Za-z]/.test(clean)) targets.add(clean);
    }
  }
  return targets;
}

/** Is `name` an INTENT_GATE route target — exact or via a wildcard prefix (Qgrad-*)? */
export function isRoutedTarget(name, targets) {
  for (const t of targets) {
    if (t.includes('*')) { if (name.startsWith(t.replace(/\*/g, ''))) return true; }
    else if (t === name) return true;
  }
  return false;
}

/** Resolve the 8 catalog root directories declared in plugin.json (absolute). */
export function catalogRoots(cfg) {
  const raw = JSON.parse(readFileSync(cfg.pluginJsonPath, 'utf8'));
  const skills = Array.isArray(raw.skills) ? raw.skills : [];
  return skills.map((s) => resolve(cfg.repoRoot, s.replace(/^\.\//, '').replace(/\/+$/, '')));
}

/**
 * Path-SEGMENT containment: is `absPath` the same as, or nested under, a catalog
 * root? Uses `root + sep` so `skills-optional/` is NOT a match for `skills/`.
 */
export function isInsideCatalog(absPath, roots) {
  const p = resolve(absPath);
  return roots.some((root) => {
    const r = resolve(root);
    return p === r || p.startsWith(r + sep);
  });
}

/**
 * SECURITY: assert `absPath` is contained within at least one of `roots`, with
 * symlinks resolved on the deepest existing ancestor (so a symlinked component
 * can't escape). The manifest (DEMOTED.json) is a tracked, hand-editable, shipped
 * file — its originalPath/demotedPath are UNTRUSTED input. Without this, a crafted
 * entry like {originalPath:"../../../tmp/x"} or a demotedPath pointing at a live
 * catalog skill turns restore() into an arbitrary-directory move primitive.
 */
function assertContained(absPath, roots, label) {
  // Resolve symlinks on the deepest existing ancestor, re-append the missing tail.
  let probe = resolve(absPath);
  const tail = [];
  while (!existsSync(probe) && dirname(probe) !== probe) { tail.unshift(probe.split(sep).pop()); probe = dirname(probe); }
  const realFull = (existsSync(probe) ? realpathSync(probe) : probe) + (tail.length ? sep + tail.join(sep) : '');
  const ok = roots.some((root) => {
    const r = existsSync(root) ? realpathSync(root) : resolve(root);
    return realFull === r || realFull.startsWith(r + sep);
  });
  if (!ok) throw new DemoteError(`manifest path escapes ${label}: ${absPath}`);
}

/** Find a skill by BARE name across all catalog roots (direct child dir with SKILL.md). */
export function findSkillByName(name, roots, cfg) {
  const matches = [];
  for (const root of roots) {
    const cand = join(root, name);
    if (existsSync(join(cand, 'SKILL.md'))) matches.push(relPosix(cfg.repoRoot, cand));
  }
  return matches;
}

/** Relative path from repoRoot, normalized to forward slashes (manifest-stable). */
function relPosix(repoRoot, abs) {
  return relative(repoRoot, abs).split(sep).join('/');
}

/**
 * Read the `tier:` value from a SKILL.md, mirroring check-skill-tiers.mjs exactly:
 * strip UTF-8 BOM, require a first-line `---` fence, scan to the next `---`, take
 * the first column-0 `tier:` line and its first non-space token. Returns the tier
 * string or undefined (no tier → treated as extended → demotable).
 */
export function tierOf(skillMdPath) {
  let txt;
  try { txt = readFileSync(skillMdPath, 'utf8'); } catch { return undefined; }
  txt = txt.replace(/^﻿/, '');
  const lines = txt.split('\n');
  if (lines[0].trim() !== '---') return undefined;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    const m = lines[i].match(/^tier:\s*(\S+)/);
    if (m) return m[1];
  }
  return undefined;
}

/** Load + validate the manifest. Throws DemoteError on any corruption. */
export function loadManifest(cfg) {
  let raw;
  try { raw = readFileSync(cfg.manifestPath, 'utf8'); }
  catch { throw new DemoteError(`manifest not found: ${cfg.manifestPath}`); }
  let m;
  try { m = JSON.parse(raw); }
  catch { throw new DemoteError('manifest is not valid JSON'); }
  if (!m || typeof m !== 'object') throw new DemoteError('manifest is not an object');
  if (m.version !== MANIFEST_VERSION) throw new DemoteError(`manifest version must be ${MANIFEST_VERSION}`);
  if (!('demoted' in m)) throw new DemoteError('manifest missing "demoted"');
  if (!m.demoted || typeof m.demoted !== 'object' || Array.isArray(m.demoted)) {
    throw new DemoteError('manifest "demoted" must be an object');
  }
  return m;
}

/** Serialize the manifest deterministically (sorted skill keys). */
function serializeManifest(m) {
  const demoted = {};
  for (const k of Object.keys(m.demoted).sort()) demoted[k] = m.demoted[k];
  return JSON.stringify({ version: MANIFEST_VERSION, demoted }, null, 2) + '\n';
}

/** Resolve a --demote/--restore argument to a skill dir (bare name or repo-relative path). */
function resolveSource(arg, roots, cfg) {
  if (arg.includes('/')) {
    const abs = resolve(cfg.repoRoot, arg);
    if (!isInsideCatalog(abs, roots)) throw new DemoteError(`path is outside the catalog roots: ${arg}`);
    if (!existsSync(join(abs, 'SKILL.md'))) throw new DemoteError(`no SKILL.md at: ${arg}`);
    return abs;
  }
  const matches = findSkillByName(arg, roots, cfg);
  if (matches.length === 0) throw new DemoteError(`skill not found: ${arg}`);
  if (matches.length > 1) {
    throw new DemoteError(`ambiguous skill name "${arg}" — candidates:\n  ${matches.join('\n  ')}\nuse a path-qualified form.`);
  }
  return resolve(cfg.repoRoot, matches[0]);
}

/** Demote a skill: move catalog dir → skills-optional/, record in manifest. */
export function demote(arg, cfg) {
  const roots = catalogRoots(cfg);
  const srcAbs = resolveSource(arg, roots, cfg);
  const base = srcAbs.split(sep).pop();

  if (tierOf(join(srcAbs, 'SKILL.md')) === 'core') {
    throw new DemoteError(`refusing to demote a tier:core skill: ${base}`);
  }
  // Refuse skills that are INTENT_GATE auto-routing targets — demoting them
  // creates dangling routes (caught by check-skill-routing). Same protective
  // intent as the tier:core refusal. Remove the route first, or keep it cataloged.
  if (isRoutedTarget(base, intentGateTargets(cfg))) {
    throw new DemoteError(`refusing to demote an INTENT_GATE route target: ${base} (it is auto-routed; remove its route in core/INTENT_GATE.md first, or keep it in the catalog)`);
  }
  const manifest = loadManifest(cfg);
  if (manifest.demoted[base]) throw new DemoteError(`already demoted: ${base}`);

  const destAbs = join(cfg.optionalDir, base);
  if (existsSync(destAbs)) throw new DemoteError(`destination not clear: ${relPosix(cfg.repoRoot, destAbs)}`);

  const originalPath = relPosix(cfg.repoRoot, srcAbs);
  const demotedPath = relPosix(cfg.repoRoot, destAbs);

  mkdirSync(cfg.optionalDir, { recursive: true });
  try {
    cfg.rename(srcAbs, destAbs);
  } catch (e) {
    if (e && e.code === 'EXDEV') throw new DemoteError('cross-device move (EXDEV) is not allowed — copy+unlink is forbidden');
    throw e;
  }
  const next = { version: MANIFEST_VERSION, demoted: { ...manifest.demoted, [base]: { originalPath, demotedPath } } };
  try {
    cfg.writeManifest(cfg.manifestPath, serializeManifest(next));
  } catch (e) {
    cfg.rename(destAbs, srcAbs); // rollback — never lose the skill
    throw new DemoteError(`manifest write failed, rolled back: ${e.message}`);
  }
  return { base, originalPath, demotedPath, reminder: SYNC_REMINDER };
}

/** Restore a demoted skill to its exact original path. */
export function restore(arg, cfg) {
  const base = arg.includes('/') ? arg.split('/').pop() : arg;
  const manifest = loadManifest(cfg);
  const entry = manifest.demoted[base];
  if (!entry) throw new DemoteError(`not in manifest: ${base}`);

  const roots = catalogRoots(cfg);
  const demotedAbs = resolve(cfg.repoRoot, entry.demotedPath);
  // UNTRUSTED manifest paths: the move SOURCE must be inside skills-optional/, the
  // DEST must be inside a catalog root. Blocks repo-escape and live-skill clobber.
  assertContained(demotedAbs, [cfg.optionalDir], 'skills-optional');
  if (!existsSync(demotedAbs)) throw new DemoteError(`integrity failure — demoted dir missing on disk: ${entry.demotedPath}`);
  const originalAbs = resolve(cfg.repoRoot, entry.originalPath);
  assertContained(originalAbs, roots, 'catalog roots');
  if (existsSync(originalAbs)) throw new DemoteError(`restore collision — original path already exists: ${entry.originalPath}`);

  mkdirSync(dirname(originalAbs), { recursive: true });
  try {
    cfg.rename(demotedAbs, originalAbs);
  } catch (e) {
    if (e && e.code === 'EXDEV') throw new DemoteError('cross-device move (EXDEV) is not allowed — copy+unlink is forbidden');
    throw e;
  }
  const nextDemoted = { ...manifest.demoted };
  delete nextDemoted[base];
  try {
    cfg.writeManifest(cfg.manifestPath, serializeManifest({ version: MANIFEST_VERSION, demoted: nextDemoted }));
  } catch (e) {
    cfg.rename(originalAbs, demotedAbs); // rollback
    throw new DemoteError(`manifest write failed, rolled back: ${e.message}`);
  }
  return { base, restoredTo: entry.originalPath, reminder: SYNC_REMINDER };
}

/** List demoted skills (sorted); reports an integrity failure if any dir is missing. */
export function list(cfg) {
  const manifest = loadManifest(cfg);
  const roots = catalogRoots(cfg);
  const names = Object.keys(manifest.demoted).sort();
  // Validate UNTRUSTED manifest paths before trusting them (same threat as restore).
  for (const n of names) {
    const e = manifest.demoted[n];
    assertContained(resolve(cfg.repoRoot, e.demotedPath), [cfg.optionalDir], 'skills-optional');
    assertContained(resolve(cfg.repoRoot, e.originalPath), roots, 'catalog roots');
  }
  const missing = names.filter((n) => !existsSync(resolve(cfg.repoRoot, manifest.demoted[n].demotedPath)));
  if (missing.length) {
    throw new DemoteError(`integrity failure — demoted dirs missing on disk: ${missing.join(', ')}`);
  }
  return names.map((n) => ({ name: n, ...manifest.demoted[n] }));
}

const USAGE = `Usage:
  node scripts/skill-demote.mjs --demote  <name-or-path>
  node scripts/skill-demote.mjs --restore <name-or-path>
  node scripts/skill-demote.mjs --list

Moves a skill between the catalog (skills/) and skills-optional/ (excluded from
the plugin catalog), reversibly. Never deletes. After a REAL move, run
scripts/sync-metadata.mjs then scripts/check-metadata-drift.mjs.`;

/** CLI entry — exact module-identity check so importers (the guard) don't run it. */
function main(argv) {
  const cmd = argv[0];
  const arg = argv[1];
  const cfg = makeConfig(REPO_ROOT);
  if (cmd === '--list') {
    const rows = list(cfg);
    if (!rows.length) { console.log('No demoted skills (demoted: {}).'); return 0; }
    for (const r of rows) console.log(`${r.name}\t${r.originalPath} -> ${r.demotedPath}`);
    return 0;
  }
  if (cmd === '--demote' || cmd === '--restore') {
    if (!arg) { console.error(`error: ${cmd} requires <name-or-path>\n\n${USAGE}`); return 2; }
    const r = cmd === '--demote' ? demote(arg, cfg) : restore(arg, cfg);
    console.log(cmd === '--demote' ? `demoted ${r.base} (${r.originalPath} -> ${r.demotedPath})` : `restored ${r.base} -> ${r.restoredTo}`);
    console.log(r.reminder);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
