import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProcessController } from '../process-controller.mjs';
import { canonicalJson, createProcessControllerStore } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const UUID = 'c40f1a92';
const PLAN = 'runtime-controller-lifecycle-69';
const ACCEPTANCE = 'a'.repeat(64);
const IMPL_SESSION = '11111111-1111-4111-8111-111111111111';
const VERIFY_SESSION = '22222222-2222-4222-8222-222222222222';

function put(cwd, filePath, content) {
  const db = openSqlite(cwd); const bytes = Buffer.from(content); const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
    VALUES(?,?,'utf8',?,420,?,?,?)`).run(filePath, content, bytes.length, now,
      createHash('sha256').update(bytes).digest('hex'), now);
  closeSqlite(db);
}

function runRecord(role, sessionId, passed = true, context = {}) {
  const plan = context.plan || PLAN;
  const goalId = context.goalId || 'G001';
  const acceptance = context.acceptance || ACCEPTANCE;
  const invocationId = role === 'implementation'
    ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const verifier = role === 'verification' ? 'independent-reviewer' : null;
  const runs = [{ command: 'node --test x', exitCode: passed ? 0 : 1, signal: null, passed,
    outputHash: 'd'.repeat(64), executedAt: '2026-08-08T00:00:00.000Z' }];
  const record = { schema: 1, goalId, role, attempt: 1, invocationId, sessionId,
    verifier, contractHash: acceptance, runs, passed, executedAt: '2026-08-08T00:00:00.000Z' };
  record.runId = createHash('sha256').update(canonicalJson(['qe-plan-run-v1', plan, goalId, role,
    1, invocationId, acceptance, sessionId, verifier, runs, record.executedAt])).digest('hex');
  return record;
}

function setupBound(cwd, sivsId = 'sivs-1', pseId = 'pse-1', context = {}) {
  const uuid = context.uuid || UUID;
  const plan = context.plan || PLAN;
  const goalId = context.goalId || 'G001';
  const acceptance = context.acceptance || ACCEPTANCE;
  const taskPath = `.qe/tasks/in-progress/TASK_REQUEST_${uuid}.md`;
  const checklistPath = `.qe/checklists/in-progress/VERIFY_CHECKLIST_${uuid}.md`;
  put(cwd, taskPath, `# TASK_REQUEST_${uuid}.md — T\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${uuid}\nplan: ${plan}\nphase: "P"\ncreated: "2026-08-08"\nstatus: in-progress\nlinks:\n  - "[[${checklistPath}]]"\n-->\n\n## 체크리스트\n- [ ] task\n`);
  put(cwd, checklistPath, `# VERIFY_CHECKLIST_${uuid}.md — V\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${uuid}\nplan: ${plan}\nphase: "P"\ncreated: "2026-08-08"\nstatus: in-progress\nlinks:\n  - "[[${taskPath}]]"\n-->\n\n## 검증 기준\n- [ ] verify\n\n## 프레임워크 무결성 체크\n- [ ] wire\n`);
  put(cwd, `.qe/planning/plans/${plan}/goals.json`, JSON.stringify({ schema: 1, slug: plan,
    goals: [{ id: goalId, objective: 'x', status: 'active', attempts: 1,
      acceptance: { status: 'defined', file: `evidence/${goalId}.acceptance.json`, hash: acceptance } }] }));
  const pse = createProcessController({ cwd, layer: 'pse', authority: 'pse-controller' });
  assert.equal(pse.initialize({ processId: pseId, requestId: 'pse-init' }).code, 'INITIALIZED');
  const pseBinding = pse.bindPseTask({ processId: pseId, requestId: 'pse-bind', taskPath, checklistPath });
  for (const [requestId, expectedRevision] of [['p1', 0], ['p2', 1], ['p3', 2]]) {
    assert.equal(pse.transitionPseStage({ processId: pseId, requestId, action: 'forward',
      binding: pseBinding.binding, expectedRevision, taskPath, checklistPath }).code,
    'PSE_STAGE_TRANSITION_COMMITTED');
  }
  const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
  assert.equal(sivs.initialize({ processId: sivsId, requestId: 'sivs-init' }).code, 'INITIALIZED');
  const binding = sivs.bindSivsTask({ processId: sivsId, requestId: 'sivs-bind', pseProcessId: pseId,
    pseBinding: pseBinding.binding, planSlug: plan, goalId, taskPath, checklistPath });
  assert.equal(binding.code, 'SIVS_TASK_BOUND');
  return { pse, sivs, binding, taskPath, checklistPath, uuid, plan, goalId, acceptance };
}

