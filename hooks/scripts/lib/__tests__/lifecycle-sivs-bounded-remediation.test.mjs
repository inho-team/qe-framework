import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

import { createProcessController } from '../process-controller.mjs';
import { canonicalJson, createProcessControllerStore } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';
import { setup, put, runRecord, UUID, PLAN, HASH } from './lifecycle-sivs-stage-adapter.test.mjs';

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMPL = '11111111-1111-4111-8111-111111111111';
const VERIFY = '22222222-2222-4222-8222-222222222222';
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

function childRemediation(cwd, payload, requestId, nowMs = null) {
  const url = new URL('../process-controller.mjs', import.meta.url).href;
  const code = `import{createProcessController}from ${JSON.stringify(url)};const n=process.env.NOW_MS;const c=createProcessController({cwd:process.env.CWD_X,layer:'sivs',authority:'sivs-controller',...(n?{now:()=>Number(n)}:{})});const p=JSON.parse(process.env.PAYLOAD);p.requestId=process.env.REQUEST_ID;const r=c.remediateSivsStage(p);c.close();process.stdout.write(JSON.stringify(r));`;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: {
      ...process.env, CWD_X: cwd, PAYLOAD: JSON.stringify(payload), REQUEST_ID: requestId,
      ...(nowMs === null ? {} : { NOW_MS: String(nowMs) }),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', status => resolve({ status, value: JSON.parse(out) }));
  });
}

function uniqueRun(role, sessionId, invocationId, passed,
  executedAt = '2026-08-07T01:00:00.000Z', outputHash = 'd'.repeat(64)) {
  const verifier = role === 'verification' ? 'independent-reviewer' : null;
  const runs = [{ command: 'node --test x', exitCode: passed ? 0 : 1, signal: null, passed,
    outputHash, executedAt }];
  const value = { schema: 1, goalId: 'G001', role, attempt: 1, invocationId, sessionId,
    verifier, contractHash: HASH, runs, passed, executedAt };
  value.runId = createHash('sha256').update(canonicalJson(['qe-plan-run-v1', PLAN, 'G001', role,
    1, invocationId, HASH, sessionId, verifier, runs, executedAt])).digest('hex');
  return value;
}

function verificationRunWithEntries(sessionId, invocationId, runs) {
  const executedAt = '2026-08-07T09:00:00.000Z'; const verifier = 'independent-reviewer';
  const value = { schema: 1, goalId: 'G001', role: 'verification', attempt: 1,
    invocationId, sessionId, verifier, contractHash: HASH, runs,
    passed: runs.every(item => item.passed), executedAt };
  value.runId = digest(['qe-plan-run-v1', PLAN, 'G001', 'verification', 1,
    invocationId, HASH, sessionId, verifier, runs, executedAt]);
  return value;
}

function failedVerification(cwd) {
  const x = setup(cwd);
  const stage = (requestId, action, expectedRevision) => x.sivs.transitionSivsStage({
    processId: 'sivs-1', requestId, action, binding: x.binding.binding,
    expectedRevision, ...x.paths,
  });
  stage('forward-implement', 'forward', 0);
  const implementation = runRecord('implementation', IMPL);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
  stage('forward-verify', 'forward', 1);
  const verification = runRecord('verification', VERIFY, false);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
  x.sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'verification-fail',
    binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
      goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
      implementationRunId: implementation.runId, verificationRunId: verification.runId,
      verdict: 'FAIL', reviewer: verification.verifier, sessionId: VERIFY,
      findingsDigest: 'e'.repeat(64) } });
  return x;
}

function stagnationReady(cwd, failureHash = 'd'.repeat(64)) {
  const x = failedVerification(cwd); x.sivs.close();
  let now = 1_000;
  const lease = createProcessControllerStore(cwd, { now: () => now });
  lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
    requestId: 'lease', durationMs: 100 }); lease.close();
  const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller', now: () => now });
  const stage = (id, action, revision) => sivs.transitionSivsStage({ processId: 'sivs-1',
    requestId: id, action, binding: x.binding.binding, expectedRevision: revision, ...x.paths });
  stage('enter-1', 'remediate', 2);
  sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
    binding: x.binding.binding, expectedRevision: 3, ...x.paths });
  const impl = uniqueRun('implementation', '33333333-3333-4333-8333-333333333333',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
  stage('forward', 'forward', 4);
  const verify = uniqueRun('verification', '44444444-4444-4444-8444-444444444444',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false,
    '2026-08-07T01:00:00.000Z', failureHash);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
  sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-2',
    binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
      goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH, implementationRunId: impl.runId,
      verificationRunId: verify.runId, verdict: 'FAIL', reviewer: verify.verifier,
      sessionId: verify.sessionId, findingsDigest: 'a'.repeat(64) } });
  stage('enter-2', 'remediate', 5); sivs.close();
  return { ...x, now: value => { now = value; } };
}

