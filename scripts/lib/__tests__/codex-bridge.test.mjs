import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DELEGATION_ARTIFACT_BYTE_CAP,
  DELEGATION_TRUNCATION_MARKER,
  buildDelegationContext,
  buildDelegationPayload,
  getCodexCommand,
} from '../codex_bridge.mjs';

function fixtureDir() {
  return mkdtempSync(join(tmpdir(), 'qe-codex-bridge-'));
}

function writeFixture(cwd, relativePath, content) {
  const filePath = join(cwd, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return relativePath;
}

test('artifacts present: context contains all delimited sections and content', () => {
  const cwd = fixtureDir();
  const taskPath = writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_test.md', 'task body\n');
  const checklistPath = writeFixture(cwd, '.qe/checklists/pending/VERIFY_CHECKLIST_test.md', 'checklist body\n');
  const planPath = writeFixture(cwd, '.qe/plans/PLAN_test.md', 'plan body\n');

  const result = buildDelegationContext('implement', { taskPath, checklistPath, planPath, cwd });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.artifacts.length, 3);
  assert.match(result.context, /=== TASK_REQUEST \(\.qe\/tasks\/pending\/TASK_REQUEST_test\.md\) ===\ntask body/);
  assert.match(result.context, /=== VERIFY_CHECKLIST \(\.qe\/checklists\/pending\/VERIFY_CHECKLIST_test\.md\) ===\nchecklist body/);
  assert.match(result.context, /=== PLAN \(\.qe\/plans\/PLAN_test\.md\) ===\nplan body/);
});

test('missing artifact: graceful degrade with warning and no throw', () => {
  const cwd = fixtureDir();
  const taskPath = writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_test.md', 'task body\n');

  let result;
  assert.doesNotThrow(() => {
    result = buildDelegationContext('verify', {
      taskPath,
      checklistPath: '.qe/checklists/pending/VERIFY_CHECKLIST_missing.md',
      cwd,
    });
  });

  assert.match(result.context, /=== TASK_REQUEST/);
  assert.doesNotMatch(result.context, /VERIFY_CHECKLIST_missing/);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Skipped VERIFY_CHECKLIST artifact/);
});

test('oversize artifact: content is capped and truncation marker appears', () => {
  const cwd = fixtureDir();
  const secretTail = 'TAIL_SECRET_MUST_NOT_BE_IN_CONTEXT';
  const taskPath = writeFixture(
    cwd,
    '.qe/tasks/pending/TASK_REQUEST_large.md',
    `${'a'.repeat(DELEGATION_ARTIFACT_BYTE_CAP)}${secretTail}`
  );

  const result = buildDelegationContext('spec', { taskPath, cwd });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].bytes, DELEGATION_ARTIFACT_BYTE_CAP + secretTail.length);
  assert.equal(result.artifacts[0].truncated, true);
  assert.ok(result.context.includes(DELEGATION_TRUNCATION_MARKER));
  assert.ok(!result.context.includes(secretTail));
});

test('delegation payload keeps command shape and includes artifact context', () => {
  const cwd = fixtureDir();
  const taskPath = writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_test.md', 'payload task body\n');

  const payload = buildDelegationPayload('implement', { taskPath, cwd, model: 'gpt-test', effort: 'high' });

  assert.deepEqual(payload.command, getCodexCommand('implement', { model: 'gpt-test', effort: 'high' }));
  assert.match(payload.context, /payload task body/);
  assert.equal(payload.warnings.length, 0);
  assert.equal(payload.artifacts.length, 1);
});

test('audit metadata record has artifact list and byte counts but no body content', () => {
  const cwd = fixtureDir();
  const bodySecret = 'AUDIT_BODY_SECRET_MUST_NOT_APPEAR';
  const taskPath = writeFixture(cwd, '.qe/tasks/pending/TASK_REQUEST_audit.md', `${bodySecret}\n`);
  const checklistPath = writeFixture(cwd, '.qe/checklists/pending/VERIFY_CHECKLIST_audit.md', 'audit checklist\n');

  const payload = buildDelegationPayload('verify', {
    taskPath,
    checklistPath,
    planPath: '.qe/plans/PLAN_missing.md',
    cwd,
  });

  assert.equal(payload.warnings.length, 1);

  const logPath = join(cwd, '.qe', 'agent-results', 'codex-context-audit.log');
  assert.equal(existsSync(logPath), true);
  const logContent = readFileSync(logPath, 'utf8');
  assert.ok(!logContent.includes(bodySecret));
  assert.ok(!logContent.includes('audit checklist'));

  const records = logContent.trim().split('\n').map((line) => JSON.parse(line));
  const record = records.at(-1);
  assert.equal(record.stage, 'verify');
  assert.equal(record.warningCount, 1);
  assert.deepEqual(
    record.artifacts.map((artifact) => artifact.path),
    [taskPath, checklistPath]
  );
  assert.deepEqual(
    record.artifacts.map((artifact) => artifact.bytes),
    [Buffer.byteLength(`${bodySecret}\n`), Buffer.byteLength('audit checklist\n')]
  );
  assert.deepEqual(
    record.artifacts.map((artifact) => artifact.truncated),
    [false, false]
  );
});
