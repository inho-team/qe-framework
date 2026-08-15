import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { createGoals, append, setGoalAcceptance, status, renderState, readGoals, recordEvent, tailLedger } from '../ledger.mjs';
import * as ledgerModule from '../ledger.mjs';
import { buildProcessTrace, createInvalidProcessTrace } from '../process-trace.mjs';

const SLUG = 'demo-plan';
const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Create a temp project root with `.qe/planning/plans/{slug}/`. @returns {string} cwd */
function makeProject(slug = SLUG) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-test-'));
  mkdirSync(path.join(dir, '.qe', 'planning', 'plans', slug), { recursive: true });
  setSession(dir, '11111111-1111-1111-1111-111111111111');
  return dir;
}

function setSession(cwd, sessionId) {
  const stateDir = path.join(cwd, '.qe', 'state');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'current-session.json'), JSON.stringify({ session_id: sessionId }), 'utf8');
}

function initializeGit(cwd) {
  writeFileSync(path.join(cwd, '.gitignore'), '.qe/\n*.json\n', 'utf8');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd }).status, 0);
  assert.equal(spawnSync('git', ['add', '.gitignore'], { cwd }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=QE', '-c', 'user.email=qe@example.invalid',
    'commit', '-q', '-m', 'fixture'], { cwd }).status, 0);
}

function ledgerLines(cwd, slug = SLUG) {
  const p = path.join(cwd, '.qe', 'planning', 'plans', slug, 'ledger.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function writeJson(cwd, name, value) {
  const file = path.join(cwd, name);
  writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

function makeSource(exists, raw) {
  return { exists, raw };
}

function makeTraceSnapshot(goalId = 'G001', objective = 'first objective', includeRuns = false) {
  const acceptance = {
    schema: 1,
    goalId,
    requirements: [{ id: 'R001', criterion: 'Requested behavior works', command: 'node --test --help' }],
    scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'A user completes the primary flow', expected: 'The requested result is visible', command: 'node --test --help' }],
    regression: { scope: 'existing behavior', command: 'node --test --help' },
    traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
  };
  const acceptanceRaw = JSON.stringify(acceptance);
  const acceptanceHash = createHash('sha256').update(acceptanceRaw).digest('hex');
  const goals = {
    goals: [
      {
        id: goalId,
        objective,
        acceptance: { hash: acceptanceHash },
      },
    ],
  };
  return {
    goals: makeSource(true, JSON.stringify(goals)),
    acceptance: makeSource(true, acceptanceRaw),
    implementation: includeRuns
      ? makeSource(true, JSON.stringify({
        schema: 1,
        goalId,
        role: 'implementation',
        sessionId: '11111111-1111-1111-1111-111111111111',
        contractHash: acceptanceHash,
        passed: true,
        runs: [
          { command: 'node --test --help', passed: true, exitCode: 0, outputHash: HASH },
        ],
      }))
      : makeSource(false, null),
    verification: includeRuns
      ? makeSource(true, JSON.stringify({
        schema: 1,
        goalId,
        role: 'verification',
        verifier: 'fresh reviewer',
        sessionId: '22222222-2222-2222-2222-222222222222',
        contractHash: acceptanceHash,
        passed: true,
        runs: [
          { command: 'node --test --help', passed: true, exitCode: 0, outputHash: HASH },
        ],
      }))
      : makeSource(false, null),
    completion: makeSource(false, null),
  };
}

