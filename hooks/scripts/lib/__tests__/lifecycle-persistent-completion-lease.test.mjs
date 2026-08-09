import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { createProcessControllerStore } from '../process-controller-store.mjs';
import { createProcessController } from '../process-controller.mjs';
import { readDeliveryLedger } from '../delivery-ledger.mjs';
import { setup, put, runRecord, UUID, PLAN, HASH } from './lifecycle-sivs-stage-adapter.test.mjs';

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const I = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

function fixture(nowMs = 1_000) {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-lease-'));
  const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
  let now = nowMs;
  const store = createProcessControllerStore(cwd, { now: () => now });
  return { cwd, store, setNow(value) { now = value; }, close() {
    store.close(); rmSync(cwd, { recursive: true, force: true });
  } };
}

function supervised(cwd) {
  const x = setup(cwd); const { sivs, binding, paths } = x;
  const stage = (id, revision) => sivs.transitionSivsStage({ processId: 'sivs-1', requestId: id,
    action: 'forward', binding: binding.binding, expectedRevision: revision, ...paths });
  stage('f1', 0); const impl = runRecord('implementation', I);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
  stage('f2', 1); const verify = runRecord('verification', V);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
  const verified = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'pv', binding: binding.binding,
    assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
      acceptanceHash: HASH, implementationRunId: impl.runId, verificationRunId: verify.runId,
      verdict: 'PASS', reviewer: verify.verifier, sessionId: V, findingsDigest: 'e'.repeat(64) } });
  stage('f3', 2);
  sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'ps', binding: binding.binding,
    assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
      acceptanceHash: HASH, verificationProofDigest: verified.proofRef.split(':')[1], verdict: 'PASS',
      supervisor: 'lead', sessionId: S, riskDigest: 'f'.repeat(64) } });
  const acceptance = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1' }],
    scenarios: [{ id: 'S1' }], humanAcceptance: { required: true } };
  const completion = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1', outcome: 'pass', evidence: 'ok' }],
    scenarios: [{ id: 'S1', outcome: 'pass', evidence: 'ok' }], regression: { outcome: 'pass', evidence: 'ok' },
    independentVerification: { verifier: verify.verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'ok' },
    goalAlignment: { objective: 'x', verifier: verify.verifier, outcome: 'pass', evidence: 'ok' },
    humanAcceptance: { status: 'passed', evidence: 'approved' }, limitations: [] };
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.acceptance.json`, `${JSON.stringify(acceptance, null, 2)}\n`);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.completion.json`, `${JSON.stringify(completion, null, 2)}\n`);
  put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
    goals: [{ id: 'G001', objective: 'x', status: 'active', attempts: 1,
      acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH },
      completionEvidence: { status: 'recorded', file: 'evidence/G001.completion.json' } }] }));
  return { ...x, verify };
}

test('acquires, renews with stale fencing protection, and bounds one generation', () => {
  const x = fixture();
  try {
    const acquired = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'acquire-1', durationMs: 100 });
    assert.deepEqual([acquired.code, acquired.generation, acquired.fence], ['PERSISTENT_LEASE_ACQUIRED', 1, 1]);
    assert.match(acquired.token, /^[0-9a-f]{64}$/);
    assert.equal(x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'acquire-1', durationMs: 100 }).replayed, true);
    x.setNow(1_001);
    for (let index = 0; index < 32; index += 1) {
      const renewed = x.store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: `renew-${index}`, token: acquired.token, generation: 1, fence: 1, durationMs: 100 });
      assert.equal(renewed.code, 'PERSISTENT_LEASE_RENEWED');
    }
    assert.equal(x.store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'renew-over', token: acquired.token, generation: 1, fence: 1, durationMs: 100 }).code,
    'PERSISTENT_LEASE_RENEWAL_EXHAUSTED');
    assert.equal(x.store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'renew-stale', token: 'f'.repeat(64), generation: 1, fence: 1, durationMs: 100 }).code,
    'PERSISTENT_LEASE_STALE');
  } finally { x.close(); }
});

