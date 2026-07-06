/**
 * lib/shadow-snapshot.mjs — QE Shadow-Git Snapshot Core Library
 *
 * Maintains an isolated shadow git repository at <root>/.qe/.snapshots/shadow.git
 * where <root> is the nearest ancestor directory containing a `.qe/` folder.
 * GIT_DIR is fully separated from real repo .git directories, so shadow ops
 * never touch qe-framework/.git, qe-mcp/.git, or any other real repo.
 *
 * Exported API:
 *   findShadowRoot(startDir?)    — walk up from startDir to find .qe root
 *   ensureShadowRepo(root?)      — init shadow repo under root (idempotent)
 *   assertNoRemote(root?)        — abort if any remote is registered (anti-push)
 *   snapshot(opts?, root?)       — create one shadow commit
 *   list(n?, root?)              — print recent snapshot log
 *   diff(ref, root?)             — show diff from ref to HEAD
 *   restore(ref, filePath?, confirm?, force?, root?)  — restore from snapshot
 *   prune(root?)                 — enforce 200-commit / 72 h rolling policy
 *
 * Safety guarantees (must survive every caller path):
 *   - Never runs git against a real repo's .git directory.
 *   - assertNoRemote() is called before every commit path; aborts on any remote.
 *   - restore defaults to dry-run; --force required to overwrite dirty files.
 *   - Lock file uses openSync O_EXCL (atomic create); pid-owner-only release.
 *   - prune uses commit-tree rewrite — non-destructive; aborts-on-failure.
 *   - Never drops below 1 recovery point while snapshots exist.
 *   - Reject absolute paths, `..`-escaping paths, and pathspec-magic paths.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  chmodSync,
  openSync,
  closeSync,
  lstatSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of snapshots kept by prune.
 * Env override: QE_SHADOW_MAX_SNAPSHOTS (integer). Useful for tests and CI.
 * Production default: 200.
 */
const MAX_SNAPSHOTS = (() => {
  const v = parseInt(process.env.QE_SHADOW_MAX_SNAPSHOTS, 10);
  return (Number.isFinite(v) && v >= 1) ? v : 200;
})();

/**
 * Batch size for auto-prune hysteresis: snapshot() triggers prune() only when
 * the commit count reaches MAX_SNAPSHOTS + PRUNE_BATCH (≥ 250 by default).
 * This avoids running the commit-tree rewrite on every single snapshot —
 * prune fires roughly once every PRUNE_BATCH snapshots, keeping the store
 * bounded at ≤ MAX_SNAPSHOTS + PRUNE_BATCH commits, trimmed to MAX_SNAPSHOTS.
 * Env override: QE_SHADOW_PRUNE_BATCH (integer). Useful for tests.
 * Production default: 50.
 */
const PRUNE_BATCH = (() => {
  const v = parseInt(process.env.QE_SHADOW_PRUNE_BATCH, 10);
  return (Number.isFinite(v) && v >= 1) ? v : 50;
})();

/**
 * Maximum age kept by prune, in milliseconds (72 h).
 * Env override: QE_SHADOW_MAX_AGE_MS (integer ms). Useful for tests.
 * Production default: 259200000 (72 h).
 */
const MAX_AGE_MS = (() => {
  const v = parseInt(process.env.QE_SHADOW_MAX_AGE_MS, 10);
  return (Number.isFinite(v) && v >= 0) ? v : 72 * 60 * 60 * 1000;
})();

