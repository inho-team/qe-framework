import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createProcessController } from '../process-controller.mjs';
import { setup, put, runRecord, UUID, PLAN, HASH } from './lifecycle-sivs-stage-adapter.test.mjs';
import { evaluateTransition } from '../process-kernel.mjs';

const I = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

function supervise(cwd) {
  const value = setup(cwd); const { sivs, binding, paths } = value;
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
  const supervised = sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'ps', binding: binding.binding,
    assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
      acceptanceHash: HASH, verificationProofDigest: verified.proofRef.split(':')[1], verdict: 'PASS',
      supervisor: 'lead', sessionId: S, riskDigest: 'f'.repeat(64) } });
  return { ...value, impl, verify, verified, supervised };
}

function publish(cwd, x) {
  const acceptance = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1' }],
    scenarios: [{ id: 'S1' }], humanAcceptance: { required: true } };
  const completion = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1', outcome: 'pass', evidence: 'ok' }],
    scenarios: [{ id: 'S1', outcome: 'pass', evidence: 'ok' }], regression: { outcome: 'pass', evidence: 'ok' },
    independentVerification: { verifier: x.verify.verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'ok' },
    goalAlignment: { objective: 'x', verifier: x.verify.verifier, outcome: 'pass', evidence: 'ok' },
    humanAcceptance: { status: 'passed', evidence: 'approved' }, limitations: [] };
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.acceptance.json`, `${JSON.stringify(acceptance, null, 2)}\n`);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.completion.json`, `${JSON.stringify(completion, null, 2)}\n`);
  put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
    goals: [{ id: 'G001', objective: 'x', status: 'active', attempts: 1,
      acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH },
      completionEvidence: { status: 'recorded', file: 'evidence/G001.completion.json' } }] }));
}