test('Stop decisions bind generation authority and replay without consulting clock', () => {
  const x = fixture();
  try {
    const acquired = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'acquire', durationMs: 100 });
    const event = { eventKey: 'stop-1', cwd: x.cwd, transcriptPath: '/tmp/t.jsonl', turnId: 'turn-1',
      userText: 'u', assistantText: 'a', sessionId: SESSION };
    x.setNow(1_050);
    const blocked = x.store.decidePersistentStop(event);
    assert.deepEqual([blocked.code, blocked.allow], ['PERSISTENT_LEASE_ACTIVE', false]);
    x.setNow(900);
    assert.equal(x.store.decidePersistentStop(event).replayed, true);
    assert.equal(x.store.decidePersistentStop({ ...event, assistantText: 'changed' }).code, 'REQUEST_ID_CONFLICT');
    x.setNow(acquired.expiresAt);
    const expired = x.store.decidePersistentStop({ ...event, eventKey: 'stop-2' });
    assert.deepEqual([expired.code, expired.allow], ['PERSISTENT_LEASE_EXPIRED', true]);
  } finally { x.close(); }
});

test('requires a genuine terminal predecessor before generation rollover', () => {
  const x = fixture();
  try {
    x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'acquire-1', durationMs: 10 });
    x.setNow(1_010);
    x.store.decidePersistentStop({ eventKey: 'expire', cwd: x.cwd, transcriptPath: '', turnId: 't',
      userText: '', assistantText: '', sessionId: SESSION });
    const next = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'acquire-2', durationMs: 10 });
    assert.deepEqual([next.code, next.generation, next.fence], ['PERSISTENT_LEASE_ACQUIRED', 2, 2]);
  } finally { x.close(); }
});

