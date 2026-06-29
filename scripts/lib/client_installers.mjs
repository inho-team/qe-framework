#!/usr/bin/env node

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, '..', '..');

// Fence markers written by the historical qe-framework Codex installer
const QE_CODEX_CONFIG_BEGIN = '# QE Framework Agent Configuration — managed by qe-framework installer';
const QE_CODEX_CONFIG_END = '# End QE Framework Agent Configuration';
const QE_CODEX_HOOKS_BEGIN = '# QE Framework Hook Configuration — managed by qe-framework installer';
const QE_CODEX_HOOKS_END = '# End QE Framework Hook Configuration';

/** Recursively create a directory (no-op if it exists). */
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

/**
 * Collect every file-copy pair under `src` mirrored into `dest`. Skips symlinks
 * (traversal guard). Directories recurse; files yield one {from, to} pair. This is
 * the single source of truth for what install copies, so planInstall (preview) and
 * installClaudeAssets (write) can never diverge.
 */
function collectCopyPairs(src, dest, out = []) {
  let stat;
  try { stat = lstatSync(src); } catch { return out; }
  if (stat.isSymbolicLink()) return out; // skip symlinks to prevent traversal
  if (stat.isDirectory()) {
    for (const entry of readdirSync(src)) collectCopyPairs(join(src, entry), join(dest, entry), out);
  } else {
    out.push({ from: src, to: dest });
  }
  return out;
}

/**
 * Check if qe-framework is installed as a Claude Code plugin.
 * Returns the plugin installPath if found, null otherwise.
 */
function getPluginInstallPath(homeDir, log = () => {}) {
  const registryPath = join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
  if (!existsSync(registryPath)) return null;

  const pluginPrefix = join(homeDir, '.claude', 'plugins');

  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
  } catch (e) {
    log(`[WARN] Failed to parse ${registryPath}: ${e.message}. Falling back to non-plugin mode.`);
    return null;
  }

  const entries = registry?.plugins?.['qe-framework@inho-team-qe-framework'];
  if (!Array.isArray(entries) || entries.length === 0) return null;

  // Sort by installedAt descending to pick the most recent entry
  const sorted = [...entries].sort((a, b) =>
    (b.installedAt || '').localeCompare(a.installedAt || '')
  );

  for (const entry of sorted) {
    const installPath = entry.installPath;
    if (!installPath) continue;
    // Path boundary check: must be under ~/.claude/plugins/
    if (!installPath.startsWith(pluginPrefix)) {
      log(`[WARN] Plugin installPath "${installPath}" is outside ${pluginPrefix}. Skipping.`);
      continue;
    }
    if (existsSync(installPath)) return installPath;
  }

  return null;
}

/**
 * Resolve install targets for the current mode. Plugin mode syncs into the plugin
 * cache (plus an absolute-path scripts copy under ~/.claude/scripts); standalone mode
 * installs directly under ~/.claude. Shared by install/uninstall/plan/doctor.
 */
function resolveTargets(repoRoot, homeDir, log = () => {}) {
  const pluginPath = getPluginInstallPath(homeDir, log);
  if (pluginPath) {
    return {
      mode: 'plugin',
      pluginPath,
      targets: [
        { src: 'skills', dest: join(pluginPath, 'skills'), label: 'skill' },
        // Opt-in / demoted skills (ADR-025 Phase 3): shipped but outside the
        // catalog globs, so demotion stays reversible in an installed plugin.
        { src: 'skills-optional', dest: join(pluginPath, 'skills-optional'), label: 'skill-optional' },
        { src: 'agents', dest: join(pluginPath, 'agents'), label: 'agent' },
        { src: 'core', dest: join(pluginPath, 'core'), label: 'core' },
        { src: 'hooks', dest: join(pluginPath, 'hooks'), label: 'hook' },
        { src: 'scripts', dest: join(pluginPath, 'scripts'), label: 'script' },
        // Absolute-path fallback: SKILL.md bash refers to $HOME/.claude/scripts/.
        { src: 'scripts', dest: join(homeDir, '.claude', 'scripts'), label: 'script(abs)' },
      ],
    };
  }
  return {
    mode: 'standalone',
    pluginPath: null,
    targets: [
      { src: 'skills', dest: join(homeDir, '.claude', 'commands'), label: 'skill' },
      // Demoted skills go to a sibling dir (NOT commands/), so they ship and stay
      // restorable but are not exposed as active commands (ADR-025 Phase 3).
      { src: 'skills-optional', dest: join(homeDir, '.claude', 'skills-optional'), label: 'skill-optional' },
      { src: 'agents', dest: join(homeDir, '.claude', 'agents'), label: 'agent' },
      { src: 'core', dest: join(homeDir, '.claude', 'core'), label: 'core' },
      { src: 'hooks', dest: join(homeDir, '.claude', 'hooks'), label: 'hook' },
      { src: 'scripts', dest: join(homeDir, '.claude', 'scripts'), label: 'script' },
    ],
  };
}

/** All {from, to} copy pairs for the current mode (no writes). */
function allCopyPairs(repoRoot, targets) {
  const pairs = [];
  for (const { src, dest } of targets) {
    const srcDir = join(repoRoot, src);
    if (!existsSync(srcDir)) continue;
    collectCopyPairs(srcDir, dest, pairs);
  }
  return pairs;
}

/**
 * Pure preview: classify every destination file as 'create' or 'overwrite' without
 * touching the filesystem. Powers `--dry-run`, the pre-install summary, and doctor.
 * @returns {{mode: string, actions: Array<{action: string, path: string}>}}
 */
export function planInstall({ repoRoot = REPO_ROOT, homeDir = homedir(), log = () => {} } = {}) {
  const { mode, targets } = resolveTargets(repoRoot, homeDir, log);
  const actions = allCopyPairs(repoRoot, targets).map((p) => ({
    action: existsSync(p.to) ? 'overwrite' : 'create',
    path: p.to,
  }));
  return { mode, actions };
}

/** Filesystem-safe backup stamp with a random suffix so same-millisecond installs never collide. */
function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Install assets for Claude. Before overwriting any existing file, the original is
 * copied into ~/.claude/.qe-backup/<stamp>/ with a manifest so the change is
 * reversible via `uninstall --restore`. `dryRun` prints the plan and writes nothing.
 * @returns {{mode, dryRun, created, overwritten, backupDir}}
 */