function makeCliReport(status, goalId = 'G001') {
  if (status === 'invalid') {
    return {
      schema: 1,
      authority: 'structural-only',
      authoritative: false,
      goalId: null,
      contractHash: null,
      status: 'invalid',
      traceComplete: false,
      summary: { totalItems: 0, linkedItems: 0, gapCount: 1 },
      items: [],
      regression: {
        implementation: { status: 'not-evaluated', outputHash: null, sessionId: null, verifier: null },
        verification: { status: 'not-evaluated', outputHash: null, sessionId: null, verifier: null },
        verdict: { status: 'not-evaluated', evidencePresent: false },
        gaps: [],
      },
      independentVerification: { status: 'not-evaluated', verifier: null, evidencePresent: false },
      goalAlignment: { status: 'not-evaluated', verifier: null, evidencePresent: false, objectiveMatches: false },
      gaps: [{ code: 'INVALID_INPUT', kind: 'trace', id: '$global', detail: 'INVALID_INPUT' }],
      nextActions: ['repair-evidence'],
    };
  }
  const acceptance = {
    schema: 1,
    goalId,
    requirements: [{ id: 'R001', criterion: 'criterion', command: 'node --test --help' }],
    scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'journey', expected: 'visible', command: 'node --test --help' }],
    regression: { scope: 'existing', command: 'node --test --help' },
    traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
  };
  const run = (role, sessionId) => ({
    schema: 1, goalId, role, sessionId, contractHash: HASH, passed: true,
    ...(role === 'verification' ? { verifier: 'fresh reviewer' } : {}),
    runs: [{ command: 'node --test --help', passed: true, exitCode: 0, outputHash: HASH }],
  });
  const completionRecord = status === 'complete' ? {
    schema: 1, goalId,
    requirements: [{ id: 'R001', outcome: 'pass', evidence: 'pass' }],
    scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'pass' }],
    regression: { outcome: 'pass', evidence: 'pass' },
    independentVerification: { verifier: 'fresh reviewer', mode: 'machine-reexecution', outcome: 'pass', evidence: 'pass' },
    goalAlignment: { objective: 'first objective', verifier: 'fresh reviewer', outcome: 'pass', evidence: 'pass' },
  } : undefined;
  return buildProcessTrace({
    goal: { id: goalId, objective: 'first objective', acceptanceHash: HASH },
    acceptanceHash: HASH,
    acceptance,
    implementationRun: run('implementation', '11111111-1111-1111-1111-111111111111'),
    verificationRun: run('verification', '22222222-2222-2222-2222-222222222222'),
    ...(completionRecord ? { completion: completionRecord } : {}),
  });
}

function acceptance(goalId = 'G001', humanRequired = false, goalObjective = 'first objective') {
  return {
    schema: 2, goalId,
    goalShape: {
      outcomes: [{ id: 'O001', statement: 'The user completes the requested primary flow.',
        completionMetric: 'The locked user-journey command exits successfully.' }],
      allowedPaths: ['src/primary-flow.mjs', 'test/primary-flow.test.mjs'],
      nonGoals: ['No unrelated UI, API, migration, or deployment work.'],
      dependencies: [],
    },
    requirements: [{ id: 'R001', outcomeId: 'O001', criterion: 'Requested behavior works', command: 'node --test --help' }],
    scenarios: [{ id: 'S001', outcomeId: 'O001', kind: 'user-journey', scenario: 'A user completes the primary flow', expected: 'The requested result is visible', command: 'node --test --help' }],
    regression: { outcomeId: 'O001', scope: 'existing behavior', command: 'node --test --help' },
    humanAcceptance: { required: humanRequired },
    goalAlignment: { objective: goalObjective, outcomeId: 'O001', rationale: 'R001 and S001 together demonstrate the requested user outcome.' },
    riskAssessment: { categories: ['none'], rationale: 'The Goal has no detected high-impact operational or security change.' },
  };
}

test('new acceptance rejects resume-only v1 and requires one fully mapped v2 outcome', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::first objective']);
  const legacy = acceptance('G001', false, 'first objective');
  legacy.schema = 1;
  legacy.goalShape = { primaryOutcome: legacy.goalShape.outcomes[0].statement,
    completionMetric: legacy.goalShape.outcomes[0].completionMetric,
    allowedPaths: legacy.goalShape.allowedPaths, nonGoals: legacy.goalShape.nonGoals, dependencies: [] };
  assert.throws(() => setGoalAcceptance(cwd, SLUG, {
    goalId: 'G001', file: writeJson(cwd, 'legacy-v1.json', legacy),
  }), /schema: 2.*resume-only/);

  const multi = acceptance('G001', false, 'first objective');
  multi.goalShape.outcomes.push({ id: 'O002', statement: 'A second independent result.',
    completionMetric: 'A second metric passes.' });
  assert.throws(() => setGoalAcceptance(cwd, SLUG, {
    goalId: 'G001', file: writeJson(cwd, 'multi-outcome-v2.json', multi),
  }), /exactly one structured outcome/);

  const unmapped = acceptance('G001', false, 'first objective');
  unmapped.scenarios[0].outcomeId = 'O999';
  assert.throws(() => setGoalAcceptance(cwd, SLUG, {
    goalId: 'G001', file: writeJson(cwd, 'unmapped-v2.json', unmapped),
  }), /map every requirement, scenario, regression, and alignment to O001/);
  rmSync(cwd, { recursive: true, force: true });
});

