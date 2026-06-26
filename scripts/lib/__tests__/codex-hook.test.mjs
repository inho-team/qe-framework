import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'scripts', 'codex', 'pre-tool-use-codex.mjs');

function runHook(command, overrides = {}) {
  const payload = {
    session_id: 'test-session',
    cwd: REPO_ROOT,
    hook_event_name: 'PreToolUse',
    turn_id: 'turn-1',
    tool_name: 'Bash',
    tool_use_id: 'tool-1',
    tool_input: { command },
    permission_mode: 'default',
    ...overrides,
  };
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

test('blocks raw git commit in Codex Bash command', () => {
  const result = runHook('git commit -m x');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QE:BLOCK\]/);
  assert.match(result.stderr, /skill=Qcommit/);
});

test('blocks raw gh pr create in Codex Bash command', () => {
  const result = runHook('gh pr create');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QE:BLOCK\]/);
  assert.match(result.stderr, /skill=Qbranch/);
});

test('blocks in-place edit in Codex Bash command', () => {
  const result = runHook('sed -i s/a/b/ f.txt');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QE:BLOCK\]/);
  assert.match(result.stderr, /skill=_edit_tool/);
});

test('blocks plugin.json version write in Codex Bash command', () => {
  const result = runHook('echo {"version":"1"} > plugin.json');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QE:BLOCK\]/);
  assert.match(result.stderr, /skill=Mbump/);
});

test('allows rm -r build in Codex Bash normal parity mode', () => {
  const result = runHook('rm -r build');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('allows benign Codex Bash command', () => {
  const result = runHook('ls -la');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('allows non-shell tool with commit-like command text', () => {
  const result = runHook('git commit -m x', {
    tool_name: 'Read',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});