test('atomically releases an active lease with SIVS completion', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-complete-'));
  try {
    const x = supervised(cwd); x.sivs.close();
    const lease = createProcessControllerStore(cwd);
    const acquired = lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 });
    assert.equal(acquired.code, 'PERSISTENT_LEASE_ACQUIRED'); lease.close();
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    const completed = sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'complete',
      action: 'forward', binding: x.binding.binding, expectedRevision: 3, ...x.paths });
    assert.equal(completed.to, 'complete'); sivs.close();
    const read = createProcessControllerStore(cwd);
    const stop = read.decidePersistentStop({ eventKey: 'after-complete', cwd, transcriptPath: '',
      turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
    assert.deepEqual([stop.code, stop.allow], ['PERSISTENT_PROCESS_COMPLETE', true]);
    read.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('completes with an already-expired lease and expires an overdue active lease atomically', () => {
  for (const preExpired of [true, false]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-expired-complete-'));
    try {
      const x = supervised(cwd); x.sivs.close();
      const lease = createProcessControllerStore(cwd);
      const acquired = lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 1 });
      while (Date.now() < acquired.expiresAt) {}
      if (preExpired) {
        assert.equal(lease.decidePersistentStop({ eventKey: 'expire-first', cwd, transcriptPath: '',
          turnId: 't', userText: '', assistantText: '', sessionId: SESSION }).code,
        'PERSISTENT_LEASE_EXPIRED');
      }
      lease.close();
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
      const completed = sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'complete',
        action: 'forward', binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      assert.equal(completed.to, 'complete'); sivs.close();
      const check = createProcessControllerStore(cwd);
      const stop = check.decidePersistentStop({ eventKey: 'after', cwd, transcriptPath: '', turnId: 't',
        userText: '', assistantText: '', sessionId: SESSION });
      assert.deepEqual([stop.code, stop.allow], ['PERSISTENT_PROCESS_COMPLETE', true]);
      check.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('rolls back both SIVS completion and lease terminal event at every precommit cut', () => {
  for (const point of ['persistent-completion-between-process-audit-and-lease-event',
    'persistent-completion-between-event-and-head', 'persistent-completion-before-commit',
    'before-commit', 'persistent-completion-after-commit']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-complete-fault-'));
    try {
      const x = supervised(cwd); x.sivs.close();
      const lease = createProcessControllerStore(cwd);
      lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 60_000 }); lease.close();
      let fired = false;
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
        faultInjector(name) { if (!fired && name === point) { fired = true; throw new Error(point); } } });
      const result = sivs.transitionSivsStage({ processId: 'sivs-1', requestId: `complete-${point}`,
        action: 'forward', binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      const committed = point === 'persistent-completion-after-commit';
      assert.equal(result.code, committed ? 'SIVS_STAGE_TRANSITION_COMMITTED' : 'STORE_UNAVAILABLE', point);
      assert.equal(sivs.read('sivs-1').snapshot.state, committed ? 'complete' : 'supervise', point);
      sivs.close();
      const check = createProcessControllerStore(cwd);
      const blocked = check.decidePersistentStop({ eventKey: `stop-${point}`, cwd, transcriptPath: '',
        turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
      assert.equal(blocked.code, committed ? 'PERSISTENT_PROCESS_COMPLETE' : 'PERSISTENT_LEASE_ACTIVE', point);
      check.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('Stop hook blocks an active controller lease before legacy persistent mode', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-hook-'));
  try {
    const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
    const store = createProcessControllerStore(cwd);
    store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 }); store.close();
    const handler = fileURLToPath(new URL('../../stop-handler.mjs', import.meta.url));
    const input = { cwd, session_id: SESSION, event_key: 'hook-stop', turn_id: 'turn',
      transcript_path: '', last_user_message: 'u', last_assistant_message: 'a' };
    const child = spawnSync(process.execPath, [handler], { input: JSON.stringify(input), encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const output = JSON.parse(child.stdout.trim());
    assert.deepEqual([output.decision, output.continue], ['block', false]);
    assert.match(output.reason, /PERSISTENT_LEASE_ACTIVE/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function childAcquire(cwd, requestId) {
  const url = new URL('../process-controller-store.mjs', import.meta.url).href;
  const code = `import{createProcessControllerStore}from ${JSON.stringify(url)};const s=createProcessControllerStore(process.env.CWD_X);const r=s.acquirePersistentLease({processId:'sivs-1',sessionId:${JSON.stringify(SESSION)},requestId:process.env.R,durationMs:1000});s.close();process.stdout.write(JSON.stringify(r));`;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code],
      { env: { ...process.env, CWD_X: cwd, R: requestId }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', status => resolve({ status, value: JSON.parse(out) }));
  });
}

test('serializes same and distinct subprocess generation rollover', async () => {
  for (const same of [true, false]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-rollover-race-'));
    try {
      const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
      const store = createProcessControllerStore(cwd);
      const first = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'first', durationMs: 1 });
      while (Date.now() < first.expiresAt) {}
      store.decidePersistentStop({ eventKey: 'expire', cwd, transcriptPath: '', turnId: 't',
        userText: '', assistantText: '', sessionId: SESSION }); store.close();
      const values = await Promise.all([childAcquire(cwd, 'next-a'), childAcquire(cwd, same ? 'next-a' : 'next-b')]);
      assert.deepEqual(values.map(item => item.status), [0, 0]);
      assert.equal(values.filter(item => item.value.code === 'PERSISTENT_LEASE_ACQUIRED').length, same ? 2 : 1);
      if (same) assert.deepEqual(values.map(item => item.value.replayed).sort(), [false, true]);
      else assert.equal(values.some(item => item.value.code === 'PERSISTENT_LEASE_ACTIVE'), true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('recovers exact acquire, renew, and Stop decisions after postcommit response loss', () => {
  for (const operation of ['acquire', 'renew', 'stop']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-response-loss-'));
    try {
      const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
      let now = 10_000; let fired = false;
      let store = createProcessControllerStore(cwd, { now: () => now,
        faultInjector(point) {
          const target = operation === 'acquire' ? 'persistent-acquire-after-commit'
            : operation === 'renew' ? 'persistent-renew-after-commit' : 'persistent-stop-after-commit';
          if (!fired && point === target) { fired = true; throw new Error(target); }
        } });
      let acquired;
      if (operation === 'acquire') {
        acquired = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
          requestId: 'acquire', durationMs: 100 });
        assert.deepEqual([acquired.code, acquired.replayed], ['PERSISTENT_LEASE_ACQUIRED', false]);
      } else {
        store.close(); store = createProcessControllerStore(cwd, { now: () => now });
        acquired = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
          requestId: 'acquire', durationMs: 100 }); store.close();
        fired = false; now += 1;
        store = createProcessControllerStore(cwd, { now: () => now,
          faultInjector(point) {
            const target = operation === 'renew' ? 'persistent-renew-after-commit' : 'persistent-stop-after-commit';
            if (!fired && point === target) { fired = true; throw new Error(target); }
          } });
        if (operation === 'renew') {
          const result = store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
            requestId: 'renew', token: acquired.token, generation: 1, fence: 1, durationMs: 100 });
          assert.deepEqual([result.code, result.replayed], ['PERSISTENT_LEASE_RENEWED', false]);
        } else {
          const result = store.decidePersistentStop({ eventKey: 'stop', cwd, transcriptPath: '',
            turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
          assert.deepEqual([result.code, result.allow], ['PERSISTENT_LEASE_ACTIVE', false]);
        }
      }
      store.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('fails closed on current/head/checkpoint corruption but does not rescan old sealed history', () => {
  for (const kind of ['head', 'checkpoint', 'old-history']) {
    const x = fixture();
    try {
      const first = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'first', durationMs: 1 });
      x.setNow(first.expiresAt);
      x.store.decidePersistentStop({ eventKey: 'expire', cwd: x.cwd, transcriptPath: '', turnId: 't',
        userText: '', assistantText: '', sessionId: SESSION });
      x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'second', durationMs: 100 });
      x.store.close();
      const raw = new DatabaseSync(join(x.cwd, '.qe', 'qe.db'));
      if (kind === 'head') raw.exec(`UPDATE process_controller_persistent_lease_current
        SET latest_event_hash='${'0'.repeat(64)}'`);
      if (kind === 'checkpoint') raw.exec(`UPDATE process_controller_persistent_lease_current
        SET predecessor_terminal_digest='${'0'.repeat(64)}'`);
      if (kind === 'old-history') {
        raw.exec('DROP TRIGGER process_controller_persistent_event_no_update');
        raw.exec(`UPDATE process_controller_persistent_lease_event SET event_hash='${'0'.repeat(64)}'
          WHERE generation=1 AND event_seq=0`);
      }
      raw.close();
      const check = createProcessControllerStore(x.cwd, { now: () => first.expiresAt });
      const decision = check.decidePersistentStop({ eventKey: `stop-${kind}`, cwd: x.cwd,
        transcriptPath: '', turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
      assert.equal(decision.code, kind === 'old-history' ? 'PERSISTENT_LEASE_ACTIVE' : 'PERSISTENT_LEASE_CORRUPT');
      check.close();
      // x.close() would close the already-closed handle; cleanup explicitly below.
      rmSync(x.cwd, { recursive: true, force: true });
    } catch (error) {
      try { rmSync(x.cwd, { recursive: true, force: true }); } catch {}
      throw error;
    }
  }
});

test('rejects a fabricated early expiry before generation rollover', () => {
  const x = fixture();
  try {
    const acquired = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'first', durationMs: 100 });
    x.setNow(acquired.expiresAt);
    x.store.decidePersistentStop({ eventKey: 'expire', cwd: x.cwd, transcriptPath: '', turnId: 't',
      userText: '', assistantText: '', sessionId: SESSION }); x.store.close();
    const raw = new DatabaseSync(join(x.cwd, '.qe', 'qe.db'));
    raw.exec('DROP TRIGGER process_controller_persistent_event_no_update');
    raw.exec(`UPDATE process_controller_persistent_lease_event SET recorded_at=0
      WHERE generation=1 AND kind='expired'`); raw.close();
    const check = createProcessControllerStore(x.cwd, { now: () => acquired.expiresAt });
    assert.equal(check.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'second', durationMs: 100 }).code, 'PERSISTENT_LEASE_CORRUPT');
    check.close(); rmSync(x.cwd, { recursive: true, force: true });
  } catch (error) {
    try { rmSync(x.cwd, { recursive: true, force: true }); } catch {}
    throw error;
  }
});

test('rejects missing and malformed full session UUID whenever any lease exists', () => {
  const x = fixture();
  try {
    x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 100 });
    for (const sessionId of ['', 'short', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa!']) {
      assert.equal(x.store.decidePersistentStop({ eventKey: `invalid-${sessionId}`, cwd: x.cwd,
        transcriptPath: '', turnId: 't', userText: '', assistantText: '', sessionId }).code,
      'PERSISTENT_SESSION_INVALID');
    }
  } finally { x.close(); }
});

test('discovers DB authority despite lost or stale unified locator and only terminal authority allows', () => {
  for (const terminal of [false, true]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-locator-'));
    try {
      const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
      const store = createProcessControllerStore(cwd);
      const acquired = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: terminal ? 1 : 60_000 });
      if (terminal) {
        while (Date.now() < acquired.expiresAt) {}
        store.decidePersistentStop({ eventKey: 'terminalize', cwd, transcriptPath: '', turnId: 'old',
          userText: '', assistantText: '', sessionId: SESSION });
      }
      store.close();
      put(cwd, '.qe/state/unified-state.json', JSON.stringify({ persistentMode: {
        active: true, mode: 'stale-locator', reason: 'non-authoritative',
        startedAt: terminal ? new Date().toISOString() : '2000-01-01T00:00:00.000Z', reinforcements: 0 } }));
      const handler = fileURLToPath(new URL('../../stop-handler.mjs', import.meta.url));
      const child = spawnSync(process.execPath, [handler], { input: JSON.stringify({ cwd,
        session_id: SESSION, event_key: `locator-${terminal}`, turn_id: 'turn', transcript_path: '',
        last_user_message: 'continue', last_assistant_message: 'working' }), encoding: 'utf8' });
      const output = JSON.parse(child.stdout.trim());
      assert.equal(output.continue, terminal);
      if (!terminal) assert.match(output.reason, /PERSISTENT_LEASE_ACTIVE/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('returns exact PERSISTENT_CLOCK_ROLLBACK for acquire, renew, Stop, and completion', () => {
  for (const operation of ['acquire', 'renew', 'stop']) {
    const x = fixture();
    try {
      const acquired = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'first', durationMs: 100 });
      if (operation === 'acquire') {
        x.setNow(acquired.expiresAt);
        x.store.decidePersistentStop({ eventKey: 'expire', cwd: x.cwd, transcriptPath: '', turnId: 't',
          userText: '', assistantText: '', sessionId: SESSION });
        x.setNow(acquired.expiresAt - 1);
        assert.equal(x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
          requestId: 'second', durationMs: 100 }).code, 'PERSISTENT_CLOCK_ROLLBACK');
      } else {
        x.setNow(999);
        const result = operation === 'renew'
          ? x.store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
            requestId: 'renew', token: acquired.token, generation: 1, fence: 1, durationMs: 100 })
          : x.store.decidePersistentStop({ eventKey: 'stop', cwd: x.cwd, transcriptPath: '',
            turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
        assert.equal(result.code, 'PERSISTENT_CLOCK_ROLLBACK');
      }
    } finally { x.close(); }
  }
  const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-completion-clock-'));
  try {
    const x = supervised(cwd); x.sivs.close();
    const future = Date.now() + 60_000;
    const lease = createProcessControllerStore(cwd, { now: () => future });
    lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 100 }); lease.close();
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    const result = sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'complete-clock',
      action: 'forward', binding: x.binding.binding, expectedRevision: 3, ...x.paths });
    assert.equal(result.code, 'PERSISTENT_CLOCK_ROLLBACK');
    assert.equal(sivs.read('sivs-1').snapshot.state, 'supervise');
    sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('retries allowed-stop cleanup after failure on exact committed Stop replay', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-cleanup-retry-'));
  try {
    const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
    const store = createProcessControllerStore(cwd);
    const acquired = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 1 }); while (Date.now() < acquired.expiresAt) {}
    store.close();
    const marker = join(cwd, 'cleanup-fail-once'); writeFileSync(marker, '1');
    const handler = fileURLToPath(new URL('../../stop-handler.mjs', import.meta.url));
    const input = { cwd, session_id: SESSION, hook_event_id: 'cleanup-replay', event_key: 'cleanup-stop',
      turn_id: 'turn', transcript_path: '', last_user_message: 'u', last_assistant_message: 'a' };
    const first = spawnSync(process.execPath, [handler], { input: JSON.stringify(input), encoding: 'utf8',
      env: { ...process.env, QE_TEST_PERSISTENT_CLEANUP_FAIL_ONCE: marker } });
    assert.equal(JSON.parse(first.stdout.trim()).continue, true);
    assert.equal(existsSync(marker), false);
    let cleanup = Object.values(readDeliveryLedger(cwd).entries)
      .find(item => item.effect === 'allowed-stop-registry-cleanup');
    assert.deepEqual([cleanup.status, cleanup.attempts], ['failed', 1]);
    const second = spawnSync(process.execPath, [handler], { input: JSON.stringify(input), encoding: 'utf8',
      env: { ...process.env, QE_TEST_PERSISTENT_CLEANUP_FAIL_ONCE: marker } });
    assert.equal(JSON.parse(second.stdout.trim()).continue, true);
    cleanup = Object.values(readDeliveryLedger(cwd).entries)
      .find(item => item.effect === 'allowed-stop-registry-cleanup');
    assert.deepEqual([cleanup.status, cleanup.attempts], ['delivered', 2]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('returns PERSISTENT_STOP_REPLAY_STALE when the committed decision generation changes', () => {
  const x = fixture();
  try {
    const acquired = x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'first', durationMs: 100 });
    const event = { eventKey: 'stable-event', cwd: x.cwd, transcriptPath: '', turnId: 't',
      userText: '', assistantText: '', sessionId: SESSION };
    assert.equal(x.store.decidePersistentStop(event).code, 'PERSISTENT_LEASE_ACTIVE');
    x.setNow(acquired.expiresAt);
    x.store.decidePersistentStop({ ...event, eventKey: 'expire' });
    x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'second', durationMs: 100 });
    assert.equal(x.store.decidePersistentStop(event).code, 'PERSISTENT_STOP_REPLAY_STALE');
  } finally { x.close(); }
});

