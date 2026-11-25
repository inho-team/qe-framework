// Shared helpers for the global ~/.qe home (git-tracked task docs). Hooks must
// never fail a session, so nothing here throws: failures become false/null.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function qeHome(env = process.env) {
  return env.QE_HOME || path.join(os.homedir(), '.qe');
}

export function tasksDir(home) {
  return path.join(home, 'tasks');
}

// Hooks have a 10 s budget, so each git call gets 3 s. QE_GIT_TIMEOUT_MS overrides it
// (tests running many git processes in parallel need longer).
export function gitTimeout(env = process.env) {
  const n = Number.parseInt(env?.QE_GIT_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

// Trimmed stdout, or null on failure, non-zero exit, or timeout.
export function git(cwd, args) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: gitTimeout(), windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return (r.stdout ?? '').trim();
  } catch {
    return null;
  }
}

export function ensureHome(home) {
  try {
    fs.mkdirSync(tasksDir(home), { recursive: true });
    if (!fs.existsSync(path.join(home, '.git')) && git(home, ['init', '-q']) === null) return false;
    return true;
  } catch {
    return false;
  }
}

export function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}

// A git killed by a hook timeout leaves .git/index.lock behind, and then every later commit
// fails. A lock older than any real commit here (30 s) is such a leftover; a newer one may
// belong to a commit running right now in another session, so it stays.
const STALE_LOCK_MS = 30_000;

function clearStaleLock(home) {
  try {
    const lock = path.join(home, '.git', 'index.lock');
    const st = fs.statSync(lock, { throwIfNoEntry: false });
    if (st && Date.now() - st.mtimeMs > STALE_LOCK_MS) fs.rmSync(lock, { force: true });
  } catch {
    // ignore: the commit below simply fails
  }
}

export function commitHome(home, message) {
  try {
    if (!fs.existsSync(path.join(home, '.git'))) return false;
    clearStaleLock(home);
    if (git(home, ['add', '-A']) === null) return false;
    // Global git hooks (e.g. LFS post-commit) can take seconds and have no
    // business in this housekeeping repo, so run without them.
    const args = ['-c', 'user.name=qe', '-c', 'user.email=qe@localhost', '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', message];
    return git(home, args) !== null;
  } catch {
    return false;
  }
}

// Make a tool-supplied path comparable: ~ expansion, Win32 extended prefixes (\\?\, \\.\),
// Git Bash drive paths (/c/...). Without this a write under ~/.qe/tasks is not recognized.
export function cleanPath(p, platform = process.platform) {
  let f = p;
  if (f === '~' || f.startsWith('~/') || f.startsWith('~\\')) f = os.homedir() + f.slice(1);
  if (platform === 'win32') {
    f = f.replace(/^[\\/]{2}[?.][\\/]/, '');
    f = f.replace(/^[\\/]([a-zA-Z])(?=[\\/]|$)/, (_, d) => d.toUpperCase() + ':');
  }
  return f;
}

// Comparison only: Windows and macOS (APFS) are case-insensitive by default.
export function normPath(p, platform = process.platform) {
  const r = path.resolve(p);
  return platform === 'win32' || platform === 'darwin' ? r.toLowerCase() : r;
}

export function isUnder(child, parent, platform = process.platform) {
  const rel = path.relative(normPath(parent, platform), normPath(child, platform));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