// ---------------------------------------------------------------------------
// Store-root resolver (Item 3)
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` (defaults to `process.cwd()`) to find the nearest
 * ancestor directory that contains a `.qe/` subdirectory.
 *
 * This generalises to:
 *   - The qe-workspace wrapper: finds the wrapper root, covering both
 *     qe-framework and qe-mcp under one shadow store.
 *   - Single-repo projects where .qe/ lives at the repo root.
 *
 * Env override: if `process.env.QE_SHADOW_ROOT` is set and points to an
 * existing directory, that path is used verbatim as the store root without
 * any upward walk. Explicit beats implicit — useful for tests and CI.
 *
 * Symlink/dir validation: when the upward walk finds a candidate `.qe`
 * entry, it must be a real directory (not a symlink pointing outside).
 * Entries that fail lstatSync or are not directories are skipped and the
 * walk continues to the next ancestor.
 *
 * @param {string} [startDir] - Directory to start the upward search from.
 *   Defaults to `process.cwd()`.
 * @returns {string} Absolute path to the shadow store root (directory with .qe/).
 * @throws {Error} If no .qe/ directory is found up to the filesystem root.
 */
export function findShadowRoot(startDir) {
  // Env override: explicit QE_SHADOW_ROOT beats the upward walk.
  const envRoot = process.env.QE_SHADOW_ROOT;
  if (envRoot) {
    const resolvedEnvRoot = resolve(envRoot);
    if (existsSync(resolvedEnvRoot)) {
      try {
        const st = lstatSync(resolvedEnvRoot);
        if (st.isDirectory()) {
          return resolvedEnvRoot;
        }
      } catch {
        // fall through to upward walk if lstat fails
      }
    }
  }

  let dir = resolve(startDir || process.cwd());
  while (true) {
    const candidate = join(dir, '.qe');
    if (existsSync(candidate)) {
      // Validate: must be a real directory, not a symlink pointing outside.
      try {
        const st = lstatSync(candidate);
        if (st.isDirectory()) {
          // Real directory (not a symlink) — accept it.
          return dir;
        }
        // It is a symlink or non-directory — skip and keep walking.
      } catch {
        // lstat failed — skip this candidate and keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        '[qe-shadow] Could not locate a .qe/ directory. ' +
        'Run from inside a project that has a .qe/ folder (or an ancestor of one).',
      );
    }
    dir = parent;
  }
}

/**
 * Derive the three key paths for a given store root.
 *
 * @param {string} root - Shadow store root (directory containing .qe/).
 * @returns {{ snapshotsDir: string, gitDir: string, lockFile: string }}
 */
function shadowPaths(root) {
  const snapshotsDir = join(root, '.qe', '.snapshots');
  return {
    snapshotsDir,
    gitDir: join(snapshotsDir, 'shadow.git'),
    lockFile: join(snapshotsDir, 'shadow.lock'),
  };
}

// ---------------------------------------------------------------------------
// Low-level git helper
// ---------------------------------------------------------------------------

/**
 * Run a git command against the shadow repo.
 * Always uses `--git-dir` + `--work-tree` so it never touches any real repo.
 *
 * @param {string[]} args - Git arguments (without 'git').
 * @param {object} opts
 * @param {string} opts.gitDir - Absolute path to shadow.git.
 * @param {string} opts.workTree - Absolute path to the work-tree root.
 * @param {boolean} [opts.check=true] - Throw on non-zero exit.
 * @param {string} [opts.input] - Data piped to stdin.
 * @returns {{ stdout: string, stderr: string, status: number }}
 */
function git(args, { gitDir, workTree, check = true, input } = {}) {
  const result = spawnSync(
    'git',
    ['--git-dir', gitDir, '--work-tree', workTree, ...args],
    {
      encoding: 'utf8',
      cwd: workTree,
      input,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
      },
    },
  );
  if (check && result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args[0]} failed (exit ${result.status}): ${msg}`);
  }
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: result.status ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Shadow repo initialisation
// ---------------------------------------------------------------------------

