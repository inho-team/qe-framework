import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createProcessController } from '../process-controller.mjs';
import { setup, put, runRecord, UUID, PLAN, HASH } from './lifecycle-sivs-stage-adapter.test.mjs';
import { evaluateTransition } from '../process-kernel.mjs';
import * as ledger from '../ledger.mjs';
import { sha256 } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const I = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';

function producerAcceptance(goalId, objective) {
  return {
    schema: 2, goalId,
    goalShape: { outcomes: [{ id: 'O001', statement: 'Producer evidence completes',
      completionMetric: 'The controller reaches complete.' }],
    allowedPaths: ['fixture.mjs'], nonGoals: ['No external effects'], dependencies: [] },
    requirements: [{ id: 'R001', outcomeId: 'O001', criterion: 'Producer command passes',
      command: 'node --test --help' }],
    scenarios: [{ id: 'S001', outcomeId: 'O001', kind: 'user-journey',
      scenario: 'Ledger publishes evidence', expected: 'SIVS completes', command: 'node --test --help' }],
    regression: { outcomeId: 'O001', scope: 'producer fixture', command: 'node --test --help' },
    humanAcceptance: { required: false },
    goalAlignment: { objective, outcomeId: 'O001', rationale: 'The journey exercises publication.' },
    riskAssessment: { categories: ['none'], rationale: 'Isolated fixture only.' },
  };
}

function producerCompletion(goalId, objective, verifier) {
  return {
    schema: 1, goalId,
    requirements: [{ id: 'R001', outcome: 'pass', evidence: 'implementation passed' }],
    scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'journey passed' }],
    regression: { outcome: 'pass', evidence: 'regression passed' },
    independentVerification: { verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'verified' },
    goalAlignment: { objective, outcomeId: 'O001', verifier, outcome: 'pass', evidence: 'aligned' },
    humanAcceptance: { status: 'not-required' }, limitations: [],
  };
}

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

