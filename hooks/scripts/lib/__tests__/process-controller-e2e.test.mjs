import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createProcessController } from '../process-controller.mjs';
import { canonicalJson, createProcessControllerStore } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';
import { RUNTIME_CONTROLLER_TESTS, runRuntimeControllerChecks }
  from '../../../../scripts/check-runtime-controller.mjs';
import { setup, put, runRecord, UUID, PLAN, HASH }
  from './lifecycle-sivs-stage-adapter.test.mjs';

const NOW = 1_000;
const LEASE_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const I1 = '11111111-1111-4111-8111-111111111111';
const V1 = '22222222-2222-4222-8222-222222222222';
const I2 = '33333333-3333-4333-8333-333333333333';
const V2 = '44444444-4444-4444-8444-444444444444';
const S = '55555555-5555-4555-8555-555555555555';
const fixedController = cwd => createProcessController({ cwd, layer: 'sivs',
  authority: 'sivs-controller', now: () => NOW });
const evidencePath = name => `.qe/planning/plans/${PLAN}/evidence/G001.${name}.json`;
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

function freshRun(role, sessionId, invocationId, passed, outputHash, executedAt) {
  const value = runRecord(role, sessionId, passed);
  Object.assign(value, { invocationId, executedAt });
  value.runs = value.runs.map(run => ({ ...run, outputHash, executedAt }));
  value.runId = digest(['qe-plan-run-v1', PLAN, 'G001', role, value.attempt,
    invocationId, HASH, sessionId, value.verifier, value.runs, executedAt]);
  return value;
}

function boundFixture(prefix = 'qe-controller-e2e-') {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  const predecessor = setup(cwd);
  predecessor.sivs.close(); predecessor.pse.close();
  return { cwd, paths: predecessor.paths, binding: predecessor.binding };
}

function stage(sivs, x, requestId, action, expectedRevision, extra = {}) {
  return sivs.transitionSivsStage({ processId: 'sivs-1', requestId, action,
    binding: x.binding.binding, expectedRevision, ...x.paths, ...extra });
}

function verificationAssertion(implementation, verification, verdict, findingsDigest) {
  return { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
    acceptanceHash: HASH, implementationRunId: implementation.runId,
    verificationRunId: verification.runId, verdict, reviewer: verification.verifier,
    sessionId: verification.sessionId, findingsDigest };
}

function writeCompletion(cwd, verifier) {
  const acceptance = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1' }],
    scenarios: [{ id: 'S1' }], humanAcceptance: { required: true } };
  const completion = { schema: 1, goalId: 'G001',
    requirements: [{ id: 'R1', outcome: 'pass', evidence: 'closed-loop-e2e' }],
    scenarios: [{ id: 'S1', outcome: 'pass', evidence: 'restart-recovered' }],
    regression: { outcome: 'pass', evidence: 'runtime-controller-checker' },
    independentVerification: { verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'V2' },
    goalAlignment: { objective: 'x', verifier, outcome: 'pass', evidence: 'V2' },
    humanAcceptance: { status: 'passed', evidence: 'operator-approved' }, limitations: [] };
  put(cwd, evidencePath('acceptance'), `${JSON.stringify(acceptance, null, 2)}\n`);
  put(cwd, evidencePath('completion'), `${JSON.stringify(completion, null, 2)}\n`);
  put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
    goals: [{ id: 'G001', objective: 'x', status: 'active', attempts: 1,
      acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH },
      completionEvidence: { status: 'recorded', file: 'evidence/G001.completion.json' } }] }));
}

function publicProjection(value, keys) {
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function failedFixture(prefix = 'qe-controller-fail-') {
  const x = boundFixture(prefix); const sivs = fixedController(x.cwd);
  assert.equal(stage(sivs, x, 'to-implement', 'forward', 0).to, 'implement');
  const implementation = runRecord('implementation', I1);
  put(x.cwd, evidencePath('implementation-run'), JSON.stringify(implementation));
  assert.equal(stage(sivs, x, 'to-verify', 'forward', 1).to, 'verify');
  const verification = runRecord('verification', V1, false);
  put(x.cwd, evidencePath('verification-run'), JSON.stringify(verification));
  const proof = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'V1-fail',
    binding: x.binding.binding,
    assertion: verificationAssertion(implementation, verification, 'FAIL', '1'.repeat(64)) });
  assert.equal(proof.verdict, 'FAIL');
  return { ...x, sivs, implementation, verification, proof };
}