export function installClaudeAssets({ repoRoot = REPO_ROOT, homeDir = homedir(), log = console.log, dryRun = false } = {}) {
  const { mode, targets } = resolveTargets(repoRoot, homeDir, log);
  const pairs = allCopyPairs(repoRoot, targets);
  const overwrites = pairs.filter((p) => existsSync(p.to));
  const creates = pairs.length - overwrites.length;

  if (dryRun) {
    log(`[dry-run] mode=${mode} — would create ${creates}, overwrite ${overwrites.length}, write 0`);
    for (const p of pairs) log(`  ${existsSync(p.to) ? 'overwrite' : 'create'}: ${p.to}`);
    return { mode, dryRun: true, created: 0, overwritten: 0, backupDir: null };
  }

  // Back up originals that would be overwritten (taken in full BEFORE any overwrite,
  // so a backup failure cannot lose an original).
  let backupDir = null;
  if (overwrites.length > 0) {
    const claudeDir = join(homeDir, '.claude');
    const stamp = backupStamp();
    backupDir = join(claudeDir, '.qe-backup', stamp);
    const entries = [];
    for (const p of overwrites) {
      const rel = relative(claudeDir, p.to);
      if (rel.startsWith('..') || isAbsolute(rel)) { // never back up outside ~/.claude
        log(`[WARN] Skipping backup of out-of-tree path: ${p.to}`);
        continue;
      }
      const bdest = join(backupDir, rel);
      ensureDir(dirname(bdest));
      copyFileSync(p.to, bdest);
      entries.push({ original: p.to, backup: bdest });
    }
    ensureDir(backupDir);
    writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({ stamp, claudeDir, entries }, null, 2));
    log(`Backed up ${entries.length} existing file(s) -> ${backupDir}`);
  }

  for (const p of pairs) {
    ensureDir(dirname(p.to));
    copyFileSync(p.from, p.to);
  }
  log(`Installed ${creates} new, ${overwrites.length} overwritten (mode=${mode}).`);
  if (backupDir) log(`Rollback available: qe-framework-uninstall --restore`);
  return { mode, dryRun: false, created: creates, overwritten: overwrites.length, backupDir };
}

/**
 * Remove only files that are byte-identical to the shipped source — i.e. assets QE
 * installed and the user never modified. User-modified collisions and user-added files
 * are left intact; now-empty directories are pruned. @returns {number} files removed.
 */
function removeShippedFiles(src, dest, log = () => {}) {
  let stat;
  try { stat = lstatSync(src); } catch { return 0; }
  if (stat.isSymbolicLink()) return 0;

  if (stat.isDirectory()) {
    if (!existsSync(dest)) return 0;
    let removed = 0;
    for (const entry of readdirSync(src)) {
      removed += removeShippedFiles(join(src, entry), join(dest, entry), log);
    }
    try { if (existsSync(dest) && readdirSync(dest).length === 0) rmSync(dest, { force: true, recursive: false }); } catch {}
    return removed;
  }

  // File: remove dest only if it exists and matches the shipped bytes exactly.
  try {
    if (existsSync(dest) && lstatSync(dest).isFile() && readFileSync(dest).equals(readFileSync(src))) {
      rmSync(dest, { force: true });
      return 1;
    }
  } catch {}
  return 0;
}

/** Restore originals from the most recent backup manifest, clamped to ~/.claude. @returns {number|null} */
function restoreLatestBackup(homeDir, log = () => {}) {
  const claudeDir = join(homeDir, '.claude');
  const backupRoot = join(claudeDir, '.qe-backup');
  if (!existsSync(backupRoot)) return null;
  const dirs = readdirSync(backupRoot)
    .filter((d) => existsSync(join(backupRoot, d, 'manifest.json')))
    .sort(); // ISO-Z stamps sort chronologically
  if (dirs.length === 0) return null;
  const latest = join(backupRoot, dirs[dirs.length - 1]);
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(latest, 'manifest.json'), 'utf8')); } catch { return null; }

  const prefix = resolve(claudeDir) + sep;
  let restored = 0;
  for (const { original, backup } of manifest.entries || []) {
    // Boundary guard: never write outside the current ~/.claude (stale/relocated/tampered manifest).
    if (!resolve(original).startsWith(prefix)) { log(`[WARN] Skipping restore outside .claude: ${original}`); continue; }
    if (!resolve(backup).startsWith(prefix)) { log(`[WARN] Skipping restore from out-of-tree backup: ${backup}`); continue; }
    if (existsSync(backup)) {
      ensureDir(dirname(original));
      copyFileSync(backup, original);
      restored++;
    }
  }
  log(`Restored ${restored} file(s) from ${latest}`);
  return restored;
}

/**
 * Remove the assets this package installed (only files matching shipped bytes, so a
 * user file colliding with a shipped name is never destroyed). With `restore`, also
 * copy back any originals saved in the most recent backup manifest.
 * Additively calls cleanupCodexAssets() in dry-run mode by default; pass
 * `purgeCodex: true` to perform actual Codex asset deletion.
 */
export function uninstallClaudeAssets({ repoRoot = REPO_ROOT, homeDir = homedir(), log = console.log, restore = false, purgeCodex = false } = {}) {
  const { mode, targets } = resolveTargets(repoRoot, homeDir, log);
  let removed = 0;
  for (const { src, dest } of targets) {
    const srcDir = join(repoRoot, src);
    if (!existsSync(srcDir)) continue;
    removed += removeShippedFiles(srcDir, dest, log);
  }
  log(`Removed ${removed} QE-shipped file(s) (mode=${mode}); user-modified/added files left intact.`);

  if (restore) {
    const n = restoreLatestBackup(homeDir, log);
    if (n == null) log('No backup found to restore.');
  }

  // Additive Codex cleanup step — dry-run by default, real deletion only when purgeCodex=true.
  cleanupCodexAssets({ homeDir, dryRun: !purgeCodex, purge: purgeCodex, log });
}

// ---------------------------------------------------------------------------
// Codex orphan cleanup
// ---------------------------------------------------------------------------

/**
 * Load the KNOWN-QE-SKILL-NAMES set from the shipped manifest.
 * Returns a Set<string>. On parse error, returns an empty set and warns.
 */
function loadKnownSkillNames(log = () => {}) {
  const manifestPath = join(MODULE_DIR, 'codex-cleanup-manifest.json');
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.skills) ? raw.skills : []);
    return new Set(arr);
  } catch (e) {
    log(`[WARN] cleanupCodexAssets: could not load manifest at ${manifestPath}: ${e.message}`);
    return new Set();
  }
}

/**
 * Parse the QE agent fence block from config.toml text.
 * Returns an array of { name, configFile } objects for every [agents."<name>"]
 * entry found between the begin/end markers (markers inclusive).
 * Returns null if either marker is absent (fence not present).
 */