test('exposes a frozen, deterministic six-metric closed-world report', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  const controller = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });

  assert.equal(typeof controller.processMetrics, 'function');
  const first = controller.processMetrics();
  const second = controller.processMetrics();

  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Object.keys(first), ['schema', 'domain', 'scope', 'counts', 'sources', 'metrics', 'digest']);
  assert.equal(first.schema, 1);
  assert.equal(first.domain, 'qe-process-metrics-report-v1');
  assert.equal(first.scope, 'controller-sivs-lifecycle-v1');
  assert.deepEqual(first.counts, {
    controllerProcesses: 0,
    sivsProcesses: 0,
    boundTasks: 0,
    verifiedTasks: 0,
  });
  assert.deepEqual(first.sources, []);
  assert.deepEqual(first.metrics.map(({ name }) => name), [
    'taskResolutionRate',
    'codeChurnRate',
    'verificationTax',
    'harnessConstraintEffect',
    'defectEscapeRate',
    'passAt1Rate',
  ]);
  assert.deepEqual(first.metrics.at(-1), {
    name: 'passAt1Rate',
    status: 'unknown',
    reason: 'VERIFICATION_PROOF_POPULATION_EMPTY',
  });
  controller.close();
});

test('counts the validated closed-world union and makes unbound SIVS history explicitly unknown', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const plan = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    assert.equal(plan.initialize({ processId: 'plan-z', requestId: 'init-plan' }).code, 'INITIALIZED');
    assert.equal(sivs.initialize({ processId: 'sivs-z', requestId: 'init-sivs' }).code, 'INITIALIZED');
    const report = plan.processMetrics();
    assert.deepEqual(report.counts, { controllerProcesses: 2, sivsProcesses: 1,
      boundTasks: 0, verifiedTasks: 0 });
    assert.equal(report.sources[0].processId, 'sivs-z');
    assert.equal(report.sources[0].binding, null);
    assert.equal(report.metrics.at(-1).reason, 'UNBOUND_TASK_HISTORY_UNPROVABLE');
    assert.equal(Object.isFrozen(report.sources[0]), true);
    plan.close(); sivs.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('measures Pass@1 only for a fully observed uniquely bound task and seals full proof rows', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const { pse, sivs, binding, taskPath, checklistPath } = setupBound(cwd);
    assert.equal(sivs.processMetrics().metrics.at(-1).reason, 'VERIFICATION_HISTORY_UNPROVABLE');
    const stage = (requestId, expectedRevision) => sivs.transitionSivsStage({ processId: 'sivs-1',
      requestId, action: 'forward', binding: binding.binding, expectedRevision, taskPath, checklistPath });
    assert.equal(stage('s1', 0).to, 'implement');
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    assert.equal(stage('s2', 1).to, 'verify');
    const verification = runRecord('verification', VERIFY_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    const proof = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-v',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: ACCEPTANCE, implementationRunId: implementation.runId,
        verificationRunId: verification.runId, verdict: 'PASS', reviewer: verification.verifier,
        sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    assert.equal(proof.code, 'SIVS_VERIFICATION_RECORDED');
    const report = sivs.processMetrics();
    assert.deepEqual(report.counts, { controllerProcesses: 2, sivsProcesses: 1,
      boundTasks: 1, verifiedTasks: 1 });
    assert.deepEqual(report.metrics.at(-1), { name: 'passAt1Rate', status: 'measured',
      unit: 'basis-points', numerator: 1, denominator: 1, valueBasisPoints: 10000 });
    assert.equal(report.sources[0].verification.sequence, 1);
    assert.equal(report.sources[0].verification.digest, report.sources[0].verification.firstDigest);
    assert.match(report.sources[0].verification.firstRowDigest, /^[0-9a-f]{64}$/);
    assert.match(report.sources[0].verification.historyDigest, /^[0-9a-f]{64}$/);
    assert.equal(report.digest, createHash('sha256').update(canonicalJson([
      report.domain, 1, report.scope, report.counts, report.sources, report.metrics])).digest('hex'));
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('fails closed for audit-only population and proof request digest tampering', () => {
  for (const variant of ['audit-only', 'proof-request']) {
    const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
    try {
      let controller;
      if (variant === 'audit-only') {
        controller = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
        const db = openSqlite(cwd);
        db.prepare(`INSERT INTO process_controller_audit
          (process_id,audit_seq,request_key,event_json,prev_hash,event_hash,recorded_at)
          VALUES('orphan',0,'x','{}',?,?,0)`).run('0'.repeat(64), '1'.repeat(64));
        closeSqlite(db);
      } else {
        const fixture = setupBound(cwd); controller = fixture.sivs;
        controller.transitionSivsStage({ processId: 'sivs-1', requestId: 's1', action: 'forward',
          binding: fixture.binding.binding, expectedRevision: 0,
          taskPath: fixture.taskPath, checklistPath: fixture.checklistPath });
        const implementation = runRecord('implementation', IMPL_SESSION);
        put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
        controller.transitionSivsStage({ processId: 'sivs-1', requestId: 's2', action: 'forward',
          binding: fixture.binding.binding, expectedRevision: 1,
          taskPath: fixture.taskPath, checklistPath: fixture.checklistPath });
        const verification = runRecord('verification', VERIFY_SESSION);
        put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
        controller.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-v', binding: fixture.binding.binding,
          assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
            acceptanceHash: ACCEPTANCE, implementationRunId: implementation.runId,
            verificationRunId: verification.runId, verdict: 'PASS', reviewer: verification.verifier,
            sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
        const db = openSqlite(cwd);
        db.exec('DROP TRIGGER process_controller_sivs_verification_no_update');
        db.prepare(`UPDATE process_controller_sivs_verification_proof SET request_digest=?
          WHERE process_id='sivs-1'`).run('f'.repeat(64));
        closeSqlite(db);
        fixture.pse.close();
      }
      assert.deepEqual(controller.processMetrics(), { ok: false, code: 'PROCESS_METRICS_CORRUPT' });
      controller.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('keeps Pass@1 bound to the first proof across later proof replay', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const { pse, sivs, binding, taskPath, checklistPath } = setupBound(cwd);
    const stage = (requestId, expectedRevision) => sivs.transitionSivsStage({ processId: 'sivs-1',
      requestId, action: 'forward', binding: binding.binding, expectedRevision, taskPath, checklistPath });
    stage('s1', 0);
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    stage('s2', 1);
    const record = passed => {
      const verification = runRecord('verification', VERIFY_SESSION, passed);
      put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
      return sivs.recordSivsVerification({ processId: 'sivs-1', requestId: passed ? 'proof-pass' : 'proof-fail',
        binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
          goalAttempt: 1, acceptanceHash: ACCEPTANCE, implementationRunId: implementation.runId,
          verificationRunId: verification.runId, verdict: passed ? 'PASS' : 'FAIL',
          reviewer: verification.verifier, sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    };
    assert.equal(record(false).verdict, 'FAIL');
    const before = sivs.processMetrics();
    assert.equal(record(true).verdict, 'PASS');
    const after = sivs.processMetrics();
    assert.deepEqual(after.metrics.at(-1), { name: 'passAt1Rate', status: 'measured',
      unit: 'basis-points', numerator: 0, denominator: 1, valueBasisPoints: 0 });
    assert.equal(after.sources[0].verification.firstDigest, before.sources[0].verification.firstDigest);
    assert.equal(after.sources[0].verification.firstRowDigest, before.sources[0].verification.firstRowDigest);
    assert.equal(after.sources[0].verification.sequence, 2);
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rounds a two-of-three fully observed Pass@1 population half-up to 6667 basis points', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  const fixtures = [];
  try {
    for (let index = 1; index <= 3; index += 1) {
      const context = { uuid: `c40f1a9${index}`, plan: `runtime-controller-metrics-${index}`,
        goalId: `G00${index}`, acceptance: String(index).repeat(64) };
      const fixture = setupBound(cwd, `sivs-${index}`, `pse-${index}`, context);
      fixtures.push(fixture);
      const stage = (requestId, expectedRevision) => fixture.sivs.transitionSivsStage({
        processId: `sivs-${index}`, requestId, action: 'forward', binding: fixture.binding.binding,
        expectedRevision, taskPath: fixture.taskPath, checklistPath: fixture.checklistPath });
      assert.equal(stage('s1', 0).to, 'implement');
      const implementation = runRecord('implementation', IMPL_SESSION, true, context);
      put(cwd, `.qe/planning/plans/${context.plan}/evidence/${context.goalId}.implementation-run.json`,
        JSON.stringify(implementation));
      assert.equal(stage('s2', 1).to, 'verify');
      const passed = index <= 2;
      const verification = runRecord('verification', VERIFY_SESSION, passed, context);
      put(cwd, `.qe/planning/plans/${context.plan}/evidence/${context.goalId}.verification-run.json`,
        JSON.stringify(verification));
      const proof = fixture.sivs.recordSivsVerification({ processId: `sivs-${index}`,
        requestId: 'proof-v', binding: fixture.binding.binding,
        assertion: { schema: 1, uuid: context.uuid, planSlug: context.plan, goalId: context.goalId,
          goalAttempt: 1, acceptanceHash: context.acceptance,
          implementationRunId: implementation.runId, verificationRunId: verification.runId,
          verdict: passed ? 'PASS' : 'FAIL', reviewer: verification.verifier,
          sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
      assert.equal(proof.verdict, passed ? 'PASS' : 'FAIL');
    }
    const report = fixtures.at(-1).sivs.processMetrics();
    assert.deepEqual(report.counts, { controllerProcesses: 6, sivsProcesses: 3,
      boundTasks: 3, verifiedTasks: 3 });
    assert.deepEqual(report.metrics.at(-1), { name: 'passAt1Rate', status: 'measured',
      unit: 'basis-points', numerator: 2, denominator: 3, valueBasisPoints: 6667 });
  } finally {
    for (const fixture of fixtures) { fixture.sivs.close(); fixture.pse.close(); }
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('uses duplicate logical identity precedence without inflating task counts', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const first = setupBound(cwd);
    const second = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    assert.equal(second.initialize({ processId: 'sivs-2', requestId: 'init-2' }).code, 'INITIALIZED');
    const db = openSqlite(cwd);
    const pseToken = db.prepare(`SELECT token_text FROM process_controller_pse_task_binding
      WHERE process_id='pse-1'`).get().token_text;
    closeSqlite(db);
    assert.equal(second.bindSivsTask({ processId: 'sivs-2', requestId: 'bind-2', pseProcessId: 'pse-1',
      pseBinding: pseToken, planSlug: PLAN, goalId: 'G001', taskPath: first.taskPath,
      checklistPath: first.checklistPath }).code, 'SIVS_TASK_BOUND');
    const report = second.processMetrics();
    assert.deepEqual(report.counts, { controllerProcesses: 3, sivsProcesses: 2,
      boundTasks: 1, verifiedTasks: 0 });
    assert.equal(report.metrics.at(-1).reason, 'LOGICAL_TASK_IDENTITY_AMBIGUOUS');
    second.close(); first.sivs.close(); first.pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('separates a remediation event paired snapshot from the later current process head', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const { pse, sivs, binding, taskPath, checklistPath } = setupBound(cwd);
    const stage = (requestId, action, expectedRevision) => sivs.transitionSivsStage({ processId: 'sivs-1',
      requestId, action, binding: binding.binding, expectedRevision, taskPath, checklistPath });
    stage('s1', 'forward', 0);
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    stage('s2', 'forward', 1);
    const verification = runRecord('verification', VERIFY_SESSION, false);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-fail', binding: binding.binding,
      assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
        acceptanceHash: ACCEPTANCE, implementationRunId: implementation.runId,
        verificationRunId: verification.runId, verdict: 'FAIL', reviewer: verification.verifier,
        sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    const lease = createProcessControllerStore(cwd);
    assert.equal(lease.acquirePersistentLease({ processId: 'sivs-1',
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId: 'lease',
      durationMs: 60_000 }).code, 'PERSISTENT_LEASE_ACQUIRED');
    lease.close();
    assert.equal(stage('enter-remediate', 'remediate', 2).to, 'remediate');
    assert.equal(sivs.remediateSivsStage({ processId: 'sivs-1', requestId: 'round-1',
      binding: binding.binding, expectedRevision: 3, taskPath, checklistPath }).code,
    'SIVS_REMEDIATION_COMMITTED');
    const pairedHead = sivs.audit('sivs-1').at(-1).event_hash;
    assert.equal(stage('after-round', 'forward', 4).to, 'verify');
    const report = sivs.processMetrics();
    assert.equal(report.sources[0].remediation.sequence, 0);
    assert.notEqual(report.sources[0].audit.hash, pairedHead);
    const db = openSqlite(cwd);
    assert.equal(report.sources[0].audit.hash, db.prepare(`SELECT process_audit_hash
      FROM process_controller_sivs_remediation_current WHERE process_id='sivs-1'`).get().process_audit_hash);
    closeSqlite(db);
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects a supervision row whose self-consistent request points at no PASS verification', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const { pse, sivs, binding, taskPath, checklistPath } = setupBound(cwd);
    const stage = (requestId, expectedRevision) => sivs.transitionSivsStage({ processId: 'sivs-1',
      requestId, action: 'forward', binding: binding.binding, expectedRevision, taskPath, checklistPath });
    stage('s1', 0);
    const implementation = runRecord('implementation', IMPL_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.implementation-run.json`, JSON.stringify(implementation));
    stage('s2', 1);
    const verification = runRecord('verification', VERIFY_SESSION);
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.verification-run.json`, JSON.stringify(verification));
    const verified = sivs.recordSivsVerification({ processId: 'sivs-1', requestId: 'proof-v',
      binding: binding.binding, assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: ACCEPTANCE, implementationRunId: implementation.runId,
        verificationRunId: verification.runId, verdict: 'PASS', reviewer: verification.verifier,
        sessionId: VERIFY_SESSION, findingsDigest: 'e'.repeat(64) } });
    stage('s3', 2);
    sivs.recordSivsSupervision({ processId: 'sivs-1', requestId: 'proof-s', binding: binding.binding,
      assertion: { schema: 1, uuid: UUID, planSlug: PLAN, goalId: 'G001', goalAttempt: 1,
        acceptanceHash: ACCEPTANCE, verificationProofDigest: verified.proofRef.split(':')[1],
        verdict: 'WARN', supervisor: 'supervisor',
        sessionId: '33333333-3333-4333-8333-333333333333', riskDigest: 'f'.repeat(64) } });
    const db = openSqlite(cwd);
    db.exec('DROP TRIGGER process_controller_sivs_supervision_no_update');
    const row = db.prepare(`SELECT * FROM process_controller_sivs_supervision_proof
      WHERE process_id='sivs-1'`).get();
    const proof = JSON.parse(row.proof_json); proof.verificationProofDigest = '9'.repeat(64);
    const assertion = { schema: 1, uuid: proof.uuid, planSlug: proof.planSlug, goalId: proof.goalId,
      goalAttempt: proof.goalAttempt, acceptanceHash: proof.acceptanceHash,
      verificationProofDigest: proof.verificationProofDigest, verdict: proof.verdict,
      supervisor: proof.supervisor, sessionId: proof.sessionId, riskDigest: proof.riskDigest };
    const controllerIdentity = db.prepare(`SELECT controller_identity FROM process_controller_sivs_task_binding
      WHERE process_id='sivs-1'`).get().controller_identity;
    const requestDigest = createHash('sha256').update(canonicalJson(['qe-sivs-supervision-request-v1',
      controllerIdentity, 'sivs-1', row.request_id, row.task_binding_sha256, assertion])).digest('hex');
    const proofDigest = createHash('sha256').update(canonicalJson(['qe-sivs-supervision-proof-v1', proof])).digest('hex');
    db.prepare(`UPDATE process_controller_sivs_supervision_proof SET proof_json=?,proof_digest=?,request_digest=?
      WHERE process_id='sivs-1'`).run(canonicalJson(proof), proofDigest, requestDigest);
    closeSqlite(db);
    assert.deepEqual(sivs.processMetrics(), { ok: false, code: 'PROCESS_METRICS_CORRUPT' });
    sivs.close(); pse.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a concurrent append is observed as one complete before or after snapshot', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qe-process-metrics-'));
  try {
    const reader = createProcessController({ cwd, layer: 'plan', authority: 'wrong-authority' });
    const url = new URL('../process-controller.mjs', import.meta.url).href;
    const code = `import{createProcessController}from ${JSON.stringify(url)};const c=createProcessController({cwd:process.env.QE_METRICS_CWD,layer:'sivs',authority:'sivs-controller'});const r=c.initialize({processId:'sivs-concurrent',requestId:'init'});c.close();if(r.code!=='INITIALIZED')process.exit(2);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, QE_METRICS_CWD: cwd }, stdio: 'ignore',
    });
    const observed = [];
    while (child.exitCode === null) {
      const report = reader.processMetrics({ callerMetricForgery: 10000 });
      assert.equal(report.code, undefined);
      observed.push(report.counts.controllerProcesses);
      await new Promise(resolve => setImmediate(resolve));
    }
    await new Promise((resolve, reject) => {
      if (child.exitCode !== null) return child.exitCode === 0 ? resolve() : reject(new Error(`child ${child.exitCode}`));
      child.once('exit', codeValue => codeValue === 0 ? resolve() : reject(new Error(`child ${codeValue}`)));
    });
    observed.push(reader.processMetrics().counts.controllerProcesses);
    assert.equal(observed.every(count => count === 0 || count === 1), true);
    assert.equal(observed.at(-1), 1);
    reader.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
