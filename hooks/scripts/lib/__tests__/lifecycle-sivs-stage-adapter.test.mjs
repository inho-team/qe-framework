import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { createProcessController } from '../process-controller.mjs';
import { canonicalJson } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

export const UUID = 'c40f1a92';
export const PLAN = 'runtime-controller-lifecycle-40';
export const HASH = '1bceb68ed7b37b7f7341236cef0ca86c6affaa8501243623512e1fc8264aa459';
const IMPL_SESSION = '11111111-1111-4111-8111-111111111111';
const VERIFY_SESSION = '22222222-2222-4222-8222-222222222222';
const SUPERVISE_SESSION = '33333333-3333-4333-8333-333333333333';

export function put(cwd, path, content) {
  const db = openSqlite(cwd); const bytes = Buffer.from(content); const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
    VALUES(?,?,'utf8',?,420,?,?,?)`).run(path, content, bytes.length, now,
      createHash('sha256').update(bytes).digest('hex'), now);
  closeSqlite(db);
}

function fixtureData(cwd) {
  const taskPath = `.qe/tasks/in-progress/TASK_REQUEST_${UUID}.md`;
  const checklistPath = `.qe/checklists/in-progress/VERIFY_CHECKLIST_${UUID}.md`;
  put(cwd, taskPath, `# TASK_REQUEST_${UUID}.md — T\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${UUID}\nplan: ${PLAN}\nphase: "P"\ncreated: "2026-08-07"\nstatus: in-progress\nlinks:\n  - "[[${checklistPath}]]"\n-->\n\n## 체크리스트\n- [ ] task\n`);
  put(cwd, checklistPath, `# VERIFY_CHECKLIST_${UUID}.md — V\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${UUID}\nplan: ${PLAN}\nphase: "P"\ncreated: "2026-08-07"\nstatus: in-progress\nlinks:\n  - "[[${taskPath}]]"\n-->\n\n## 검증 기준\n- [ ] verify\n\n## 프레임워크 무결성 체크\n- [ ] wire\n`);
  put(cwd, `.qe/planning/plans/${PLAN}/goals.json`, JSON.stringify({ schema: 1, slug: PLAN,
    goals: [{ id: 'G001', objective: 'x', status: 'active', attempts: 1,
      acceptance: { status: 'defined', file: 'evidence/G001.acceptance.json', hash: HASH } }] }));
  return { taskPath, checklistPath };
}

export function runRecord(role, sessionId, passed = true) {
  const invocationId = role === 'implementation'
    ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const verifier = role === 'verification' ? 'independent-reviewer' : null;
  const runs = [{ command: 'node --test x', exitCode: passed ? 0 : 1, signal: null, passed,
    outputHash: 'd'.repeat(64), executedAt: '2026-08-07T00:00:00.000Z' }];
  const record = { schema: 1, goalId: 'G001', role, attempt: 1, invocationId, sessionId,
    verifier, contractHash: HASH, runs, passed, executedAt: '2026-08-07T00:00:00.000Z' };
  record.runId = createHash('sha256').update(canonicalJson(['qe-plan-run-v1', PLAN, 'G001', role,
    record.attempt, invocationId, HASH, sessionId, verifier, runs, record.executedAt])).digest('hex');
  return record;
}

export function setup(cwd) {
  const paths = fixtureData(cwd);
  const pse = createProcessController({ cwd, layer: 'pse', authority: 'pse-controller' });
  assert.equal(pse.initialize({ processId: 'pse-1', requestId: 'pse-init' }).code, 'INITIALIZED');
  const bound = pse.bindPseTask({ processId: 'pse-1', requestId: 'pse-bind', ...paths });
  for (const [requestId, expectedRevision] of [['p1', 0], ['p2', 1], ['p3', 2]]) {
    assert.equal(pse.transitionPseStage({ processId: 'pse-1', requestId, action: 'forward',
      binding: bound.binding, expectedRevision, ...paths }).code, 'PSE_STAGE_TRANSITION_COMMITTED');
  }
  const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
  assert.equal(sivs.initialize({ processId: 'sivs-1', requestId: 'sivs-init' }).code, 'INITIALIZED');
  const binding = sivs.bindSivsTask({ processId: 'sivs-1', requestId: 'sivs-bind',
    pseProcessId: 'pse-1', pseBinding: bound.binding, planSlug: PLAN, goalId: 'G001', ...paths });
  assert.equal(binding.code, 'SIVS_TASK_BOUND');
  return { paths, pse, sivs, binding };
}

