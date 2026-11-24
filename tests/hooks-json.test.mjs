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

function toShellPath(p) {
  return spawnSync(shPath, ['-c', 'cygpath -u "$1" 2>/dev/null || printf "%s" "$1"', 'x', p], {
    encoding: 'utf8',
  }).stdout.trim();
}

test('SessionStart runs only on startup, clear, and compact', () => {
  assert.equal(hooks.hooks.SessionStart[0].matcher, 'startup|clear|compact');
  assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStop']);
  // Sourcing is a shell builtin, so the launcher starts even when PATH is empty.
  assert.equal(command, 'QE_HOOK=session-start.mjs . "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh"');
});

test('hook command emits a clear notice instead of failing when node is not found', { skip: !shPath }, () => {
  // A PATH holding only an empty temp dir: sh builtins (command, printf) still work, node does not resolve.
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-nonode-'));
  const res = spawnSync(shPath, ['-c', command], {
    encoding: 'utf8',
    // QE_NODE_PROBES='' turns off the common-path probes so "no node anywhere" is reproducible.
    env: { PATH: emptyBin, CLAUDE_PLUGIN_ROOT: repoRoot, QE_NODE_PROBES: '' },
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /Node\.js/);
  assert.match(out.systemMessage, /\/clear/);
  assert.match(out.systemMessage, /Node\.js 22/);
});

test('hook command finds node at a probe path when PATH lacks it', { skip: !shPath }, () => {
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-nonode-'));
  // A probe dir with a space in its name exercises quoting.
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe probe '));
  const fakeNode = path.join(probeDir, 'node');
  const marker = '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"PROBED"}}';
  fs.writeFileSync(fakeNode, `#!/bin/sh\nprintf '%s' '${marker}'\n`);
  fs.chmodSync(fakeNode, 0o755);
  const res = spawnSync(shPath, ['-c', command], {
    encoding: 'utf8',
    env: {
      PATH: emptyBin,
      CLAUDE_PLUGIN_ROOT: repoRoot,
      QE_NODE_PROBES: `/nonexistent/node:${toShellPath(fakeNode)}`,
    },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, 'PROBED');
});

test('hook command finds node under LOCALAPPDATA Volta when PATH is empty', { skip: !shPath }, () => {
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-nonode-'));
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-home-'));
  // LOCALAPPDATA arrives in C:\… form on Windows; the default probe list must not split it on ':'.
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-lad-'));
  const voltaBin = path.join(localAppData, 'Volta', 'bin');
  fs.mkdirSync(voltaBin, { recursive: true });
  const fakeNode = path.join(voltaBin, 'node.exe');
  const marker = '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"PROBED"}}';
  fs.writeFileSync(fakeNode, `#!/bin/sh\nprintf '%s' '${marker}'\n`);
  fs.chmodSync(fakeNode, 0o755);
  const res = spawnSync(shPath, ['-c', command], {
    encoding: 'utf8',
    env: { PATH: emptyBin, CLAUDE_PLUGIN_ROOT: repoRoot, HOME: toShellPath(emptyHome), LOCALAPPDATA: localAppData },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, 'PROBED');
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
  assert.match(out.hookSpecificOutput.additionalContext, /^# QE — 이해 → 계획 → 실행 → 검증 → 마무리/);
  assert.equal(out.systemMessage, undefined);
});

test('run.sh with QE_HOOK=other.mjs prints nothing when node is missing', { skip: !shPath }, () => {
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-nonode-'));
  const res = spawnSync(shPath, ['-c', 'QE_HOOK=other.mjs . "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh"'], {
    encoding: 'utf8',
    env: { PATH: emptyBin, CLAUDE_PLUGIN_ROOT: repoRoot, QE_NODE_PROBES: '' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '');
});

test('run.sh runs the script named by QE_HOOK', { skip: !shPath }, () => {
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-nonode-'));
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe probe '));
  const fakeNode = path.join(probeDir, 'node');
  fs.writeFileSync(fakeNode, `#!/bin/sh
printf '%s' "$1"
`);
  fs.chmodSync(fakeNode, 0o755);
  const res = spawnSync(shPath, ['-c', 'QE_HOOK=other.mjs . "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh"'], {
    encoding: 'utf8',
    env: { PATH: emptyBin, CLAUDE_PLUGIN_ROOT: toShellPath(repoRoot), QE_NODE_PROBES: toShellPath(fakeNode) },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.endsWith('hooks/other.mjs'), res.stdout);
});
