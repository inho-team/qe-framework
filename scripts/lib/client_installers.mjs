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

  if (existsSync(skillsDir)) {
    let entries;
    try { entries = readdirSync(skillsDir); } catch { entries = []; }
    for (const entry of entries) {
      // Must be in the known manifest AND contain SKILL.md.
      if (!knownSkillNames.has(entry)) continue;
      const entryPath = join(skillsDir, entry);
      let stat;
      try { stat = lstatSync(entryPath); } catch { continue; }
      if (!stat.isDirectory()) continue;
      if (!existsSync(join(entryPath, 'SKILL.md'))) continue;
      skillsToRemove.push(entryPath);
    }
  }

  // ----- Agents: fence-driven authoritative list -----
  const configPath = join(codexDir, 'config.toml');
  let qeAgents = []; // { name, configFile }
  let configText = null;
  let fencePresent = false;

  if (existsSync(configPath)) {
    try { configText = readFileSync(configPath, 'utf8'); } catch { configText = null; }
    if (configText !== null) {
      const parsed = parseQeAgentFence(configText);
      if (parsed !== null) {
        fencePresent = true;
        qeAgents = parsed;
      }
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
  log(`[codex-cleanup] mode=${effectiveDryRun ? 'dry-run' : 'PURGE'} | skills=${skillsToRemove.length} | agents=${agentFilesToRemove.length} | configFence=${fencePresent}`);
  for (const p of skillsToRemove) log(`  [skill] ${p}`);
  for (const p of agentFilesToRemove) log(`  [agent] ${p}`);
  if (fencePresent) log(`  [config] strip QE fence from ${configPath}`);

  // Build receipt object before any writes.
  const stamp = backupStamp();
  const receiptDir = join(codexDir, '.qe-cleanup');
  const receiptPath = join(receiptDir, `receipt-${stamp}.json`);
  const receipt = {
    timestamp: new Date().toISOString(),
    mode: effectiveDryRun ? 'dry-run' : 'purge',
    skills: skillsToRemove,
    agents: agentFilesToRemove,
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
    return { skills: skillsToRemove, agents: agentFilesToRemove, configEdited: false, dryRun: true, receiptPath };
  }

  // ----- Purge mode: backup config.toml, strip fence, remove files -----

  let configEdited = false;
  let backupPath = null;
  if (fencePresent && configText !== null) {
    try {
      backupPath = `${configPath}.bak-${stamp}`;
      writeFileSync(backupPath, configText, 'utf8'); // backup BEFORE edit
      const stripped = stripQeAgentFence(configText);
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
    configEdited,
    dryRun: false,
    receiptPath,
    configBackup: backupPath,
  };
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
  return { mode, version, present, backups: backups.length };
}