function parseQeAgentFence(text) {
  const lines = text.split(/\r?\n/);
  const beginIdx = lines.findIndex((l) => l.trim() === QE_CODEX_CONFIG_BEGIN);
  const endIdx = lines.findIndex((l) => l.trim() === QE_CODEX_CONFIG_END);

  // Both markers must be present for the fence to exist.
  if (beginIdx === -1 || endIdx === -1) return null;

  const fenceLines = lines.slice(beginIdx + 1, endIdx);
  const agents = [];
  let currentName = null;

  for (const line of fenceLines) {
    // Match [agents."Name"] or [agents.Name]
    const headerMatch = line.match(/^\[agents\."([^"]+)"\]$/) || line.match(/^\[agents\.([^\]]+)\]$/);
    if (headerMatch) {
      currentName = headerMatch[1];
      continue;
    }
    if (currentName) {
      const cfMatch = line.match(/^config_file\s*=\s*"([^"]+)"/);
      if (cfMatch) {
        agents.push({ name: currentName, configFile: cfMatch[1] });
        currentName = null;
      }
    }
  }
  return agents;
}

/**
 * Strip the QE fence block (both markers + all lines between) from config.toml
 * text. Idempotent: if markers are absent, returns the original text unchanged.
 * Collapses runs of >1 blank line left behind into a single blank line.
 */
function stripQeAgentFence(text) {
  const lines = text.split(/\r?\n/);
  const beginIdx = lines.findIndex((l) => l.trim() === QE_CODEX_CONFIG_BEGIN);
  const endIdx = lines.findIndex((l) => l.trim() === QE_CODEX_CONFIG_END);
  if (beginIdx === -1 || endIdx === -1) return text; // no-op

  const before = lines.slice(0, beginIdx);
  const after = lines.slice(endIdx + 1);
  const merged = [...before, ...after];

  // Collapse runs of >1 blank line into a single blank line.
  const collapsed = [];
  let prevBlank = false;
  for (const line of merged) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }

  return collapsed.join('\n');
}

/**
 * Strip the QE hooks fence block from config.toml text. Kept separate from the
 * agent fence so install/cleanup can manage hooks without disturbing agents.
 */
function stripQeHooksFence(text) {
  const lines = text.split(/\r?\n/);
  const beginIdx = lines.findIndex((l) => l.trim() === QE_CODEX_HOOKS_BEGIN);
  const endIdx = lines.findIndex((l) => l.trim() === QE_CODEX_HOOKS_END);
  if (beginIdx === -1 || endIdx === -1) return text;

  const before = lines.slice(0, beginIdx);
  const after = lines.slice(endIdx + 1);
  const merged = [...before, ...after];
  const collapsed = [];
  let prevBlank = false;
  for (const line of merged) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }

  return collapsed.join('\n');
}

function parseCodexHookEvents(configText, expectedHookPath) {
  if (!configText || !expectedHookPath || !configText.includes(expectedHookPath)) return [];
  const begin = configText.indexOf(QE_CODEX_HOOKS_BEGIN);
  const end = configText.indexOf(QE_CODEX_HOOKS_END);
  if (begin === -1 || end === -1 || end <= begin) return [];
  const fence = configText.slice(begin, end);
  return [...new Set([...fence.matchAll(/\[\[hooks\.([A-Za-z0-9_-]+)\]\]/g)].map((m) => m[1]))];
}

/**
 * Codex renamed [features].codex_hooks to [features].hooks. Migrate the user
 * config in-place during install so repeated sessions do not emit deprecation
 * warnings. If both keys exist, keep hooks and remove the deprecated key.
 */
function migrateDeprecatedCodexHookFeature(text) {
  const lines = text.split(/\r?\n/);
  let inFeatures = false;
  let featureHooksPresent = false;
  let featureCodexHooksIndex = -1;
  let dottedHooksPresent = false;
  let dottedCodexHooksIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\[[^\]]+\]/.test(trimmed)) {
      inFeatures = trimmed === '[features]';
    }

    if (inFeatures && /^\s*hooks\s*=/.test(lines[i])) {
      featureHooksPresent = true;
    } else if (inFeatures && /^\s*codex_hooks\s*=/.test(lines[i])) {
      featureCodexHooksIndex = i;
    } else if (/^\s*features\.hooks\s*=/.test(lines[i])) {
      dottedHooksPresent = true;
    } else if (/^\s*features\.codex_hooks\s*=/.test(lines[i])) {
      dottedCodexHooksIndex = i;
    }
  }

  let changed = false;
  const removeIndexes = [];
  if (featureCodexHooksIndex !== -1) {
    if (featureHooksPresent) {
      removeIndexes.push(featureCodexHooksIndex);
    } else {
      lines[featureCodexHooksIndex] = lines[featureCodexHooksIndex].replace(
        /^(\s*)codex_hooks(\s*=)/,
        '$1hooks$2',
      );
    }
    changed = true;
  }

  if (dottedCodexHooksIndex !== -1) {
    if (dottedHooksPresent) {
      removeIndexes.push(dottedCodexHooksIndex);
    } else {
      lines[dottedCodexHooksIndex] = lines[dottedCodexHooksIndex].replace(
        /^(\s*)features\.codex_hooks(\s*=)/,
        '$1features.hooks$2',
      );
    }
    changed = true;
  }

  for (const index of removeIndexes.sort((a, b) => b - a)) {
    lines.splice(index, 1);
  }

  return { text: lines.join('\n'), changed };
}

/**
 * Remove orphaned QE assets from ~/.codex during uninstall.
 *
 * Safety contract:
 *  - Injectable homeDir: NEVER touches real ~/.codex in tests.
 *  - Default dryRun=true / purge=false: prints plan, writes receipt, deletes NOTHING.
 *  - Real deletion only when purge===true.
 *  - Skills removed only if name is in KNOWN-QE-SKILL-NAMES AND dir contains SKILL.md.
 *  - Agents removed only if listed in the config.toml QE fence; fence absent -> no agents removed.
 *  - config.toml fence block stripped (with .bak backup) only when fence is present.
 *  - No blanket rm -rf of ~/.codex, ~/.codex/skills, or ~/.codex/agents.
 *  - Graceful skip if ~/.codex does not exist.
 *
 * @param {object} opts
 * @param {string}   [opts.homeDir] - injectable home dir (default: os.homedir())
 * @param {boolean}  [opts.dryRun]  - if true (default), report only — delete nothing
 * @param {boolean}  [opts.purge]   - if true, perform actual deletions (overrides dryRun)
 * @param {Function} [opts.log]     - logger (default: console.log)
 * @returns {{ skills: string[], agents: string[], configEdited: boolean, dryRun: boolean }}
 */
