import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
const command = hooks.hooks.SessionStart[0].hooks[0].command;

// Find a POSIX sh; skip the shell tests where none exists.
// On Windows (Git Bash) `command -v` prints a POSIX path, so translate it with cygpath.
const shProbe = spawnSync('sh', ['-c', 'p=$(command -v sh); cygpath -w "$p" 2>/dev/null || printf "%s" "$p"'], {
  encoding: 'utf8',
});
const shPath = shProbe.status === 0 ? shProbe.stdout.trim() : null;

test('SessionStart runs only on startup, clear, and compact', () => {
  assert.equal(hooks.hooks.SessionStart[0].matcher, 'startup|clear|compact');
  assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart']);
});

test('hook command emits a clear notice instead of failing when node is not on PATH', { skip: !shPath }, () => {
  // A PATH holding only an empty temp dir: sh builtins (command, printf) still work, node does not resolve.
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-nonode-'));
  const res = spawnSync(shPath, ['-c', command], {
    encoding: 'utf8',
    env: { PATH: emptyBin, CLAUDE_PLUGIN_ROOT: repoRoot },
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /Node\.js/);
  assert.match(out.systemMessage, /Node\.js 22/);
});

test('hook command runs the session-start script when node is on PATH', { skip: !shPath }, () => {
  const nodeDir = path.dirname(process.execPath);
  const res = spawnSync(shPath, ['-c', command], {
    encoding: 'utf8',
    input: JSON.stringify({ cwd: os.tmpdir(), source: 'startup' }),
    env: { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}`, CLAUDE_PLUGIN_ROOT: repoRoot },
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /^# QE — 이해 → 계획 → 실행 → 검증/);
  assert.equal(out.systemMessage, undefined);
});