function publish(cwd, x, acceptanceSuffix = '\n', completionSuffix = '\n') {
  const acceptance = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1' }],
    scenarios: [{ id: 'S1' }], humanAcceptance: { required: true } };
  const completion = { schema: 1, goalId: 'G001', requirements: [{ id: 'R1', outcome: 'pass', evidence: 'ok' }],
    scenarios: [{ id: 'S1', outcome: 'pass', evidence: 'ok' }], regression: { outcome: 'pass', evidence: 'ok' },
    independentVerification: { verifier: x.verify.verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'ok' },
    goalAlignment: { objective: 'x', verifier: x.verify.verifier, outcome: 'pass', evidence: 'ok' },
    humanAcceptance: { status: 'passed', evidence: 'approved' }, limitations: [] };
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.acceptance.json`,
    `${JSON.stringify(acceptance, null, 2)}${acceptanceSuffix}`);
  put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.completion.json`,
    `${JSON.stringify(completion, null, 2)}${completionSuffix}`);
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
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.acceptance.json`, JSON.stringify(acceptance, null, 2));
    put(cwd, `.qe/planning/plans/${PLAN}/evidence/G001.completion.json`, JSON.stringify(completion, null, 2));
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

test('completes from acceptance and completion rows published by ledger APIs', { concurrency: false }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-ledger-producer-'));
  const plan = 'producer-plan'; const uuid = 'deadc0de'; const objective = 'producer objective';
  const taskPath = `.qe/tasks/in-progress/TASK_REQUEST_${uuid}.md`;
  const checklistPath = `.qe/checklists/in-progress/VERIFY_CHECKLIST_${uuid}.md`;
  const previousRoot = process.env.QE_ROOT;
  try {
    writeFileSync(join(cwd, '.gitignore'), '.qe/\n*.json\n', 'utf8');
    assert.equal(spawnSync('git', ['init', '-q'], { cwd }).status, 0);
    assert.equal(spawnSync('git', ['add', '.gitignore'], { cwd }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=QE', '-c', 'user.email=qe@example.invalid',
      'commit', '-q', '-m', 'fixture'], { cwd }).status, 0);
    mkdirSync(join(cwd, '.qe', 'planning', 'plans', plan), { recursive: true });
    mkdirSync(join(cwd, '.qe', 'state'), { recursive: true });
    writeFileSync(join(cwd, '.qe', 'state', 'current-session.json'), JSON.stringify({ session_id: I }), 'utf8');
    process.env.QE_ROOT = cwd;

    ledger.createGoals(cwd, plan, [`Producer::${objective}`, 'Successor::successor objective']);
    const acceptanceFile = join(cwd, 'acceptance.json');
    writeFileSync(acceptanceFile, JSON.stringify(producerAcceptance('G001', objective)), 'utf8');
    ledger.setGoalAcceptance(cwd, plan, { goalId: 'G001', file: acceptanceFile });
    assert.equal(ledger.executePlanGoalTransition(cwd, plan, { action: 'next', sessionId: I }).code, 'PROJECTED');
    const goalDb = openSqlite(cwd);
    const goal = JSON.parse(goalDb.prepare('SELECT content FROM qe_files WHERE path=?')
      .get(`.qe/planning/plans/${plan}/goals.json`).content).goals[0];
    closeSqlite(goalDb);

    put(cwd, taskPath, `# TASK_REQUEST_${uuid}.md — Producer\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${uuid}\nplan: ${plan}\nphase: "Phase 1"\ncreated: "2026-08-16"\nstatus: in-progress\nlinks:\n  - "[[${checklistPath}]]"\n-->\n\n## 체크리스트\n- [ ] publish\n`);
    put(cwd, checklistPath, `# VERIFY_CHECKLIST_${uuid}.md — Producer\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${uuid}\nplan: ${plan}\nphase: "Phase 1"\ncreated: "2026-08-16"\nstatus: in-progress\nlinks:\n  - "[[${taskPath}]]"\n-->\n\n## 검증 기준\n- [ ] verify\n\n## 프레임워크 무결성 체크\n- [ ] wire\n`);

    const pse = createProcessController({ cwd, layer: 'pse', authority: 'pse-controller' });
    pse.initialize({ processId: 'producer-pse', requestId: 'init' });
    const pseBinding = pse.bindPseTask({ processId: 'producer-pse', requestId: 'bind', taskPath, checklistPath });
    for (const [requestId, expectedRevision] of [['p1', 0], ['p2', 1], ['p3', 2]]) {
      assert.equal(pse.transitionPseStage({ processId: 'producer-pse', requestId, action: 'forward',
        binding: pseBinding.binding, expectedRevision, taskPath, checklistPath }).code,
      'PSE_STAGE_TRANSITION_COMMITTED');
    }
    const sivs = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller' });
    sivs.initialize({ processId: 'producer-sivs', requestId: 'init' });
    const binding = sivs.bindSivsTask({ processId: 'producer-sivs', requestId: 'bind',
      pseProcessId: 'producer-pse', pseBinding: pseBinding.binding, planSlug: plan, goalId: 'G001',
      taskPath, checklistPath });
    const stage = (requestId, expectedRevision) => sivs.transitionSivsStage({ processId: 'producer-sivs',
      requestId, action: 'forward', binding: binding.binding, expectedRevision, taskPath, checklistPath });
    assert.equal(stage('s1', 0).to, 'implement');
    const implementation = ledger.runGoalEvidence(cwd, plan,
      { goalId: 'G001', role: 'implementation', sessionId: I });
    assert.equal(stage('s2', 1).to, 'verify');
    const verifier = 'producer-verifier';
    const verification = ledger.runGoalEvidence(cwd, plan,
      { goalId: 'G001', role: 'verification', verifier, sessionId: V });
    const verified = sivs.recordSivsVerification({ processId: 'producer-sivs', requestId: 'verify-proof',
      binding: binding.binding, assertion: { schema: 1, uuid, planSlug: plan, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: goal.acceptance.hash, implementationRunId: implementation.runId,
        verificationRunId: verification.runId, verdict: 'PASS', reviewer: verifier,
        sessionId: V, findingsDigest: 'e'.repeat(64) } });
    assert.equal(stage('s3', 2).to, 'supervise');
    sivs.recordSivsSupervision({ processId: 'producer-sivs', requestId: 'supervise-proof',
      binding: binding.binding, assertion: { schema: 1, uuid, planSlug: plan, goalId: 'G001',
        goalAttempt: 1, acceptanceHash: goal.acceptance.hash,
        verificationProofDigest: verified.proofRef.split(':')[1], verdict: 'PASS', supervisor: 'producer-lead',
        sessionId: S, riskDigest: 'f'.repeat(64) } });

    const completionFile = join(cwd, 'completion.json');
    writeFileSync(completionFile, JSON.stringify(producerCompletion('G001', objective, verifier)), 'utf8');
    ledger.recordGoalEvidence(cwd, plan, { goalId: 'G001', file: completionFile });
    const db = openSqlite(cwd);
    for (const path of [`.qe/planning/plans/${plan}/evidence/G001.acceptance.json`,
      `.qe/planning/plans/${plan}/evidence/G001.completion.json`]) {
      assert.equal(db.prepare('SELECT content FROM qe_files WHERE path=?').get(path).content.endsWith('\n'), false);
    }
    closeSqlite(db);
    assert.equal(stage('complete', 3).to, 'complete');
    const completed = ledger.executePlanGoalTransition(cwd, plan,
      { action: 'complete', sessionId: I });
    assert.equal(completed.code, 'PROJECTED', JSON.stringify(completed));

    const successorAcceptance = join(cwd, 'successor-acceptance.json');
    writeFileSync(successorAcceptance,
      JSON.stringify(producerAcceptance('G002', 'successor objective')), 'utf8');
    ledger.setGoalAcceptance(cwd, plan, { goalId: 'G002', file: successorAcceptance });

    const staleDb = openSqlite(cwd);
    const predecessorAcceptancePath = `.qe/planning/plans/${plan}/evidence/G001.acceptance.json`;
    const predecessorAcceptance = staleDb.prepare(
      'SELECT content,size,sha256 FROM qe_files WHERE path=?').get(predecessorAcceptancePath);
    const staleAcceptance = `${predecessorAcceptance.content} `;
    staleDb.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?').run(
      staleAcceptance, Buffer.byteLength(staleAcceptance),
      sha256(staleAcceptance), predecessorAcceptancePath);
    closeSqlite(staleDb);
    assert.equal(ledger.executePlanGoalTransition(cwd, plan,
      { action: 'next', sessionId: I }).code, 'EVIDENCE_INCOMPLETE');
    const restoreDb = openSqlite(cwd);
    restoreDb.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?').run(
      predecessorAcceptance.content, predecessorAcceptance.size,
      predecessorAcceptance.sha256, predecessorAcceptancePath);
    closeSqlite(restoreDb);

    const successor = ledger.executePlanGoalTransition(cwd, plan,
      { action: 'next', sessionId: I });
    assert.equal(successor.code, 'PROJECTED', JSON.stringify(successor));
    assert.equal(successor.goal?.id, 'G002');
    sivs.close(); pse.close();
  } finally {
    if (previousRoot === undefined) delete process.env.QE_ROOT; else process.env.QE_ROOT = previousRoot;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('accepts every canonical no-LF and single-LF evidence pairing', () => {
  for (const acceptanceSuffix of ['', '\n']) {
    for (const completionSuffix of ['', '\n']) {
      const cwd = mkdtempSync(join(tmpdir(), 'qe-sivs-frame-pair-'));
      try {
        const x = supervise(cwd); publish(cwd, x, acceptanceSuffix, completionSuffix);
        const result = x.sivs.transitionSivsStage({ processId: 'sivs-1',
          requestId: `complete-${acceptanceSuffix.length}-${completionSuffix.length}`, action: 'forward',
          binding: x.binding.binding, expectedRevision: 3, ...x.paths });
        assert.equal(result.to, 'complete');
        x.sivs.close(); x.pse.close();
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    }
  }
});

test('rejects non-canonical framing for acceptance and completion without state mutation', () => {
  const mutations = [
    ['crlf', text => `${text}\r\n`],
    ['double-lf', text => `${text}\n\n`],
    ['trailing-space', text => `${text} `],
    ['trailing-tab', text => `${text}\t`],
    ['leading-space', text => ` ${text}`],
    ['malformed', () => '{bad'],
  ];
  for (const artifact of ['acceptance', 'completion']) {
    for (const [label, mutate] of mutations) {
      const cwd = mkdtempSync(join(tmpdir(), `qe-sivs-frame-${artifact}-${label}-`));
      try {
        const x = supervise(cwd); publish(cwd, x, '', '');
        const path = `.qe/planning/plans/${PLAN}/evidence/G001.${artifact}.json`;
        const db = openSqlite(cwd); const text = db.prepare('SELECT content FROM qe_files WHERE path=?').get(path).content;
        closeSqlite(db); put(cwd, path, mutate(text));
        const before = x.sivs.read('sivs-1').snapshot;
        const result = x.sivs.transitionSivsStage({ processId: 'sivs-1',
          requestId: `complete-${artifact}-${label}`, action: 'forward', binding: x.binding.binding,
          expectedRevision: 3, ...x.paths });
        assert.equal(result.code, 'SIVS_COMPLETION_EVIDENCE_CORRUPT');
        assert.deepEqual(x.sivs.read('sivs-1').snapshot, before);
        x.sivs.close(); x.pse.close();
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    }
  }
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
