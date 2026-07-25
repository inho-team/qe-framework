#!/usr/bin/env node
/**
 * migrate-qe-docs.mjs — Phase 4 bulk migration of legacy `.qe` execution
 * documents onto the Phase 3 title-first `qe-doc-frontmatter` convention
 * (`core/DOC_CONVENTIONS.md`, D034).
 *
 * Design contract (G026–G033):
 *   - Dry-run by default. Without `--apply` NOTHING is written: no backups, no
 *     document edits, no index rebuild — only a report is produced.
 *   - Every `--apply` first copies each to-be-changed original into
 *     `.qe/.archive/pre-v9/<path-relative-to-.qe>`; an existing backup is never
 *     clobbered, so the earliest original always wins. Conversion is additive
 *     (insert a frontmatter block; never delete or reorder body content).
 *   - Idempotent: a document that already carries a valid frontmatter block is
 *     skipped, so re-running `--apply` on the same tree is byte-identical.
 *   - Scope is fixed to the six execution-document lanes (TARGET_DIRS). Any
 *     dot-prefixed path segment below a lane (a nested `.qe`, `.archive`, …) and
 *     the auto-derived `analysis` lane are excluded, mirroring the index scan.
 *   - Legacy = no recognized frontmatter block. A NO-H1 legacy document (first
 *     line is not an H1) has a filename-based H1 synthesized so the title-first
 *     extractor can recognize the inserted block.
 *
 * The frontmatter render and the derived-index rebuild reuse the shared Phase 3
 * helpers (`doc-frontmatter.mjs`, `doc-index.mjs`) rather than re-implementing
 * parsing or index logic. All writes are repo-relative and containment-checked.
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, renameSync, mkdirSync, copyFileSync, statSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocFrontmatter } from './lib/doc-frontmatter.mjs';
import { rebuildIndex, KINDS } from './lib/doc-index.mjs';

/**
 * The six execution-document lanes migrated by this tool, relative to `.qe`.
 * `analysis` is intentionally absent: it is an auto-derived lane and must not be
 * hand-annotated. `tasks`/`checklists` include their lifecycle subfolders.
 */
export const TARGET_DIRS = ['tasks', 'checklists', 'handoffs', 'security-reports', 'docs', 'gc'];

/** Backup root for pre-migration originals, relative to `.qe`. */
const BACKUP_ROOT = join('.archive', 'pre-v9');

/** Placeholder plan/phase for legacy backfill — the true values are unknown. */
const LEGACY_PLAN = 'legacy';
const LEGACY_PHASE = 'legacy';

/**
 * Resolve `relOrPath` under `root` and assert the result stays inside `root`.
 * Rejects absolute paths and parent-traversal outright (defense in depth over
 * the canonical-containment check) so no write can escape the repository.
 */
export function resolveWithin(root, relOrPath) {
  const rootResolved = resolve(root);
  if (String(relOrPath).split(/[\\/]/).includes('..')) {
    throw new Error(`path traversal not allowed: "${relOrPath}"`);
  }
  const resolved = resolve(rootResolved, relOrPath);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    throw new Error(`path escapes root: "${relOrPath}"`);
  }
  return resolved;
}

/**
 * Assert the REAL parent directory of `full` resolves inside `root`. `resolveWithin`
 * is a lexical guard only; this dereferences symlinks so a symlinked scan-root
 * (e.g. `.qe/tasks -> /elsewhere`) cannot redirect an atomic write outside the
 * repository. The parent directory is expected to exist (it is a scanned lane).
 */
function assertRealParentContained(root, full) {
  const realRoot = realpathSync(resolve(root));
  const realParent = realpathSync(dirname(full));
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new Error(`refusing write outside repo (symlink escape): ${full}`);
  }
}

/** Infer the convention `kind` from a filename, per the DOC_CONVENTIONS map. */
export function inferKind(name) {
  if (name.startsWith('TASK_REQUEST')) return 'spec';
  if (name.startsWith('VERIFY_CHECKLIST')) return 'verify';
  if (name.startsWith('SECURITY_REPORT') || name.startsWith('risk-proof')) return 'audit';
  if (name.startsWith('HANDOFF')) return 'handoff';
  return 'report';
}

/**
 * Derive a stable, lint-valid uuid for a legacy document. Task/checklist files
 * keep their real id token (`TASK_REQUEST_<id>` → `<id>`); every other file uses
 * its filename stem sanitized to the legacy-id alphabet, guaranteeing a unique,
 * non-empty identifier that satisfies the convention lint.
 */