test('stored acceptance v1 remains readable for resume without permitting new v1 writes', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::first objective']);
  const legacy = acceptance('G001', false, 'first objective');
  legacy.schema = 1;
  legacy.goalShape = { primaryOutcome: legacy.goalShape.outcomes[0].statement,
    completionMetric: legacy.goalShape.outcomes[0].completionMetric,
    allowedPaths: legacy.goalShape.allowedPaths, nonGoals: legacy.goalShape.nonGoals, dependencies: [] };
  for (const item of [...legacy.requirements, ...legacy.scenarios]) delete item.outcomeId;
  delete legacy.regression.outcomeId;
  delete legacy.goalAlignment.outcomeId;
  const planDir = path.join(cwd, '.qe', 'planning', 'plans', SLUG);
  const evidenceDir = path.join(planDir, 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'G001.acceptance.json'), JSON.stringify(legacy), 'utf8');
  const goals = readGoals(cwd, SLUG);
  goals.goals[0].acceptance = { status: 'defined', file: 'evidence/G001.acceptance.json',
    hash: createHash('sha256').update(JSON.stringify(legacy)).digest('hex') };
  writeFileSync(path.join(planDir, 'goals.json'), `${JSON.stringify(goals, null, 2)}\n`, 'utf8');

  const report = ledgerModule.traceGoal(cwd, SLUG, { goalId: 'G001' });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.gaps.some(gap => gap.code === 'MISSING_IMPLEMENTATION_RUN'));
  rmSync(cwd, { recursive: true, force: true });
});

test('create-goals writes ordered microgoals + one created event each', () => {
  const cwd = makeProject();
  const res = createGoals(cwd, SLUG, ['Build::Build the thing', 'Verify::Verify it']);
  assert.equal(res.created, 2);
  const doc = readGoals(cwd, SLUG);
  assert.equal(doc.goals[0].id, 'G001');
  assert.equal(doc.goals[1].objective, 'Verify it');
  assert.equal(doc.goals[0].status, 'pending');
  assert.equal(ledgerLines(cwd).length, 2);
  rmSync(cwd, { recursive: true, force: true });
});

test('create-goals is idempotent (preserves existing history)', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  const res = createGoals(cwd, SLUG, ['B::b']);
  assert.ok(res.skipped);
  assert.equal(readGoals(cwd, SLUG).goals.length, 1);
  rmSync(cwd, { recursive: true, force: true });
});

test('create-goals fails before persistence for an empty Plan or empty Goal fields', () => {
  for (const goals of [[], ['::'], ['Title::   '], ['   ::Objective']]) {
    const cwd = makeProject();
    assert.throws(() => createGoals(cwd, SLUG, goals), /requires at least one|must be non-empty/);
    assert.equal(existsSync(path.join(cwd, '.qe', 'planning', 'plans', SLUG, 'goals.json')), false);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('acceptance dependencies must exist and point only to earlier Goals', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::first objective', 'B::second objective']);
  for (const [goalId, dependencies, pattern] of [
    ['G001', ['G002'], /earlier Goal/],
    ['G002', ['G999'], /does not exist/],
  ]) {
    const contract = acceptance(goalId, false, goalId === 'G001' ? 'first objective' : 'second objective');
    contract.goalShape.dependencies = dependencies;
    assert.throws(() => setGoalAcceptance(cwd, SLUG, {
      goalId, file: writeJson(cwd, `${goalId}.invalid-dependency.json`, contract),
    }), pattern);
  }
  const valid = acceptance('G002', false, 'second objective');
  valid.goalShape.dependencies = ['G001'];
  assert.equal(setGoalAcceptance(cwd, SLUG, {
    goalId: 'G002', file: writeJson(cwd, 'G002.valid-dependency.json', valid),
  }).goalId, 'G002');
  rmSync(cwd, { recursive: true, force: true });
});

test('append is append-only: prior lines are byte-preserved, new line at end', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a', 'B::b']);
  const before = ledgerLines(cwd);
  append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
  const after = ledgerLines(cwd);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.slice(0, before.length), before); // existing lines untouched
  assert.match(after[after.length - 1], /"event":"started"/);
  rmSync(cwd, { recursive: true, force: true });
});

