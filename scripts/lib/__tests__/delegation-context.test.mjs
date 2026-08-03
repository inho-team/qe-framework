import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as claudeBridge from '../claude_bridge.mjs';
import * as codexBridge from '../codex_bridge.mjs';
import {
  DELEGATION_ARTIFACT_BYTE_CAP,
  DELEGATION_TRUNCATION_MARKER,
  buildDelegationContext,
  loadSivsConfig,
} from '../delegation-context.mjs';

test('both compatibility bridges expose the same neutral implementation', () => {
  assert.equal(claudeBridge.buildDelegationContext, buildDelegationContext);
  assert.equal(codexBridge.buildDelegationContext, buildDelegationContext);
  assert.equal(claudeBridge.loadSivsConfig, loadSivsConfig);
  assert.equal(codexBridge.loadSivsConfig, loadSivsConfig);
});

test('neutral context reads bounded artifacts and reports missing inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-delegation-context-'));
  writeFileSync(join(root, 'task.md'), 'task body\n');
  writeFileSync(join(root, 'large.md'), 'x'.repeat(DELEGATION_ARTIFACT_BYTE_CAP + 32));

  const result = buildDelegationContext('verify', {
    cwd: root,
    taskPath: 'task.md',
    checklistPath: 'missing.md',
    planPath: 'large.md',
    audit: false,
  });
  assert.match(result.context, /=== TASK_REQUEST \(task\.md\) ===\ntask body/);
  assert.match(result.context, new RegExp(DELEGATION_TRUNCATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.warnings.length, 1);
});

test('neutral config accepts single-AI fields and rejects retired routing fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-delegation-config-'));
  mkdirSync(join(root, '.qe'));
  writeFileSync(join(root, '.qe', 'sivs-config.json'), JSON.stringify({
    schemaVersion: 2,
    verify: { model: 'gpt-5.4', effort: 'high' },
  }));
  assert.deepEqual(loadSivsConfig(root).verify, { model: 'gpt-5.4', effort: 'high' });

  writeFileSync(join(root, '.qe', 'sivs-config.json'), JSON.stringify({
    schemaVersion: 2,
    verify: { engine: 'codex' },
  }));
  assert.throws(() => loadSivsConfig(root), /Invalid single-AI SIVS config/);
});

test('cross-client command surfaces remain retired after extraction', () => {
  assert.throws(() => claudeBridge.getClaudeCommand('verify'), /retired/);
  assert.throws(() => codexBridge.getCodexCommand('verify'), /retired/);
  assert.throws(() => claudeBridge.buildReverseDelegationPayload('verify'), /retired/);
  assert.throws(() => codexBridge.buildDelegationPayload('verify'), /retired/);
});