export function cleanupCodexAssets({
  homeDir = homedir(),
  dryRun = true,
  purge = false,
  log = console.log,
} = {}) {
  if (!homeDir || typeof homeDir !== 'string' || homeDir.trim() === '') {
    throw new Error('cleanupCodexAssets: refusing to run with empty homeDir (would resolve to a cwd-relative .codex path)');
  }

  const codexDir = join(homeDir, '.codex');

  // Graceful skip if ~/.codex doesn't exist.
  if (!existsSync(codexDir)) {
    return { skills: [], agents: [], configEdited: false, dryRun: purge !== true };
  }

  const effectiveDryRun = purge !== true; // purge===true -> real deletion

  // ----- Skills: manifest match + SKILL.md presence -----
  const knownSkillNames = loadKnownSkillNames(log);
  const skillsDir = join(codexDir, 'skills');
  const skillsToRemove = [];
  const scriptsDir = join(codexDir, 'scripts');
  const scriptsToRemove = [];
  const hooksDir = join(codexDir, 'hooks');
  const hooksToRemove = [];

  if (existsSync(skillsDir)) {
    for (const entry of knownSkillNames) {
      if (typeof entry !== 'string' || entry.trim() === '') continue;
      // Must be in the known manifest AND contain SKILL.md. Entries may be
      // top-level names (legacy) or nested repo-relative paths such as
      // coding-experts/quality/Qvitest.
      const parts = entry.split('/').filter(Boolean);
      if (parts.length === 0 || parts.some((part) => part === '..')) continue;
      const entryPath = join(skillsDir, ...parts);
      if (!resolve(entryPath).startsWith(resolve(skillsDir) + sep)) continue;
      let stat;
      try { stat = lstatSync(entryPath); } catch { continue; }
      if (!stat.isDirectory()) continue;
      if (!existsSync(join(entryPath, 'SKILL.md'))) continue;
      skillsToRemove.push(entryPath);
    }
  }

  // ----- Scripts: explicit installed subtree only -----
  if (existsSync(scriptsDir)) {
    try {
      const stat = lstatSync(scriptsDir);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        scriptsToRemove.push(scriptsDir);
      } else if (stat.isSymbolicLink()) {
        log(`[WARN] cleanupCodexAssets: skipping symlink scripts dir: ${scriptsDir}`);
      }
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not inspect scripts dir: ${e.message}`);
    }
  }

  // ----- Hooks: explicit installed subtree only -----
  if (existsSync(hooksDir)) {
    try {
      const stat = lstatSync(hooksDir);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        hooksToRemove.push(hooksDir);
      } else if (stat.isSymbolicLink()) {
        log(`[WARN] cleanupCodexAssets: skipping symlink hooks dir: ${hooksDir}`);
      }
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not inspect hooks dir: ${e.message}`);
    }
  }

  // ----- Agents: fence-driven authoritative list -----
  const configPath = join(codexDir, 'config.toml');
  let qeAgents = []; // { name, configFile }
  let configText = null;
  let fencePresent = false;
  let hooksFencePresent = false;

  if (existsSync(configPath)) {
    try { configText = readFileSync(configPath, 'utf8'); } catch { configText = null; }
    if (configText !== null) {
      const parsed = parseQeAgentFence(configText);
      if (parsed !== null) {
        fencePresent = true;
        qeAgents = parsed;
      }
      hooksFencePresent = configText.includes(QE_CODEX_HOOKS_BEGIN) && configText.includes(QE_CODEX_HOOKS_END);
    }
  }

  const agentsDir = join(codexDir, 'agents');
  const agentFilesToRemove = []; // absolute paths
  // Boundary guard: a tampered/relocated fence config_file could point outside
  // ~/.codex; never let purge delete an arbitrary path. Mirrors the confinement
  // pattern in restoreLatestBackup() / installClaudeAssets() backup logic.
  const codexPrefix = resolve(codexDir) + sep;

  for (const { name, configFile } of qeAgents) {
    // Use the config_file path from the fence (absolute); derive .md sibling.
    const tomlPath = configFile || join(agentsDir, `${name}.toml`);
    const mdPath = tomlPath.replace(/\.toml$/, '.md');
    if (!resolve(tomlPath).startsWith(codexPrefix)) {
      log(`[WARN] cleanupCodexAssets: skipping out-of-tree agent path: ${tomlPath}`);
      continue;
    }
    if (existsSync(tomlPath)) agentFilesToRemove.push(tomlPath);
    if (existsSync(mdPath) && resolve(mdPath).startsWith(codexPrefix)) agentFilesToRemove.push(mdPath);
  }

  // ----- Log plan -----
  log(`[codex-cleanup] mode=${effectiveDryRun ? 'dry-run' : 'PURGE'} | skills=${skillsToRemove.length} | agents=${agentFilesToRemove.length} | scripts=${scriptsToRemove.length} | hooks=${hooksToRemove.length} | configFence=${fencePresent}`);
  for (const p of skillsToRemove) log(`  [skill] ${p}`);
  for (const p of agentFilesToRemove) log(`  [agent] ${p}`);
  for (const p of scriptsToRemove) log(`  [script] ${p}`);
  for (const p of hooksToRemove) log(`  [hook] ${p}`);
  if (fencePresent) log(`  [config] strip QE fence from ${configPath}`);
  if (hooksFencePresent) log(`  [config] strip QE hooks fence from ${configPath}`);

  // Build receipt object before any writes.
  const stamp = backupStamp();
  const receiptDir = join(codexDir, '.qe-cleanup');
  const receiptPath = join(receiptDir, `receipt-${stamp}.json`);
  const receipt = {
    timestamp: new Date().toISOString(),
    mode: effectiveDryRun ? 'dry-run' : 'purge',
    skills: skillsToRemove,
    agents: agentFilesToRemove,
    scripts: scriptsToRemove,
    hooks: hooksToRemove,
    configFenceStripped: false,
    configBackup: null,
  };

  // ----- Dry-run: write receipt and return (no deletions) -----
  if (effectiveDryRun) {
    try {
      mkdirSync(receiptDir, { recursive: true });
      writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
      log(`[codex-cleanup] dry-run receipt written: ${receiptPath}`);
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not write receipt: ${e.message}`);
    }
    return { skills: skillsToRemove, agents: agentFilesToRemove, scripts: scriptsToRemove, hooks: hooksToRemove, configEdited: false, dryRun: true, receiptPath };
  }

  // ----- Purge mode: backup config.toml, strip fence, remove files -----

  let configEdited = false;
  let backupPath = null;
  if ((fencePresent || hooksFencePresent) && configText !== null) {
    try {
      backupPath = `${configPath}.bak-${stamp}`;
      writeFileSync(backupPath, configText, 'utf8'); // backup BEFORE edit
      const stripped = stripQeHooksFence(stripQeAgentFence(configText));
      writeFileSync(configPath, stripped, 'utf8');
      configEdited = true;
      log(`[codex-cleanup] config.toml backed up -> ${backupPath}`);
      log(`[codex-cleanup] config.toml QE fence stripped`);
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: config.toml edit failed: ${e.message}`);
    }
  }

  // Remove agent files one by one (never blanket).
  for (const p of agentFilesToRemove) {
    try {
      rmSync(p, { force: true });
      log(`[codex-cleanup] removed agent file: ${p}`);
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not remove ${p}: ${e.message}`);
    }
  }

  // Remove skill directories one by one (never blanket).
  for (const p of skillsToRemove) {
    try {
      rmSync(p, { recursive: true, force: true });
      log(`[codex-cleanup] removed skill dir: ${p}`);
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not remove ${p}: ${e.message}`);
    }
  }

  // Remove installed scripts subtree explicitly (never broader than ~/.codex/scripts).
  for (const p of scriptsToRemove) {
    try {
      if (resolve(p) !== resolve(scriptsDir)) {
        log(`[WARN] cleanupCodexAssets: skipping unexpected scripts path: ${p}`);
        continue;
      }
      rmSync(p, { recursive: true, force: true });
      log(`[codex-cleanup] removed scripts dir: ${p}`);
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not remove ${p}: ${e.message}`);
    }
  }

  // Remove installed hooks subtree explicitly (never broader than ~/.codex/hooks).
  for (const p of hooksToRemove) {
    try {
      if (resolve(p) !== resolve(hooksDir)) {
        log(`[WARN] cleanupCodexAssets: skipping unexpected hooks path: ${p}`);
        continue;
      }
      rmSync(p, { recursive: true, force: true });
      log(`[codex-cleanup] removed hooks dir: ${p}`);
    } catch (e) {
      log(`[WARN] cleanupCodexAssets: could not remove ${p}: ${e.message}`);
    }
  }

  // Write purge receipt.
  receipt.configFenceStripped = configEdited;
  receipt.configBackup = backupPath;
  try {
    mkdirSync(receiptDir, { recursive: true });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    log(`[codex-cleanup] purge receipt written: ${receiptPath}`);
  } catch (e) {
    log(`[WARN] cleanupCodexAssets: could not write purge receipt: ${e.message}`);
  }

  return {
    skills: skillsToRemove,
    agents: agentFilesToRemove,
    scripts: scriptsToRemove,
    hooks: hooksToRemove,
    configEdited,
    dryRun: false,
    receiptPath,
    configBackup: backupPath,
  };
}

// ---------------------------------------------------------------------------
// Codex install (dual-target)
// ---------------------------------------------------------------------------

/**
 * Parse YAML-style frontmatter from a Markdown file.
 * Returns { metadata: Record<string,string>, body: string }.
 * If no frontmatter block is present, metadata is {} and body is the full text.
 *
 * @param {string} markdown - Raw markdown string (UTF-8)
 * @returns {{ metadata: Record<string, string>, body: string }}
 */
function parseAgentFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { metadata: {}, body: markdown.trim() };
  }

  const metadata = {};
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    // Strip surrounding quotes (single or double)
    metadata[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }

  return {
    metadata,
    body: markdown.slice(match[0].length).trim(),
  };
}

/**
 * Escape a string for safe use as a TOML quoted value.
 * @param {string} value
 * @returns {string}
 */
function quoteToml(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Escape a string for TOML multi-line basic strings.
 * Newlines are preserved; quotes/backslashes/control characters are escaped.
 *
 * @param {string} value
 * @returns {string}
 */
function quoteTomlMultilineBasic(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\u0008/g, '\\b')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f');
}

function inferReasoningEffort(modelHint) {
  const model = String(modelHint || '').toLowerCase();
  if (model.includes('opus')) return 'high';
  if (model.includes('sonnet')) return 'medium';
  if (model.includes('haiku')) return 'low';
  return '';
}

function renderCodexCompatibilityNote({ modelHint, reasoningEffortHint, toolsHint }) {
  const lines = [
    '# Codex Native Agent Compatibility',
    '',
    'This file was generated from a QE Framework Claude agent markdown file.',
    '',
    '- QE maps Claude Agent-tool workflows to Codex native subagents through the client adapter.',
    '- Invoke this agent explicitly from Codex when native subagents are available.',
    '- If a Codex runtime lacks a required subagent primitive, preserve the role contract with role-separated inline execution and mark the fallback explicitly.',
  ];
  if (modelHint) lines.push(`- Source recommendedModel hint: \`${modelHint}\`.`);
  if (reasoningEffortHint) lines.push(`- Source reasoning effort hint: \`${reasoningEffortHint}\`.`);
  if (toolsHint) lines.push(`- Source tool/MCP hint: \`${toolsHint}\`.`);
  lines.push('', '---', '');
  return lines.join('\n');
}