test('append mutates only the target goal; bumps attempts on started', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a', 'B::b']);
  append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
  append(cwd, SLUG, { goalId: 'G001', event: 'checkpoint', status: 'active', evidence: 'checkpoint reached' });
  const doc = readGoals(cwd, SLUG);
  assert.equal(doc.goals[0].status, 'active');
  assert.equal(doc.goals[0].attempts, 1);
  assert.equal(doc.goals[1].status, 'pending'); // untouched
  rmSync(cwd, { recursive: true, force: true });
});

test('append rejects invalid event/status (schema guard)', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  assert.throws(() => append(cwd, SLUG, { goalId: 'G001', event: 'bogus' }), /invalid event/);
  assert.throws(() => append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'nope' }), /invalid status/);
  assert.throws(() => append(cwd, SLUG, { goalId: 'GXXX', event: 'started' }), /unknown goalId/);
  assert.throws(() => append(cwd, SLUG, { goalId: 'G001', event: 'checkpoint', status: 'complete' }), /must use advance/);
  rmSync(cwd, { recursive: true, force: true });
});

test('G002 exports the read-only trace query and CLI adapter', () => {
  assert.equal(typeof ledgerModule.traceGoal, 'function');
  assert.equal(typeof ledgerModule.runTraceCli, 'function');
});

test('acceptance lock rejects invalid optional traceability before mutation', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::first objective']);
  const contract = acceptance('G001', false, 'first objective');
  contract.traceability = [{ requirementId: 'R999', scenarioIds: ['S001'] }];
  const input = writeJson(cwd, 'invalid-traceability.json', contract);
  const locked = path.join(cwd, '.qe', 'planning', 'plans', SLUG, 'evidence', 'G001.acceptance.json');
  const before = JSON.stringify(readGoals(cwd, SLUG));

  assert.throws(
    () => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: input }),
    /traceability/,
  );
  assert.equal(existsSync(locked), false);
  assert.equal(JSON.stringify(readGoals(cwd, SLUG)), before);
  rmSync(cwd, { recursive: true, force: true });
});

test('traceGoal is read-only and reports missing run/completion evidence as incomplete', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::first objective']);
  const contract = acceptance('G001', false, 'first objective');
  contract.traceability = [{ requirementId: 'R001', scenarioIds: ['S001'] }];
  setGoalAcceptance(cwd, SLUG, {
    goalId: 'G001',
    file: writeJson(cwd, 'trace-acceptance.json', contract),
  });
  const plan = path.join(cwd, '.qe', 'planning', 'plans', SLUG);
  const beforeGoals = readFileSync(path.join(plan, 'goals.json'), 'utf8');
  const beforeLedger = readFileSync(path.join(plan, 'ledger.jsonl'), 'utf8');
  const beforeAcceptance = readFileSync(path.join(plan, 'evidence', 'G001.acceptance.json'), 'utf8');

  const report = ledgerModule.traceGoal(cwd, SLUG, { goalId: 'G001' });

  assert.equal(report.status, 'incomplete');
  assert.ok(report.gaps.some(gap => gap.code === 'MISSING_IMPLEMENTATION_RUN'));
  assert.ok(report.gaps.some(gap => gap.code === 'MISSING_VERIFICATION_RUN'));
  assert.equal(readFileSync(path.join(plan, 'goals.json'), 'utf8'), beforeGoals);
  assert.equal(readFileSync(path.join(plan, 'ledger.jsonl'), 'utf8'), beforeLedger);
  assert.equal(readFileSync(path.join(plan, 'evidence', 'G001.acceptance.json'), 'utf8'), beforeAcceptance);

  const stdout = [];
  const stderr = [];
  const exit = ledgerModule.runTraceCli(
    ['--slug', SLUG, '--goal-id', 'G001', '--cwd', cwd],
    { traceGoal: () => report, stdout: value => stdout.push(value), stderr: value => stderr.push(value) },
  );
  assert.equal(exit, 3);
  assert.equal(stdout.length, 1);
  assert.equal(JSON.parse(stdout[0]).status, 'incomplete');
  assert.deepEqual(stderr, []);
  rmSync(cwd, { recursive: true, force: true });
});