function acquireLease(x, durationMs = 60_000) {
  const store = createProcessControllerStore(x.cwd, { now: () => NOW });
  const lease = store.acquirePersistentLease({ processId: 'sivs-1', sessionId: LEASE_SESSION,
    requestId: 'lease-L', durationMs });
  assert.equal(lease.code, 'PERSISTENT_LEASE_ACQUIRED'); store.close();
  return lease;
}

test('runs FAIL-remediation-restart-fresh PASS-supervision-completion through public SIVS adapters', () => {
  const x = failedFixture('qe-controller-success-');
  try {
    const originalTask = openSqlite(x.cwd).prepare('SELECT content FROM qe_files WHERE path=?')
      .get(x.paths.taskPath).content;
    const originalChecklistDb = openSqlite(x.cwd);
    const originalChecklist = originalChecklistDb.prepare('SELECT content FROM qe_files WHERE path=?')
      .get(x.paths.checklistPath).content;
    closeSqlite(originalChecklistDb);
    const lease = acquireLease(x);
    assert.equal(lease.expiresAt, NOW + 60_000);

    assert.equal(stage(x.sivs, x, 'enter-remediation', 'remediate', 2).to, 'remediate');
    const remediationRequest = { processId: 'sivs-1', requestId: 'remediation-1',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths };
    const remediation = x.sivs.remediateSivsStage(remediationRequest);
    assert.deepEqual([remediation.code, remediation.to, remediation.round, remediation.depth],
      ['SIVS_REMEDIATION_COMMITTED', 'implement', 1, 2]);
    const remediationKeys = ['code', 'to', 'round', 'depth', 'halted', 'audited',
      'auditSeq', 'auditHash', 'roundDigest', 'stagnationDigest'];
    const remProjection = publicProjection(remediation, remediationKeys);
    const auditAfterRemediation = x.sivs.audit('sivs-1').length;
    const replay = x.sivs.remediateSivsStage(remediationRequest);
    assert.deepEqual(publicProjection(replay, remediationKeys), remProjection);
    assert.equal(replay.replayed, true);
    assert.equal(x.sivs.audit('sivs-1').length, auditAfterRemediation);

    put(x.cwd, x.paths.taskPath, `${originalTask}\nexternal drift`);
    assert.equal(x.sivs.remediateSivsStage(remediationRequest).replayed, true);
    assert.equal(x.sivs.audit('sivs-1').length, auditAfterRemediation);
    put(x.cwd, x.paths.taskPath, originalTask);
    assert.equal(x.sivs.remediateSivsStage({ ...remediationRequest, expectedRevision: 4 }).code,
      'REQUEST_ID_CONFLICT');

    x.sivs.close();
    let sivs = fixedController(x.cwd);
    assert.deepEqual(sivs.read('sivs-1').snapshot, { state: 'implement', revision: 4 });
    const leaseRead = createProcessControllerStore(x.cwd, { now: () => NOW });
    assert.equal(leaseRead.decidePersistentStop({ eventKey: 'restart-head', cwd: x.cwd,
      transcriptPath: '', turnId: 't', userText: '', assistantText: '',
      sessionId: LEASE_SESSION }).code, 'PERSISTENT_LEASE_ACTIVE');
    leaseRead.close();

    const implementation2 = freshRun('implementation', I2,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true, '2'.repeat(64),
      '2026-08-08T02:00:00.000Z');
    put(x.cwd, evidencePath('implementation-run'), JSON.stringify(implementation2));
    assert.equal(stage(sivs, x, 'I2-to-verify', 'forward', 4).to, 'verify');
    const verification2 = freshRun('verification', V2,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true, '3'.repeat(64),
      '2026-08-08T03:00:00.000Z');
    put(x.cwd, evidencePath('verification-run'), JSON.stringify(verification2));
    const verified2 = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'V2-pass',
      binding: x.binding.binding,
      assertion: verificationAssertion(implementation2, verification2, 'PASS', '4'.repeat(64)) });
    assert.equal(verified2.verdict, 'PASS');
    assert.equal(stage(sivs, x, 'V2-to-supervise', 'forward', 5).to, 'supervise');
    const supervised = sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'S-pass',
      binding: x.binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN,
        goalId: 'G001', goalAttempt: 1, acceptanceHash: HASH,
        verificationProofDigest: verified2.proofRef.split(':')[1], verdict: 'PASS',
        supervisor: 'critical-lead', sessionId: S, riskDigest: '5'.repeat(64) } });
    assert.equal(supervised.verdict, 'PASS');
    assert.equal(new Set([I1, V1, I2, V2, S]).size, 5);

    writeCompletion(x.cwd, verification2.verifier);
    const completionRequest = { processId: 'sivs-1', requestId: 'complete-1', action: 'forward',
      binding: x.binding.binding, expectedRevision: 6, ...x.paths };
    const completed = sivs.transitionSivsStage(completionRequest);
    assert.deepEqual([completed.code, completed.to, completed.replayed],
      ['SIVS_STAGE_TRANSITION_COMMITTED', 'complete', false]);
    const completionKeys = ['ok', 'allowed', 'code', 'action', 'to', 'audited',
      'auditSeq', 'auditHash', 'evidenceDigest'];
    const completeProjection = publicProjection(completed, completionKeys);
    const auditAfterCompletion = sivs.audit('sivs-1').length;
    put(x.cwd, x.paths.checklistPath, `${originalChecklist}\nexternal drift`);
    const completionReplay = sivs.transitionSivsStage(completionRequest);
    assert.deepEqual(publicProjection(completionReplay, completionKeys), completeProjection);
    assert.equal(completionReplay.replayed, true);
    assert.equal(sivs.audit('sivs-1').length, auditAfterCompletion);
    put(x.cwd, x.paths.checklistPath, originalChecklist);
    assert.equal(stage(sivs, x, 'post-terminal', 'forward', 7).allowed, false);

    const audit = sivs.audit('sivs-1');
    assert.deepEqual(audit.map(row => row.audit_seq), audit.map((_, index) => index));
    for (let index = 1; index < audit.length; index += 1) {
      assert.equal(audit[index].prev_hash, audit[index - 1].event_hash);
    }
    assert.deepEqual(sivs.read('sivs-1').snapshot, { state: 'complete', revision: 7 });
    const metrics = sivs.processMetrics(); const source = metrics.sources[0];
    assert.deepEqual(metrics.counts, { controllerProcesses: 2, sivsProcesses: 1,
      boundTasks: 1, verifiedTasks: 1 });
    assert.deepEqual(source.binding.logicalKey, [UUID, PLAN, 'G001', 1, HASH]);
    assert.equal(source.verification.sequence, 2);
    assert.equal(source.verification.firstDigest, x.proof.proofRef.split(':')[1]);
    assert.equal(source.verification.digest, verified2.proofRef.split(':')[1]);
    assert.equal(source.supervision.digest, supervised.proofRef.split(':')[1]);
    assert.deepEqual(metrics.metrics.at(-1), { name: 'passAt1Rate', status: 'measured',
      unit: 'basis-points', numerator: 0, denominator: 1, valueBasisPoints: 0 });
    sivs.close(); sivs = null;

    const terminal = createProcessControllerStore(x.cwd, { now: () => NOW });
    const db = openSqlite(x.cwd);
    const leaseRows = db.prepare(`SELECT kind FROM process_controller_persistent_lease_event
      WHERE process_id='sivs-1' ORDER BY event_seq`).all().map(row => row.kind);
    const leaseHead = db.prepare(`SELECT status FROM process_controller_persistent_lease_current
      WHERE process_id='sivs-1'`).get();
    closeSqlite(db);
    assert.deepEqual(leaseRows, ['acquire', 'released']);
    assert.equal(leaseHead.status, 'released');
    assert.equal(terminal.decidePersistentStop({ eventKey: 'terminal', cwd: x.cwd,
      transcriptPath: '', turnId: 't', userText: '', assistantText: '',
      sessionId: LEASE_SESSION }).code, 'PERSISTENT_PROCESS_COMPLETE');
    terminal.close();
  } finally {
    try { x.sivs.close(); } catch {}
    rmSync(x.cwd, { recursive: true, force: true });
  }
});