function tamperRemediationCounters(cwd, round, depth, stagnationDigest) {
  const db = openSqlite(cwd);
  db.exec('DROP TRIGGER process_controller_sivs_remediation_event_no_update');
  const row = db.prepare(`SELECT * FROM process_controller_sivs_remediation_event
    WHERE process_id='sivs-1' ORDER BY event_seq DESC LIMIT 1`).get();
  const payload = JSON.parse(row.payload_json); payload.round = round; payload.depth = depth;
  payload.stagnationDigest = stagnationDigest;
  const payloadJson = canonicalJson(payload);
  const hash = digest(['qe-sivs-bounded-remediation-v1', 'sivs-1', row.event_seq,
    row.prev_hash, payload]);
  db.prepare(`UPDATE process_controller_sivs_remediation_event SET payload_json=?,event_hash=?
    WHERE process_id='sivs-1' AND event_seq=?`).run(payloadJson, hash, row.event_seq);
  db.prepare(`UPDATE process_controller_sivs_remediation_current SET round_count=?,depth_count=?,
    last_stagnation_digest=?,latest_event_hash=? WHERE process_id='sivs-1'`)
    .run(round, depth, stagnationDigest, hash); closeSqlite(db);
}

test('derives verification FAIL route and counts only its committed remediation round', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-remediation-'));
  try {
    const x = failedVerification(cwd);
    assert.equal(typeof x.sivs.remediateSivsStage, 'function');
    x.sivs.close();
    const lease = createProcessControllerStore(cwd);
    assert.equal(lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 }).code, 'PERSISTENT_LEASE_ACQUIRED');
    lease.close();
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    assert.equal(sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter-remediation',
      action: 'remediate', binding: x.binding.binding, expectedRevision: 2, ...x.paths }).to,
    'remediate');
    const result = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths });
    assert.deepEqual([result.code, result.to, result.round, result.depth],
      ['SIVS_REMEDIATION_COMMITTED', 'implement', 1, 2]);
    const event = JSON.parse(sivs.audit('sivs-1').at(-1).event_json);
    const source = JSON.parse(sivs.audit('sivs-1').at(-2).event_json);
    const failing = [{ command: 'node --test x', exitCode: 1, signal: null,
      outputHash: 'd'.repeat(64) }];
    assert.deepEqual(event.request.roundProjection.semanticFailure,
      { source: 'verification-run', failing });
    assert.deepEqual(Object.keys(event.request.roundProjection).sort(), [
      'acceptanceHash', 'candidateDepth', 'candidateRound', 'checklistSha256', 'cost',
      'goalAttempt', 'proofDigest', 'proofKind', 'route', 'schema', 'semanticFailure',
      'sourceAuditHash', 'sourceRevision', 'taskBindingSha256', 'taskSha256',
    ].sort());
    const db = openSqlite(cwd);
    const taskRow = db.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(x.paths.taskPath);
    const checklistRow = db.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(x.paths.checklistPath);
    const bindingRow = db.prepare(`SELECT token_sha256 FROM process_controller_sivs_task_binding
      WHERE process_id='sivs-1'`).get(); closeSqlite(db);
    assert.deepEqual(event.request.roundProjection, { schema: 1,
      taskBindingSha256: bindingRow.token_sha256, goalAttempt: 1, acceptanceHash: HASH,
      candidateRound: 1, candidateDepth: 2, route: 'implement', cost: 2,
      proofKind: 'verification', proofDigest: source.request.evidenceProjection.proof.proofDigest,
      semanticFailure: { source: 'verification-run', failing }, taskSha256: taskRow.sha256,
      checklistSha256: checklistRow.sha256, sourceRevision: 3,
      sourceAuditHash: sivs.audit('sivs-1').at(-2).event_hash });
    const semanticFailureDigest = digest(['qe-sivs-verification-failure-v1', failing]);
    assert.equal(event.request.stagnationDigest, digest(['qe-sivs-remediation-stagnation-v1',
      event.request.bindingSha256, HASH, 'implement', 'verification', semanticFailureDigest]));
    assert.equal(event.request.roundDigest,
      digest(['qe-sivs-remediation-round-v1', event.request.roundProjection]));
    assert.equal(sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).replayed, true);
    assert.equal(sivs.read('sivs-1').snapshot.revision, 4);
    sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects caller route overrides and filename counters are compatibility-only', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-route-override-'));
  try {
    const x = failedVerification(cwd);
    const denied = x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'override',
      binding: x.binding.binding, expectedRevision: 2, ...x.paths, route: 'verify' });
    assert.deepEqual([denied.code, denied.audited], ['SIVS_REMEDIATION_ROUTE_INVALID', true]);
    x.sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
  const source = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../../pre-tool-use.mjs', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /recordAndCheck\(cwd, remUuid, 'remediation'\)/);
  assert.match(source, /compatibility-only/);
});

