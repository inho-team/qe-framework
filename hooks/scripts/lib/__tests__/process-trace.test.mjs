import { test } from 'node:test';
import assert from 'node:assert/strict';

let processTraceModule = null;
try {
  processTraceModule = await import('../process-trace.mjs');
} catch {
  // Red-phase safeguard: the suite fails through assertions, not import crashes.
}

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

function loadProcessTrace() {
  assert.equal(
    typeof processTraceModule?.buildProcessTrace,
    'function',
    'process-trace must export buildProcessTrace',
  );
  return processTraceModule.buildProcessTrace;
}

function runProcessTrace(input) {
  return loadProcessTrace()(input);
}

function makeGoal(overrides = {}) {
  return {
    id: 'G001',
    objective: 'Ship the happy path',
    acceptanceHash: HASH,
    ...overrides,
  };
}

function makeRequirement(overrides = {}) {
  return {
    id: 'R001',
    criterion: 'Requirement is satisfied',
    command: 'node ./scripts/requirement.mjs',
    ...overrides,
  };
}

function makeScenario(overrides = {}) {
  return {
    id: 'S001',
    kind: 'user-journey',
    scenario: 'A user completes the path',
    expected: 'The happy path is visible',
    command: 'node ./scripts/scenario.mjs',
    ...overrides,
  };
}

function makeTraceability(overrides = {}) {
  return {
    requirementId: 'R001',
    scenarioIds: ['S001'],
    ...overrides,
  };
}

function makeRun(command, overrides = {}) {
  return {
    command,
    passed: true,
    exitCode: 0,
    outputHash: HASH,
    ...overrides,
  };
}

function makeImplementationRun(overrides = {}) {
  return {
    schema: 1,
    goalId: 'G001',
    role: 'implementation',
    sessionId: UUID_A,
    contractHash: HASH,
    passed: true,
    runs: [
      makeRun('node ./scripts/requirement.mjs'),
      makeRun('node ./scripts/scenario.mjs'),
      makeRun('node ./scripts/regression.mjs'),
    ],
    ...overrides,
  };
}

function makeVerificationRun(overrides = {}) {
  return {
    schema: 1,
    goalId: 'G001',
    role: 'verification',
    verifier: 'fresh reviewer',
    sessionId: UUID_B,
    contractHash: HASH,
    passed: true,
    runs: [
      makeRun('node ./scripts/requirement.mjs'),
      makeRun('node ./scripts/scenario.mjs'),
      makeRun('node ./scripts/regression.mjs'),
    ],
    ...overrides,
  };
}

function makeCompletion(overrides = {}) {
  return {
    schema: 1,
    goalId: 'G001',
    requirements: [{ id: 'R001', outcome: 'pass', evidence: 'recorded evidence' }],
    scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'scenario evidence' }],
    regression: { outcome: 'pass', evidence: 'regression evidence' },
    independentVerification: {
      verifier: 'fresh reviewer',
      mode: 'machine-reexecution',
      outcome: 'pass',
      evidence: 'independent verification evidence',
    },
    goalAlignment: {
      objective: 'Ship the happy path',
      verifier: 'fresh reviewer',
      outcome: 'pass',
      evidence: 'goal alignment evidence',
    },
    ...overrides,
  };
}

function makeFixture(overrides = {}) {
  return {
    goal: makeGoal(),
    acceptanceHash: HASH,
    acceptance: {
      schema: 1,
      goalId: 'G001',
      requirements: [makeRequirement()],
      scenarios: [makeScenario()],
      regression: { scope: 'existing behavior', command: 'node ./scripts/regression.mjs' },
      traceability: [makeTraceability()],
    },
    implementationRun: makeImplementationRun(),
    verificationRun: makeVerificationRun(),
    completion: makeCompletion(),
    ...overrides,
  };
}

function assertInvalidTraceReport(result, code, kind = 'trace', id = '$global', action = 'repair-evidence') {
  assert.deepEqual(Reflect.ownKeys(result), [
    'schema',
    'authority',
    'authoritative',
    'goalId',
    'contractHash',
    'status',
    'traceComplete',
    'summary',
    'items',
    'regression',
    'independentVerification',
    'goalAlignment',
    'gaps',
    'nextActions',
  ]);
  assert.equal(result.schema, 1);
  assert.equal(result.authority, 'structural-only');
  assert.equal(result.authoritative, false);
  assert.equal(result.goalId, null);
  assert.equal(result.contractHash, null);
  assert.equal(result.status, 'invalid');
  assert.equal(result.traceComplete, false);
  assert.deepEqual(result.summary, { totalItems: 0, linkedItems: 0, gapCount: 1 });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.regression, {
    implementation: { status: 'not-evaluated', outputHash: null, sessionId: null, verifier: null },
    verification: { status: 'not-evaluated', outputHash: null, sessionId: null, verifier: null },
    verdict: { status: 'not-evaluated', evidencePresent: false },
    gaps: [],
  });
  assert.deepEqual(result.independentVerification, { status: 'not-evaluated', verifier: null, evidencePresent: false });
  assert.deepEqual(result.goalAlignment, {
    status: 'not-evaluated',
    verifier: null,
    evidencePresent: false,
    objectiveMatches: false,
  });
  assert.deepEqual(result.gaps, [{ code, kind, id, detail: code }]);
  assert.deepEqual(result.nextActions, [action]);
}

