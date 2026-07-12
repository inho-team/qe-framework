#!/usr/bin/env node

/**
 * git-staging-guard.test.mjs
 *
 * Unit tests for R006 git staging guard.
 *
 * Covers (REQUIREMENTS R006 sub-clause mapping in test names):
 *   - Broad staging detection: '.', './', '..', '-A', '--all', '-u',
 *     combined short flags (-uv, -An), pathspec magic, glob chars (quoted+unquoted)
 *   - Explicit path pass-through (./src/file.js, .gitignore, ../sibling/file.js)
 *   - Interactive flag block (-p, -i)
 *   - Dry-run allow (-n)
 *   - Conservative broad: git add -A -- src/
 *   - Compound forms: git -C repo add ..., cd x && git add .
 *   - Order violation: path-then-option, option-form after -- → warn
 *   - index.lock threshold boundary: 120s exact, 119999ms, 120001ms
 *   - Owning process: git found / none / unknown
 *   - Future mtime → age 0 → non-recovery
 *   - Lock absent
 *
 * All tests use temp directories only. No production file mutation.
 *
 * Run with: node --test hooks/scripts/lib/__tests__/git-staging-guard.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  classifyStagingCommand,
  gatherLockFacts,
  judgeStaleLock,
  LOCK_STALE_THRESHOLD_MS,
} from '../git-staging-guard.mjs';

const GUARD_CLI = fileURLToPath(new URL('../git-staging-guard.mjs', import.meta.url));

// ============================================================================
// Helpers
// ============================================================================

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-staging-guard-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Create a minimal .git/index.lock file with a specific mtime offset from now. */
function makeLockFile(dir, ageMsOffset = 0) {
  const gitDir = path.join(dir, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  const lockPath = path.join(gitDir, 'index.lock');
  fs.writeFileSync(lockPath, '');
  const now = Date.now();
  const targetMs = now - ageMsOffset;
  const targetSec = targetMs / 1000;
  // Use utimes to set mtime
  fs.utimesSync(lockPath, targetSec, targetSec);
  return lockPath;
}

/** Run the CLI --check and return { stdout, exitCode }. */
function runCLI(command) {
  const result = spawnSync(process.execPath, [GUARD_CLI, '--check', command], {
    encoding: 'utf8',
  });
  return { stdout: result.stdout || '', exitCode: result.status };
}

/** Run the CLI --lock-check [cwd] and return { stdout, exitCode }. */
function runLockCheckCLI(cwd) {
  const args = cwd ? [GUARD_CLI, '--lock-check', cwd] : [GUARD_CLI, '--lock-check'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { stdout: result.stdout || '', exitCode: result.status };
}

// ============================================================================
// THRESHOLD constant
// ============================================================================

test('R006 LOCK_STALE_THRESHOLD_MS is 120000', () => {
  assert.equal(LOCK_STALE_THRESHOLD_MS, 120_000, 'threshold must be exactly 120000ms');
});

// ============================================================================
// classifyStagingCommand — BROAD (must be block)
// ============================================================================

test('R006 broad: git add . → block', () => {
  const r = classifyStagingCommand('git add .');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add ./ → block', () => {
  const r = classifyStagingCommand('git add ./');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add .. → block', () => {
  const r = classifyStagingCommand('git add ..');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add ../.. → block (all dots/slashes)', () => {
  const r = classifyStagingCommand('git add ../..');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add ../../ → block (all dots/slashes)', () => {
  const r = classifyStagingCommand('git add ../../');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add -A → block', () => {
  const r = classifyStagingCommand('git add -A');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add --all → block', () => {
  const r = classifyStagingCommand('git add --all');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad: git add -u → block', () => {
  const r = classifyStagingCommand('git add -u');
  assert.equal(r.verdict, 'block', `expected block, got: ${r.verdict} — ${r.reason}`);
});

test('R006 broad combined-short-flag: git add -uv → block (-u component)', () => {
  const r = classifyStagingCommand('git add -uv');
  assert.equal(r.verdict, 'block', `R006 combined short flag -u in -uv must be block: ${r.reason}`);
});

test('R006 dry-run combined: git add -An → pass (-n dry-run overrides -A, no staging)', () => {
  // -An decomposes to -A (broad) + -n (dry-run). Since -n means no filesystem staging occurs,
  // the command is safe and must pass (spec: -n 허용 takes precedence over broad tokens).
  const r = classifyStagingCommand('git add -An');
  assert.equal(r.verdict, 'pass', `R006 -n in combined -An must pass (dry-run, no staging): ${r.reason}`);
});

test('R006 broad combined-short-flag: git add -Au → block (-A and -u components)', () => {
  const r = classifyStagingCommand('git add -Au');
  assert.equal(r.verdict, 'block', `R006 combined -A and -u must be block: ${r.reason}`);
});

test('R006 broad pathspec magic: git add :/ → block', () => {
  const r = classifyStagingCommand('git add :/');
  assert.equal(r.verdict, 'block', `R006 pathspec magic :/ must be block: ${r.reason}`);
});

test('R006 broad pathspec magic: git add :(glob) → block', () => {
  const r = classifyStagingCommand('git add ":(glob)"');
  assert.equal(r.verdict, 'block', `R006 pathspec magic :(glob) must be block: ${r.reason}`);
});

test('R006 broad unquoted glob: git add *.js → block', () => {
  const r = classifyStagingCommand('git add *.js');
  assert.equal(r.verdict, 'block', `R006 unquoted glob * must be block: ${r.reason}`);
});

test('R006 broad unquoted glob: git add src/? → block', () => {
  const r = classifyStagingCommand('git add src/?');
  assert.equal(r.verdict, 'block', `R006 unquoted glob ? must be block: ${r.reason}`);
});

test('R006 broad unquoted glob: git add src/[abc].js → block', () => {
  const r = classifyStagingCommand('git add "src/[abc].js"');
  assert.equal(r.verdict, 'block', `R006 glob chars in brackets must be block: ${r.reason}`);
});

test('R006 broad quoted glob: git add "*.js" → block (git uses wildmatch)', () => {
  const r = classifyStagingCommand('git add "*.js"');
  assert.equal(r.verdict, 'block', `R006 quoted glob *.js must be block (git wildmatch): ${r.reason}`);
});

test('R006 broad quoted glob: git add ".*" → block', () => {
  const r = classifyStagingCommand("git add '.*'");
  assert.equal(r.verdict, 'block', `R006 quoted glob .* must be block: ${r.reason}`);
});

test('R006 broad conservative: git add -A -- src/ → block (-A present with path limiter)', () => {
  const r = classifyStagingCommand('git add -A -- src/');
  assert.equal(r.verdict, 'block', `R006 -A with path limiter must be block (conservative): ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — INTERACTIVE (must be block)
// ============================================================================

test('R006 interactive: git add -p → block (hook-context hang risk)', () => {
  const r = classifyStagingCommand('git add -p');
  assert.equal(r.verdict, 'block', `R006 -p must be block: ${r.reason}`);
});

test('R006 interactive: git add -i → block (hook-context hang risk)', () => {
  const r = classifyStagingCommand('git add -i');
  assert.equal(r.verdict, 'block', `R006 -i must be block: ${r.reason}`);
});

test('R006 interactive: git add --patch → block', () => {
  const r = classifyStagingCommand('git add --patch');
  assert.equal(r.verdict, 'block', `R006 --patch must be block: ${r.reason}`);
});

test('R006 interactive: git add --interactive → block', () => {
  const r = classifyStagingCommand('git add --interactive');
  assert.equal(r.verdict, 'block', `R006 --interactive must be block: ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — DRY-RUN (must pass)
// ============================================================================

test('R006 dry-run: git add -n -- path/to/file → pass', () => {
  const r = classifyStagingCommand('git add -n -- path/to/file');
  assert.equal(r.verdict, 'pass', `R006 -n dry-run must pass: ${r.reason}`);
});

test('R006 dry-run: git add --dry-run src/foo.js → pass', () => {
  const r = classifyStagingCommand('git add --dry-run src/foo.js');
  assert.equal(r.verdict, 'pass', `R006 --dry-run must pass: ${r.reason}`);
});

test('R006 dry-run: git add -n . → pass (-n stages nothing, broad token irrelevant)', () => {
  const r = classifyStagingCommand('git add -n .');
  assert.equal(r.verdict, 'pass', `R006 -n with broad token must pass (no staging): ${r.reason}`);
});

test('R006 dry-run: git add -n src/a.js → pass', () => {
  const r = classifyStagingCommand('git add -n src/a.js');
  assert.equal(r.verdict, 'pass', `R006 -n with explicit path must pass: ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — EXPLICIT PATH (must pass)
// ============================================================================

test('R006 explicit: git add src/file.js → pass', () => {
  const r = classifyStagingCommand('git add src/file.js');
  assert.equal(r.verdict, 'pass', `expected pass: ${r.reason}`);
});

test('R006 explicit: git add ./src/file.js → pass (./ is path prefix, not broad)', () => {
  const r = classifyStagingCommand('git add ./src/file.js');
  assert.equal(r.verdict, 'pass', `R006 ./src/file.js must pass (explicit path): ${r.reason}`);
});

test('R006 explicit: git add .gitignore → pass (.gitignore has non-dot chars)', () => {
  const r = classifyStagingCommand('git add .gitignore');
  assert.equal(r.verdict, 'pass', `R006 .gitignore must pass (explicit): ${r.reason}`);
});

test('R006 explicit: git add ../sibling/file.js → pass (has non-dot/slash chars)', () => {
  const r = classifyStagingCommand('git add ../sibling/file.js');
  assert.equal(r.verdict, 'pass', `R006 ../sibling/file.js must pass (explicit): ${r.reason}`);
});

test('R006 explicit: git add -- ./src/file.js → pass', () => {
  const r = classifyStagingCommand('git add -- ./src/file.js');
  assert.equal(r.verdict, 'pass', `R006 -- ./src/file.js must pass: ${r.reason}`);
});

test('R006 explicit: git add path/a.js path/b.js → pass (multiple explicit paths)', () => {
  const r = classifyStagingCommand('git add path/a.js path/b.js');
  assert.equal(r.verdict, 'pass', `R006 multiple explicit paths must pass: ${r.reason}`);
});

test('R006 explicit: deleted file staging git add -u -- deleted.js → block (has -u)', () => {
  // -u is a broad flag regardless of path limiter
  const r = classifyStagingCommand('git add -u -- deleted.js');
  assert.equal(r.verdict, 'block', `R006 -u with path limiter: still block for consistency: ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — DYNAMIC TOKENS (fail-open explicit)
// ============================================================================

test('R006 dynamic: git add $FILE → pass (fail-open: cannot resolve $VAR)', () => {
  const r = classifyStagingCommand('git add $FILE');
  assert.equal(r.verdict, 'pass', `R006 $VAR must fail-open as explicit: ${r.reason}`);
});

test('R006 dynamic: git add $(git diff --name-only) → pass (fail-open subshell)', () => {
  const r = classifyStagingCommand('git add $(git diff --name-only)');
  assert.equal(r.verdict, 'pass', `R006 subshell must fail-open as explicit: ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — ORDER VIOLATION (must be warn)
// ============================================================================

test('R006 order-violation: git add file.js -v → warn (path before option)', () => {
  const r = classifyStagingCommand('git add file.js -v');
  assert.equal(r.verdict, 'warn', `R006 path-then-option must be warn: ${r.reason}`);
});

test('R006 order-violation: git add -- -v → warn (option-form token after --)', () => {
  const r = classifyStagingCommand('git add -- -v');
  assert.equal(r.verdict, 'warn', `R006 option-form after -- must be warn: ${r.reason}`);
});

test('R006 order-violation determinism: warn verdict is not block or pass', () => {
  // Determinism contract: order violation is always warn (V10 compliance)
  const r = classifyStagingCommand('git add src/foo.js --verbose');
  assert.equal(r.verdict, 'warn', `R006 order violation must always be warn (determinism contract): ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — COMPOUND FORMS
// ============================================================================

test('R006 compound: git -C repo add . → block', () => {
  const r = classifyStagingCommand('git -C /some/repo add .');
  assert.equal(r.verdict, 'block', `R006 git -C repo add . must be block: ${r.reason}`);
});

test('R006 compound: git -C repo add src/file.js → pass', () => {
  const r = classifyStagingCommand('git -C /some/repo add src/file.js');
  assert.equal(r.verdict, 'pass', `R006 git -C repo add explicit must pass: ${r.reason}`);
});

test('R006 compound: cd x && git add . → block', () => {
  const r = classifyStagingCommand('cd /some/dir && git add .');
  assert.equal(r.verdict, 'block', `R006 cd && git add . must be block: ${r.reason}`);
});

test('R006 compound: cd x && git add src/file.js → pass', () => {
  const r = classifyStagingCommand('cd /some/dir && git add src/file.js');
  assert.equal(r.verdict, 'pass', `R006 cd && git add explicit must pass: ${r.reason}`);
});

test('R006 compound: git add . ; echo done → block (semicolon separated)', () => {
  const r = classifyStagingCommand('git add . ; echo done');
  assert.equal(r.verdict, 'block', `R006 semicolon compound with broad add must be block: ${r.reason}`);
});

// ============================================================================
// classifyStagingCommand — NON-GIT COMMANDS (must pass)
// ============================================================================

test('R006 non-git: echo "git add ." → pass (not an executable git add)', () => {
  // The classifier only fires on actual git add tokens, not text inside echo
  const r = classifyStagingCommand('echo "git add ."');
  assert.equal(r.verdict, 'pass', `R006 echo "git add ." must pass (no git add invocation): ${r.reason}`);
});

test('R006 non-git: heredoc body containing git add . → pass (not executable)', () => {
  const cmd = "cat <<'EOF'\ngit add .\nEOF";
  const r = classifyStagingCommand(cmd);
  assert.equal(r.verdict, 'pass', `R006 heredoc body must not be treated as executable git add: ${r.reason}`);
});

test('R006 non-git: shell wrapper heredoc body containing git add . → pass', () => {
  const cmd = "bash -lc 'cat <<EOF\ngit add .\nEOF'";
  const r = classifyStagingCommand(cmd);
  assert.equal(r.verdict, 'pass', `R006 shell-wrapper heredoc body must not block: ${r.reason}`);
});

test('R006 compound: heredoc followed by executable git add . → block', () => {
  const cmd = "cat <<EOF\ntext\nEOF\ngit add .";
  const r = classifyStagingCommand(cmd);
  assert.equal(r.verdict, 'block', `R006 git add after heredoc terminator must still block: ${r.reason}`);
});

test('R006 non-git: npm test → pass (no git add)', () => {
  const r = classifyStagingCommand('npm test');
  assert.equal(r.verdict, 'pass', `R006 npm test must pass: ${r.reason}`);
});

// ============================================================================
// gatherLockFacts + judgeStaleLock — I/O separation
// ============================================================================

test('R006 lock: no .git directory → exists false, stale false', (t) => {
  const dir = makeTempDir(t);
  const facts = gatherLockFacts(dir);
  assert.equal(facts.exists, false, 'no .git dir → exists must be false');
  const judgment = judgeStaleLock(facts);
  assert.equal(judgment.stale, false, 'non-existent lock is not stale');
});

test('R006 lock: index.lock absent → exists false', (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  const facts = gatherLockFacts(dir);
  assert.equal(facts.exists, false, 'missing lock → exists false');
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, false, 'missing lock → not stale');
});

test('R006 lock boundary: age exactly 120000ms → stale=false (not yet stale, needs >=)', (t) => {
  const dir = makeTempDir(t);
  // Set mtime to exactly 120000ms ago — threshold is >=, so 120000 IS stale
  // But we can only control mtime at second precision via utimes.
  // We test the judgment function directly with synthetic facts.
  const factsAtThreshold = { exists: true, ageMs: 120_000, ownerProcess: 'none' };
  const j = judgeStaleLock(factsAtThreshold);
  assert.equal(j.stale, true, 'R006 age == 120000ms (at threshold) must be stale=true (>= check)');
});

test('R006 lock boundary: age 119999ms → stale=false (below threshold)', () => {
  const facts = { exists: true, ageMs: 119_999, ownerProcess: 'none' };
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, false, 'R006 age 119999ms must be stale=false (below threshold)');
});

test('R006 lock boundary: age 120001ms → stale=true (above threshold, no owner)', () => {
  const facts = { exists: true, ageMs: 120_001, ownerProcess: 'none' };
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, true, 'R006 age 120001ms with no owner must be stale=true');
});

test('R006 lock: owning git process → stale=false', () => {
  const facts = { exists: true, ageMs: 200_000, ownerProcess: 'git' };
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, false, 'R006 git process owning lock → not stale (do not remove)');
});

test('R006 lock: ownerProcess unknown → stale=false (conservative non-recovery)', () => {
  const facts = { exists: true, ageMs: 300_000, ownerProcess: 'unknown' };
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, false, 'R006 unknown owner → conservative non-recovery, stale=false');
});

test('R006 lock: future mtime → ageMs=0 → stale=false (clock skew non-recovery)', () => {
  const facts = { exists: true, ageMs: 0, ownerProcess: 'none' };
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, false, 'R006 future mtime (age=0) → non-recovery, stale=false');
});

test('R006 lock: null ageMs (stat failed) → stale=false (conservative)', () => {
  const facts = { exists: true, ageMs: null, ownerProcess: 'none' };
  const j = judgeStaleLock(facts);
  assert.equal(j.stale, false, 'R006 null age → conservative non-recovery');
});

test('R006 lock: I/O and judgment are separated (gatherLockFacts returns facts object)', (t) => {
  const dir = makeTempDir(t);
  makeLockFile(dir, 200_000); // 200s old
  const facts = gatherLockFacts(dir);
  // gatherLockFacts should return a plain facts object, not a judgment
  assert.ok('exists' in facts, 'facts must have exists');
  assert.ok('ageMs' in facts, 'facts must have ageMs');
  assert.ok('ownerProcess' in facts, 'facts must have ownerProcess');
  assert.ok(!('stale' in facts), 'facts must NOT have stale (that is judgeStaleLock domain)');
});

test('R006 lock: gatherLockFacts on a real file returns correct exists=true', (t) => {
  const dir = makeTempDir(t);
  makeLockFile(dir, 200_000);
  const facts = gatherLockFacts(dir);
  assert.equal(facts.exists, true, 'lock file created → exists must be true');
  assert.ok(facts.ageMs !== null, 'ageMs must be set for existing lock');
});

// ============================================================================
// CLI entrypoint tests (V21)
// ============================================================================

test('R006 CLI: --check "git add ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('git add .');
  assert.equal(exitCode, 1, `R006 CLI block must exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

test('R006 CLI: --check "git add src/file.js" → exit 0 (pass)', () => {
  const { stdout, exitCode } = runCLI('git add src/file.js');
  assert.equal(exitCode, 0, `R006 CLI pass must exit 0, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('pass'), `stdout must include "pass": ${stdout}`);
});

test('R006 CLI: --check "git add file.js --verbose" → exit 0 (warn)', () => {
  const { stdout, exitCode } = runCLI('git add file.js --verbose');
  assert.equal(exitCode, 0, `R006 CLI warn must exit 0, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('warn'), `stdout must include "warn": ${stdout}`);
});

test('R006 CLI: no --check arg → exit 2 (usage error)', () => {
  const result = spawnSync(process.execPath, [GUARD_CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2, 'no --check arg must exit 2');
});

// ============================================================================
// F1: git global option bypass tests
// ============================================================================

test('F1 global-opt: git --no-pager add . → block (--no-pager must not bypass guard)', () => {
  const r = classifyStagingCommand('git --no-pager add .');
  assert.equal(r.verdict, 'block', `git --no-pager add . must be block: ${r.reason}`);
});

test('F1 global-opt: git -c core.quotePath=false add . → block (-c must not bypass guard)', () => {
  const r = classifyStagingCommand('git -c core.quotePath=false add .');
  assert.equal(r.verdict, 'block', `git -c k=v add . must be block: ${r.reason}`);
});

test('F1 global-opt: git -c x=y add . → block', () => {
  const r = classifyStagingCommand('git -c x=y add .');
  assert.equal(r.verdict, 'block', `git -c x=y add . must be block: ${r.reason}`);
});

test('F1 global-opt: git -c x=y add src/a.js → pass (explicit path after global opt)', () => {
  const r = classifyStagingCommand('git -c x=y add src/a.js');
  assert.equal(r.verdict, 'pass', `git -c x=y add explicit path must pass: ${r.reason}`);
});

test('F1 global-opt: git --no-pager -c x=y add . → block (multiple global opts)', () => {
  const r = classifyStagingCommand('git --no-pager -c x=y add .');
  assert.equal(r.verdict, 'block', `multiple global opts before add must still block: ${r.reason}`);
});

test('F1 global-opt: git --git-dir=.git add . → block (--git-dir= single token)', () => {
  const r = classifyStagingCommand('git --git-dir=.git add .');
  assert.equal(r.verdict, 'block', `git --git-dir=.git add . must be block: ${r.reason}`);
});

// F1 stage alias
test('F1 stage-alias: git stage . → block (git stage is alias of git add)', () => {
  const r = classifyStagingCommand('git stage .');
  assert.equal(r.verdict, 'block', `git stage . must be block: ${r.reason}`);
});

test('F1 stage-alias: git stage src/file.js → pass (explicit path via stage alias)', () => {
  const r = classifyStagingCommand('git stage src/file.js');
  assert.equal(r.verdict, 'pass', `git stage explicit path must pass: ${r.reason}`);
});

test('F1 stage-alias: git -c x=y stage . → block (global opt + stage alias broad)', () => {
  const r = classifyStagingCommand('git -c x=y stage .');
  assert.equal(r.verdict, 'block', `git -c x=y stage . must be block: ${r.reason}`);
});

test('F4 wrapper: env FOO=1 git add . → block (env prefix must not bypass)', () => {
  const r = classifyStagingCommand('env FOO=1 git add .');
  assert.equal(r.verdict, 'block', `env prefix must not bypass staging guard: ${r.reason}`);
});

test('F4 wrapper: env -i FOO=1 git add src/a.js → pass (explicit path)', () => {
  const r = classifyStagingCommand('env -i FOO=1 git add src/a.js');
  assert.equal(r.verdict, 'pass', `env prefix with explicit path must pass: ${r.reason}`);
});

test('F4 wrapper: env -C /tmp git add . → block (env value option must not bypass)', () => {
  const r = classifyStagingCommand('env -C /tmp git add .');
  assert.equal(r.verdict, 'block', `env -C must not bypass staging guard: ${r.reason}`);
});

test('F4 wrapper: env --chdir=/tmp git add src/a.js → pass (env value option explicit path)', () => {
  const r = classifyStagingCommand('env --chdir=/tmp git add src/a.js');
  assert.equal(r.verdict, 'pass', `env --chdir explicit path must pass: ${r.reason}`);
});

test('F4 wrapper: env -S "git add ." → block (split-string command)', () => {
  const r = classifyStagingCommand('env -S "git add ."');
  assert.equal(r.verdict, 'block', `env -S split string must not bypass staging guard: ${r.reason}`);
});

test('F4 wrapper precision: env echo "git add ." → pass (git text is echo argument)', () => {
  const r = classifyStagingCommand('env echo "git add ."');
  assert.equal(r.verdict, 'pass', `env echo text must not trigger staging guard: ${r.reason}`);
});

test('F4 wrapper: FOO=1 git add . → block (assignment prefix must not bypass)', () => {
  const r = classifyStagingCommand('FOO=1 git add .');
  assert.equal(r.verdict, 'block', `assignment prefix must not bypass staging guard: ${r.reason}`);
});

test('F4 wrapper: LC_ALL=C.UTF-8 A=1 git add src/a.js → pass (assignment explicit path)', () => {
  const r = classifyStagingCommand('LC_ALL=C.UTF-8 A=1 git add src/a.js');
  assert.equal(r.verdict, 'pass', `assignment prefix with explicit path must pass: ${r.reason}`);
});

test('F4 wrapper: bash -lc "git add ." → block (shell wrapper must not bypass)', () => {
  const r = classifyStagingCommand('bash -lc "git add ."');
  assert.equal(r.verdict, 'block', `bash -lc wrapper must not bypass staging guard: ${r.reason}`);
});

test('F4 wrapper: FOO=1 bash -lc "git add ." → block (assignment + shell wrapper)', () => {
  const r = classifyStagingCommand('FOO=1 bash -lc "git add ."');
  assert.equal(r.verdict, 'block', `assignment before shell wrapper must not bypass staging guard: ${r.reason}`);
});

test('F4 wrapper: sh -c "git add src/a.js" → pass (explicit path)', () => {
  const r = classifyStagingCommand('sh -c "git add src/a.js"');
  assert.equal(r.verdict, 'pass', `sh -c explicit path must pass: ${r.reason}`);
});

test('F4 wrapper precision: echo "git add ." → pass (quoted text is not executed)', () => {
  const r = classifyStagingCommand('echo "git add ."');
  assert.equal(r.verdict, 'pass', `echo text must not trigger staging guard: ${r.reason}`);
});

// F1 CLI probes (subprocess)
test('F1 CLI: --check "git --no-pager add ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('git --no-pager add .');
  assert.equal(exitCode, 1, `git --no-pager add . must exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

test('F1 CLI: --check "git -c x=y add ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('git -c x=y add .');
  assert.equal(exitCode, 1, `git -c x=y add . must exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

test('F1 CLI: --check "git stage ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('git stage .');
  assert.equal(exitCode, 1, `git stage . must exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

test('F1 CLI: --check "git -c x=y add src/a.js" → exit 0 (pass)', () => {
  const { stdout, exitCode } = runCLI('git -c x=y add src/a.js');
  assert.equal(exitCode, 0, `git -c x=y add src/a.js must exit 0, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('pass'), `stdout must include "pass": ${stdout}`);
});

test('F4 CLI: --check "bash -lc git add ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('bash -lc "git add ."');
  assert.equal(exitCode, 1, `bash -lc broad staging should exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

test('F4 CLI: --check "FOO=1 git add ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('FOO=1 git add .');
  assert.equal(exitCode, 1, `assignment-prefixed broad staging should exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

test('F4 CLI: --check "env -C /tmp git add ." → exit 1 (block)', () => {
  const { stdout, exitCode } = runCLI('env -C /tmp git add .');
  assert.equal(exitCode, 1, `env -C broad staging should exit 1, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('block'), `stdout must include "block": ${stdout}`);
});

// ============================================================================
// F3: --lock-check CLI mode
// ============================================================================

test('F3 CLI: --lock-check /tmp → no-lock verdict, exit 0', () => {
  const { stdout, exitCode } = runLockCheckCLI('/tmp');
  assert.equal(exitCode, 0, `--lock-check must exit 0, got ${exitCode}. stdout: ${stdout}`);
  assert.ok(stdout.includes('verdict:'), `stdout must include "verdict:": ${stdout}`);
  // /tmp has no .git/index.lock → no-lock
  assert.ok(stdout.includes('no-lock'), `--lock-check /tmp must report no-lock: ${stdout}`);
});

test('F3 CLI: --lock-check (no cwd arg) → no-lock or wait verdict, exit 0', () => {
  const { stdout, exitCode } = runLockCheckCLI();
  assert.equal(exitCode, 0, `--lock-check with no arg must exit 0, got ${exitCode}`);
  assert.ok(stdout.includes('verdict:'), `stdout must include "verdict:": ${stdout}`);
  // verdict is one of no-lock / wait / recoverable
  assert.ok(
    stdout.includes('no-lock') || stdout.includes('wait') || stdout.includes('recoverable'),
    `verdict must be no-lock|wait|recoverable: ${stdout}`,
  );
});

test('F3 CLI: --lock-check prints exists, ageMs, ownerProcess fields', () => {
  const { stdout, exitCode } = runLockCheckCLI('/tmp');
  assert.equal(exitCode, 0, `exit 0`);
  assert.ok(stdout.includes('exists:'), `stdout must include "exists:": ${stdout}`);
  assert.ok(stdout.includes('ageMs:'), `stdout must include "ageMs:": ${stdout}`);
  assert.ok(stdout.includes('ownerProcess:'), `stdout must include "ownerProcess:": ${stdout}`);
});
