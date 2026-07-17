#!/usr/bin/env node

/**
 * failure-capture.test.mjs
 *
 * Run with: node --test hooks/scripts/lib/__tests__/failure-capture.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureAbnormalWorkerExit,
  detectFailure,
  findAbnormalWorkerExit,
  isAbnormalWorkerExit,
  isCodexMaterializationCrash,
  readRecentFailures,
} from '../failure-capture.mjs';

function mkproject() {
  const root = mkdtempSync(join(tmpdir(), 'qe-failure-capture-'));
  mkdirSync(join(root, '.qe', 'state'), { recursive: true });
  return root;
}

function readAgentErrors(root) {
  return JSON.parse(readFileSync(join(root, '.qe', 'state', 'agent-errors.json'), 'utf8'));
}

test('failure-capture: detects and logs exit code 137', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(isAbnormalWorkerExit({ exitCode: 137 }), true);

  const result = captureAbnormalWorkerExit(root, {
    exitCode: 137,
    workerId: 'worker-a',
    itemId: 'item-1',
    taskUuid: '62465d48',
  });

  assert.equal(result.captured, true);
  assert.equal(result.shouldRetry, true);
  assert.equal(result.retryCount, 0);

  const errors = readAgentErrors(root);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'abnormal-worker-exit');
  assert.equal(errors[0].workerId, 'worker-a');
  assert.equal(errors[0].itemId, 'item-1');
  assert.equal(errors[0].exitCode, 137);
  assert.equal(errors[0].taskUuid, '62465d48');
  assert.match(errors[0].message, /137/);
  assert.match(errors[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('failure-capture: detects SIGKILL-equivalent signal capture', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(isAbnormalWorkerExit({ signal: 'SIGKILL' }), true);
  assert.equal(isAbnormalWorkerExit({ signal: 9 }), true);
  assert.equal(findAbnormalWorkerExit({ workerExit: { signal: 'KILL', workerId: 'worker-b' } }).workerId, 'worker-b');

  const result = captureAbnormalWorkerExit(root, {
    signal: 'SIGKILL',
    worker_id: 'worker-b',
    item_id: 'item-2',
  });

  assert.equal(result.captured, true);
  assert.equal(result.entry.signal, 'SIGKILL');
  assert.equal(result.entry.workerId, 'worker-b');
  assert.match(result.entry.message, /SIGKILL/);
});

test('failure-capture: first retry allowed, second retry suppressed', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const exitInfo = {
    code: '137',
    workerId: 'worker-c',
    itemId: 'item-3',
    taskUuid: 'retry-task',
  };

  const first = captureAbnormalWorkerExit(root, exitInfo);
  assert.equal(first.shouldRetry, true);
  assert.equal(first.retryCount, 0);
  assert.equal(first.entry.retryAllowed, true);

  const second = captureAbnormalWorkerExit(root, exitInfo);
  assert.equal(second.shouldRetry, false);
  assert.equal(second.retryCount, 1);
  assert.equal(second.entry.retryAllowed, false);

  const errors = readAgentErrors(root);
  assert.equal(errors.length, 2);
  assert.equal(errors[1].retryCount, 1);
});

test('failure-capture: retry identity ignores exit reporting shape', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const first = captureAbnormalWorkerExit(root, {
    exitCode: 137,
    workerId: 'worker-same',
    itemId: 'item-same',
    taskUuid: 'same-task',
  });
  assert.equal(first.shouldRetry, true);
  assert.equal(first.retryCount, 0);

  const second = captureAbnormalWorkerExit(root, {
    signal: 'SIGKILL',
    workerId: 'worker-same',
    itemId: 'item-same',
    taskUuid: 'same-task',
  });
  assert.equal(second.shouldRetry, false);
  assert.equal(second.retryCount, 1);

  const errors = readAgentErrors(root);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].exitCode, 137);
  assert.equal(errors[1].signal, 'SIGKILL');
  assert.equal(errors[1].retryAllowed, false);
});

test('failure-capture: Codex materialization crash uses the same one-retry counter', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(isCodexMaterializationCrash({ status: 'crashed' }), true);
  assert.equal(isAbnormalWorkerExit({ crashed: true }), true);

  const first = captureAbnormalWorkerExit(root, {
    status: 'crashed',
    pid: 999999,
    jobId: 'job-dead',
    workerId: 'codex-rescue',
    itemId: 'codex-materialization',
    taskUuid: 'crash-task',
  });
  assert.equal(first.captured, true);
  assert.equal(first.shouldRetry, true);
  assert.equal(first.entry.crashed, true);
  assert.equal(first.entry.pid, 999999);

  const second = captureAbnormalWorkerExit(root, {
    crashed: true,
    pid: 999999,
    jobId: 'job-dead',
    workerId: 'codex-rescue',
    itemId: 'codex-materialization',
    taskUuid: 'crash-task',
  });
  assert.equal(second.shouldRetry, false);
  assert.equal(second.retryCount, 1);
});

test('failure-capture: malformed or missing agent-errors.json is tolerated', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  rmSync(join(root, '.qe', 'state', 'agent-errors.json'), { force: true });
  const missing = captureAbnormalWorkerExit(root, { exitCode: 137, workerId: 'missing-log' });
  assert.equal(missing.captured, true);
  assert.equal(readAgentErrors(root).length, 1);

  writeFileSync(join(root, '.qe', 'state', 'agent-errors.json'), '{not-json', 'utf8');
  const malformed = captureAbnormalWorkerExit(root, { exitCode: 137, workerId: 'bad-log' });
  assert.equal(malformed.captured, true);
  const errors = readAgentErrors(root);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].workerId, 'bad-log');
});

test('failure-capture: existing unchecked checklist detection remains compatible', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, '.qe', 'checklists', 'in-progress'), { recursive: true });
  writeFileSync(
    join(root, '.qe', 'checklists', 'in-progress', 'VERIFY_CHECKLIST_abc12345.md'),
    '# Verify\n\n- [x] complete\n- [ ] still pending\n',
    'utf8'
  );

  const detection = detectFailure(root);
  assert.equal(detection.failed, true);
  assert.equal(detection.taskUuid, 'abc12345');
  assert.deepEqual(detection.uncheckedItems, ['still pending']);
  assert.match(detection.reasons[0], /1 unchecked item/);
});

test('failure-capture: non-abnormal exits are ignored', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(isAbnormalWorkerExit({ exitCode: 1 }), false);
  assert.equal(findAbnormalWorkerExit({ workerExit: { exitCode: 1 } }), null);

  const result = captureAbnormalWorkerExit(root, { exitCode: 1, workerId: 'worker-ok' });
  assert.equal(result.captured, false);
  assert.equal(existsSync(join(root, '.qe', 'state', 'agent-errors.json')), false);
});

// ============================================================================
// Regression: section-terminator lookahead must handle end-of-input AND must
// not truncate on any character (previous bug: `\Z` is not a JS regex anchor —
// it matched a literal `Z`, so a trailing "## Failure Reasons" section got cut
// at the first uppercase Z in its body).
// ============================================================================

test('readRecentFailures: trailing failure reasons are not truncated at "Z"', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const sessionDir = join(root, '.qe', 'learning', 'failures', '2026-07', '2026-07-16-abcd1234');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'CONTEXT.md'),
    'date: 2026-07-16\ntask_uuid: abcd1234\n\n## Failure Reasons\n- Zod validation rejected the payload\n'
  );

  const result = readRecentFailures(root);
  assert.ok(result.includes('Zod validation rejected the payload'), 'reason text must survive the uppercase Z');
});
