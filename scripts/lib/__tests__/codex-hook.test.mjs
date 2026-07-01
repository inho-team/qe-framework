import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'scripts', 'codex', 'lifecycle-codex.mjs');

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
  return spawnSync(process.execPath, [HOOK_PATH, 'PreToolUse', 'scripts/pre-tool-use.mjs'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

function runRawHook(input) {
  return spawnSync(process.execPath, [HOOK_PATH, 'PreToolUse', 'scripts/pre-tool-use.mjs'], {
    input,
    encoding: 'utf8',
  });
}

test('blocks raw git commit in Codex Bash command', () => {
  const result = runHook('git commit -m x');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QE:BLOCK\]/);
  assert.match(result.stderr, /skill=Qcommit/);
  assert.match(result.stderr, /Use \$Qcommit instead/);
});

test('blocks raw gh pr create in Codex Bash command', () => {
  const result = runHook('gh pr create');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[QE:BLOCK\]/);
  assert.match(result.stderr, /skill=Qbranch/);
  assert.match(result.stderr, /Use \$Qbranch instead/);
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
  assert.match(result.stderr, /skill=qe-admin-version/);
  assert.match(result.stderr, /qe-admin-mcp release\/bump admin workflow/);
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

test('blocks raw git commit for every supported shell tool variant', () => {
  for (const tool_name of ['Bash', 'Shell', 'shell', 'exec_command']) {
    const result = runHook('git commit -m x', { tool_name });

    assert.equal(result.status, 2, `expected block for ${tool_name}`);
    assert.match(result.stderr, /\[QE:BLOCK\]/, `expected block marker for ${tool_name}`);
    assert.match(result.stderr, /skill=Qcommit/, `expected Qcommit guidance for ${tool_name}`);
  }
});

test('allows benign shell command for every supported shell tool variant', () => {
  for (const tool_name of ['Bash', 'Shell', 'shell', 'exec_command']) {
    const result = runHook('pwd', { tool_name });

    assert.equal(result.status, 0, `expected allow for ${tool_name}`);
    assert.match(result.stdout, /"continue":true/, `expected continue response for ${tool_name}`);
    assert.equal(result.stderr, '', `expected empty stderr for ${tool_name}`);
  }
});

test('allows non-shell tool with commit-like command text', () => {
  const result = runHook('git commit -m x', {
    tool_name: 'Read',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('fails open when payload is empty', () => {
  const result = runRawHook('');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('fails open when payload is malformed JSON', () => {
  const result = runRawHook('{"tool_name":');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('fails open when payload is unexpected JSON type', () => {
  const result = runRawHook('[]');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('fails open when shell payload omits command', () => {
  const result = runHook(undefined, {
    tool_name: 'Shell',
    tool_input: {},
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});

test('fails open when shell payload command is not a string', () => {
  const result = runHook('ignored', {
    tool_name: 'exec_command',
    tool_input: { command: { raw: 'git commit -m x' } },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /"continue":true/);
  assert.equal(result.stderr, '');
});