test('partitions binding provenance, path/byte drift, stale CAS, caller route, and direct completion', () => {
  const x = failedFixture('qe-controller-boundary-');
  try {
    acquireLease(x);
    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'caller-route',
      binding: x.binding.binding, expectedRevision: 2, ...x.paths, route: 'verify' }).code,
    'SIVS_REMEDIATION_ROUTE_INVALID');
    assert.equal(stage(x.sivs, x, 'enter', 'remediate', 2).to, 'remediate');
    const before = x.sivs.audit('sivs-1').length;
    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'invalid-binding',
      binding: 'f'.repeat(64), expectedRevision: 3, ...x.paths }).code,
    'SIVS_TASK_BINDING_INVALID');

    const pse = createProcessController({ cwd: x.cwd, layer: 'pse', authority: 'pse-controller',
      now: () => NOW });
    const replayedPseBinding = pse.bindPseTask({ processId: 'pse-1', requestId: 'pse-bind', ...x.paths });
    const second = fixedController(x.cwd);
    assert.equal(second.initialize({ processId: 'sivs-2', requestId: 'sivs-2-init' }).code, 'INITIALIZED');
    const secondBinding = second.bindSivsTask({ processId: 'sivs-2', requestId: 'sivs-2-bind',
      pseProcessId: 'pse-1', pseBinding: replayedPseBinding.binding,
      planSlug: PLAN, goalId: 'G001', ...x.paths });
    assert.equal(secondBinding.code, 'SIVS_TASK_BOUND');
    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'foreign-binding',
      binding: secondBinding.binding, expectedRevision: 3, ...x.paths }).code,
    'SIVS_TASK_BINDING_MISMATCH');
    second.close(); pse.close();

    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'changed-path',
      binding: x.binding.binding, expectedRevision: 3,
      taskPath: `${x.paths.taskPath}.changed`, checklistPath: x.paths.checklistPath }).code,
    'SIVS_TASK_BINDING_MISMATCH');
    const db = openSqlite(x.cwd);
    const checklist = db.prepare('SELECT content FROM qe_files WHERE path=?').get(x.paths.checklistPath).content;
    closeSqlite(db); put(x.cwd, x.paths.checklistPath, `${checklist}\nchanged`);
    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'changed-bytes',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).code,
    'SIVS_TASK_BINDING_MISMATCH');
    put(x.cwd, x.paths.checklistPath, checklist);
    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'commit',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).code,
    'SIVS_REMEDIATION_COMMITTED');
    assert.equal(x.sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'stale-distinct',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths }).code, 'STALE_SNAPSHOT');
    assert.equal(x.sivs.audit('sivs-1').length > before, true);

    const direct = fixedController(x.cwd);
    direct.initialize({ processId: 'direct', requestId: 'init' });
    const attestation = sessionId => ({ status: 'valid', subject: 'sivs', revision: 0,
      proofRef: 'forged', issuedBy: 'sivs-controller', sessionId, digest: 'forged' });
    assert.equal(direct.transition({ processId: 'direct', requestId: 'direct-complete',
      to: 'complete', expectedRevision: 0, attestations: { specification: attestation(V1),
        implementation: attestation(I1), verification: attestation(V1), supervision: attestation(S) },
      humanAcceptance: { required: false, status: 'not-required' } }).code,
    'SIVS_COMPLETION_ADAPTER_REQUIRED');
    direct.close();
  } finally { try { x.sivs.close(); } catch {} rmSync(x.cwd, { recursive: true, force: true }); }
});