test('one stagnation race halts, keeps committed counters, and authorizes Stop', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stagnation-'));
  try {
    const x = failedVerification(cwd); x.sivs.close();
    let now = 1_000;
    const leaseStore = createProcessControllerStore(cwd, { now: () => now });
    const acquired = leaseStore.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 100 }); leaseStore.close();
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller', now: () => now });
    const stage = (requestId, action, expectedRevision) => sivs.transitionSivsStage({
      processId: 'sivs-1', requestId, action, binding: x.binding.binding,
      expectedRevision, ...x.paths });
    stage('enter-1', 'remediate', 2);
    assert.equal(sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).code,
    'SIVS_REMEDIATION_COMMITTED');
    const priorStopStore = createProcessControllerStore(cwd, { now: () => now });
    assert.equal(priorStopStore.decidePersistentStop({ eventKey: 'before-halt', cwd,
      transcriptPath: '', turnId: 't', userText: '', assistantText: '', sessionId: SESSION }).code,
    'PERSISTENT_LEASE_ACTIVE'); priorStopStore.close();
    const implementation = uniqueRun('implementation',
      '33333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    stage('forward-new-verify', 'forward', 4);
    const verification = uniqueRun('verification',
      '44444444-4444-4444-8444-444444444444', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'verification-fail-2',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
        implementationRunId: implementation.runId, verificationRunId: verification.runId,
        verdict: 'FAIL', reviewer: verification.verifier, sessionId: verification.sessionId,
        findingsDigest: 'a'.repeat(64) } });
    stage('enter-2', 'remediate', 5);
    now = 1_100; sivs.close();
    const payload = { processId: 'sivs-1', binding: x.binding.binding, expectedRevision: 6, ...x.paths };
    const raced = await Promise.all([childRemediation(cwd, payload, 'round-2-a', now),
      childRemediation(cwd, payload, 'round-2-b', now)]);
    assert.deepEqual(raced.map(item => item.status), [0, 0]);
    const halted = raced.map(item => item.value).find(item => item.code === 'SIVS_REMEDIATION_STAGNATED');
    assert.equal(raced.filter(item => item.value.code === 'SIVS_REMEDIATION_STAGNATED').length, 1);
    assert.equal(raced.some(item => item.value.code === 'STALE_SNAPSHOT'), true);
    const after = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller', now: () => now });
    assert.deepEqual([halted.code, halted.round, halted.depth, halted.halted],
      ['SIVS_REMEDIATION_STAGNATED', 1, 2, true]);
    const haltDb = openSqlite(cwd);
    const remediationRows = haltDb.prepare(`SELECT kind FROM process_controller_sivs_remediation_event
      WHERE process_id='sivs-1' ORDER BY event_seq`).all();
    const leaseKinds = haltDb.prepare(`SELECT kind FROM process_controller_persistent_lease_event
      WHERE process_id='sivs-1' ORDER BY event_seq`).all().map(row => row.kind);
    const leaseCurrent = haltDb.prepare(`SELECT status FROM process_controller_persistent_lease_current
      WHERE process_id='sivs-1'`).get(); closeSqlite(haltDb);
    assert.equal(remediationRows.filter(row => row.kind === 'halted').length, 1);
    assert.deepEqual(leaseKinds, ['acquire', 'expired', 'released']);
    assert.equal(leaseCurrent.status, 'released');
    assert.deepEqual([after.read('sivs-1').snapshot.state,
      after.transition({ processId: 'sivs-1', requestId: 'escape', to: 'verify',
        expectedRevision: 7 }).code], ['blocked', 'SIVS_REMEDIATION_HALTED']);
    for (const action of ['forward', 'remediate', 'block', 'resume']) {
      assert.equal(after.transitionSivsStage({ processId: 'sivs-1', requestId: `escape-${action}`,
        action, binding: x.binding.binding, expectedRevision: 7, ...x.paths }).code,
      'SIVS_REMEDIATION_HALTED');
    }
    assert.equal(after.remediateSivsStage({ processId: 'sivs-1', requestId: 'escape-round',
      binding: x.binding.binding, expectedRevision: 7, ...x.paths }).code,
    'SIVS_REMEDIATION_HALTED');
    after.close();
    const stopStore = createProcessControllerStore(cwd, { now: () => now });
    assert.equal(stopStore.decidePersistentStop({ eventKey: 'before-halt', cwd, transcriptPath: '',
      turnId: 't', userText: '', assistantText: '', sessionId: SESSION }).code,
    'PERSISTENT_STOP_REPLAY_STALE');
    assert.equal(stopStore.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'escape-acquire', durationMs: 100 }).code, 'SIVS_REMEDIATION_HALTED');
    assert.equal(stopStore.renewPersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'escape-renew', token: acquired.token, generation: acquired.generation,
      fence: acquired.fence, durationMs: 100 }).code, 'SIVS_REMEDIATION_HALTED');
    const stop = stopStore.decidePersistentStop({ eventKey: 'halt-stop', cwd, transcriptPath: '',
      turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
    assert.deepEqual([stop.code, stop.allow], ['PERSISTENT_REMEDIATION_HALTED', true]);
    stopStore.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('captures one now, denies an ordinary overdue candidate, and denies already expired input without counting', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-overdue-'));
  try {
    const x = failedVerification(cwd); x.sivs.close();
    let now = 1_000; let reads = 0;
    const lease = createProcessControllerStore(cwd, { now: () => now });
    lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 100 }); lease.close();
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
      now() { reads += 1; return now; } });
    sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
      binding: x.binding.binding, expectedRevision: 2, ...x.paths });
    now = 1_100;
    const overdue = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'overdue',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths });
    assert.deepEqual([overdue.code, sivs.read('sivs-1').snapshot.revision, reads],
      ['SIVS_REMEDIATION_LEASE_EXPIRED', 3, 1]);
    sivs.close();
    const stopStore = createProcessControllerStore(cwd, { now: () => now });
    assert.equal(stopStore.decidePersistentStop({ eventKey: 'expire', cwd, transcriptPath: '',
      turnId: 't', userText: '', assistantText: '', sessionId: SESSION }).code,
    'PERSISTENT_LEASE_EXPIRED'); stopStore.close();
    const retry = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller', now: () => now });
    assert.equal(retry.remediateSivsStage({ processId: 'sivs-1', requestId: 'expired',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).code,
    'SIVS_REMEDIATION_LEASE_EXPIRED');
    retry.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rolls back remediation current, event, process, and lease on every precommit cut', () => {
  for (const point of ['sivs-remediation-before-current',
    'sivs-remediation-between-current-and-event',
    'sivs-remediation-between-event-and-process-state',
    'sivs-remediation-between-process-state-and-audit',
    'sivs-remediation-before-commit', 'sivs-remediation-after-commit']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-remediation-fault-'));
    try {
      const x = failedVerification(cwd); x.sivs.close();
      const leaseStore = createProcessControllerStore(cwd);
      leaseStore.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 60_000 }); leaseStore.close();
      const enter = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
      enter.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
        binding: x.binding.binding, expectedRevision: 2, ...x.paths }); enter.close();
      let fired = false;
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
        faultInjector(name) { if (!fired && name === point) { fired = true; throw new Error(point); } } });
      const denied = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: `round-${point}`,
        binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      const postcommit = point === 'sivs-remediation-after-commit';
      assert.equal(denied.code, postcommit ? 'SIVS_REMEDIATION_COMMITTED' : 'STORE_UNAVAILABLE', point);
      assert.deepEqual([sivs.read('sivs-1').snapshot.state, sivs.read('sivs-1').snapshot.revision],
        postcommit ? ['implement', 4] : ['remediate', 3], point);
      sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('derives supervision FAIL from the authorized riskDigest TCB and routes to verify at cost one', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-supervision-remediation-'));
  try {
    const x = setup(cwd);
    const stage = (requestId, action, expectedRevision) => x.sivs.transitionSivsStage({
      processId: 'sivs-1', requestId, action, binding: x.binding.binding,
      expectedRevision, ...x.paths });
    stage('forward-implementation', 'forward', 0);
    const implementation = runRecord('implementation', IMPL);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    stage('forward-verification', 'forward', 1);
    const verification = runRecord('verification', VERIFY, true);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    const verified = x.sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'verification-pass',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
        implementationRunId: implementation.runId, verificationRunId: verification.runId,
        verdict: 'PASS', reviewer: verification.verifier, sessionId: VERIFY,
        findingsDigest: 'e'.repeat(64) } });
    stage('forward-supervision', 'forward', 2);
    const riskDigest = 'f'.repeat(64);
    x.sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'supervision-fail',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
        verificationProofDigest: verified.proofRef.split(':')[1], verdict: 'FAIL',
        supervisor: 'risk-lead', sessionId: '33333333-3333-4333-8333-333333333333',
        riskDigest } });
    const leaseStore = createProcessControllerStore(cwd);
    leaseStore.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 }); leaseStore.close();
    stage('enter-remediation', 'remediate', 3);
    const result = x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
      binding: x.binding.binding, expectedRevision: 4, ...x.paths });
    assert.deepEqual([result.code, result.to, result.round, result.depth],
      ['SIVS_REMEDIATION_COMMITTED', 'verify', 1, 1]);
    const event = JSON.parse(x.sivs.audit('sivs-1').at(-1).event_json);
    assert.deepEqual(event.request.roundProjection.semanticFailure,
      { source: 'trusted-supervisor-riskDigest', riskDigest });
    x.sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('permits depth four and halts the distinct third verification failure before depth six counts', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-depth-cap-'));
  try {
    const x = failedVerification(cwd);
    const lease = createProcessControllerStore(cwd);
    lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 }); lease.close();
    const stage = (id, action, revision) => x.sivs.transitionSivsStage({ processId: 'sivs-1',
      requestId: id, action, binding: x.binding.binding, expectedRevision: revision, ...x.paths });
    stage('enter-1', 'remediate', 2);
    assert.deepEqual([x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).round, 2], [1, 2]);
    const cycles = [
      ['33333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '44444444-4444-4444-8444-444444444444', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '1'],
      ['55555555-5555-4555-8555-555555555555', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        '66666666-6666-4666-8666-666666666666', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '2'],
    ];
    let revision = 4;
    for (let index = 0; index < cycles.length; index += 1) {
      const [implSession, implInvocation, verifySession, verifyInvocation, digit] = cycles[index];
      const impl = uniqueRun('implementation', implSession, implInvocation, true,
        `2026-08-07T0${index + 2}:00:00.000Z`);
      put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
      stage(`forward-${index}`, 'forward', revision); revision += 1;
      const verify = uniqueRun('verification', verifySession, verifyInvocation, false,
        `2026-08-07T0${index + 2}:01:00.000Z`, digit.repeat(64));
      put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
      x.sivs.recordSivsVerification({ processId: 'sivs-1', requestId: `proof-${index}`,
        binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
          goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
          implementationRunId: impl.runId, verificationRunId: verify.runId, verdict: 'FAIL',
          reviewer: verify.verifier, sessionId: verify.sessionId, findingsDigest: digit.repeat(64) } });
      stage(`enter-${index + 2}`, 'remediate', revision); revision += 1;
      const result = x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: `round-${index + 2}`,
        binding: x.binding.binding, expectedRevision: revision, ...x.paths }); revision += 1;
      if (index === 0) assert.deepEqual([result.code, result.round, result.depth],
        ['SIVS_REMEDIATION_COMMITTED', 2, 4]);
      else assert.deepEqual([result.code, result.round, result.depth],
        ['SIVS_REMEDIATION_DEPTH_LIMIT', 2, 4]);
    }
    x.sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('races round three, then gives round cap priority on retry candidate four', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-round-cap-'));
  try {
    const x = setup(cwd);
    let sivs = x.sivs;
    const stage = (id, action, revision) => sivs.transitionSivsStage({ processId: 'sivs-1',
      requestId: id, action, binding: x.binding.binding, expectedRevision: revision, ...x.paths });
    stage('implementation', 'forward', 0);
    const impl = runRecord('implementation', IMPL);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
    stage('verification', 'forward', 1);
    const verify0 = runRecord('verification', VERIFY, true);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify0));
    let verified = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'verify-0',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH, implementationRunId: impl.runId,
        verificationRunId: verify0.runId, verdict: 'PASS', reviewer: verify0.verifier,
        sessionId: verify0.sessionId, findingsDigest: '0'.repeat(64) } });
    stage('supervise-0', 'forward', 2);
    const lease = createProcessControllerStore(cwd);
    lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 }); lease.close();
    const verifySessions = ['44444444-4444-4444-8444-444444444444',
      '66666666-6666-4666-8666-666666666666', '88888888-8888-4888-8888-888888888888'];
    const verifyInvocations = ['dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'ffffffff-ffff-4fff-8fff-ffffffffffff', 'abababab-abab-4aba-8aba-abababababab'];
    const supervisorSessions = ['33333333-3333-4333-8333-333333333333',
      '55555555-5555-4555-8555-555555555555', '77777777-7777-4777-8777-777777777777',
      '99999999-9999-4999-8999-999999999999'];
    let revision = 3;
    for (let round = 1; round <= 4; round += 1) {
      sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: `supervision-fail-${round}`,
        binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
          goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
          verificationProofDigest: verified.proofRef.split(':')[1], verdict: 'FAIL',
          supervisor: 'risk-lead', sessionId: supervisorSessions[round - 1],
          riskDigest: String(round).repeat(64) } });
      stage(`enter-${round}`, 'remediate', revision); revision += 1;
      let result;
      if (round === 3) {
        sivs.close();
        const payload = { processId: 'sivs-1', binding: x.binding.binding,
          expectedRevision: revision, ...x.paths };
        const raced = await Promise.all([childRemediation(cwd, payload, 'round-3-a'),
          childRemediation(cwd, payload, 'round-3-b')]);
        assert.equal(raced.filter(item => item.value.code === 'SIVS_REMEDIATION_COMMITTED').length, 1);
        assert.equal(raced.some(item => item.value.code === 'STALE_SNAPSHOT'), true);
        result = raced.map(item => item.value).find(item => item.code === 'SIVS_REMEDIATION_COMMITTED');
        sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
      } else result = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: `round-${round}`,
        binding: x.binding.binding, expectedRevision: revision, ...x.paths });
      revision += 1;
      if (round <= 3) assert.deepEqual([result.code, result.round, result.depth],
        ['SIVS_REMEDIATION_COMMITTED', round, round]);
      else {
        assert.deepEqual([result.code, result.round, result.depth],
          ['SIVS_REMEDIATION_ROUND_LIMIT', 3, 3]);
        break;
      }
      const verify = uniqueRun('verification', verifySessions[round - 1],
        verifyInvocations[round - 1], true, `2026-08-07T0${round + 2}:00:00.000Z`);
      put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
      verified = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: `verify-${round}`,
        binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
          goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH, implementationRunId: impl.runId,
          verificationRunId: verify.runId, verdict: 'PASS', reviewer: verify.verifier,
          sessionId: verify.sessionId, findingsDigest: String(round).repeat(64) } });
      stage(`supervise-${round}`, 'forward', revision); revision += 1;
    }
    sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects a later proof after the sealed remediation entry and detects orphan/current/process corruption before caps', () => {
  for (const variant of ['later-proof', 'orphan-event', 'current-head']) {
    const cwd = mkdtempSync(join(tmpdir(), `qe-sivs-corrupt-${variant}-`));
    try {
      const x = failedVerification(cwd);
      const lease = createProcessControllerStore(cwd);
      lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 60_000 }); lease.close();
      x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
        binding: x.binding.binding, expectedRevision: 2, ...x.paths });
      const db = openSqlite(cwd);
      if (variant === 'later-proof') {
        const row = db.prepare(`SELECT * FROM process_controller_sivs_verification_proof
          WHERE process_id='sivs-1' AND verification_seq=1`).get();
        db.prepare(`INSERT INTO process_controller_sivs_verification_proof
          VALUES(?,?,?,?,?,?,?,?)`).run(row.process_id, 2, 'later-proof', 'a'.repeat(64),
          row.task_binding_sha256, row.proof_json, row.proof_digest, row.created_at + 1);
      } else if (variant === 'orphan-event') {
        db.prepare(`INSERT INTO process_controller_sivs_remediation_event
          VALUES(?,?,?,?,?,?,?,?,?)`).run('sivs-1', 0, 'orphan', 'a'.repeat(64), 'round', '{}',
          '0'.repeat(64), 'b'.repeat(64), Date.now());
      } else {
        // First create a valid current/event, then make its process checkpoint impossible.
        closeSqlite(db);
        x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'first',
          binding: x.binding.binding, expectedRevision: 3, ...x.paths });
        const tamper = openSqlite(cwd);
        tamper.prepare(`UPDATE process_controller_sivs_remediation_current
          SET process_revision=process_revision+1 WHERE process_id='sivs-1'`).run();
        closeSqlite(tamper);
        assert.equal(x.sivs.transition({ processId: 'sivs-1', requestId: 'corrupt-read',
          to: 'verify', expectedRevision: 4 }).code, 'SIVS_REMEDIATION_STATE_CORRUPT');
        x.sivs.close(); x.pse.close(); continue;
      }
      closeSqlite(db);
      const result = x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: `candidate-${variant}`,
        binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      assert.equal(result.code, variant === 'later-proof'
        ? 'SIVS_REMEDIATION_NOT_AUTHORIZED' : 'SIVS_REMEDIATION_STATE_CORRUPT');
      x.sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('rejects stale revision, Goal drift, and task/checklist drift before any remediation count', () => {
  for (const variant of ['stale', 'goal', 'task', 'checklist']) {
    const cwd = mkdtempSync(join(tmpdir(), `qe-sivs-negative-${variant}-`));
    try {
      const x = failedVerification(cwd);
      const lease = createProcessControllerStore(cwd);
      lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 60_000 }); lease.close();
      x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
        binding: x.binding.binding, expectedRevision: 2, ...x.paths });
      let request = { processId: 'sivs-1', requestId: variant, binding: x.binding.binding,
        expectedRevision: variant === 'stale' ? 2 : 3, ...x.paths };
      if (variant === 'goal') {
        put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
          goals: [{ id: 'G001', objective: 'x', status: 'active', attempts: 2,
            acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH } }] }));
      } else if (variant === 'task') request = { ...request, taskPath: `${x.paths.taskPath}.wrong` };
      else if (variant === 'checklist') put(cwd, x.paths.checklistPath,
        '# changed checklist\n- [ ] no longer immutable\n');
      const result = x.sivs.remediateSivsStage(request);
      assert.equal(result.code, variant === 'stale' ? 'STALE_SNAPSHOT' : 'SIVS_TASK_BINDING_MISMATCH');
      assert.equal(x.sivs.read('sivs-1').snapshot.revision, 3);
      x.sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('serializes same-revision remediation writers so replay does not recount and a distinct loser is stale', async () => {
  for (const same of [true, false]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-remediation-race-'));
    try {
      const x = failedVerification(cwd);
      const lease = createProcessControllerStore(cwd);
      lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 60_000 }); lease.close();
      x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
        binding: x.binding.binding, expectedRevision: 2, ...x.paths });
      x.sivs.close(); x.pse.close();
      const payload = { processId: 'sivs-1', binding: x.binding.binding, expectedRevision: 3, ...x.paths };
      const raced = await Promise.all([childRemediation(cwd, payload, 'race-a'),
        childRemediation(cwd, payload, same ? 'race-a' : 'race-b')]);
      assert.deepEqual(raced.map(item => item.status), [0, 0]);
      if (same) {
        assert.equal(raced.every(item => item.value.code === 'SIVS_REMEDIATION_COMMITTED'), true);
        assert.deepEqual(raced.map(item => item.value.replayed).sort(), [false, true]);
      } else {
        assert.equal(raced.filter(item => item.value.code === 'SIVS_REMEDIATION_COMMITTED').length, 1);
        assert.equal(raced.some(item => item.value.code === 'STALE_SNAPSHOT'), true);
      }
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('rolls back the overdue expiry/release and lease-head halt cuts atomically', () => {
  for (const point of ['sivs-remediation-between-lease-expire-and-release',
    'sivs-remediation-between-lease-event-and-head']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-halt-lease-fault-'));
    try {
      const x = stagnationReady(cwd); x.now(1_100); let fired = false;
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
        now: () => 1_100, faultInjector(name) {
          if (!fired && name === point) { fired = true; throw new Error(point); }
        } });
      const result = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: `halt-${point}`,
        binding: x.binding.binding, expectedRevision: 6, ...x.paths });
      assert.equal(result.code, 'STORE_UNAVAILABLE', point);
      assert.deepEqual([sivs.read('sivs-1').snapshot.state, sivs.read('sivs-1').snapshot.revision],
        ['remediate', 6], point); sivs.close();
      const stop = createProcessControllerStore(cwd, { now: () => 1_100 });
      assert.equal(stop.decidePersistentStop({ eventKey: `stop-${point}`, cwd, transcriptPath: '',
        turnId: 't', userText: '', assistantText: '', sessionId: SESSION }).code,
      'PERSISTENT_LEASE_EXPIRED'); stop.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('re-derives ordered failing verification entries and excludes passing entries', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-ordered-failures-'));
  try {
    const x = setup(cwd);
    x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'impl', action: 'forward',
      binding: x.binding.binding, expectedRevision: 0, ...x.paths });
    const impl = runRecord('implementation', IMPL);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
    x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'verify', action: 'forward',
      binding: x.binding.binding, expectedRevision: 1, ...x.paths });
    const entries = [
      { command: 'pass-first', exitCode: 0, signal: null, passed: true,
        outputHash: '1'.repeat(64), executedAt: '2026-08-07T09:00:01.000Z' },
      { command: 'fail-second', exitCode: 2, signal: null, passed: false,
        outputHash: '2'.repeat(64), executedAt: '2026-08-07T09:00:02.000Z' },
      { command: 'fail-third', exitCode: null, signal: 'SIGTERM', passed: false,
        outputHash: '3'.repeat(64), executedAt: '2026-08-07T09:00:03.000Z' },
    ];
    const verify = verificationRunWithEntries(VERIFY,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', entries);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
    x.sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH, implementationRunId: impl.runId,
        verificationRunId: verify.runId, verdict: 'FAIL', reviewer: verify.verifier,
        sessionId: verify.sessionId, findingsDigest: 'a'.repeat(64) } });
    const lease = createProcessControllerStore(cwd);
    lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
      requestId: 'lease', durationMs: 60_000 }); lease.close();
    x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
      binding: x.binding.binding, expectedRevision: 2, ...x.paths });
    x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths });
    const semantic = JSON.parse(x.sivs.audit('sivs-1').at(-1).event_json)
      .request.roundProjection.semanticFailure;
    assert.deepEqual(semantic.failing, [
      { command: 'fail-second', exitCode: 2, signal: null, outputHash: '2'.repeat(64) },
      { command: 'fail-third', exitCode: null, signal: 'SIGTERM', outputHash: '3'.repeat(64) },
    ]);
    x.sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('Stop fails closed when the sealed halt event or its process audit is tampered', () => {
  for (const variant of ['halt-event', 'process-audit']) {
    const cwd = mkdtempSync(join(tmpdir(), `qe-sivs-stop-tamper-${variant}-`));
    try {
      const x = stagnationReady(cwd); x.now(1_100);
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
        now: () => 1_100 });
      assert.equal(sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'halt',
        binding: x.binding.binding, expectedRevision: 6, ...x.paths }).code,
      'SIVS_REMEDIATION_STAGNATED'); sivs.close();
      const db = openSqlite(cwd);
      if (variant === 'halt-event') {
        db.exec('DROP TRIGGER process_controller_sivs_remediation_event_no_update');
        db.prepare(`UPDATE process_controller_sivs_remediation_event SET payload_json='{}'
          WHERE process_id='sivs-1' AND kind='halted'`).run();
      } else {
        db.exec('DROP TRIGGER process_controller_audit_no_update');
        db.prepare(`UPDATE process_controller_audit SET event_json='{}'
          WHERE process_id='sivs-1' AND audit_seq=(SELECT MAX(audit_seq)
          FROM process_controller_audit WHERE process_id='sivs-1')`).run();
      }
      closeSqlite(db);
      const stop = createProcessControllerStore(cwd, { now: () => 1_100 });
      const result = stop.decidePersistentStop({ eventKey: `stop-${variant}`, cwd,
        transcriptPath: '', turnId: 't', userText: '', assistantText: '', sessionId: SESSION });
      assert.equal(result.ok, false);
      assert.equal(result.code, variant === 'halt-event'
        ? 'SIVS_REMEDIATION_STATE_CORRUPT' : 'PERSISTENT_LEASE_CORRUPT');
      stop.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('gives stagnation priority over simultaneous round/depth and round priority over distinct depth', () => {
  for (const same of [true, false]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-priority-'));
    try {
      const x = stagnationReady(cwd, same ? 'd'.repeat(64) : '9'.repeat(64));
      const db = openSqlite(cwd);
      const priorDigest = db.prepare(`SELECT last_stagnation_digest AS d
        FROM process_controller_sivs_remediation_current WHERE process_id='sivs-1'`).get().d;
      closeSqlite(db);
      tamperRemediationCounters(cwd, 3, 5, same ? priorDigest : 'f'.repeat(64));
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
        now: () => 1_000 });
      const result = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: `priority-${same}`,
        binding: x.binding.binding, expectedRevision: 6, ...x.paths });
      assert.deepEqual([result.code, result.round, result.depth], same
        ? ['SIVS_REMEDIATION_STAGNATED', 3, 5]
        : ['SIVS_REMEDIATION_ROUND_LIMIT', 3, 5]);
      sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('commits exact depth five then halts the next cost-one candidate at depth six', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-depth-five-'));
  try {
    const x = stagnationReady(cwd, '9'.repeat(64));
    tamperRemediationCounters(cwd, 1, 3, 'f'.repeat(64));
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
      now: () => 1_000 });
    const depthFive = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'depth-five',
      binding: x.binding.binding, expectedRevision: 6, ...x.paths });
    assert.deepEqual([depthFive.code, depthFive.round, depthFive.depth],
      ['SIVS_REMEDIATION_COMMITTED', 2, 5]);
    const impl = uniqueRun('implementation', '55555555-5555-4555-8555-555555555555',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
    sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'to-verify', action: 'forward',
      binding: x.binding.binding, expectedRevision: 7, ...x.paths });
    const verify = uniqueRun('verification', '66666666-6666-4666-8666-666666666666',
      'ffffffff-ffff-4fff-8fff-ffffffffffff', true);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
    const verified = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'pass',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH, implementationRunId: impl.runId,
        verificationRunId: verify.runId, verdict: 'PASS', reviewer: verify.verifier,
        sessionId: verify.sessionId, findingsDigest: 'a'.repeat(64) } });
    sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'to-supervise', action: 'forward',
      binding: x.binding.binding, expectedRevision: 8, ...x.paths });
    sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'supervision-fail',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
        verificationProofDigest: verified.proofRef.split(':')[1], verdict: 'FAIL',
        supervisor: 'risk-lead', sessionId: '77777777-7777-4777-8777-777777777777',
        riskDigest: '7'.repeat(64) } });
    sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
      binding: x.binding.binding, expectedRevision: 9, ...x.paths });
    const halted = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'depth-six',
      binding: x.binding.binding, expectedRevision: 10, ...x.paths });
    assert.deepEqual([halted.code, halted.round, halted.depth],
      ['SIVS_REMEDIATION_DEPTH_LIMIT', 2, 5]);
    sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('fails closed on current-with-missing, gapped remediation events, and process audit-head mismatch', () => {
  for (const variant of ['current-missing', 'gapped-event', 'process-audit-head']) {
    const cwd = mkdtempSync(join(tmpdir(), `qe-sivs-structural-${variant}-`));
    try {
      const x = failedVerification(cwd);
      const lease = createProcessControllerStore(cwd);
      lease.acquirePersistentLease({ processId: 'sivs-1', sessionId: SESSION,
        requestId: 'lease', durationMs: 60_000 }); lease.close();
      x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 'enter', action: 'remediate',
        binding: x.binding.binding, expectedRevision: 2, ...x.paths });
      x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round',
        binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      const db = openSqlite(cwd);
      if (variant === 'current-missing') {
        db.exec('DROP TRIGGER process_controller_sivs_remediation_event_no_delete');
        db.prepare(`DELETE FROM process_controller_sivs_remediation_event
          WHERE process_id='sivs-1'`).run();
      } else if (variant === 'gapped-event') {
        db.prepare(`INSERT INTO process_controller_sivs_remediation_event
          VALUES(?,?,?,?,?,?,?,?,?)`).run('sivs-1', 2, 'gap', 'a'.repeat(64), 'round', '{}',
          'b'.repeat(64), 'c'.repeat(64), Date.now());
        db.prepare(`UPDATE process_controller_sivs_remediation_current
          SET latest_event_seq=2,latest_event_hash=? WHERE process_id='sivs-1'`).run('c'.repeat(64));
      } else {
        db.prepare(`UPDATE process_controller_state SET last_audit_hash=?
          WHERE process_id='sivs-1'`).run('f'.repeat(64));
      }
      closeSqlite(db);
      const result = x.sivs.transition({ processId: 'sivs-1', requestId: `probe-${variant}`,
        to: 'verify', expectedRevision: 4 });
      assert.equal(result.code, variant === 'process-audit-head'
        ? 'CONTROLLER_CORRUPT' : 'SIVS_REMEDIATION_STATE_CORRUPT');
      x.sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('remediation current process-audit mismatch wins before a cap-crossing candidate without recount', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-current-audit-mismatch-'));
  try {
    const x = stagnationReady(cwd, '9'.repeat(64));
    tamperRemediationCounters(cwd, 3, 5, 'f'.repeat(64));
    const db = openSqlite(cwd);
    db.prepare(`UPDATE process_controller_sivs_remediation_current SET process_audit_hash=?
      WHERE process_id='sivs-1'`).run('e'.repeat(64)); closeSqlite(db);
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
      now: () => 1_000 });
    const result = sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'cap-crossing',
      binding: x.binding.binding, expectedRevision: 6, ...x.paths });
    assert.deepEqual([result.code, result.audited], ['SIVS_REMEDIATION_STATE_CORRUPT', true]);
    assert.deepEqual([sivs.read('sivs-1').snapshot.state, sivs.read('sivs-1').snapshot.revision],
      ['remediate', 6]); sivs.close();
    const check = openSqlite(cwd);
    const current = check.prepare(`SELECT round_count,depth_count,process_audit_hash
      FROM process_controller_sivs_remediation_current WHERE process_id='sivs-1'`).get();
    const events = check.prepare(`SELECT COUNT(*) AS n FROM process_controller_sivs_remediation_event
      WHERE process_id='sivs-1'`).get().n; closeSqlite(check);
    assert.deepEqual([current.round_count, current.depth_count, current.process_audit_hash],
      [3, 5, 'e'.repeat(64)]);
    assert.equal(events, 1); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
