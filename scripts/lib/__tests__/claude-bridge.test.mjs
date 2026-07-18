import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DELEGATION_ARTIFACT_BYTE_CAP,
  DELEGATION_TRUNCATION_MARKER,
} from '../codex_bridge.mjs';
import {
  buildReverseDelegationPayload,
  getClaudeCommand,
  isClaudeCliAuthenticated,
  isClaudeCliAvailable,
  resolveReverseEngine,
} from '../claude_bridge.mjs';

function withFakeClaude(script, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'qe-fake-claude-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);

  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath || ''}`;
  try {
    return fn();
  } finally {
    process.env.PATH = oldPath;
  }
}

function fixtureDir() {
  return mkdtempSync(join(tmpdir(), 'qe-claude-bridge-'));
}

function writeFixture(cwd, relativePath, content) {
  const filePath = join(cwd, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return relativePath;
}

test('getClaudeCommand renders stage commands and rejects unknown stages', () => {
  assert.deepEqual(getClaudeCommand('verify'), {
    command: 'claude -p',
    argv: ['claude', '-p'],
    description: 'Delegate verification to Claude',
  });
  assert.equal(
    getClaudeCommand('supervise', { model: 'sonnet', background: true }).command,
    'claude -p --model sonnet --background'
  );
  assert.throws(() => getClaudeCommand('missing'), /Unknown stage/);
});

test('resolveReverseEngine delegates to Claude when CLI is authenticated', () => {
  withFakeClaude(`#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '{"loggedIn":true,"authMethod":"test"}'
  exit 0
fi
exit 0
`, () => {
    assert.equal(isClaudeCliAvailable(), true);
    assert.equal(isClaudeCliAuthenticated(), true);
    const result = resolveReverseEngine('verify', { verify: { engine: 'claude' } });
    assert.equal(result.engine, 'claude');
    assert.equal(result.command.command, 'claude -p');
  });
});

test('resolveReverseEngine falls back to Codex when Claude CLI is not logged in', () => {
  withFakeClaude(`#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '{"loggedIn":false,"authMethod":"none"}'
  exit 1
fi
exit 0
`, () => {
    assert.equal(isClaudeCliAvailable(), true);
    assert.equal(isClaudeCliAuthenticated(), false);
    const result = resolveReverseEngine('verify', { verify: { engine: 'claude' } });
    assert.equal(result.engine, 'codex');
    assert.match(result.warning, /not authenticated/);
  });
});

test('resolveReverseEngine keeps Codex stages local', () => {
  const result = resolveReverseEngine('implement', { implement: { engine: 'codex' } });
  assert.deepEqual(result, { engine: 'codex' });
});

test('reverse delegation payload keeps Claude command shape and includes artifact context', () => {
  const cwd = fixtureDir();
  const taskPath = writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_test.md', 'reverse task body\n');
  const checklistPath = writeFixture(
    cwd,
    '.qe/checklists/pending/VERIFY_CHECKLIST_test.md',
    'reverse checklist body\n'
  );

  const payload = buildReverseDelegationPayload('verify', {
    taskPath,
    checklistPath,
    cwd,
    model: 'sonnet',
  });

  assert.deepEqual(payload.command, getClaudeCommand('verify', { model: 'sonnet' }));
  assert.equal(payload.command.command, 'claude -p --model sonnet');
  assert.match(payload.context, /=== TASK_REQUEST \(\.qe\/tasks\/pending\/TASK_REQUEST_test\.md\) ===/);
  assert.match(payload.context, /reverse task body/);
  assert.match(payload.context, /reverse checklist body/);
  assert.equal(payload.warnings.length, 0);
  assert.equal(payload.artifacts.length, 2);
});

test('reverse delegation payload degrades gracefully when artifacts are absent', () => {
  const cwd = fixtureDir();

  let payload;
  assert.doesNotThrow(() => {
    payload = buildReverseDelegationPayload('spec', {
      taskPath: '.qe/tasks/pending/TASK_REQUEST_missing.md',
      checklistPath: '.qe/checklists/pending/VERIFY_CHECKLIST_missing.md',
      cwd,
    });
  });

  assert.deepEqual(payload.command, getClaudeCommand('spec'));
  assert.equal(payload.context, '');
  assert.equal(payload.artifacts.length, 0);
  assert.equal(payload.warnings.length, 2);
  assert.match(payload.warnings[0], /Skipped TASK_REQUEST artifact/);
});

test('reverse delegation payload uses shared builder truncation marker for oversize input', () => {
  const cwd = fixtureDir();
  const secretTail = 'CLAUDE_TAIL_SECRET_MUST_NOT_BE_IN_CONTEXT';
  const taskPath = writeFixture(
    cwd,
    '.qe/tasks/pending/TASK_REQUEST_large.md',
    `${'a'.repeat(DELEGATION_ARTIFACT_BYTE_CAP)}${secretTail}`
  );

  const payload = buildReverseDelegationPayload('implement', { taskPath, cwd });

  assert.equal(payload.artifacts.length, 1);
  assert.equal(payload.artifacts[0].truncated, true);
  assert.ok(payload.context.includes(DELEGATION_TRUNCATION_MARKER));
  assert.ok(!payload.context.includes(secretTail));
});