test('composes the locked writer-backed stagnation, depth, and round cap proofs', () => {
  const file = new URL('./lifecycle-sivs-bounded-remediation.test.mjs', import.meta.url);
  const pattern = [
    'one stagnation race halts, keeps committed counters, and authorizes Stop',
    'permits depth four and halts the distinct third verification failure before depth six counts',
    'races round three, then gives round cap priority on retry candidate four',
  ].join('|');
  const result = spawnSync(process.execPath,
    ['--test', '--test-name-pattern', pattern, fileURLToPath(file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('checker freezes exact order, spawns one child, and propagates exit, signal, and error', () => {
  assert.equal(Object.isFrozen(RUNTIME_CONTROLLER_TESTS), true);
  assert.deepEqual(RUNTIME_CONTROLLER_TESTS.map(path => path.split('/').at(-1)), [
    'process-controller-e2e.test.mjs',
    'lifecycle-sivs-stage-adapter.test.mjs',
    'lifecycle-sivs-completion-gate.test.mjs',
    'lifecycle-sivs-bounded-remediation.test.mjs',
    'lifecycle-persistent-completion-lease.test.mjs',
    'lifecycle-process-metrics.test.mjs',
  ]);
  const calls = [];
  const result = value => runRuntimeControllerChecks({ spawnSyncImpl(...args) {
    calls.push(args); return value;
  } });
  assert.equal(result({ status: 0, signal: null }), 0);
  assert.equal(result({ status: 1, signal: null }), 1);
  assert.equal(result({ status: null, signal: 'SIGTERM' }), 1);
  assert.equal(result({ status: null, signal: null, error: new Error('spawn') }), 1);
  assert.equal(calls.length, 4);
  for (const [file, args, options] of calls) {
    assert.equal(file, process.execPath);
    assert.deepEqual(args, ['--test', ...RUNTIME_CONTROLLER_TESTS]);
    assert.deepEqual(options, { stdio: 'inherit' });
    assert.equal(args.includes('scripts/check-all.mjs'), false);
  }
});