test('exposes the four SIVS adapter methods on every facade', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
  try {
    const value = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    for (const name of ['bindSivsTask', 'recordSivsVerification',
      'recordSivsSupervision', 'transitionSivsStage']) assert.equal(typeof value[name], 'function');
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('binds current PSE execute head and advances from implementation, verification, and supervision proofs', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
  try {
    const { paths, pse, sivs, binding } = setup(cwd);
    const stage = (requestId, action, expectedRevision) => sivs.transitionSivsStage({
      processId: 'sivs-1', requestId, action, binding: binding.binding, expectedRevision, ...paths });
    assert.equal(stage('s1', 'forward', 0).to, 'implement');
    assert.deepEqual([stage('s-missing', 'forward', 1).code, stage('s-missing', 'forward', 1).audited],
      ['SIVS_IMPLEMENTATION_PROOF_MISSING', true]);
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    assert.equal(stage('s2', 'forward', 1).to, 'verify');
    const verification = runRecord('verification', VERIFY_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    const assertion = { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
      acceptanceHash: HASH, implementationRunId: implementation.runId,
      verificationRunId: verification.runId, verdict: 'PASS', reviewer: verification.verifier,
      sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) };
    const verified = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-v',
      binding: binding.binding, assertion });
    assert.equal(verified.code, 'SIVS_VERIFICATION_RECORDED');
    assert.equal(sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-v',
      binding: binding.binding, assertion }).replayed, true);
    assert.equal(stage('s3', 'forward', 2).to, 'supervise');
    const supervised = sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'proof-s',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: HASH, verificationProofDigest: verified.proofRef.split(':')[1],
        verdict: 'WARN', supervisor: 'critical-lead', sessionId: SUPERVISE_SESSION,
        riskDigest: 'f'.repeat(64) } });
    assert.equal(supervised.code, 'SIVS_SUPERVISION_RECORDED');
    assert.equal(stage('no-complete', 'forward', 3).code, 'SIVS_COMPLETION_EVIDENCE_MISSING');
    assert.equal(sivs.read('sivs-1').snapshot.state, 'supervise');
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects a PASS assertion for the exact failed verification run without appending proof', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
  try {
    const { paths, pse, sivs, binding } = setup(cwd);
    sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 's1', action: 'forward',
      binding: binding.binding, expectedRevision: 0, ...paths });
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    sivs.transitionSivsStage({ processId: 'sivs-1', requestId: 's2', action: 'forward',
      binding: binding.binding, expectedRevision: 1, ...paths });
    const verification = runRecord('verification', VERIFY_SESSION, false);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    const result = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'bad-pass',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: HASH, implementationRunId: implementation.runId,
        verificationRunId: verification.runId, verdict: 'PASS', reviewer: verification.verifier,
        sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    assert.deepEqual([result.code, result.audited], ['SIVS_VERIFICATION_ASSERTION_MISMATCH', true]);
    const db = openSqlite(cwd);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM process_controller_sivs_verification_proof').get().n, 0);
    closeSqlite(db); sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('carries one sealed FAIL proof through two remediate block/resume cycles', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
  try {
    const { paths, pse, sivs, binding } = setup(cwd);
    const stage = (requestId, action, expectedRevision) => sivs.transitionSivsStage({
      processId: 'sivs-1', requestId, action, binding: binding.binding, expectedRevision, ...paths });
    stage('s1', 'forward', 0);
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    stage('s2', 'forward', 1);
    const verification = runRecord('verification', VERIFY_SESSION, false);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    const failed = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-fail',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: HASH, implementationRunId: implementation.runId,
        verificationRunId: verification.runId, verdict: 'FAIL', reviewer: verification.verifier,
        sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    assert.equal(failed.verdict, 'FAIL');
    assert.equal(stage('remediate', 'remediate', 2).to, 'remediate');
    for (const [blockId, resumeId, revision] of [['b1', 'r1', 3], ['b2', 'r2', 5]]) {
      assert.equal(stage(blockId, 'block', revision).to, 'blocked');
      assert.equal(stage(resumeId, 'resume', revision + 1).to, 'remediate');
    }
    const events = sivs.audit('sivs-1').slice(-5).map(row => JSON.parse(row.event_json));
    const proofs = events.map(event => event.request.evidenceProjection.proof);
    assert.ok(proofs.every(proof => proof.kind === 'remediation' && proof.status === 'fail'));
    assert.equal(new Set(proofs.map(proof => proof.proofDigest)).size, 1);
    const db = openSqlite(cwd);
    db.exec('DROP TRIGGER process_controller_audit_no_update');
    db.prepare(`UPDATE process_controller_audit SET event_json='{}'
      WHERE process_id='sivs-1' AND audit_seq=4`).run();
    closeSqlite(db);
    const tampered = stage('b3', 'block', 7);
    assert.deepEqual([tampered.code, tampered.audited], ['CONTROLLER_CORRUPT', true]);
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('fails closed on a gapped proof sequence and rolls back rejection-audit faults', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
  try {
    const { paths, pse, sivs, binding } = setup(cwd);
    const db = openSqlite(cwd);
    db.prepare(`INSERT INTO process_controller_sivs_verification_proof VALUES(?,?,?,?,?,?,?,?)`)
      .run('sivs-1', 2, 'gap', 'a'.repeat(64), createHash('sha256').update(binding.binding).digest('hex'),
        '{}', 'b'.repeat(64), Date.now()); closeSqlite(db);
    const result = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'gap-read',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: HASH, implementationRunId: 'a'.repeat(64),
        verificationRunId: 'b'.repeat(64), verdict: 'PASS', reviewer: 'r',
        sessionId: VERIFY_SESSION, findingsDigest: 'c'.repeat(64) } });
    assert.deepEqual([result.code, result.audited], ['SIVS_VERIFICATION_PROOF_CORRUPT', true]);
    sivs.close();
    const faulted = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
      faultInjector(point) { if (point === 'before-rejection-commit') throw new Error(point); } });
    const before = faulted.read('sivs-1').snapshot;
    const denied = faulted.transitionSivsStage({ processId: 'sivs-1', requestId: 'bad-action',
      action: 'resume', binding: binding.binding, expectedRevision: 0, ...paths });
    assert.deepEqual([denied.code, denied.audited], ['STORE_UNAVAILABLE', false]);
    assert.deepEqual(faulted.read('sivs-1').snapshot, before);
    faulted.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function child(code, env) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code],
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', value => { out += value; });
    p.on('close', status => resolve({ status, value: JSON.parse(out) }));
  });
}