/**
 * Render a Codex agent TOML file from name, description, and instruction body.
 *
 * @param {{ name: string, description: string, instructions: string, metadata?: Record<string, string> }} opts
 * @returns {string} TOML content
 */
function renderCodexAgentToml({ name, description, instructions, metadata = {} }) {
  const modelHint = metadata.recommendedModel || metadata.model || '';
  const reasoningEffortHint = metadata.reasoningEffort
    || metadata.reasoning_effort
    || metadata.model_reasoning_effort
    || inferReasoningEffort(modelHint);
  const toolsHint = metadata.tools || metadata.mcp || metadata.MCP || '';
  const sandboxMode = metadata.sandbox_mode || metadata.sandboxMode || 'workspace-write';
  const compatibilityNote = renderCodexCompatibilityNote({ modelHint, reasoningEffortHint, toolsHint });
  const developerInstructions = `${compatibilityNote}${instructions.replace(/\r\n/g, '\n').replace(/\r/g, '\n')}`;

  const lines = [
    '# QE-generated Codex native agent',
    `name = ${quoteToml(name)}`,
    `description = ${quoteToml(description)}`,
  ];
  // NOTE: Codex (>=0.142.x) strict-deserializes agent role TOML and rejects the
  // whole file on any unknown top-level key. The model/effort/tools hints are
  // therefore carried inside developer_instructions (compatibility note) only,
  // not as top-level qe_*_hint keys.
  lines.push(
    `sandbox_mode = ${quoteToml(sandboxMode)}`,
    'developer_instructions = """',
    quoteTomlMultilineBasic(developerInstructions),
    '"""',
    '',
  );
  return [
    ...lines,
  ].join('\n');
}

/**
 * Render the managed QE fence block for config.toml.
 * Contains one [agents."<name>"] entry per installed agent.
 *
 * @param {string} agentsDir - Absolute path to ~/.codex/agents
 * @param {Array<{ name: string, description: string }>} entries
 * @returns {string} Multi-line TOML block (begins with QE_CODEX_CONFIG_BEGIN, ends with QE_CODEX_CONFIG_END)
 */
function renderCodexAgentConfigBlock(agentsDir, entries) {
  const lines = [QE_CODEX_CONFIG_BEGIN, ''];
  for (const entry of entries) {
    lines.push(`[agents.${quoteToml(entry.name)}]`);
    lines.push(`description = ${quoteToml(entry.description)}`);
    lines.push(`config_file = ${quoteToml(join(agentsDir, `${entry.name}.toml`))}`);
    lines.push('');
  }
  lines.push(QE_CODEX_CONFIG_END, '');
  return lines.join('\n');
}