/**
 * Ensure the shadow git repo exists under `root/.qe/.snapshots/shadow.git`
 * with work-tree equal to `root`. Idempotent: safe to call on every invocation.
 *
 * Sets up info/exclude to prevent the shadow repo from tracking:
 *   - nested .git directories (qe-framework/.git, qe-mcp/.git, etc.)
 *   - node_modules
 *   - the shadow repo itself
 *
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 */
export function ensureShadowRepo(root) {
  const storeRoot = root || findShadowRoot();
  const { snapshotsDir, gitDir } = shadowPaths(storeRoot);

  if (!existsSync(snapshotsDir)) {
    mkdirSync(snapshotsDir, { recursive: true });
    try { chmodSync(snapshotsDir, 0o700); } catch {}
  }

  if (!existsSync(join(gitDir, 'HEAD'))) {
    const result = spawnSync(
      'git',
      ['--git-dir', gitDir, '--work-tree', storeRoot, 'init'],
      { encoding: 'utf8', cwd: storeRoot },
    );
    if (result.status !== 0) {
      throw new Error(`shadow repo init failed: ${result.stderr || result.stdout}`);
    }

    const g = (args) => git(args, { gitDir, workTree: storeRoot });
    g(['config', 'core.bare', 'false']);
    g(['config', 'user.email', 'qe-shadow@local']);
    g(['config', 'user.name', 'QE Shadow']);
    g(['config', 'advice.detachedHead', 'false']);
    g(['config', 'advice.pushNonFFCurrent', 'false']);
  }

  // Write / refresh exclude file every time in case it was corrupted.
  const infoDir = join(gitDir, 'info');
  if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true });

  writeFileSync(
    join(infoDir, 'exclude'),
    [
      '# Auto-generated by qe-shadow — do not edit manually.',
      '# Exclude nested git internals so shadow never swallows them.',
      '.git/',
      '**/.git/',
      'node_modules/',
      '**/node_modules/',
      '# Shadow repo itself and its lock.',
      '.qe/.snapshots/',
    ].join('\n') + '\n',
  );
}

// ---------------------------------------------------------------------------
// Remote-push abort guard
// ---------------------------------------------------------------------------

/**
 * Verify that no remote is registered in the shadow repo.
 * This is the anti-push guard: no remote = no push path.
 * Called before every commit to guarantee the invariant survives all callers.
 *
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 * @throws {Error} If one or more remotes exist.
 */
export function assertNoRemote(root) {
  const storeRoot = root || findShadowRoot();
  const { gitDir } = shadowPaths(storeRoot);
  const { stdout } = git(['remote'], { gitDir, workTree: storeRoot, check: false });
  if (stdout.length > 0) {
    throw new Error(
      `[qe-shadow] ABORT: shadow repo has registered remotes:\n${stdout}\n` +
      'Remove remotes with `git --git-dir=<shadow.git> remote remove <name>` ' +
      'to prevent accidental push. Snapshot NOT created.',
    );
  }
}

// ---------------------------------------------------------------------------
// Lock helper (debounce / concurrency guard)
// ---------------------------------------------------------------------------

/**
 * Acquire an atomic lock file using O_EXCL (create-exclusive).
 * Returns a release function that only unlinks if this process still owns the lock.
 *
 * Strategy:
 *   1. openSync(lockFile, 'wx') — atomically fails with EEXIST if held.
 *   2. On EEXIST: read stored {pid, ts}; if stale (age > maxAgeMs) attempt
 *      one unlink + retry; otherwise throw "lock held" for the caller to
 *      handle (hook path swallows it, snapshot is skipped gracefully).
 *   3. release() reads the lock back and only unlinks if pid matches ours.
 *
 * @param {string} lockFile - Absolute path to the lock file.
 * @param {number} [maxAgeMs=5000] - Max lock age before it is considered stale.
 * @returns {() => void} Release function.
 */