export function deriveMigrationUuid(name) {
  const stem = name.replace(/\.md$/i, '');
  const m = stem.match(/^(?:TASK_REQUEST|VERIFY_CHECKLIST)_([A-Za-z0-9]+)/);
  if (m) return m[1];
  return stem.replace(/[^A-Za-z0-9._-]/g, '-');
}

/** Lifecycle status from the containing folder; non-lifecycle lanes are done. */
function deriveStatusFromRel(rel) {
  if (rel.includes('/in-progress/')) return 'in-progress';
  if (rel.includes('/completed/')) return 'completed';
  if (rel.includes('/pending/')) return 'pending';
  // `on-hold` is not a convention status value; map it to the nearest valid one.
  if (rel.includes('/on-hold/')) return 'pending';
  return 'completed';
}

/** The synthesized H1 title for a NO-H1 legacy document: its filename stem. */
function titleFromName(name) {
  return name.replace(/\.md$/i, '');
}

/** True when the first line of `text` is a Markdown H1 (`# ...`). */
function hasH1(text) {
  return /^#\s+\S/.test(String(text ?? '').replace(/\r\n/g, '\n').split('\n')[0] || '');
}

/**
 * Render the `qe-doc-frontmatter` block (opening marker through `-->`) for the
 * given metadata. `links` is always an empty list: legacy pairings are not
 * reconstructed here, which keeps every migrated document lint-clean (no risk of
 * a broken `[[link]]`). Output round-trips through `extractDocFrontmatter`.
 */
export function renderFrontmatter({ kind, uuid, plan = LEGACY_PLAN, phase = LEGACY_PHASE, created, status }) {
  return [
    '<!-- qe-doc-frontmatter',
    `kind: ${kind}`,
    `uuid: ${uuid}`,
    `plan: ${plan}`,
    `phase: "${phase}"`,
    `created: "${created}"`,
    `status: ${status}`,
    'links: []',
    '-->',
  ].join('\n');
}

/**
 * Transform a legacy document body into its migrated form by inserting the
 * frontmatter block immediately after the H1. When the document has no H1, an
 * H1 is synthesized from `meta.title` and prepended. Body content is otherwise
 * preserved verbatim.
 *
 * @returns {{ text: string, synthesizedTitle: string|null }}
 */
export function migrateContent(original, meta) {
  const source = String(original ?? '').replace(/\r\n/g, '\n');
  const block = renderFrontmatter(meta);
  if (hasH1(source)) {
    const lines = source.split('\n');
    const rest = lines.slice(1).join('\n');
    return { text: `${lines[0]}\n${block}\n${rest}`, synthesizedTitle: null };
  }
  // Sanitize control characters/newlines so a synthesized H1 can never spill
  // onto a second line and push the frontmatter marker off the recognized row.
  const title = String(meta.title || 'Untitled').replace(/[\x00-\x1f]+/g, ' ').trim() || 'Untitled';
  return { text: `# ${title}\n${block}\n\n${source}`, synthesizedTitle: title };
}

/**
 * Recursively list `.md` files under `dir`, skipping any dot-prefixed path
 * segment below `dir` (a nested `.qe`, `.archive`, `.git`, …). This mirrors the
 * index scanner so migration and indexing agree on scope.
 */
function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = join(entry.parentPath, entry.name);
    const belowRoot = relative(dir, full).split(sep).slice(0, -1);
    if (belowRoot.some(seg => seg.startsWith('.'))) continue;
    out.push(full);
  }
  return out;
}

/**
 * Classify every in-scope document without writing anything. Each entry records
 * the chosen action and (for migrate targets) the frontmatter metadata that
 * would be inserted. Actions:
 *   - `migrate`      — legacy doc (no frontmatter block) to convert.
 *   - `skip-valid`   — already carries a valid frontmatter block.
 *   - `skip-invalid` — carries a malformed/unterminated block; left untouched.
 *   - `skip-excluded`— legacy, but held back by an `exclude` token (e.g. an
 *                      in-flight doc owned by a concurrent session).
 *
 * @param {object} [opts]
 * @param {string[]} [opts.exclude] tokens matched against each doc's rel path or
 *   derived uuid; a legacy doc that matches any token is skipped, not migrated.
 */