const CODEX_LIFECYCLE_HOOKS = [
  { event: 'SessionStart', script: 'scripts/session-start.mjs', timeout: 10, statusMessage: 'QE session bootstrap' },
  { event: 'PreToolUse', matcher: '*', script: 'scripts/pre-tool-use.mjs', timeout: 5, statusMessage: 'QE safety guard' },
  { event: 'PreCompact', script: 'scripts/pre-compact.mjs', timeout: 10, statusMessage: 'QE compaction guard' },
  { event: 'PostToolUse', matcher: '^(Write|Edit|Bash|Shell|shell|exec_command)$', script: 'scripts/post-tool-use.mjs', timeout: 15, statusMessage: 'QE post-tool checks' },
  { event: 'Stop', script: 'scripts/stop-handler.mjs', timeout: 5, statusMessage: 'QE stop guard' },
  { event: 'UserPromptSubmit', script: 'scripts/prompt-check.mjs', timeout: 8, statusMessage: 'QE prompt router' },
  { event: 'Notification', script: 'scripts/notification.mjs', timeout: 5, statusMessage: 'QE notification handler' },
  { event: 'TeammateIdle', script: 'scripts/teammate-idle.mjs', timeout: 10, statusMessage: 'QE teammate idle handler' },
  { event: 'TaskCompleted', script: 'scripts/task-completed.mjs', timeout: 10, statusMessage: 'QE task completion handler' },
];

function resolveInstalledCodexHookPath(homeDir, log = () => {}) {
  return join(homeDir, '.codex', 'hooks', 'scripts', 'codex', 'lifecycle-codex.mjs');
}

/**
 * Render the managed QE Codex hooks fence block for config.toml.
 *
 * @param {string} entryPath - Absolute installed hook entry script path
 * @returns {string} Multi-line TOML block
 */
function renderCodexHooksConfigBlock(entryPath) {
  const lines = [QE_CODEX_HOOKS_BEGIN, ''];
  for (const hook of CODEX_LIFECYCLE_HOOKS) {
    lines.push(`[[hooks.${hook.event}]]`);
    if (hook.matcher) lines.push(`matcher = ${quoteToml(hook.matcher)}`);
    lines.push('');
    lines.push(`[[hooks.${hook.event}.hooks]]`);
    lines.push('type = "command"');
    lines.push(`command = ${quoteToml(`node "${entryPath}" "${hook.event}" "${hook.script}"`)}`);
    lines.push(`timeout = ${hook.timeout}`);
    lines.push(`statusMessage = ${quoteToml(hook.statusMessage)}`);
    lines.push('');
  }
  lines.push(QE_CODEX_HOOKS_END, '');
  return lines.join('\n');
}

const CODEX_SKILL_DESCRIPTION_MAX = 220;

function normalizeSkillDescription(value) {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\s+/g, ' ');
}

function truncateDescription(value, maxLength = CODEX_SKILL_DESCRIPTION_MAX) {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, Math.max(0, maxLength - 1));
  const boundary = clipped.search(/\s+\S*$/);
  return `${clipped.slice(0, boundary > 80 ? boundary : clipped.length).trimEnd()}…`;
}

function compactSkillDescriptionForCodex(description) {
  const normalized = normalizeSkillDescription(description);
  if (normalized.length <= CODEX_SKILL_DESCRIPTION_MAX) return normalized;

  const triggerMatch = normalized.match(/\b(Use when|Use for|Invoke for|Trigger phrases:)\b/i);
  if (!triggerMatch) return truncateDescription(normalized);

  const summary = truncateDescription(
    normalized.slice(0, triggerMatch.index).replace(/\s*(Distinct from|Complements|Supports)\b.*$/i, '').trim(),
    100,
  );
  const trigger = truncateDescription(normalized.slice(triggerMatch.index), CODEX_SKILL_DESCRIPTION_MAX - summary.length - 1);
  return truncateDescription(`${summary} ${trigger}`);
}

function compactCodexSkillMarkdown(markdown) {
  if (!markdown.startsWith('---\n')) return { markdown, changed: false };
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return { markdown, changed: false };

  const frontmatter = markdown.slice(4, end);
  const nextFrontmatter = frontmatter.replace(/^description:\s*(.+)$/m, (line, rawDescription) => {
    const compact = compactSkillDescriptionForCodex(rawDescription);
    if (normalizeSkillDescription(rawDescription) === compact) return line;
    return `description: ${JSON.stringify(compact)}`;
  });

  if (nextFrontmatter === frontmatter) return { markdown, changed: false };
  return { markdown: `---\n${nextFrontmatter}${markdown.slice(end)}`, changed: true };
}

function copyCodexSkillDirectory(src, dest) {
  let compacted = 0;
  let stat;
  try { stat = lstatSync(src); } catch { return compacted; }
  if (stat.isSymbolicLink()) return compacted;
  if (stat.isDirectory()) {
    ensureDir(dest);
    let entries = [];
    try { entries = readdirSync(src); } catch {}
    for (const entry of entries) {
      compacted += copyCodexSkillDirectory(join(src, entry), join(dest, entry));
    }
    return compacted;
  }

  ensureDir(dirname(dest));
  if (src.endsWith(`${sep}SKILL.md`)) {
    const source = readFileSync(src, 'utf8');
    const result = compactCodexSkillMarkdown(source);
    writeFileSync(dest, result.markdown, 'utf8');
    return result.changed ? 1 : 0;
  }
  copyFileSync(src, dest);
  return compacted;
}

function collectSkillSourceDirs(skillsDir, baseDir = skillsDir, out = []) {
  let stat;
  try { stat = lstatSync(skillsDir); } catch { return out; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return out;

  if (existsSync(join(skillsDir, 'SKILL.md'))) {
    out.push({
      src: skillsDir,
      rel: relative(baseDir, skillsDir).split(sep).join('/'),
    });
    return out;
  }

  let entries = [];
  try { entries = readdirSync(skillsDir); } catch { return out; }
  for (const entry of entries) {
    collectSkillSourceDirs(join(skillsDir, entry), baseDir, out);
  }
  return out;
}

/**
 * Synchronise the codex-cleanup-manifest.json to include every skill name
 * currently in the repo `skills/` directory. Union with existing entries,
 * deduplicate, and write sorted. Ensures manifest symmetry: every skill
 * installCodexAssets() writes can later be removed by cleanupCodexAssets().
 *
 * @param {string} repoRoot - Repository root path
 * @param {Function} log - Logger
 */
function syncCleanupManifest(repoRoot, log = () => {}) {
  const manifestPath = join(MODULE_DIR, 'codex-cleanup-manifest.json');
  const skillsDir = join(repoRoot, 'skills');

  let existing = { skills: [] };
  try {
    existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(existing.skills)) existing.skills = [];
  } catch { /* first run or parse error — start fresh */ }

  const current = collectSkillSourceDirs(skillsDir).map((entry) => entry.rel);

  // Union: preserve historical entries, add new ones, dedup, sort
  const merged = [...new Set([...existing.skills, ...current])].sort();

  const next = { ...existing, skills: merged };
  try {
    writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    log(`[codex-install] manifest synced: ${merged.length} skills`);
  } catch (e) {
    log(`[WARN] installCodexAssets: could not write manifest: ${e.message}`);
  }
}