test('fails closed for existing DB open failure and partial persistent schema', () => {
  for (const kind of ['open', 'partial']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-store-failure-'));
    try {
      const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
      const store = createProcessControllerStore(cwd);
      store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 100 }); store.close();
      const dbPath = join(cwd, '.qe', 'qe.db');
      if (kind === 'open') {
        renameSync(dbPath, `${dbPath}.saved`); mkdirSync(dbPath);
      } else {
        const raw = new DatabaseSync(dbPath); raw.exec('DROP TABLE process_controller_persistent_lease_event'); raw.close();
      }
      const handler = fileURLToPath(new URL('../../stop-handler.mjs', import.meta.url));
      const child = spawnSync(process.execPath, [handler], { input: JSON.stringify({ cwd,
        session_id: SESSION, event_key: `failure-${kind}`, turn_id: 't', transcript_path: '',
        last_user_message: 'u', last_assistant_message: 'a' }), encoding: 'utf8' });
      const output = JSON.parse(child.stdout.trim());
      assert.equal(output.continue, false);
      assert.match(output.reason, kind === 'open' ? /PERSISTENT_STORE_UNAVAILABLE/ : /PERSISTENT_LEASE_CORRUPT/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('fails closed on current process and sealed SIVS binding corruption', () => {
  for (const kind of ['process', 'binding']) {
    const x = fixture();
    try {
      x.store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 100 }); x.store.close();
      const raw = new DatabaseSync(join(x.cwd, '.qe', 'qe.db'));
      if (kind === 'process') raw.exec(`UPDATE process_controller_state SET snapshot_json='{}'
        WHERE process_id='sivs-1'`);
      else {
        raw.exec('DROP TRIGGER process_controller_sivs_task_binding_no_update');
        raw.exec(`UPDATE process_controller_sivs_task_binding SET payload_json='{}'
          WHERE process_id='sivs-1'`);
      }
      raw.close();
      const check = createProcessControllerStore(x.cwd, { now: () => 1_000 });
      assert.equal(check.decidePersistentStop({ eventKey: `corrupt-${kind}`, cwd: x.cwd,
        transcriptPath: '', turnId: 't', userText: '', assistantText: '', sessionId: SESSION }).code,
      'PERSISTENT_LEASE_CORRUPT');
      check.close(); rmSync(x.cwd, { recursive: true, force: true });
    } catch (error) {
      try { rmSync(x.cwd, { recursive: true, force: true }); } catch {}
      throw error;
    }
  }
});

test('proves acquire, renew, Stop-active, and Stop-expiry precommit cut rollback and retry', () => {
  for (const operation of ['acquire', 'renew', 'stop-active', 'stop-expiry']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-persistent-operation-cut-'));
    try {
      const bound = setup(cwd); bound.sivs.close(); bound.pse.close();
      let now = 1_000; let fired = false;
      const point = operation === 'acquire' ? 'persistent-acquire-between-event-and-head'
        : operation === 'renew' ? 'persistent-renew-between-event-and-head'
          : operation === 'stop-expiry' ? 'persistent-stop-expiry-between-event-and-head'
            : 'persistent-stop-before-decision';
      let store = createProcessControllerStore(cwd, { now: () => now });
      let acquired = null;
      if (operation !== 'acquire') {
        acquired = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
          requestId: 'lease', durationMs: 100 }); store.close();
        if (operation === 'stop-expiry') now = acquired.expiresAt;
      } else store.close();
      store = createProcessControllerStore(cwd, { now: () => now,
        faultInjector(name) { if (!fired && name === point) { fired = true; throw new Error(point); } } });
      const request = operation === 'acquire'
        ? () => store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
          requestId: 'lease', durationMs: 100 })
        : operation === 'renew'
          ? () => store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
            requestId: 'renew', token: acquired.token, generation: 1, fence: 1, durationMs: 100 })
          : () => store.decidePersistentStop({ eventKey: operation, cwd, transcriptPath: '',
            turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
      assert.equal(request().code, 'PERSISTENT_STORE_UNAVAILABLE', `${operation}:${point}`);
      store.close(); store = createProcessControllerStore(cwd, { now: () => now });
      const retry = operation === 'acquire'
        ? store.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
          requestId: 'lease', durationMs: 100 })
        : operation === 'renew'
          ? store.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
            requestId: 'renew', token: acquired.token, generation: 1, fence: 1, durationMs: 100 })
          : store.decidePersistentStop({ eventKey: operation, cwd, transcriptPath: '',
            turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
      assert.equal(retry.code, operation === 'acquire' ? 'PERSISTENT_LEASE_ACQUIRED'
        : operation === 'renew' ? 'PERSISTENT_LEASE_RENEWED'
          : operation === 'stop-expiry' ? 'PERSISTENT_LEASE_EXPIRED' : 'PERSISTENT_LEASE_ACTIVE');
      store.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});
