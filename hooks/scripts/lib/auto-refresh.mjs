'use strict';

// Background auto-refresh of .qe/analysis/.
//
// When the session-start hook detects stale analysis, it can self-heal without the
// user running /Qrefresh: spawn a detached, headless `claude -p /Qrefresh` on the
// Haiku model. Permissions are NOT bypassed. Instead we use:
//   --permission-mode dontAsk   → no TTY prompt; un-allowed tools fail-closed (deny,
//                                  never hang) so a missing pattern can only skip part
//                                  of the analysis, never block or escalate.
//   --allowedTools <allowlist>  → only the tools Erefresh-executor needs, with Edit/
//                                  Write path-scoped to .qe/** so the refresh can never
//                                  modify project source.
//
// Two entry points (the session-start hook calls both when analysis is stale):
//   maybeSpawnRefresh()     — one-shot refresh at session start (lock-guarded).
//   ensurePeriodicRefresh() — start a recurring qcron tmux job if not already running.

import { existsSync, statSync, mkdirSync, writeFileSync } from './qe-fs.mjs';
import { join } from 'path';
import { execSync, spawn } from 'child_process';

// Allowlist scoped to what Erefresh-executor (Read/Write/Edit/Grep/Glob/Bash) needs to
// rebuild .qe/analysis/. Edit/Write are path-locked to .qe/** so project source is never
// touched. Bash is limited to read-only inspection commands. dontAsk denies anything not
// listed here, so the worst case is an incomplete refresh — never a destructive one.
export const REFRESH_ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob',
  'Edit(.qe/**)', 'Write(.qe/**)',
  'Bash(ls *)', 'Bash(find *)', 'Bash(cat *)', 'Bash(wc *)',
  'Bash(head *)', 'Bash(tail *)', 'Bash(stat *)',
  'Bash(git log *)', 'Bash(git status *)', 'Bash(git diff *)',
].join(' ');

/**
 * Resolve the `claude` CLI to an absolute path.
 * A detached process does not inherit the interactive shell PATH reliably (claude
 * often lives in ~/.local/bin), so resolve it up front.
 * @returns {string|null} absolute path to the claude binary, or null if not found
 */
function resolveClaudeBin() {
  try {
    const p = execSync('command -v claude', { encoding: 'utf8' }).trim();
    return p || null;
  } catch {
    return null;
  }
}

/**
 * Check whether tmux is available on PATH (required for the periodic refresh job).
 * @returns {boolean} true if the tmux CLI is found
 */
function hasTmux() {
  try {
    execSync('command -v tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * One-shot background refresh at session start.
 * Lock-guarded so concurrent terminals do not spawn duplicate runs.
 * @returns {boolean} true if a fresh refresh was launched
 */
export function maybeSpawnRefresh(cwd, cfg) {
  if (!cfg.auto_refresh_enabled) return false;

  const qeDir = join(cwd, '.qe');
  const lockPath = join(qeDir, '.refresh.lock');
  const ttl = cfg.auto_refresh_lock_ttl_ms;

  // Skip if another session is already refreshing within the lock TTL.
  try {
    if (existsSync(lockPath)) {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age < ttl) return false;
    }
  } catch { /* unreadable lock — fall through and attempt refresh */ }

  const claudeBin = resolveClaudeBin();
  if (!claudeBin) return false;

  // Stamp the lock before spawning (best-effort).
  try {
    mkdirSync(qeDir, { recursive: true });
    writeFileSync(lockPath, String(Date.now()));
  } catch { /* non-fatal */ }

  const args = [
    '-p', '/Qrefresh',
    '--model', cfg.auto_refresh_model,
    '--permission-mode', 'dontAsk',
    '--allowedTools', REFRESH_ALLOWED_TOOLS,
  ];

  try {
    const child = spawn(claudeBin, args, { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a recurring qcron tmux job (id: auto-refresh) if not already running.
 * No-op when tmux is absent or the daemon script cannot be located.
 * @returns {boolean} true if a periodic job was started this call
 */
export function ensurePeriodicRefresh(cwd, cfg, pluginRoot) {
  if (!cfg.auto_refresh_enabled) return false;
  if (!hasTmux()) return false;

  // Already running?
  try {
    const sessions = execSync('tmux ls 2>/dev/null', { encoding: 'utf8' });
    if (sessions.includes('qcron-auto-refresh')) return false;
  } catch { /* no tmux server yet — proceed to start the job */ }

  const daemon = pluginRoot ? join(pluginRoot, 'scripts', 'qcron-daemon.sh') : null;
  if (!daemon || !existsSync(daemon)) return false;

  const intervalSec = Math.round(cfg.auto_refresh_interval_ms / 1000);
  // daemon args: start <job_id> <interval> <mission> <model> <perm_mode>
  // perm_mode 'allowlist' makes the daemon run with dontAsk + the .qe/-scoped allowlist
  // instead of the default --dangerously-skip-permissions.
  const args = [daemon, 'start', 'auto-refresh', String(intervalSec), '/Qrefresh', cfg.auto_refresh_model, 'allowlist'];

  try {
    const child = spawn('bash', args, { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
