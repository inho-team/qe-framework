import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { deliverOnce, readDeliveryLedger, semanticEventKey } from '../delivery-ledger.mjs';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const TASK_COMPLETED_HOOK = resolve(TEST_DIR, '../../task-completed.mjs');
const STOP_HOOK = resolve(TEST_DIR, '../../stop-handler.mjs');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qe-delivery-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('semantic keys ignore delivery timestamp noise and distinguish effects', (t) => {
  const first = semanticEventKey('TaskCompleted', { task_id: 'T-1', status: 'complete', timestamp: 1 });
  const replay = semanticEventKey('TaskCompleted', { task_id: 'T-1', status: 'complete', timestamp: 2 });
  assert.equal(first, replay);

  const root = fixture(t);
  let calls = 0;
  const a = deliverOnce(root, { eventType: 'TaskCompleted', payload: { task_id: 'T-1' }, effect: 'bookkeeping', run: () => ++calls });
  const b = deliverOnce(root, { eventType: 'TaskCompleted', payload: { task_id: 'T-1' }, effect: 'telemetry', run: () => ++calls });
  assert.equal(a.status, 'delivered');
  assert.equal(b.status, 'delivered');
  assert.equal(calls, 2);
});

test('a delivered effect is suppressed on replay across ledger reads', (t) => {
  const root = fixture(t);
  let calls = 0;
  const input = { eventType: 'Stop', payload: { hook_event_id: 'event-1' }, effect: 'cleanup' };
  const first = deliverOnce(root, { ...input, run: () => ++calls });
  const replay = deliverOnce(root, { ...input, run: () => ++calls });

  assert.equal(first.status, 'delivered');
  assert.equal(replay.status, 'duplicate');
  assert.equal(calls, 1);
  assert.equal(Object.values(readDeliveryLedger(root).entries)[0].status, 'delivered');
});

test('a failed effect remains retryable and success is then deduplicated', (t) => {
  const root = fixture(t);
  let attempts = 0;
  let successfulEffects = 0;
  const input = { eventType: 'TaskCompleted', payload: { task_id: 'T-2' }, effect: 'metrics' };

  assert.throws(() => deliverOnce(root, {
    ...input,
    run: () => {
      attempts += 1;
      throw new Error('temporary failure');
    },
  }), /temporary failure/);
  assert.equal(Object.values(readDeliveryLedger(root).entries)[0].status, 'failed');

  const retry = deliverOnce(root, {
    ...input,
    run: () => {
      attempts += 1;
      successfulEffects += 1;
    },
  });
  const replay = deliverOnce(root, { ...input, run: () => { successfulEffects += 1; } });
  assert.equal(retry.status, 'delivered');
  assert.equal(retry.attempts, 2);
  assert.equal(replay.status, 'duplicate');
  assert.equal(attempts, 2);
  assert.equal(successfulEffects, 1);
});

test('distinct explicit lifecycle event ids are delivered independently', (t) => {
  const root = fixture(t);
  let calls = 0;
  for (const eventId of ['event-a', 'event-b']) {
    deliverOnce(root, {
      eventType: 'Stop', payload: { event_id: eventId }, effect: 'sweep', run: () => ++calls,
    });
  }
  assert.equal(calls, 2);
  assert.equal(Object.keys(readDeliveryLedger(root).entries).length, 2);
});

function runHook(script, payload) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

test('TaskCompleted replay records each successful hook effect once', (t) => {
  const root = fixture(t);
  const payload = {
    cwd: root,
    hook_event_id: 'task-delivery-1',
    task_id: 'T-3',
    status: 'complete',
    verification_attempt: 1,
    session_id: 'session-1',
  };
  runHook(TASK_COMPLETED_HOOK, payload);
  runHook(TASK_COMPLETED_HOOK, payload);

  const ledger = JSON.parse(readFileSync(join(root, '.qe/state/delivery-ledger.json'), 'utf8'));
  assert.equal(Object.keys(ledger.entries).length, 3);
  assert.ok(Object.values(ledger.entries).every((entry) => entry.status === 'delivered' && entry.attempts === 1));

  const telemetry = readFileSync(join(root, '.qe/telemetry', `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8')
    .trim().split('\n').filter(Boolean);
  assert.equal(telemetry.length, 1);
});

test('Stop replay deduplicates sweep and allowed-stop cleanup effects', (t) => {
  const root = fixture(t);
  const payload = {
    cwd: root,
    hook_event_id: 'stop-delivery-1',
    session_id: '11111111-1111-4111-8111-111111111111',
    last_assistant_message: 'continuing later',
  };
  runHook(STOP_HOOK, payload);
  runHook(STOP_HOOK, payload);

  const ledger = JSON.parse(readFileSync(join(root, '.qe/state/delivery-ledger.json'), 'utf8'));
  assert.equal(Object.keys(ledger.entries).length, 2);
  assert.ok(Object.values(ledger.entries).every((entry) => entry.status === 'delivered' && entry.attempts === 1));
});