/**
 * Install QE Framework assets into ~/.codex.
 *
 * Safety contract:
 *  - Injectable homeDir: NEVER touches real ~/.codex in tests.
 *  - Graceful skip: if ~/.codex does not exist, logs a skip line and returns
 *    WITHOUT creating any directory (user is not a Codex user).
 *  - Skills: each skills/<dir> copied to ~/.codex/skills/<dir> (overwrite-safe).
 *  - Agents: each agents/*.md parsed, rendered to <name>.toml, written to
 *    ~/.codex/agents/<name>.toml; entries collected for config fence.
 *  - config.toml: backed up via backupStamp() before edit; existing QE fence
 *    stripped with stripQeAgentFence() then a freshly rendered fence appended
 *    (idempotent — re-install does NOT duplicate the fence).
 *  - Manifest: synced so cleanupCodexAssets() can remove every installed skill.
 *  - dryRun: when true, prints the plan and returns without writing anything.
 *
 * @param {object} opts
 * @param {string}   [opts.repoRoot] - repository root (default: auto-detected)
 * @param {string}   [opts.homeDir]  - injectable home dir (default: os.homedir())
 * @param {Function} [opts.log]      - logger (default: console.log)
 * @param {boolean}  [opts.dryRun]   - if true, print plan only; write nothing
 * @returns {{ skipped: boolean, skills: number, agents: number, dryRun: boolean }}
 */
export function installCodexAssets({
  repoRoot = REPO_ROOT,
  homeDir = homedir(),
  log = console.log,
  dryRun = false,
  syncManifest = true,
} = {}) {
  if (!homeDir || typeof homeDir !== 'string' || homeDir.trim() === '') {
    throw new Error('installCodexAssets: refusing to run with empty homeDir (would resolve to a cwd-relative .codex path)');
  }

  const codexDir = join(homeDir, '.codex');

  // Graceful skip: do NOT create ~/.codex if the user isn't a Codex user.
  if (!existsSync(codexDir)) {
    log('[codex-install] ~/.codex not found — skipping Codex install (not a Codex user).');
    return { skipped: true, skills: 0, agents: 0, dryRun };
  }

  const skillsSrcDir = join(repoRoot, 'skills');
  const agentsSrcDir = join(repoRoot, 'agents');
  const scriptsSrcDir = join(repoRoot, 'scripts');
  const hooksSrcDir = join(repoRoot, 'hooks');
  const codexSkillsDir = join(codexDir, 'skills');
  const codexAgentsDir = join(codexDir, 'agents');
  const codexScriptsDir = join(codexDir, 'scripts');
  const codexHooksDir = join(codexDir, 'hooks');
  const codexConfigPath = join(codexDir, 'config.toml');

  if (dryRun) {
    log('[codex-install] dry-run — no files will be written');
    let skillCount = 0;
    let agentCount = 0;
    if (existsSync(skillsSrcDir)) {
      skillCount = collectSkillSourceDirs(skillsSrcDir).length;
    }
    if (existsSync(agentsSrcDir)) {
      try { agentCount = readdirSync(agentsSrcDir).filter((e) => e.endsWith('.md')).length; } catch {}
    }
    log(`[codex-install] would install ${skillCount} skill(s), ${agentCount} agent(s), upsert config fence`);
    if (existsSync(scriptsSrcDir)) {
      log(`[codex-install] would copy scripts/ -> ${codexScriptsDir}`);
    }
    if (existsSync(hooksSrcDir)) {
      log(`[codex-install] would copy hooks/ -> ${codexHooksDir}`);
    }
    return { skipped: false, skills: skillCount, agents: agentCount, dryRun: true };
  }

  // ----- Skills -----
  let skillCount = 0;
  let compactedSkillDescriptions = 0;
  if (existsSync(skillsSrcDir)) {
    ensureDir(codexSkillsDir);
    for (const { src, rel } of collectSkillSourceDirs(skillsSrcDir)) {
      const dest = join(codexSkillsDir, ...rel.split('/'));
      compactedSkillDescriptions += copyCodexSkillDirectory(src, dest);
      log(`[codex-install] skill: ${rel} -> ${codexSkillsDir}`);
      skillCount++;
    }
    log(`[codex-install] ${skillCount} skill(s) installed for Codex.`);
    if (compactedSkillDescriptions > 0) {
      log(`[codex-install] compacted ${compactedSkillDescriptions} Codex skill description(s) for context budget.`);
    }
    // Keep manifest in sync so cleanupCodexAssets can remove these skills later.
    // Skippable so tests never mutate the tracked repo manifest (test isolation).
    if (syncManifest) syncCleanupManifest(repoRoot, log);
  } else {
    log('[codex-install] skills/ not found — skipping Codex skills.');
  }

  // ----- Agents -----
  const agentEntries = [];
  if (existsSync(agentsSrcDir)) {
    ensureDir(codexAgentsDir);
    let mdFiles = [];
    try { mdFiles = readdirSync(agentsSrcDir).filter((e) => e.endsWith('.md')); } catch {}
    for (const entry of mdFiles) {
      const srcPath = join(agentsSrcDir, entry);
      let markdown = '';
      try { markdown = readFileSync(srcPath, 'utf8'); } catch { continue; }
      const { metadata, body } = parseAgentFrontmatter(markdown);
      const name = metadata.name || entry.replace(/\.md$/i, '');
      const description = metadata.description || `${name} agent installed by QE Framework.`;
      const tomlContent = renderCodexAgentToml({ name, description, instructions: body, metadata });
      const tomlDest = join(codexAgentsDir, `${name}.toml`);
      writeFileSync(tomlDest, tomlContent, 'utf8');
      agentEntries.push({ name, description });
      log(`[codex-install] agent: ${entry} -> ${tomlDest}`);
    }
    log(`[codex-install] ${agentEntries.length} agent(s) installed for Codex.`);
  } else {
    log('[codex-install] agents/ not found — skipping Codex agents.');
  }

  // ----- Scripts -----
  if (existsSync(scriptsSrcDir)) {
    ensureDir(codexScriptsDir);
    copyRecursive(scriptsSrcDir, codexScriptsDir);
    log(`[codex-install] scripts/ copied -> ${codexScriptsDir}`);
  } else {
    log('[codex-install] scripts/ not found — skipping Codex scripts.');
  }

  // ----- Hooks -----
  if (existsSync(hooksSrcDir)) {
    ensureDir(codexHooksDir);
    copyRecursive(hooksSrcDir, codexHooksDir);
    log(`[codex-install] hooks/ copied -> ${codexHooksDir}`);
  } else {
    log('[codex-install] hooks/ not found — skipping Codex hooks.');
  }

  // ----- config.toml fence upsert -----
  const stamp = backupStamp();
  const currentConfig = existsSync(codexConfigPath)
    ? readFileSync(codexConfigPath, 'utf8')
    : '';
  if (existsSync(codexConfigPath)) {
    const backupPath = `${codexConfigPath}.bak-${stamp}`;
    writeFileSync(backupPath, currentConfig, 'utf8');
    log(`[codex-install] config.toml backed up -> ${backupPath}`);
  }
  const installedHookPath = resolveInstalledCodexHookPath(homeDir, log);
  const migratedHookFeature = migrateDeprecatedCodexHookFeature(currentConfig);
  if (migratedHookFeature.changed) {
    log('[codex-install] migrated deprecated [features].codex_hooks to [features].hooks.');
  }
  const stripped = stripQeHooksFence(stripQeAgentFence(migratedHookFeature.text));
  const blocks = [stripped];
  if (agentEntries.length > 0) {
    blocks.push(renderCodexAgentConfigBlock(codexAgentsDir, agentEntries));
  }
  blocks.push(renderCodexHooksConfigBlock(installedHookPath));
  const nextConfig = blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  writeFileSync(codexConfigPath, `${nextConfig}\n`, 'utf8');
  if (agentEntries.length > 0) {
    log(`[codex-install] config.toml fence upserted (${agentEntries.length} agent entries).`);
  }
  log('[codex-install] QE hooks installed — run /hooks in Codex to review and approve them.');

  // Record the installed version so SessionStart drift-detection can tell when
  // the plugin has been updated but Codex assets weren't re-synced yet. The
  // SessionStart hook reads ~/.codex/.qe-codex-version and, if it lags the
  // loaded plugin version, kicks off a background re-sync. Best-effort: a
  // failed stamp just means the next session re-syncs again (idempotent).
  try {
    let version = 'unknown';
    try { version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version; } catch {}
    writeFileSync(
      join(codexDir, '.qe-codex-version'),
      `${JSON.stringify({ version, ts: new Date().toISOString() })}\n`,
      'utf8',
    );
    log(`[codex-install] version stamp written: ${version}`);
  } catch { /* stamp is best-effort — never fail the install on it */ }

  return { skipped: false, skills: skillCount, agents: agentEntries.length, dryRun: false };
}

