import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
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

test('getClaudeCommand renders stage commands and rejects unknown stages', () => {
  assert.deepEqual(getClaudeCommand('verify'), {
    command: 'claude -p',
    description: 'Delegate verification to Claude',
  });
  assert.equal(
    getClaudeCommand('supervise', { model: 'sonnet', background: true }).command,
    'claude -p --model sonnet --background'
  );
  assert.throws(() => getClaudeCommand('missing'), /Unknown stage/);
});

test('resolveReverseEngine delegates to Claude only when CLI is authenticated', () => {
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