test('buildProcessTrace returns a canonical complete report for a valid synthetic fixture', () => {
  const result = runProcessTrace(makeFixture());

  assert.equal(result.schema, 1);
  assert.equal(result.authority, 'structural-only');
  assert.equal(result.authoritative, false);
  assert.equal(result.goalId, 'G001');
  assert.equal(result.contractHash, HASH);
  assert.equal(result.status, 'complete');
  assert.equal(result.traceComplete, true);
  assert.deepEqual(result.summary, { totalItems: 2, linkedItems: 2, gapCount: 0 });
  assert.deepEqual(result.nextActions, []);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].kind, 'requirement');
  assert.equal(result.items[0].relation.status, 'pass');
  assert.deepEqual(result.items[0].scenarioIds, ['S001']);
  assert.equal(result.items[0].implementation.status, 'pass');
  assert.equal(result.items[0].verification.status, 'pass');
  assert.equal(result.items[0].verdict.status, 'pass');
  assert.equal(result.items[1].kind, 'scenario');
  assert.equal(result.items[1].relation.status, 'pass');
  assert.deepEqual(result.items[1].requirementIds, ['R001']);
  assert.equal(result.items[1].implementation.status, 'pass');
  assert.equal(result.items[1].verification.status, 'pass');
  assert.equal(result.items[1].verdict.status, 'pass');
  assert.equal(result.regression.implementation.status, 'pass');
  assert.equal(result.regression.verification.status, 'pass');
  assert.equal(result.regression.verdict.status, 'pass');
  assert.equal(result.independentVerification.status, 'pass');
  assert.equal(result.goalAlignment.status, 'pass');
});

test('buildProcessTrace preserves the schema 2 single-outcome mapping', () => {
  const fixture = makeFixture();
  fixture.acceptance.schema = 2;
  fixture.acceptance.goalShape = { outcomes: [{ id: 'O001' }] };
  fixture.acceptance.requirements[0].outcomeId = 'O001';
  fixture.acceptance.scenarios[0].outcomeId = 'O001';
  fixture.acceptance.regression.outcomeId = 'O001';
  fixture.completion.goalAlignment.outcomeId = 'O001';
  assert.equal(runProcessTrace(fixture).status, 'complete');

  fixture.completion.goalAlignment.outcomeId = 'O999';
  assertInvalidTraceReport(runProcessTrace(fixture), 'GOAL_ALIGNMENT_MISMATCH',
    'trace', '$global', 'align-goal');
});

test('buildProcessTrace marks missing traceability as incomplete relation gaps', () => {
  const result = runProcessTrace(
    makeFixture({
      acceptance: {
        schema: 1,
        goalId: 'G001',
        requirements: [makeRequirement()],
        scenarios: [makeScenario()],
        regression: { scope: 'existing behavior', command: 'node ./scripts/regression.mjs' },
      },
    }),
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.traceComplete, false);
  assert.equal(result.summary.linkedItems, 0);
  assert.equal(result.summary.gapCount, 2);
  assert.equal(result.items[0].relation.status, 'missing');
  assert.ok(result.items[0].gaps.includes('MISSING_REQUIREMENT_SCENARIO_LINK'));
  assert.equal(result.items[1].relation.status, 'missing');
  assert.ok(result.items[1].gaps.includes('MISSING_REQUIREMENT_SCENARIO_LINK'));
  assert.ok(result.nextActions.includes('link-scenario'));
});

test('buildProcessTrace returns literal INVALID_INPUT when a passed bundle includes an unmatched extra run', () => {
  const result = runProcessTrace(
    makeFixture({
      implementationRun: makeImplementationRun({
        runs: [
          makeRun('node ./scripts/requirement.mjs'),
          makeRun('node ./scripts/scenario.mjs'),
          makeRun('node ./scripts/regression.mjs'),
          makeRun('node ./scripts/unmatched-extra.mjs', { passed: false, exitCode: 1 }),
        ],
      }),
    }),
  );

  assert.equal(result.status, 'invalid');
  assert.equal(result.traceComplete, false);
  assert.deepEqual(result.summary, { totalItems: 0, linkedItems: 0, gapCount: 1 });
  assertInvalidTraceReport(result, 'INVALID_INPUT');
});

test('buildProcessTrace keeps a required failed command as FAILED_*_COMMAND', () => {
  const result = runProcessTrace(
    makeFixture({
      implementationRun: makeImplementationRun({
        runs: [
          makeRun('node ./scripts/requirement.mjs', { passed: false, exitCode: 1 }),
          makeRun('node ./scripts/scenario.mjs'),
          makeRun('node ./scripts/regression.mjs'),
        ],
      }),
    }),
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.items[0].implementation.status, 'failed');
  assert.ok(result.items[0].gaps.includes('FAILED_IMPLEMENTATION_COMMAND'));
  assert.ok(!result.items[0].gaps.includes('FAILED_IMPLEMENTATION_BUNDLE'));
});