/**
 * Copy a file or directory recursively (symlinks skipped — traversal guard).
 * @param {string} src
 * @param {string} dest
 */
function copyRecursive(src, dest) {
  let stat;
  try { stat = lstatSync(src); } catch { return; }
  if (stat.isSymbolicLink()) return; // traversal guard (mirrors collectCopyPairs)
  if (stat.isDirectory()) {
    ensureDir(dest);
    let entries = [];
    try { entries = readdirSync(src); } catch {}
    for (const entry of entries) copyRecursive(join(src, entry), join(dest, entry));
    return;
  }
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
}

/**
 * Report install state: mode, version, where assets live (present/absent), and how
 * many reversible backups exist. Read-only.
 * @returns {{mode, version, present, backups}}
 */
export function doctor({ repoRoot = REPO_ROOT, homeDir = homedir(), log = console.log } = {}) {
  const { mode, targets, pluginPath } = resolveTargets(repoRoot, homeDir, log);
  let version = 'unknown';
  try { version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version; } catch {}

  log('QE Framework — doctor');
  log(`  mode:    ${mode}${pluginPath ? ` (${pluginPath})` : ''}`);
  log(`  version: ${version}`);
  log('  assets:');
  let present = 0;
  for (const { dest, label } of targets) {
    const here = existsSync(dest);
    if (here) present++;
    log(`    ${label.padEnd(11)} ${here ? 'present' : 'absent '}  ${dest}`);
  }
  const backupRoot = join(homeDir, '.claude', '.qe-backup');
  const backups = existsSync(backupRoot)
    ? readdirSync(backupRoot).filter((d) => existsSync(join(backupRoot, d, 'manifest.json'))).sort()
    : [];
  log(`  backups: ${backups.length}${backups.length ? ` (latest: ${backups[backups.length - 1]})` : ''}`);

  // Codex drift: cross-check the config.toml QE fence against the .toml files it
  // references. A fenced agent whose config_file is missing makes Codex log a
  // "malformed agent role definition" warning per entry. Read-only — surfaces the
  // exact drift so `qe-framework-install` (now dual-target) can repair it.
  const codexDir = join(homeDir, '.codex');
  let codexFenced = 0;
  let codexMissing = 0;
  let codexStamp = null;
  let codexHookInstalled = false;
  let codexHookFenced = false;
  let codexHookEvents = [];
  if (existsSync(codexDir)) {
    const codexConfigPath = join(codexDir, 'config.toml');
    const expectedHookPath = resolveInstalledCodexHookPath(homeDir);
    codexHookInstalled = existsSync(expectedHookPath);
    if (existsSync(codexConfigPath)) {
      let cfgText = '';
      try { cfgText = readFileSync(codexConfigPath, 'utf8'); } catch {}
      const fenced = parseQeAgentFence(cfgText);
      if (fenced) {
        codexFenced = fenced.length;
        codexMissing = fenced.filter((a) => !existsSync(a.configFile)).length;
      }
      codexHookFenced = cfgText.includes(expectedHookPath);
      codexHookEvents = parseCodexHookEvents(cfgText, expectedHookPath);
    }
    try {
      codexStamp = JSON.parse(readFileSync(join(codexDir, '.qe-codex-version'), 'utf8')).version;
    } catch { /* stamp absent → never synced (or externally cleared) */ }
    log('  codex:');
    log(`    version stamp: ${codexStamp || 'none'}`);
    log(`    fenced agents: ${codexFenced}`);
    log(`    hook bundle: ${codexHookInstalled ? 'present' : 'missing'}`);
    log(`    hook fence: ${codexHookFenced ? 'points to ~/.codex/hooks ✓' : 'missing/stale'}`);
    log(`    hook events: ${codexHookEvents.length ? codexHookEvents.join(', ') : 'none'}`);
    if (codexMissing > 0) {
      log(`    ⚠ ${codexMissing} fenced agent(s) reference a missing .toml — run qe-framework-install to repair`);
    } else if (codexFenced > 0) {
      log('    all fenced agents resolve ✓');
    }
  }
  return { mode, version, present, backups: backups.length, codexFenced, codexMissing, codexStamp, codexHookInstalled, codexHookFenced, codexHookEvents };
}