test('completes from exact producer-compatible evidence and replays exact audit-bound projection', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-complete-'));
  try {
    const x = supervise(cwd);
    const acceptance = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1' }],
      scenarios: [{ id: 'S1' }], humanAcceptance: { required: true } };
    const completion = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1', outcome: 'pass', evidence: 'ok' }],
      scenarios: [{ id: 'S1', outcome: 'pass', evidence: 'ok' }], regression: { outcome: 'pass', evidence: 'ok' },
      independentVerification: { verifier: x.verify.verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'ok' },
      goalAlignment: { objective: 'x', verifier: x.verify.verifier, outcome: 'pass', evidence: 'ok' },
      humanAcceptance: { status: 'passed', evidence: 'approved' }, limitations: [] };
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.acceptance.json`, `${JSON.stringify(acceptance, null, 2)}\n`);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.completion.json`, `${JSON.stringify(completion, null, 2)}\n`);
    put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
      goals: [{ id: 'G001', objective: 'x', status: 'active', attempts: 1,
        acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH },
        completionEvidence: { status: 'recorded', file: 'evidence/G001.completion.json' } }] }));
    const request = { processId: 'sivs-1', requestId: 'complete', action: 'forward',
      binding: x.binding.binding, expectedRevision: 3, ...x.paths };
    const result = x.sivs.transitionSivsStage(request);
    assert.deepEqual([result.code, result.to, result.replayed], ['SIVS_STAGE_TRANSITION_COMMITTED', 'complete', false]);
    assert.equal(x.sivs.transitionSivsStage(request).replayed, true);
    const event = JSON.parse(x.sivs.audit('sivs-1').at(-1).event_json);
    assert.match(event.request.completionEvidenceDigest, /^[0-9a-f]{64}$/);
    assert.equal(event.request.completionEvidenceProjection.verificationRunId, x.verify.runId);
    x.sivs.close(); x.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('partitions missing, corrupt, and stale completion sources without state mutation', () => {
  for (const kind of ['missing', 'corrupt', 'stale']) {
    const cwd = mkdtempSync(join(tmpdir(), `qe-sivs-complete-${kind}-`));
    try {
      const x = supervise(cwd); const before = x.sivs.read('sivs-1').snapshot;
      if (kind !== 'missing') put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.completion.json`, kind === 'corrupt'
        ? '{bad' : `${JSON.stringify({ schema: 1, goalId: 'G001' }, null, 2)}\n`);
      if (kind === 'stale') put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
        goals: [{ id: 'G001', objective: 'x', status: 'complete', attempts: 1,
          acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH },
          completionEvidence: { status: 'recorded', file: 'evidence/G001.completion.json' } }] }));
      const result = x.sivs.transitionSivsStage({ processId: 'sivs-1', requestId: `complete-${kind}`,
        action: 'forward', binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      assert.equal(result.code, kind === 'missing' ? 'SIVS_COMPLETION_EVIDENCE_MISSING'
        : kind === 'stale' ? 'SIVS_COMPLETION_EVIDENCE_STALE' : 'SIVS_COMPLETION_EVIDENCE_CORRUPT');
      assert.deepEqual(x.sivs.read('sivs-1').snapshot, before);
      x.sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('preserves the kernel revision-exhaustion boundary used by completion', () => {
  const attestation = sessionId => ({ status: 'valid', subject: 'sivs',
    revision: Number.MAX_SAFE_INTEGER, proofRef: 'proof', issuedBy: 'sivs-controller',
    sessionId, digest: 'd' });
  const result = evaluateTransition({ layer: 'sivs', snapshot: { state: 'supervise', revision: Number.MAX_SAFE_INTEGER },
    to: 'complete', expectedRevision: Number.MAX_SAFE_INTEGER, authority: 'sivs-controller',
    attestations: { specification: attestation(V), implementation: attestation(I),
      verification: attestation(V), supervision: attestation(S) },
    humanAcceptance: { required: false, status: 'not-required' } });
  assert.equal(result.code, 'REVISION_EXHAUSTED');
});

test('rolls back completion-specific cuts and recovers after commit', () => {
  for (const point of ['before-state', 'between-state-and-audit', 'before-commit', 'after-commit']) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-complete-fault-'));
    try {
      const x = supervise(cwd); publish(cwd, x); x.sivs.close(); let fired = false;
      const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
        faultInjector(name) { if (!fired && name === point) { fired = true; throw new Error(point); } } });
      const result = sivs.transitionSivsStage({ processId: 'sivs-1', requestId: `complete-${point}`,
        action: 'forward', binding: x.binding.binding, expectedRevision: 3, ...x.paths });
      const committed = point === 'after-commit';
      assert.equal(result.code, committed ? 'SIVS_STAGE_TRANSITION_COMMITTED' : 'STORE_UNAVAILABLE', point);
      assert.equal(sivs.read('sivs-1').snapshot.state, committed ? 'complete' : 'supervise', point);
      sivs.close(); x.pse.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

function runChild(code, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code],
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', status => resolve({ status, result: JSON.parse(out) }));
  });
}

test('serializes same and distinct completion subprocess writers', async () => {
  for (const same of [true, false]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-complete-race-'));
    try {
      const x = supervise(cwd); publish(cwd, x); x.sivs.close(); x.pse.close();
      const url = new URL('../process-controller.mjs', import.meta.url).href;
      const code = `import{createProcessController}from ${JSON.stringify(url)};const c=createProcessController({cwd:process.env.CWD_X,layer:'sivs',authority:'sivs-controller'});const p=JSON.parse(process.env.P);p.requestId=process.env.R;const v=c.transitionSivsStage(p);c.close();process.stdout.write(JSON.stringify({code:v.code,replayed:v.replayed}));`;
      const payload = JSON.stringify({ processId: 'sivs-1', action: 'forward', binding: x.binding.binding,
        expectedRevision: 3, ...x.paths });
      const values = await Promise.all([runChild(code, { CWD_X: cwd, P: payload, R: 'complete-a' }),
        runChild(code, { CWD_X: cwd, P: payload, R: same ? 'complete-a' : 'complete-b' })]);
      assert.deepEqual(values.map(v => v.status), [0, 0]);
      assert.deepEqual(values.map(v => v.result.code).sort(), same
        ? ['SIVS_STAGE_TRANSITION_COMMITTED', 'SIVS_STAGE_TRANSITION_COMMITTED']
        : ['SIVS_STAGE_TRANSITION_COMMITTED', 'STALE_SNAPSHOT']);
      if (same) assert.deepEqual(values.map(v => v.result.replayed).sort(), [false, true]);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('denies generic direct SIVS completion through the audited process path', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-direct-complete-'));
  try {
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    sivs.initialize({ processId: 'direct-1', requestId: 'init' });
    const attestation = sessionId => ({ status: 'valid', subject: 'sivs', revision: 0,
      proofRef: 'forged', issuedBy: 'sivs-controller', sessionId, digest: 'forged' });
    const result = sivs.transition({ processId: 'direct-1', requestId: 'direct-complete',
      to: 'complete', expectedRevision: 0, attestations: { specification: attestation(V),
        implementation: attestation(I), verification: attestation(V), supervision: attestation(S) },
      humanAcceptance: { required: false, status: 'not-required' } });
    assert.deepEqual([result.code, result.audited], ['SIVS_COMPLETION_ADAPTER_REQUIRED', true]);
    assert.deepEqual(sivs.read('direct-1').snapshot, { state: 'spec', revision: 0 });
    assert.equal(sivs.audit('direct-1').length, 2);
    sivs.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