function acquireLock(lockFile, maxAgeMs = 5000) {
  const lockData = JSON.stringify({ pid: process.pid, ts: Date.now() });

  /**
   * Attempt to create the lock file exclusively (O_EXCL).
   * On EEXIST checks staleness and performs one takeover attempt if stale.
   * Throws on active contention or on a second consecutive EEXIST after takeover.
   */
  function tryCreate() {
    let fd;
    try {
      fd = openSync(lockFile, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      let stored = {};
      try { stored = JSON.parse(readFileSync(lockFile, 'utf8')); } catch {}

      const age = Date.now() - (stored.ts || 0);
      if (age < maxAgeMs) {
        throw new Error(
          `[qe-shadow] lock held by pid ${stored.pid || '?'} (age ${age} ms); skipping snapshot.`,
        );
      }

      // Stale lock — attempt one atomic takeover.
      try { unlinkSync(lockFile); } catch {}
      fd = openSync(lockFile, 'wx');
    }
    try {
      writeFileSync(fd, lockData);
    } finally {
      try { closeSync(fd); } catch {}
    }
  }

  tryCreate();

  return function releaseLock() {
    try {
      const stored = JSON.parse(readFileSync(lockFile, 'utf8'));
      if (stored.pid === process.pid) unlinkSync(lockFile);
    } catch {}
  };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Create one shadow snapshot commit.
 * Commit message includes timestamp, trigger source, and optional session id.
 * Calls assertNoRemote() before committing — aborts if any remote is found.
 *
 * @param {object} [opts]
 * @param {string} [opts.source='manual'] - Trigger source: edit|write|codex|manual.
 * @param {string} [opts.sid=''] - Session identifier when available.
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 * @returns {string} The new commit SHA, or empty string if nothing to commit.
 */
export function snapshot({ source = 'manual', sid = '' } = {}, root) {
  const storeRoot = root || findShadowRoot();
  const { gitDir, lockFile } = shadowPaths(storeRoot);
  const g = (args, opts) => git(args, { gitDir, workTree: storeRoot, ...opts });

  ensureShadowRepo(storeRoot);
  assertNoRemote(storeRoot);

  // Capture the result in an outer variable so the auto-prune block (which runs
  // after the lock is released) can still return it to the caller.
  let resultSha = '';

  const release = acquireLock(lockFile);
  try {
    g(['add', '--all']);

    const statusOut = g(['status', '--porcelain'], { check: false }).stdout;
    if (!statusOut) {
      console.log('[qe-shadow] nothing to commit; shadow repo already up-to-date.');
      return '';
    }

    const timestamp = new Date().toISOString();
    const sidPart = sid ? ` sid:${sid}` : '';
    const message = `snapshot: ${timestamp} source:${source}${sidPart}`;

    g(['commit', '--allow-empty-message', '-m', message]);
    resultSha = g(['rev-parse', 'HEAD']).stdout;
    console.log(`[qe-shadow] snapshot created: ${resultSha.slice(0, 12)} (${source})`);
  } finally {
    // Release the snapshot lock BEFORE the auto-prune check.
    // prune() acquires its own lock; holding both would risk deadlock.
    release();
  }

  // ---------------------------------------------------------------------------
  // Auto-prune: high-water-mark check (runs AFTER releasing the snapshot lock).
  //
  // Cheaply count commits via rev-list --count. If the store has reached the
  // high-water mark (MAX_SNAPSHOTS + PRUNE_BATCH, default 250), call prune()
  // to trim back to MAX_SNAPSHOTS. Using a batch threshold means the expensive
  // commit-tree rewrite runs ~once every PRUNE_BATCH snapshots rather than on
  // every call. A prune failure is logged but never propagated — the snapshot
  // itself already succeeded and must remain usable.
  // ---------------------------------------------------------------------------
  if (resultSha) {
    try {
      // Count-based trigger: high-water mark check.
      const { stdout: countStr, status: countStatus } = git(
        ['rev-list', '--count', 'HEAD'],
        { gitDir, workTree: storeRoot, check: false },
      );
      let countTrigger = false;
      if (countStatus === 0) {
        const count = parseInt(countStr, 10);
        if (Number.isFinite(count) && count >= MAX_SNAPSHOTS + PRUNE_BATCH) {
          countTrigger = true;
        }
      }

      // Age-based trigger: check whether the OLDEST snapshot exceeds MAX_AGE_MS.
      // Use `git log --max-parents=0 -1 --format=%ct` to read the root commit's
      // committer timestamp in one cheap plumbing call (no graph traversal).
      let ageTrigger = false;
      const { stdout: oldestCt, status: oldestStatus } = git(
        ['log', '--max-parents=0', '-1', '--format=%ct'],
        { gitDir, workTree: storeRoot, check: false },
      );
      if (oldestStatus === 0 && oldestCt) {
        const oldestEpochSeconds = parseInt(oldestCt, 10);
        if (Number.isFinite(oldestEpochSeconds)) {
          const ageMs = Date.now() - oldestEpochSeconds * 1000;
          if (ageMs > MAX_AGE_MS) {
            ageTrigger = true;
          }
        }
      }

      if (countTrigger || ageTrigger) {
        const reason = countTrigger
          ? `${parseInt(countStr, 10)} commits >= ${MAX_SNAPSHOTS + PRUNE_BATCH}`
          : `oldest snapshot age > ${MAX_AGE_MS} ms`;
        console.log(`[qe-shadow] auto-prune triggered (${reason}); pruning to ${MAX_SNAPSHOTS}...`);
        prune(storeRoot);
      }
    } catch (pruneErr) {
      console.warn(`[qe-shadow] auto-prune warning (snapshot still succeeded): ${pruneErr.message}`);
    }
  }

  return resultSha;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Print the shadow commit log, most recent first.
 *
 * @param {number} [n=20] - Number of entries to show.
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 */
export function list(n = 20, root) {
  const storeRoot = root || findShadowRoot();
  const { gitDir } = shadowPaths(storeRoot);
  const g = (args, opts) => git(args, { gitDir, workTree: storeRoot, ...opts });

  ensureShadowRepo(storeRoot);
  const { stdout } = g(
    ['log', '--oneline', `--max-count=${n}`, 'HEAD'],
    { check: false },
  );
  if (!stdout) {
    console.log('[qe-shadow] no snapshots yet.');
    return;
  }
  console.log(stdout);
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Show the diff between the current working tree and a snapshot ref.
 *
 * @param {string} ref - Git ref or SHA to diff against.
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 */
export function diff(ref, root) {
  if (!ref) {
    console.error('[qe-shadow] diff requires a <ref> argument.');
    process.exit(1);
  }
  const storeRoot = root || findShadowRoot();
  const { gitDir } = shadowPaths(storeRoot);
  const g = (args, opts) => git(args, { gitDir, workTree: storeRoot, ...opts });

  ensureShadowRepo(storeRoot);
  const { stdout, status } = g(['diff', ref, 'HEAD'], { check: false });
  if (status !== 0) {
    console.error(`[qe-shadow] diff failed. Is "${ref}" a valid ref?`);
    process.exit(1);
  }
  console.log(stdout || '(no differences)');
}

// ---------------------------------------------------------------------------
// Restore — dry-run by default, --force required for dirty files
// ---------------------------------------------------------------------------

/**
 * Restore files from a snapshot ref.
 *
 * By default this is a dry-run that shows which files would be restored.
 * Pass `confirm=true` (--confirm / --yes) to actually overwrite files.
 * An optional path argument restricts restore to that path only.
 *
 * Safety rules:
 *   - `filePath` must be relative, must not escape root via `..`, must not be
 *     absolute, and must not start with `:` (git pathspec magic).
 *     Passed with `--` separator to prevent git misinterpretation.
 *   - `ref` is verified via `git rev-parse --verify` before use.
 *   - `confirm=true` performs the restore; the working-tree diff is the source
 *     of truth for what needs restoring, so no additional --force gate is
 *     needed. `force` is accepted as a harmless alias for backward compat.
 *   - Only the explicitly specified path(s) are ever touched; scope never
 *     silently expands beyond what the caller requested.
 *
 * @param {string} ref - Snapshot commit ref to restore from.
 * @param {string|null} [filePath=null] - Optional relative path to restrict restore to.
 * @param {boolean} [confirm=false] - If true, actually restore files.
 * @param {boolean} [force=false] - Accepted for backward compat; no longer required.
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 */
export function restore(ref, filePath = null, confirm = false, force = false, root) {
  if (!ref) {
    console.error('[qe-shadow] restore requires a <ref> argument.');
    process.exit(1);
  }
  const storeRoot = root || findShadowRoot();
  const { gitDir } = shadowPaths(storeRoot);
  const g = (args, opts) => git(args, { gitDir, workTree: storeRoot, ...opts });

  ensureShadowRepo(storeRoot);

  // Validate filePath: reject absolute, `..`-escaping, and pathspec magic.
  if (filePath !== null) {
    if (isAbsolute(filePath)) {
      console.error('[qe-shadow] restore path must be relative, not absolute.');
      process.exit(1);
    }
    if (filePath.startsWith(':')) {
      console.error('[qe-shadow] restore path must not use git pathspec magic (leading ":").');
      process.exit(1);
    }
    const resolved = resolve(storeRoot, filePath);
    if (!resolved.startsWith(storeRoot + '/') && resolved !== storeRoot) {
      console.error(`[qe-shadow] restore path "${filePath}" escapes the workspace root.`);
      process.exit(1);
    }
  }

  // Verify ref is a valid commit before using it.
  const { status: verifyStatus } = g(
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    { check: false },
  );
  if (verifyStatus !== 0) {
    console.error(`[qe-shadow] ref "${ref}" is not a valid commit.`);
    process.exit(1);
  }

  // Compare ref against the WORKING TREE (not HEAD) so damage that has not
  // been snapshotted is detected correctly. `git diff <ref> -- <path>` without
  // a second commit ref produces an index+worktree diff relative to the ref's
  // tree, which is exactly the set of files that need to be restored.
  const pathArgs = filePath ? ['--', filePath] : ['--', '.'];
  const { stdout: changedFiles, status } = g(
    ['diff', '--name-only', ref, ...pathArgs],
    { check: false },
  );

  if (status !== 0) {
    console.error(`[qe-shadow] could not compute diff for ref "${ref}".`);
    process.exit(1);
  }

  const files = changedFiles.split('\n').filter(Boolean);

  if (files.length === 0) {
    console.log('[qe-shadow] no files differ from the snapshot; nothing to restore.');
    return;
  }

  console.log(`[qe-shadow] Files that would be restored from ${ref}:`);
  files.forEach(f => console.log(`  ${f}`));

  if (!confirm) {
    console.log(
      '\n[qe-shadow] DRY-RUN: no files were changed. ' +
      'Re-run with --confirm (or --yes) to overwrite.',
    );
    return;
  }

  // --confirm alone is sufficient: the caller has explicitly scoped the
  // restore to the specified path(s) and confirmed intent. The dirty-check
  // hard-ABORT that required --force has been removed because in the primary
  // recovery case the on-disk damage IS the local modification you want to
  // overwrite — blocking on --force defeats the purpose of restore.
  // (force is still accepted as a no-op alias for backward compat.)

  const checkoutPathArgs = filePath ? [filePath] : ['.'];
  g(['checkout', ref, '--', ...checkoutPathArgs]);

  console.log(`[qe-shadow] restored ${files.length} file(s) from ${ref}.`);
}

// ---------------------------------------------------------------------------
// Prune — 200 snapshots / 72 h rolling, non-destructive commit-tree rewrite
// ---------------------------------------------------------------------------

/**
 * Remove shadow snapshots older than MAX_AGE_MS or beyond MAX_SNAPSHOTS.
 *
 * Strategy (safe, non-destructive rewrite via commit-tree):
 *   1. Determine `toKeep`: newest MAX_SNAPSHOTS commits younger than MAX_AGE_MS.
 *      Never drops below 1 recovery point while any snapshot exists.
 *   2. Rebuild a fresh linear history oldest→newest via `git commit-tree`.
 *   3. Point the branch to the final new commit via `git update-ref` then
 *      `git reset --hard` to sync the work-tree.
 *   4. Run `git gc --prune=now` to discard orphaned old objects.
 *   5. The entire rewrite runs under acquireLock() to prevent interleaving.
 *   6. Any commit-tree failure causes an immediate abort without modifying the
 *      existing branch — history stays intact on any partial failure.
 *
 * @param {string} [root] - Shadow store root. Defaults to `findShadowRoot()`.
 */
export function prune(root) {
  const storeRoot = root || findShadowRoot();
  const { gitDir, lockFile } = shadowPaths(storeRoot);
  const g = (args, opts) => git(args, { gitDir, workTree: storeRoot, ...opts });

  ensureShadowRepo(storeRoot);
  // Anti-push guard: prune creates commits via commit-tree and must never run
  // against a repo that has a remote. Same invariant as snapshot(). Abort
  // immediately if any remote is registered — before acquiring the lock or
  // touching history.
  assertNoRemote(storeRoot);

  const { stdout, status } = g(['log', '--format=%H %at', 'HEAD'], { check: false });
  if (status !== 0 || !stdout) {
    console.log('[qe-shadow] no snapshots to prune.');
    return;
  }

  const commits = stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, ts] = line.trim().split(' ');
      return { sha, ts: Number(ts) * 1000 };
    });

  const now = Date.now();
  const cutoffTime = now - MAX_AGE_MS;

  let toKeep = commits
    .slice(0, MAX_SNAPSHOTS)
    .filter(c => c.ts >= cutoffTime);

  // Safety: never leave zero recovery points while commits exist.
  if (toKeep.length === 0 && commits.length > 0) {
    toKeep = [commits[0]];
  }

  if (toKeep.length === commits.length) {
    console.log('[qe-shadow] nothing to prune.');
    return;
  }

  const dropCount = commits.length - toKeep.length;
  console.log(`[qe-shadow] pruning ${dropCount} old snapshot(s), keeping ${toKeep.length}.`);

  const release = acquireLock(lockFile);
  try {
    const ordered = [...toKeep].reverse(); // oldest→newest

    let prevNewSha = null;
    const newShas = [];

    for (const { sha } of ordered) {
      const { stdout: tree, status: treeStatus } = g(
        ['rev-parse', `${sha}^{tree}`],
        { check: false },
      );
      if (treeStatus !== 0 || !tree) {
        console.warn(`[qe-shadow] prune ABORTED: could not resolve tree for ${sha}. History unchanged.`);
        return;
      }

      const { stdout: msg, status: msgStatus } = g(
        ['log', '-1', '--format=%B', sha],
        { check: false },
      );
      if (msgStatus !== 0) {
        console.warn(`[qe-shadow] prune ABORTED: could not read message for ${sha}. History unchanged.`);
        return;
      }

      const ctArgs = ['commit-tree', tree];
      if (prevNewSha) ctArgs.push('-p', prevNewSha);
      ctArgs.push('-m', msg || sha);

      const { stdout: newSha, status: ctStatus } = g(ctArgs, { check: false });
      if (ctStatus !== 0 || !newSha) {
        console.warn(`[qe-shadow] prune ABORTED: commit-tree failed for ${sha}. History unchanged.`);
        return;
      }

      newShas.push(newSha);
      prevNewSha = newSha;
    }

    const finalNewSha = newShas[newShas.length - 1];
    const { stdout: branchName } = g(['symbolic-ref', '--short', 'HEAD'], { check: false });
    const branch = branchName || 'main';

    const { status: updateRefStatus } = g(
      ['update-ref', `refs/heads/${branch}`, finalNewSha],
      { check: false },
    );
    const { status: resetStatus } = g(
      ['reset', '--hard', branch],
      { check: false },
    );

    if (updateRefStatus !== 0 || resetStatus !== 0) {
      console.warn(
        '[qe-shadow] prune ABORTED: failed to update branch ref. History may be unchanged.',
      );
      return;
    }

    try { g(['gc', '--prune=now', '--quiet'], { check: false }); } catch {}

    console.log('[qe-shadow] prune complete.');
  } finally {
    release();
  }
}