test('traceGoal reads a stable snapshot exactly twice before building the report', () => {
  const calls = [];
  const snapshot = makeTraceSnapshot();

  const report = ledgerModule.traceGoal('/tmp/project', SLUG, { goalId: 'G001' }, {
    readSnapshot(cwd, slug, goalId) {
      calls.push([cwd, slug, goalId]);
      return snapshot;
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['/tmp/project', SLUG, 'G001']);
  assert.deepEqual(calls[1], ['/tmp/project', SLUG, 'G001']);
  assert.equal(report.status, 'incomplete');
  assert.ok(report.gaps.some((gap) => gap.code === 'MISSING_IMPLEMENTATION_RUN'));
  assert.ok(report.gaps.some((gap) => gap.code === 'MISSING_VERIFICATION_RUN'));
});

test('traceGoal gives changed-read precedence before parsing malformed evidence', () => {
  const source = (exists, raw) => ({ exists, raw });
  const first = {
    goals: source(true, '{bad'), acceptance: source(true, '{bad'),
    implementation: source(false, null), verification: source(false, null), completion: source(false, null),
  };
  const second = {
    ...first,
    completion: source(true, '{still-bad'),
  };
  let reads = 0;
  const report = ledgerModule.traceGoal('/tmp/project', SLUG, { goalId: 'G001' }, {
    readSnapshot: () => (reads++ === 0 ? first : second),
  });
  assert.equal(reads, 2);
  assert.equal(report.status, 'invalid');
  assert.equal(report.gaps[0].code, 'EVIDENCE_CHANGED_DURING_READ');
  assert.deepEqual(report.nextActions, ['retry-query']);
});

test('traceGoal returns INVALID_INPUT when the requested goal is absent from the stable goals source', () => {
  const report = ledgerModule.traceGoal('/tmp/project', SLUG, { goalId: 'G001' }, {
    readSnapshot() {
      return {
        goals: makeSource(true, JSON.stringify({ goals: [{ id: 'G002', objective: 'other objective', acceptance: { hash: HASH } }] })),
        acceptance: makeSource(true, JSON.stringify({
          schema: 1,
          goalId: 'G001',
          requirements: [{ id: 'R001', criterion: 'Requested behavior works', command: 'node --test --help' }],
          scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'A user completes the primary flow', expected: 'The requested result is visible', command: 'node --test --help' }],
          regression: { scope: 'existing behavior', command: 'node --test --help' },
        })),
        implementation: makeSource(false, null),
        verification: makeSource(false, null),
        completion: makeSource(false, null),
      };
    },
  });

  assert.equal(report.status, 'invalid');
  assert.equal(report.gaps[0].code, 'INVALID_INPUT');
});

test('broad Goal contracts are rejected before execution and must be split', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['Broad::implement UI API migration docs and deployment']);
  const broad = acceptance('G001', false, 'implement UI API migration docs and deployment');
  broad.goalShape.allowedPaths = ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs', 'e.mjs', 'f.mjs'];
  assert.throws(() => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'broad-paths.json', broad) }), /1-5 unique relative paths/);
  broad.goalShape.allowedPaths = ['a.mjs'];
  broad.requirements = Array.from({ length: 4 }, (_, index) => ({ id: `R${index + 1}`,
    outcomeId: 'O001', criterion: `criterion ${index + 1}`, command: 'node --test --help' }));
  assert.throws(() => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'broad-requirements.json', broad) }), /at most 3 requirements/);
  rmSync(cwd, { recursive: true, force: true });
});