test('serializes same and distinct SIVS subprocess writers', async () => {
  for (const same of [true, false]) {
    const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
    try {
      const { paths, pse, sivs, binding } = setup(cwd); sivs.close(); pse.close();
      const url = new URL('../process-controller.mjs', import.meta.url).href;
      const code = `import{createProcessController}from ${JSON.stringify(url)};const c=createProcessController({cwd:process.env.CWD_X,layer:'sivs',authority:'sivs-controller'});const p=JSON.parse(process.env.PAYLOAD);p.requestId=process.env.REQ;const r=c.transitionSivsStage(p);c.close();process.stdout.write(JSON.stringify({code:r.code,replayed:r.replayed}));`;
      const payload = JSON.stringify({ processId: 'sivs-1', action: 'forward', binding: binding.binding,
        expectedRevision: 0, ...paths });
      const values = await Promise.all([child(code, { CWD_X: cwd, PAYLOAD: payload, REQ: 'race-a' }),
        child(code, { CWD_X: cwd, PAYLOAD: payload, REQ: same ? 'race-a' : 'race-b' })]);
      assert.deepEqual(values.map(item => item.status), [0, 0]);
      const codes = values.map(item => item.value.code).sort();
      assert.deepEqual(codes, same
        ? ['SIVS_STAGE_TRANSITION_COMMITTED', 'SIVS_STAGE_TRANSITION_COMMITTED']
        : ['SIVS_STAGE_TRANSITION_COMMITTED', 'STALE_SNAPSHOT']);
      if (same) assert.deepEqual(values.map(item => item.value.replayed).sort(), [false, true]);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('rejects invalid assertion attempts and makes digest-consistent semantic proof forgery safe to block', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-stage-'));
  try {
    const { paths, pse, sivs, binding } = setup(cwd);
    const bad = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'bad-attempt',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 0, acceptanceHash: HASH, implementationRunId: 'a'.repeat(64),
        verificationRunId: 'b'.repeat(64), verdict: 'PASS', reviewer: 'r', sessionId: VERIFY_SESSION,
        findingsDigest: 'c'.repeat(64) } });
    assert.deepEqual([bad.code, bad.audited], ['SIVS_VERIFICATION_ASSERTION_MISMATCH', true]);
    const stage = (id, action, revision) => sivs.transitionSivsStage({ processId: 'sivs-1', requestId: id,
      action, binding: binding.binding, expectedRevision: revision, ...paths });
    stage('f1', 'forward', 0);
    const impl = runRecord('implementation', IMPL_SESSION); const verify = runRecord('verification', VERIFY_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(impl));
    stage('f2', 'forward', 1);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verify));
    sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'pv', binding: binding.binding,
      assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
        acceptanceHash: HASH, implementationRunId: impl.runId, verificationRunId: verify.runId,
        verdict: 'PASS', reviewer: verify.verifier, sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    const db = openSqlite(cwd); db.exec('DROP TRIGGER process_controller_sivs_verification_no_update');
    const row = db.prepare('SELECT * FROM process_controller_sivs_verification_proof WHERE process_id=?').get('sivs-1');
    const proof = JSON.parse(row.proof_json); proof.reviewer = 'forged-reviewer';
    const proofJson = canonicalJson(proof);
    const digest = createHash('sha256').update(canonicalJson(['qe-sivs-verification-proof-v1', proof])).digest('hex');
    db.prepare('UPDATE process_controller_sivs_verification_proof SET proof_json=?,proof_digest=? WHERE process_id=?')
      .run(proofJson, digest, 'sivs-1'); closeSqlite(db);
    assert.equal(stage('forged-forward', 'forward', 2).code, 'SIVS_VERIFICATION_PROOF_CORRUPT');
    const blocked = stage('safe-block', 'block', 2);
    assert.equal(blocked.to, 'blocked');
    const event = JSON.parse(sivs.audit('sivs-1').at(-1).event_json);
    assert.equal(event.request.evidenceProjection.proof.status, 'corrupt');
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