export function planMigration(projectRoot, opts = {}) {
  const exclude = Array.isArray(opts.exclude) ? opts.exclude.filter(Boolean) : [];
  const qeDir = join(projectRoot, '.qe');
  const entries = [];
  for (const dir of TARGET_DIRS) {
    for (const full of listMarkdown(join(qeDir, dir))) {
      const rel = relative(projectRoot, full).split(sep).join('/');
      const name = basename(full);
      let text = '';
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const fm = extractDocFrontmatter(text);
      if (fm.state === 'valid') {
        entries.push({ rel, full, name, action: 'skip-valid' });
        continue;
      }
      if (fm.state === 'invalid' || fm.state === 'unterminated') {
        entries.push({ rel, full, name, action: 'skip-invalid', reason: fm.error || fm.state });
        continue;
      }
      // state === 'missing' → legacy document to migrate.
      const kind = inferKind(name);
      const uuid = deriveMigrationUuid(name);
      // Hold back docs the caller asked to exclude (e.g. concurrent-session work).
      if (exclude.some(tok => rel.includes(tok) || uuid === tok)) {
        entries.push({ rel, full, name, action: 'skip-excluded' });
        continue;
      }
      const status = deriveStatusFromRel(rel);
      let created;
      try {
        created = statSync(full).mtime.toISOString().slice(0, 10);
      } catch {
        created = new Date().toISOString().slice(0, 10);
      }
      entries.push({
        rel, full, name, action: 'migrate',
        kind, uuid, status, created,
        plan: LEGACY_PLAN, phase: LEGACY_PHASE,
        synthesizeH1: !hasH1(text),
        title: titleFromName(name),
      });
    }
  }
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const summary = {
    migrate: entries.filter(e => e.action === 'migrate').length,
    skipValid: entries.filter(e => e.action === 'skip-valid').length,
    skipInvalid: entries.filter(e => e.action === 'skip-invalid').length,
    skipExcluded: entries.filter(e => e.action === 'skip-excluded').length,
  };
  return { entries, summary };
}