test('buildProcessTrace rejects hostile accessors and proxies with INVALID_INPUT without invoking the getter', () => {
  let getterHits = 0;
  const goal = {};
  Object.defineProperty(goal, 'id', {
    enumerable: true,
    get() {
      getterHits += 1;
      throw new Error('getter should not run');
    },
  });
  Object.defineProperty(goal, 'objective', { enumerable: true, value: 'Ship the happy path' });
  Object.defineProperty(goal, 'acceptanceHash', { enumerable: true, value: HASH });

  const result = runProcessTrace(
    new Proxy(
      {
        goal,
        acceptance: makeFixture().acceptance,
        implementationRun: makeImplementationRun(),
        verificationRun: makeVerificationRun(),
        completion: makeCompletion(),
      },
      {
        get(target, prop, receiver) {
          return Reflect.get(target, prop, receiver);
        },
      },
    ),
  );

  assert.equal(getterHits, 0);
  assertInvalidTraceReport(result, 'INVALID_INPUT');
});

test('buildProcessTrace returns INVALID_INPUT for a nested accessor and preserves the input object', () => {
  const pristine = makeFixture();
  const input = makeFixture();
  Object.defineProperty(input.completion.requirements[0], 'evidence', {
    enumerable: true,
    get() {
      throw new Error('getter should not run');
    },
  });

  const result = runProcessTrace(input);

  assertInvalidTraceReport(result, 'INVALID_INPUT');
  assert.deepEqual(
    {
      goal: input.goal,
      acceptance: input.acceptance,
      implementationRun: input.implementationRun,
      verificationRun: input.verificationRun,
    },
    {
      goal: pristine.goal,
      acceptance: pristine.acceptance,
      implementationRun: pristine.implementationRun,
      verificationRun: pristine.verificationRun,
    },
  );
});

test('buildProcessTrace rejects acceptance arrays above the bounded caps with the literal invalid skeleton', () => {
  const result = runProcessTrace(
    makeFixture({
      acceptance: {
        schema: 1,
        goalId: 'G001',
        requirements: [
          makeRequirement({ id: 'R001' }),
          makeRequirement({ id: 'R002', criterion: 'Requirement 2', command: 'node ./scripts/requirement-2.mjs' }),
          makeRequirement({ id: 'R003', criterion: 'Requirement 3', command: 'node ./scripts/requirement-3.mjs' }),
          makeRequirement({ id: 'R004', criterion: 'Requirement 4', command: 'node ./scripts/requirement-4.mjs' }),
        ],
        scenarios: [makeScenario()],
        regression: { scope: 'existing behavior', command: 'node ./scripts/regression.mjs' },
        traceability: [makeTraceability()],
      },
    }),
  );

  assertInvalidTraceReport(result, 'INVALID_INPUT');
});

test('buildProcessTrace reports INVALID_TRACEABILITY for unknown relation ids with the literal invalid skeleton', () => {
  const result = runProcessTrace(
    makeFixture({
      acceptance: {
        schema: 1,
        goalId: 'G001',
        requirements: [makeRequirement()],
        scenarios: [makeScenario()],
        regression: { scope: 'existing behavior', command: 'node ./scripts/regression.mjs' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S999'] }],
      },
    }),
  );

  assertInvalidTraceReport(result, 'INVALID_TRACEABILITY');
});

test('buildProcessTrace emits gaps in stable contract order when runs and verdicts are missing', () => {
  const result = runProcessTrace(
    makeFixture({
      implementationRun: undefined,
      verificationRun: undefined,
      completion: undefined,
    }),
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.traceComplete, false);
  assert.deepEqual(result.summary, { totalItems: 2, linkedItems: 0, gapCount: 11 });
  assert.deepEqual(
    result.gaps.map((gap) => [gap.code, gap.kind, gap.id]),
    [
      ['MISSING_IMPLEMENTATION_RUN', 'requirement', 'R001'],
      ['MISSING_VERIFICATION_RUN', 'requirement', 'R001'],
      ['MISSING_ITEM_VERDICT', 'requirement', 'R001'],
      ['MISSING_IMPLEMENTATION_RUN', 'scenario', 'S001'],
      ['MISSING_VERIFICATION_RUN', 'scenario', 'S001'],
      ['MISSING_ITEM_VERDICT', 'scenario', 'S001'],
      ['MISSING_IMPLEMENTATION_RUN', 'regression', '$regression'],
      ['MISSING_VERIFICATION_RUN', 'regression', '$regression'],
      ['MISSING_REGRESSION_VERDICT', 'regression', '$regression'],
      ['MISSING_INDEPENDENT_VERDICT', 'trace', '$global'],
      ['MISSING_GOAL_ALIGNMENT', 'trace', '$global'],
    ],
  );
  assert.deepEqual(result.nextActions, ['run-implementation', 'run-verification', 'record-verdict', 'align-goal']);
});
