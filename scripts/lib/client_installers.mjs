#!/usr/bin/env node

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, '..', '..');

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
 */
export function uninstallClaudeAssets({ repoRoot = REPO_ROOT, homeDir = homedir(), log = console.log, restore = false } = {}) {
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