/** Copy an original into the pre-v9 backup, never clobbering an existing one. */
function backupOriginal(projectRoot, entry) {
  const relBelowQe = entry.rel.replace(/^\.qe\//, '');
  const backupRel = join('.qe', BACKUP_ROOT, relBelowQe);
  const backupFull = resolveWithin(projectRoot, backupRel);
  if (existsSync(backupFull)) return backupFull; // earliest original wins.
  mkdirSync(dirname(backupFull), { recursive: true });
  assertRealParentContained(projectRoot, backupFull); // no symlinked .archive escape.
  copyFileSync(entry.full, backupFull);
  return backupFull;
}

/** Atomically write `content` to `full` (temp + rename) inside its own dir. */
function atomicWrite(full, content) {
  const tmp = join(dirname(full), `.${basename(full)}.${process.pid}.tmp`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, full);
}

/**
 * Execute a plan: back up, convert, and rebuild the derived index exactly once.
 * Only `migrate` entries are touched; every write is containment-checked. Safe
 * to re-run — a second pass finds no migrate targets and changes nothing.
 *
 * @returns {{ changed: string[], backedUp: string[], skippedInvalid: string[], indexPath: string|null }}
 */
export function applyPlan(projectRoot, plan) {
  const changed = [];
  const backedUp = [];
  const skippedRace = [];
  const failed = [];
  const skippedInvalid = plan.entries.filter(e => e.action === 'skip-invalid').map(e => e.rel);
  const targets = plan.entries.filter(e => e.action === 'migrate');

  for (const entry of targets) {
    try {
      const full = resolveWithin(projectRoot, entry.rel); // reject any escaping rel.
      const original = readFileSync(full, 'utf8');
      // TOCTOU re-check: the plan may be stale. If a racing writer already gave
      // this file a frontmatter block, do NOT insert a second one — skip it.
      if (extractDocFrontmatter(original).state !== 'missing') {
        skippedRace.push(entry.rel);
        continue;
      }
      // Symlink guard: confirm the real write target stays inside the repo before
      // any copy/write follows a potentially symlinked scan-root directory.
      assertRealParentContained(projectRoot, full);
      const backup = backupOriginal(projectRoot, entry);
      const { text } = migrateContent(original, entry);
      // Guard: the migrated text must be recognizable, or we do not write it.
      if (extractDocFrontmatter(text).state !== 'valid') {
        failed.push(`${entry.rel}: unrecognized frontmatter after render`);
        continue;
      }
      atomicWrite(full, text);
      changed.push(entry.rel);
      backedUp.push(backup);
    } catch (err) {
      // One pathological file must not abort the batch; record and continue.
      failed.push(`${entry.rel}: ${err.message}`);
    }
  }

  let indexPath = null;
  if (changed.length > 0) {
    indexPath = rebuildIndex(projectRoot);
  }
  return { changed, backedUp, skippedRace, skippedInvalid, failed, indexPath };
}

/** Render a human-readable migration report from a plan (+ optional result). */
export function formatReport(plan, { apply = false, result = null } = {}) {
  const lines = [];
  lines.push(`# QE Doc Migration Report`);
  lines.push('');
  lines.push(`- mode: ${apply ? 'APPLY' : 'dry-run (no writes)'}`);
  lines.push(`- migrate: ${plan.summary.migrate}`);
  lines.push(`- skip (already migrated): ${plan.summary.skipValid}`);
  lines.push(`- skip (malformed block): ${plan.summary.skipInvalid}`);
  lines.push(`- skip (excluded): ${plan.summary.skipExcluded || 0}`);
  lines.push('');
  lines.push('| action | kind | uuid | status | H1 | path |');
  lines.push('|---|---|---|---|---|---|');
  for (const e of plan.entries) {
    if (e.action === 'migrate') {
      lines.push(`| migrate | ${e.kind} | ${e.uuid} | ${e.status} | ${e.synthesizeH1 ? 'synth' : 'keep'} | ${e.rel} |`);
    } else {
      lines.push(`| ${e.action} | | | | | ${e.rel} |`);
    }
  }
  if (apply && result) {
    lines.push('');
    lines.push(`- changed: ${result.changed.length}`);
    lines.push(`- backed up to: .qe/${BACKUP_ROOT}/`);
    lines.push(`- index rebuilt: ${result.indexPath ? 'yes' : 'no (nothing changed)'}`);
    if (result.skippedRace && result.skippedRace.length) {
      lines.push(`- skipped (migrated by a concurrent writer): ${result.skippedRace.join(', ')}`);
    }
    if (result.skippedInvalid.length) {
      lines.push(`- malformed (left untouched): ${result.skippedInvalid.join(', ')}`);
    }
    if (result.failed && result.failed.length) {
      lines.push(`- failed (left untouched): ${result.failed.join(', ')}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Top-level orchestration: plan, optionally apply, and produce a report. In
 * apply mode the report is also persisted under the (index-excluded) backup dir.
 *
 * @returns {{ plan: object, result: object|null, report: string }}
 */
export function runMigration(projectRoot, { apply = false, exclude = [] } = {}) {
  const plan = planMigration(projectRoot, { exclude });
  let result = null;
  if (apply) {
    result = applyPlan(projectRoot, plan);
  }
  const report = formatReport(plan, { apply, result });
  // Persist the report only for a substantive apply. A no-op re-run (idempotent,
  // 0 changed) must NOT clobber the report that documented the real conversion.
  if (apply && result && result.changed.length > 0) {
    const reportFull = resolveWithin(projectRoot, join('.qe', BACKUP_ROOT, 'MIGRATION_REPORT.md'));
    mkdirSync(dirname(reportFull), { recursive: true });
    assertRealParentContained(projectRoot, reportFull); // no symlinked .archive escape.
    writeFileSync(reportFull, report, 'utf8');
  }
  return { plan, result, report };
}

// CLI: `node scripts/migrate-qe-docs.mjs [projectRoot] [--apply] [--exclude=a,b]`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  // Accept `--exclude=a,b` or `--exclude a,b`; split on comma into tokens.
  let exclude = [];
  const eqArg = args.find(a => a.startsWith('--exclude='));
  if (eqArg) exclude = eqArg.slice('--exclude='.length).split(',').map(s => s.trim()).filter(Boolean);
  else {
    const i = args.indexOf('--exclude');
    if (i !== -1 && args[i + 1]) exclude = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
  }
  const root = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--exclude') || process.cwd();
  const { report } = runMigration(resolve(root), { apply, exclude });
  process.stdout.write(report);
  if (!apply) {
    process.stdout.write('\nDry-run only. Re-run with --apply to migrate (originals are backed up first).\n');
  }
}