test('code-changing Goal contracts require behavioral test evidence', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['Code::change runtime behavior']);
  const structuralOnly = acceptance('G001', false, 'change runtime behavior');
  structuralOnly.requirements[0].command = 'npm run qe:validate';
  structuralOnly.scenarios[0].command = 'node scripts/check-all.mjs';
  structuralOnly.regression.command = 'npm run qe:validate';
  assert.throws(
    () => setGoalAcceptance(cwd, SLUG, {
      goalId: 'G001',
      file: writeJson(cwd, 'structural-only.json', structuralOnly),
    }),
    /requires at least one behavioral test-runner command/,
  );
  rmSync(cwd, { recursive: true, force: true });
});

test('bounded micro assurance is admitted only with exact machine-verifiable limits', () => {
  const cwd = makeProject();
  initializeGit(cwd);
  createGoals(cwd, SLUG, ['Micro::change runtime behavior']);
  const bounded = acceptance('G001', false, 'change runtime behavior');
  bounded.assurance = {
    lane: 'bounded-micro',
    admissionVersion: 1,
    materialDecisionsResolved: true,
    workItems: 2,
  };
  assert.equal(setGoalAcceptance(cwd, SLUG, {
    goalId: 'G001', file: writeJson(cwd, 'bounded.json', bounded),
  }).acceptance.status, 'defined');
  const stored = JSON.parse(readFileSync(path.join(cwd, '.qe', 'planning', 'plans', SLUG,
    'evidence', 'G001.acceptance.json'), 'utf8'));
  assert.equal(stored.assurance.issuedBy, 'qe-ledger');
  assert.equal(stored.assurance.authority, 'plan-controller');
  assert.equal(stored.assurance.sessionId, '11111111-1111-1111-1111-111111111111');
  assert.deepEqual(stored.assurance.scopeBaseline, { schema: 1, entries: [] });
  assert.match(stored.assurance.admissionId, /^[0-9a-f]{64}$/);

  for (const [name, mutate, message] of [
    ['four-paths', value => value.goalShape.allowedPaths.push('docs/extra.md', 'docs/fourth.md'), /at most 3 allowed paths/],
    ['three-items', value => { value.assurance.workItems = 3; }, /1-2 work items/],
    ['forged-provenance', value => { value.assurance.issuedBy = 'Qplan'; }, /exact version 1 request shape/],
    ['unresolved', value => { value.assurance.materialDecisionsResolved = false; }, /resolved material decisions/],
    ['risk', value => { value.riskAssessment = { categories: ['security'], rationale: 'Security boundary.' }; value.humanAcceptance.required = true; }, /risk category none/],
    ['hidden-risk-path', value => { value.goalShape.allowedPaths = ['scripts/deploy.mjs']; }, /omits detected Goal risk: deployment/],
  ]) {
    const isolated = makeProject(`${SLUG}-${name}`);
    initializeGit(isolated);
    createGoals(isolated, `${SLUG}-${name}`, ['Micro::change runtime behavior']);
    const candidate = structuredClone(bounded);
    mutate(candidate);
    assert.throws(() => setGoalAcceptance(isolated, `${SLUG}-${name}`, {
      goalId: 'G001', file: writeJson(isolated, `${name}.json`, candidate),
    }), message);
    rmSync(isolated, { recursive: true, force: true });
  }
  rmSync(cwd, { recursive: true, force: true });
});

// Controller-bound queue, completion, immutable evidence, distinct-session,
// alignment, and derived-state coverage lives in
// lifecycle-plan-goal-adapter.test.mjs. Those cases were removed here when
// advanceGoal became canonical-root-only; retaining legacy temp-root copies
// would test an intentionally unsupported transition path.

