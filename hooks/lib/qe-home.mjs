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

// Trimmed stdout, or null on failure, non-zero exit, or timeout.
export function git(cwd, args) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3000, windowsHide: true });
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

export function commitHome(home, message) {
  try {
    if (!fs.existsSync(path.join(home, '.git'))) return false;
    if (git(home, ['add', '-A']) === null) return false;
    // Global git hooks (e.g. LFS post-commit) can take seconds and have no
    // business in this housekeeping repo, so run without them.
    const args = ['-c', 'user.name=qe', '-c', 'user.email=qe@localhost', '-c', 'core.hooksPath=', 'commit', '-q', '--no-verify', '-m', message];
    return git(home, args) !== null;
  } catch {
    return false;
  }
}

// Comparison only: Windows and macOS (APFS) are case-insensitive by default.
export function normPath(p, platform = process.platform) {
  const r = path.resolve(p);
  return platform === 'win32' || platform === 'darwin' ? r.toLowerCase() : r;
}

export function isUnder(child, parent) {
  const rel = path.relative(normPath(parent), normPath(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