test('acceptance requires a verbatim Goal objective, user journey, and risk-based human acceptance', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['Deploy::Deploy payment authentication migration']);
  const invalid = acceptance('G001', false, 'A conveniently narrower objective');
  invalid.scenarios[0].kind = 'unit-test';
  assert.throws(() => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'invalid-contract.json', invalid) }), /user-journey/);
  invalid.scenarios[0].kind = 'user-journey';
  assert.throws(() => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'misaligned-contract.json', invalid) }), /preserve the Goal objective/);
  const risky = acceptance('G001', false, 'Deploy payment authentication migration');
  risky.riskAssessment = { categories: ['payment'], rationale: 'Payment changes are high impact.' };
  assert.throws(() => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'underclassified-contract.json', risky) }), /omits detected Goal risk/);
  risky.riskAssessment = { categories: ['payment', 'authentication', 'deployment', 'data-migration'], rationale: 'The Goal changes payment, authentication, deployment, and data migration paths.' };
  assert.throws(() => setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'missing-human-contract.json', risky) }), /humanAcceptance/);
  risky.humanAcceptance.required = true;
  assert.equal(setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: writeJson(cwd, 'risky-contract.json', risky) }).acceptance.status, 'defined');
  rmSync(cwd, { recursive: true, force: true });
});

test('atomicity: no leftover .tmp files after writes', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
  renderState(cwd, SLUG);
  const dir = path.join(cwd, '.qe', 'planning', 'plans', SLUG);
  assert.ok(!readdirSync(dir).some(f => f.endsWith('.tmp')));
  rmSync(cwd, { recursive: true, force: true });
});

test('two slugs do not collide', () => {
  const cwd = makeProject('alpha');
  mkdirSync(path.join(cwd, '.qe', 'planning', 'plans', 'beta'), { recursive: true });
  createGoals(cwd, 'alpha', ['A::a']);
  createGoals(cwd, 'beta', ['B::b', 'C::c']);
  assert.equal(readGoals(cwd, 'alpha').goals.length, 1);
  assert.equal(readGoals(cwd, 'beta').goals.length, 2);
  rmSync(cwd, { recursive: true, force: true });
});

test('status uses bounded tail read on a large ledger', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  for (let i = 0; i < 1000; i++) recordEvent(cwd, SLUG, { ts: 'x', event: 'checkpoint', goalId: 'G001', status: 'active', evidence: 'e'.repeat(50), attempt: i });
  const recent = tailLedger(cwd, SLUG, 3);
  assert.equal(recent.length, 3); // only last lines parsed, not all 1001
  const s = status(cwd, SLUG);
  assert.equal(s.total, 1);
  assert.equal(s.recent.length, 3);
  rmSync(cwd, { recursive: true, force: true });
});

test('bounded tail read survives multi-byte UTF-8 past the 8KB window', () => {
  const cwd = makeProject();
  createGoals(cwd, SLUG, ['A::a']);
  // Korean evidence (3 bytes/char) so the >8KB tail window can split a codepoint.
  for (let i = 0; i < 300; i++) {
    recordEvent(cwd, SLUG, { ts: 'x', event: 'checkpoint', goalId: 'G001', status: 'active', evidence: `한글증거${i}`.repeat(8), attempt: i });
  }
  const recent = tailLedger(cwd, SLUG, 3);
  assert.equal(recent.length, 3);
  // every returned line parsed cleanly and kept intact Korean (no U+FFFD)
  for (const ev of recent) {
    assert.match(ev.evidence, /한글증거/);
    assert.doesNotMatch(ev.evidence, /�/);
  }
  assert.equal(recent[2].attempt, 299); // newest event preserved, not dropped
  rmSync(cwd, { recursive: true, force: true });
});

test('render-state replaces the progress block idempotently', () => {
  const cwd = makeProject();
  const sp = path.join(cwd, '.qe', 'planning', 'plans', SLUG, 'STATE.md');
  writeFileSync(sp, '# STATE\n\n## Phase Progress\n\nold\n\n## Notes\nkeep me\n');
  createGoals(cwd, SLUG, ['A::a']);
  renderState(cwd, SLUG);
  renderState(cwd, SLUG); // twice → no duplication
  const out = readFileSync(sp, 'utf8');
  assert.equal(out.match(/## Phase Progress/g).length, 1);
  assert.match(out, /G001/);
  assert.match(out, /## Notes\nkeep me/); // trailing section preserved
  assert.doesNotMatch(out, /\nold\n/);
  rmSync(cwd, { recursive: true, force: true });
});

test('Qplan SKILL.md stays within line budget (baseline 240 + 15 = 255)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..', '..');
  const skill = path.join(repoRoot, 'skills', 'Qplan', 'SKILL.md');
  const lines = readFileSync(skill, 'utf8').split('\n').length;
  assert.ok(lines <= 255, `Qplan/SKILL.md is ${lines} lines, budget is 255`);
});

test('runTraceCli returns the expected exit codes and diagnostics for trace report statuses', () => {
  const cases = [
    { status: 'complete', exit: 0 },
    { status: 'incomplete', exit: 3 },
    { status: 'invalid', exit: 4 },
  ];

  for (const { status, exit } of cases) {
    const stdout = [];
    const stderr = [];
    const observedExit = ledgerModule.runTraceCli(
      ['--slug', SLUG, '--goal-id', 'G001', '--cwd', '/tmp/project'],
      {
        traceGoal: () => makeCliReport(status),
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      },
    );

    assert.equal(observedExit, exit);
    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 0);
    assert.equal(JSON.parse(stdout[0]).status, status);
  }
});

test('runTraceCli exits 2 for malformed flag sets and 1 for traceGoal failures', () => {
  const usageCases = [
    ['--goal-id', 'G001', '--goal-id', 'G002'],
    ['--slug', SLUG],
    ['--goal-id', 'G001', '--unknown', 'x'],
    ['--goal-id', 'G001', '--cwd'],
  ];

  for (const argv of usageCases) {
    const stdout = [];
    const stderr = [];
    const exit = ledgerModule.runTraceCli(argv, {
      traceGoal: () => makeCliReport('complete'),
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });
    assert.equal(exit, 2);
    assert.equal(stdout.length, 0);
    assert.equal(stderr.length, 1);
    assert.equal(stderr[0], 'ledger trace: usage\n');
  }

  const failureStdout = [];
  const failureStderr = [];
  const failureExit = ledgerModule.runTraceCli(
    ['--slug', SLUG, '--goal-id', 'G001', '--cwd', '/tmp/project'],
    {
      traceGoal: () => {
        throw new Error('boom');
      },
      stdout: (value) => failureStdout.push(value),
      stderr: (value) => failureStderr.push(value),
    },
  );

  assert.equal(failureExit, 1);
  assert.equal(failureStdout.length, 0);
  assert.equal(failureStderr.length, 1);
  assert.equal(failureStderr[0], 'ledger trace: trace query failed\n');
});

test('runTraceCli rejects incoherent reports and serializer substitution without stdout', () => {
  const malformed = makeCliReport('complete');
  malformed.summary.totalItems = 99;
  const malformedOut = [];
  const malformedErr = [];
  assert.equal(ledgerModule.runTraceCli(
    ['--slug', SLUG, '--goal-id', 'G001', '--cwd', '/tmp/project'],
    { traceGoal: () => malformed, stdout: value => malformedOut.push(value), stderr: value => malformedErr.push(value) },
  ), 1);
  assert.deepEqual(malformedOut, []);
  assert.deepEqual(malformedErr, ['ledger trace: invalid trace report\n']);

  for (const forge of [
    report => { report.items[0].implementation.verifier = 'forged reviewer'; },
    report => { report.items[1].scenarioIds = ['S001']; },
  ]) {
    const forged = makeCliReport('complete');
    forge(forged);
    const out = [];
    const err = [];
    assert.equal(ledgerModule.runTraceCli(
      ['--slug', SLUG, '--goal-id', 'G001', '--cwd', '/tmp/project'],
      { traceGoal: () => forged, stdout: value => out.push(value), stderr: value => err.push(value) },
    ), 1);
    assert.deepEqual(out, []);
    assert.deepEqual(err, ['ledger trace: invalid trace report\n']);
  }

  const serializerOut = [];
  const serializerErr = [];
  assert.equal(ledgerModule.runTraceCli(
    ['--slug', SLUG, '--goal-id', 'G001', '--cwd', '/tmp/project'],
    {
      traceGoal: () => makeCliReport('complete'),
      stringify: () => '{}',
      stdout: value => serializerOut.push(value),
      stderr: value => serializerErr.push(value),
    },
  ), 1);
  assert.deepEqual(serializerOut, []);
  assert.deepEqual(serializerErr, ['ledger trace: trace serialization failed\n']);
});
