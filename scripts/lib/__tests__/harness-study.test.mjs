import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as harness from '../harness-pilot.mjs';
import * as runner from '../../run-harness-pilot.mjs';
import { verifyPilotOutput } from '../../verify-harness-pilot.mjs';
import { evaluateHarness } from '../../evaluate-harness.mjs';

const CONDITIONS = [
  'native-ephemeral',
  'native-durable',
  'full-sivs-ephemeral',
  'full-sivs-durable',
];
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function task(index) {
  const id = `study-task-${String(index).padStart(2, '0')}`;
  return {
    id,
    category: 'micro-fix',
    prompt: `Update ${id}.`,
    starterFiles: { 'input.txt': `${id}\n` },
    hiddenAcceptance: { command: 'node hidden-check.mjs' },
  };
}

function fixture({ taskCount = 20, repetition = 3, seed = 'study-seed-v1' } = {}) {
  return {
    schema: 1,
    seed,
    model: 'gpt-5.4-mini',
    effort: 'medium',
    repetition,
    budget: {
      maxInputTokens: 1000,
      maxOutputTokens: 100,
      maxWallSeconds: 10,
      maxBudgetUsd: 1,
    },
    tasks: Array.from({ length: taskCount }, (_, index) => task(index + 1)),
  };
}

function canonicalDigest(value) {
  const canonical = JSON.stringify(value, (_, item) => item && typeof item === 'object'
    && !Array.isArray(item) ? Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right))) : item);
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function outputHash(value = '') {
  return createHash('sha256').update(value).digest('hex');
}

function json(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function claimFor(fixtureValue = fixture()) {
  return runner.createPilotExecuteClaim({
    fixture: fixtureValue,
    invocationId: '44444444-4444-4444-8444-444444444444',
    revision: 'c'.repeat(40),
    createdAt: '2026-08-11T00:00:00.000Z',
    smokeAttemptIds: ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'],
  });
}

function authorityFor(fixtureValue, claim = claimFor(fixtureValue)) {
  return { fixture: fixtureValue, expectedFixtureDigest: claim.fixtureDigest };
}

function syntheticRawRun(claim, entry) {
  return {
    ...entry,
    model: claim.scheduleManifest.model,
    effort: claim.scheduleManifest.effort,
    revision: claim.revision,
    promptDigest: '7'.repeat(64),
    actor: actorResult(entry.condition),
    hiddenAcceptance: { passed: true, exitCode: 0, signal: null, outputHash: outputHash() },
    verdict: { valid: true, success: true, reasons: [] },
  };
}

function writeCell(root, claim, schedule, index, status = 'completed') {
  const directory = join(root, '.pilot-execute-cells', String(index).padStart(3, '0'));
  mkdirSync(directory, { recursive: true });
  const entry = schedule[index];
  const cell = harness.createPilotCell({ ...entry,
    model: claim.scheduleManifest.model, effort: claim.scheduleManifest.effort }, claim.budget);
  const cellIdentity = harness.pilotCellIdentity(cell);
  json(join(directory, 'started.json'), {
    schema: 2, kind: 'cell-started', invocationId: claim.invocationId,
    revision: claim.revision, at: '2026-08-11T00:00:01.000Z', index, cell, cellIdentity,
  });
  const terminal = {
    schema: 2, kind: 'cell-terminal', invocationId: claim.invocationId,
    revision: claim.revision, at: '2026-08-11T00:00:02.000Z', index, cell, cellIdentity,
    status,
    run: status === 'completed' ? syntheticRawRun(claim, entry) : null,
  };
  if (status === 'failed') {
    terminal.evidence = null;
    terminal.error = { code: 'SYNTHETIC_FAILURE', message: 'synthetic failure' };
  }
  json(join(directory, 'terminal.json'), terminal);
  return directory;
}

function writeGeneration(root, claim, schedule) {
  const generation = 'study-generation';
  const generationRoot = join(root, 'generations', generation);
  mkdirSync(generationRoot, { recursive: true });
  const rawRuns = schedule.map(entry => syntheticRawRun(claim, entry));
  const dataset = {
    schema: 1,
    budget: claim.budget,
    runs: rawRuns.map(run => ({ taskId: run.taskId, repetition: run.repetition,
      condition: run.condition, result: { success: true, escapedDefects: 0,
        humanCorrections: 0, inputTokens: 1, outputTokens: 1, wallSeconds: 0.001 } })),
  };
  const files = {
    'runtime.json': `${JSON.stringify({ schema: 1, mode: 'execute', revision: claim.revision,
      budget: claim.budget, smokeAttemptIds: claim.smokeAttemptIds })}\n`,
    'results.json': `${JSON.stringify({ ...dataset, rawRuns })}\n`,
    'report.json': `${JSON.stringify(evaluateHarness(dataset))}\n`,
    'RUN.md': `# Synthetic study run\n\n- Balanced task/repetition pairs: 60\n- Runs: 240\n\n> Study run: 3 repetitions per task; interpret results with the preregistered limitations.\n`,
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(generationRoot, name), content);
  const hashes = Object.fromEntries(Object.entries(files)
    .map(([name, content]) => [name, outputHash(content)]));
  const manifestText = `${JSON.stringify({ schema: 1, generation, revision: claim.revision,
    files: hashes })}\n`;
  writeFileSync(join(generationRoot, 'manifest.json'), manifestText);
  const manifestHash = outputHash(manifestText);
  json(join(root, 'current.json'), { schema: 1, generation, revision: claim.revision, manifestHash });
  return { generation, manifestHash };
}

function rebindGeneration(root, terminal, changedFile) {
  const generationRoot = join(root, 'generations', terminal.generation);
  const manifestPath = join(generationRoot, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files[changedFile] = outputHash(readFileSync(join(generationRoot, changedFile)));
  const manifestText = `${JSON.stringify(manifest)}\n`;
  writeFileSync(manifestPath, manifestText);
  const manifestHash = outputHash(manifestText);
  json(join(root, 'current.json'), { schema: 1, generation: terminal.generation,
    revision: terminal.revision, manifestHash });
  const rebound = { ...terminal, manifestHash };
  json(join(root, '.pilot-execute-terminal.json'), rebound);
  return rebound;
}

function writeIncompleteGeneration(root, claim) {
  const generation = 'incomplete-generation';
  const generationRoot = join(root, 'generations', generation);
  mkdirSync(generationRoot, { recursive: true });
  const report = '{"ok":true}\n';
  writeFileSync(join(generationRoot, 'report.json'), report);
  const manifestText = `${JSON.stringify({ schema: 1, generation, revision: claim.revision,
    files: { 'report.json': outputHash(report) } })}\n`;
  writeFileSync(join(generationRoot, 'manifest.json'), manifestText);
  const manifestHash = outputHash(manifestText);
  json(join(root, 'current.json'), { schema: 1, generation, revision: claim.revision, manifestHash });
  return { generation, manifestHash };
}

function actorResult(condition) {
  return {
    ok: true,
    modelTurn: true,
    inputTokens: 1,
    outputTokens: 1,
    wallSeconds: 0.001,
    timedOut: false,
    bufferExceeded: false,
    controller: condition.endsWith('-ephemeral') ? null : {
      activeCode: 'ALLOWED',
      admissionCode: 'ADMITTED',
      admitted: true,
      auditDigest: 'a'.repeat(64),
      initializeCode: 'INITIALIZED',
      processId: 'study-controller',
      terminalCode: 'ALLOWED',
    },
  };
}

test('accepts only the closed 5x1 and 20x3 profiles and builds 240 unique cells', () => {
  const study = harness.validatePilotFixture(fixture());
  const schedule = harness.buildPilotSchedule(study);
  assert.equal(schedule.length, 240);
  assert.equal(new Set(schedule.map(cell => `${cell.taskId}:${cell.repetition}:${cell.condition}`)).size, 240);
  for (const taskValue of study.tasks) {
    for (const repetition of [1, 2, 3]) {
      assert.deepEqual(schedule.filter(cell => cell.taskId === taskValue.id && cell.repetition === repetition)
        .map(cell => cell.condition).sort(), [...CONDITIONS].sort());
    }
  }
  for (const invalid of [
    fixture({ taskCount: 5, repetition: 3 }),
    fixture({ taskCount: 20, repetition: 1 }),
    fixture({ taskCount: 20, repetition: 0 }),
    fixture({ taskCount: 20, repetition: 2.5 }),
  ]) assert.throws(() => harness.validatePilotFixture(invalid), TypeError);
  const duplicate = fixture();
  duplicate.tasks[1].id = duplicate.tasks[0].id;
  assert.throws(() => harness.validatePilotFixture(duplicate), TypeError);
});

test('preserves the preregistered pilot schedule digest', () => {
  const pilot = JSON.parse(readFileSync(new URL('../../fixtures/harness-pilot.json', import.meta.url), 'utf8'));
  const schedule = harness.buildPilotSchedule(pilot);
  assert.equal(schedule.length, 20);
  assert.equal(canonicalDigest(schedule.map((entry, index) => ({ index, ...entry }))),
    '15c8c3059f21d5a3b22b855c4ed199f3e55c52ebe3e040454255d65674ae6819');
});

test('selects the first durable smoke cell even when schedule index zero is not durable', () => {
  assert.equal(typeof harness.selectPilotSmokeCell, 'function');
  let selectedFixture;
  for (let index = 0; index < 100; index += 1) {
    const candidate = fixture({ seed: `non-durable-first-${index}` });
    if (harness.buildPilotSchedule(candidate)[0].condition !== 'full-sivs-durable') {
      selectedFixture = candidate;
      break;
    }
  }
  assert.ok(selectedFixture);
  const selected = harness.selectPilotSmokeCell(selectedFixture);
  assert.equal(selected.condition, 'full-sivs-durable');
  assert.deepEqual(selected, harness.buildPilotSchedule(selectedFixture)
    .find(cell => cell.condition === 'full-sivs-durable'));
});

test('runs the selected durable smoke index instead of implicitly running index zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-smoke-index-'));
  try {
    let selectedFixture;
    for (let index = 0; index < 100; index += 1) {
      const candidate = fixture({ seed: `non-durable-smoke-${index}` });
      if (harness.buildPilotSchedule(candidate)[0].condition !== 'full-sivs-durable') {
        selectedFixture = candidate;
        break;
      }
    }
    const schedule = harness.buildPilotSchedule(selectedFixture);
    const selectedIndex = schedule.findIndex(cell => cell.condition === 'full-sivs-durable');
    const output = await harness.runPilot(selectedFixture, {
      root,
      revision: 'd'.repeat(40),
      cellIndexes: [selectedIndex],
      actor: async request => {
        assert.equal(request.condition, 'full-sivs-durable');
        return actorResult(request.condition);
      },
      scorer: async () => ({ passed: true, exitCode: 0, signal: null, outputHash: outputHash() }),
    });
    assert.equal(output.rawRuns.length, 1);
    assert.equal(output.rawRuns[0].condition, 'full-sivs-durable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isolates all 240 workspaces under concurrency four', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-workspaces-'));
  const workspaces = [];
  try {
    const result = await harness.runPilot(fixture(), {
      root,
      revision: 'a'.repeat(40),
      concurrency: 4,
      actor: async request => {
        workspaces.push(request.workspace);
        assert.equal(readFileSync(join(request.workspace, 'input.txt'), 'utf8'), `${request.taskId}\n`);
        await new Promise(resolve => setTimeout(resolve, 1));
        return actorResult(request.condition);
      },
      scorer: async () => ({ passed: true, exitCode: 0, signal: null, outputHash: outputHash() }),
    });
    assert.equal(result.dataset.runs.length, 240);
    assert.equal(new Set(workspaces).size, 240);
    assert.ok(workspaces.every(path => !existsSync(path)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a pre-populated canonical cell root before invoking the actor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-prepopulated-'));
  let actorCalls = 0;
  try {
    const fixtureValue = fixture();
    const first = harness.buildPilotSchedule(fixtureValue)[0];
    const cellRoot = join(root,
      `000-${first.taskId}-r${first.repetition}-${first.condition}`);
    mkdirSync(cellRoot);
    writeFileSync(join(cellRoot, 'injected.txt'), 'must not reach actor');
    await assert.rejects(() => harness.runPilot(fixtureValue, {
      root,
      revision: 'e'.repeat(40),
      cellIndexes: [0],
      actor: async request => {
        actorCalls += 1;
        return actorResult(request.condition);
      },
      scorer: async () => ({ passed: true, exitCode: 0, signal: null, outputHash: outputHash() }),
    }), /workspace root already exists/);
    assert.equal(actorCalls, 0);
    assert.equal(readFileSync(join(cellRoot, 'injected.txt'), 'utf8'), 'must not reach actor');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drops large patches and bounds model result text before retaining run evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-bounded-run-'));
  try {
    const output = await harness.runPilot(fixture(), {
      root,
      revision: 'f'.repeat(40),
      cellIndexes: [0],
      actor: async request => ({
        ...actorResult(request.condition),
        result: 'r'.repeat(4 * 1024 * 1024),
        patch: 'p'.repeat(2 * 1024 * 1024),
      }),
      scorer: async () => ({ passed: true, exitCode: 0, signal: null, outputHash: outputHash() }),
    });
    assert.equal('patch' in output.rawRuns[0].actor, false);
    assert.equal(output.rawRuns[0].actor.result.length, 8192);
    assert.match(output.rawRuns[0].actor.resultDigest, /^[0-9a-f]{64}$/);
    assert.match(output.rawRuns[0].actor.patchHash, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('creates a schema 2 claim with a full schedule manifest', () => {
  assert.equal(typeof runner.createPilotExecuteClaim, 'function');
  const claim = runner.createPilotExecuteClaim({
    fixture: fixture(),
    invocationId: '11111111-1111-4111-8111-111111111111',
    revision: 'b'.repeat(40),
    createdAt: '2026-08-11T00:00:00.000Z',
    smokeAttemptIds: [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ],
  });
  assert.equal(claim.schema, 2);
  assert.equal(claim.expectedCellCount, 240);
  assert.deepEqual(Object.keys(claim.scheduleManifest).sort(), [
    'budgetDigest', 'conditions', 'effort', 'model', 'orderedTaskIds', 'repetition', 'schema', 'seed',
  ]);
  assert.equal(claim.scheduleManifest.orderedTaskIds.length, 20);
  assert.equal(claim.scheduleManifest.repetition, 3);
  assert.equal(claim.scheduleManifest.model, fixture().model);
  assert.match(claim.scheduleManifest.budgetDigest, /^[0-9a-f]{64}$/);
  assert.equal(claim.fixtureDigest, '139c388aa84c1004de38e4e8d8e14b11addd82b5be713c0269222cb3be4373d6');
  assert.equal(claim.scheduleDigest, 'f217a81d6bf38563ce7527b52f8615e5708d37bb69ef2a941a2d799bf600af15');
  assert.equal(claim.scheduleManifest.budgetDigest,
    '05c3d0f4d0a0e1604a208308a8ef37e7e4802e0492dd81414f4837fb392bfd3a');
});

test('schema 2 verifier requires a trusted fixture binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-unbound-'));
  try {
    const claim = claimFor();
    writeFileSync(join(root, '.pilot-execute-claim.json'), `${JSON.stringify(claim)}\n`);
    const nonterminal = verifyPilotOutput(root);
    assert.equal(nonterminal.classification, 'nonterminal', nonterminal.reason);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('independently verifies all 240 schema 2 cells and rejects identity substitution', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-success-'));
  try {
    const fixtureValue = fixture();
    const claim = claimFor(fixtureValue);
    const schedule = harness.buildPilotSchedule(fixtureValue);
    json(join(root, '.pilot-execute-claim.json'), claim);
    for (let index = 0; index < schedule.length; index += 1) writeCell(root, claim, schedule, index);
    const published = writeGeneration(root, claim, schedule);
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 2, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z', claimDigest: canonicalDigest(claim),
      completedIndexes: schedule.map((_, index) => index), failedIndexes: [], unstartedIndexes: [],
      ...published,
    });
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'unbound');
    assert.equal(verifyPilotOutput(root, { fixture: fixtureValue }).classification, 'unbound');
    const success = verifyPilotOutput(root, authorityFor(fixtureValue, claim));
    assert.equal(success.classification, 'succeeded', success.reason);

    const substitutedFixture = structuredClone(fixtureValue);
    substitutedFixture.tasks[0].prompt += ' substituted';
    assert.equal(verifyPilotOutput(root, {
      fixture: substitutedFixture, expectedFixtureDigest: claim.fixtureDigest,
    }).classification, 'corrupt');

    const target = join(root, '.pilot-execute-cells', '001', 'terminal.json');
    const changed = JSON.parse(readFileSync(target, 'utf8'));
    changed.cell.repetition = changed.cell.repetition === 3 ? 2 : changed.cell.repetition + 1;
    json(target, changed);
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a substituted manifest that copies the trusted fixture digest label', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-substituted-manifest-'));
  try {
    const trustedFixture = fixture();
    const trustedClaim = claimFor(trustedFixture);
    const substitutedFixture = fixture({ seed: 'substituted-study-seed' });
    const claim = claimFor(substitutedFixture);
    claim.fixtureDigest = trustedClaim.fixtureDigest;
    const schedule = harness.buildPilotSchedule(substitutedFixture);
    json(join(root, '.pilot-execute-claim.json'), claim);
    for (let index = 0; index < schedule.length; index += 1) writeCell(root, claim, schedule, index);
    const published = writeGeneration(root, claim, schedule);
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 2, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z', claimDigest: canonicalDigest(claim),
      completedIndexes: schedule.map((_, index) => index), failedIndexes: [], unstartedIndexes: [],
      ...published,
    });
    assert.equal(verifyPilotOutput(root, {
      fixture: trustedFixture, expectedFixtureDigest: trustedClaim.fixtureDigest,
    }).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects schema 2 evidence relabeled as legacy schema 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-schema-downgrade-'));
  try {
    const fixtureValue = fixture({ taskCount: 5, repetition: 1 });
    const claim = claimFor(fixtureValue);
    const schedule = harness.buildPilotSchedule(fixtureValue);
    const relabeledClaim = { ...claim, schema: 1 };
    delete relabeledClaim.expectedCellCount;
    delete relabeledClaim.scheduleManifest;
    json(join(root, '.pilot-execute-claim.json'), relabeledClaim);
    for (let index = 0; index < schedule.length; index += 1) {
      writeCell(root, claim, schedule, index);
      const directory = join(root, '.pilot-execute-cells', String(index).padStart(3, '0'));
      for (const name of ['started.json', 'terminal.json']) {
        const path = join(directory, name);
        const evidence = JSON.parse(readFileSync(path, 'utf8'));
        delete evidence.cellIdentity;
        evidence.cell = {
          taskId: evidence.cell.taskId,
          repetition: evidence.cell.repetition,
          condition: evidence.cell.condition,
        };
        json(path, evidence);
      }
    }
    const published = writeGeneration(root, claim, schedule);
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 1, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z',
      claimDigest: canonicalDigest(relabeledClaim),
      completedIndexes: schedule.map((_, index) => index), failedIndexes: [], unstartedIndexes: [],
      ...published,
    });
    assert.equal(verifyPilotOutput(root, authorityFor(fixtureValue, claim)).classification, 'corrupt');
    assert.equal(verifyPilotOutput(root).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing or mismatched execute authority before claim and actor launch', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'qe-harness-study-authority-preflight-'));
  let lock;
  try {
    const git = args => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    writeFileSync(join(repoRoot, 'tracked.txt'), 'authority preflight\n');
    assert.equal(git(['init', '-q']).status, 0);
    assert.equal(git(['config', 'user.name', 'QE Harness']).status, 0);
    assert.equal(git(['config', 'user.email', 'qe-harness@example.invalid']).status, 0);
    assert.equal(git(['add', 'tracked.txt']).status, 0);
    assert.equal(git(['commit', '-q', '-m', 'authority']).status, 0);
    const revision = git(['rev-parse', 'HEAD']).stdout.trim();
    const fixtureValue = fixture();
    const claim = claimFor(fixtureValue);
    const outputIdentity = runner.preparePilotOutputRoot({ repoRoot });
    lock = runner.acquirePilotOutputLock(outputIdentity.path);
    let actorCalls = 0;
    for (const expectedFixtureDigest of [undefined, 'f'.repeat(64)]) {
      await assert.rejects(() => runner.runCapturedPilotOperation({
        mode: 'execute', repoRoot, fixture: fixtureValue, expectedFixtureDigest,
        revision, outputIdentity, lockAuthority: lock,
        actor: async () => { actorCalls += 1; }, scorer: async () => ({}),
        runPilotImpl: async () => { actorCalls += 1; },
      }), /PILOT_FIXTURE_AUTHORITY/);
      assert.equal(existsSync(join(outputIdentity.path, '.pilot-execute-claim.json')), false);
    }
    assert.equal(actorCalls, 0);
    const cli = spawnSync(process.execPath, ['scripts/run-harness-pilot.mjs', '--execute'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /PILOT_FIXTURE_AUTHORITY_REQUIRED/);
  } finally {
    lock?.release();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('rejects a schema 2 generation that omits required runtime, results, and summary files', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-incomplete-generation-'));
  try {
    const fixtureValue = fixture();
    const claim = claimFor(fixtureValue);
    const schedule = harness.buildPilotSchedule(fixtureValue);
    json(join(root, '.pilot-execute-claim.json'), claim);
    for (let index = 0; index < schedule.length; index += 1) writeCell(root, claim, schedule, index);
    const published = writeIncompleteGeneration(root, claim);
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 2, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z', claimDigest: canonicalDigest(claim),
      completedIndexes: schedule.map((_, index) => index), failedIndexes: [], unstartedIndexes: [],
      ...published,
    });
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects self-consistently rehashed dataset, report, and raw verdict corruption', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-semantic-corruption-'));
  try {
    const fixtureValue = fixture();
    const claim = claimFor(fixtureValue);
    const schedule = harness.buildPilotSchedule(fixtureValue);
    json(join(root, '.pilot-execute-claim.json'), claim);
    for (let index = 0; index < schedule.length; index += 1) writeCell(root, claim, schedule, index);
    const published = writeGeneration(root, claim, schedule);
    let terminal = {
      schema: 2, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z', claimDigest: canonicalDigest(claim),
      completedIndexes: schedule.map((_, index) => index), failedIndexes: [], unstartedIndexes: [],
      ...published,
    };
    json(join(root, '.pilot-execute-terminal.json'), terminal);

    const summaryPath = join(root, 'generations', published.generation, 'RUN.md');
    writeFileSync(summaryPath, readFileSync(summaryPath, 'utf8').replace(
      '> Study run: 3 repetitions per task; interpret results with the preregistered limitations.',
      '> Study run: 3 repetitions per task; actual run used one repetition.',
    ));
    terminal = rebindGeneration(root, terminal, 'RUN.md');
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');

    writeGeneration(root, claim, schedule);
    terminal = { ...terminal, ...published };
    json(join(root, '.pilot-execute-terminal.json'), terminal);
    writeFileSync(summaryPath, `${readFileSync(summaryPath, 'utf8')}\n- Runs: 1\n`);
    terminal = rebindGeneration(root, terminal, 'RUN.md');
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');

    writeGeneration(root, claim, schedule);
    terminal = { ...terminal, ...published };
    json(join(root, '.pilot-execute-terminal.json'), terminal);

    const resultsPath = join(root, 'generations', published.generation, 'results.json');
    const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
    results.runs[0].result.inputTokens = 999;
    json(resultsPath, results);
    terminal = rebindGeneration(root, terminal, 'results.json');
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');

    writeGeneration(root, claim, schedule);
    terminal = { ...terminal, ...published };
    json(join(root, '.pilot-execute-terminal.json'), terminal);
    const reportPath = join(root, 'generations', published.generation, 'report.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    report.balancedPairs = 1;
    json(reportPath, report);
    terminal = rebindGeneration(root, terminal, 'report.json');
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');

    writeGeneration(root, claim, schedule);
    terminal = { ...terminal, ...published };
    json(join(root, '.pilot-execute-terminal.json'), terminal);
    const rawResults = JSON.parse(readFileSync(resultsPath, 'utf8'));
    rawResults.rawRuns[0].actor.timedOut = true;
    json(resultsPath, rawResults);
    const cellTerminalPath = join(root, '.pilot-execute-cells', '000', 'terminal.json');
    const cellTerminal = JSON.parse(readFileSync(cellTerminalPath, 'utf8'));
    cellTerminal.run.actor.timedOut = true;
    json(cellTerminalPath, cellTerminal);
    terminal = rebindGeneration(root, terminal, 'results.json');
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifies coherent schema 2 failure evidence and rejects missing terminal evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-failed-'));
  try {
    const fixtureValue = fixture();
    const claim = claimFor(fixtureValue);
    const schedule = harness.buildPilotSchedule(fixtureValue);
    json(join(root, '.pilot-execute-claim.json'), claim);
    const cellRoot = writeCell(root, claim, schedule, 0, 'failed');
    json(join(root, '.pilot-execute-terminal.json'), {
      schema: 2, kind: 'execute-terminal', status: 'failed', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z', claimDigest: canonicalDigest(claim),
      completedIndexes: [], failedIndexes: [0],
      unstartedIndexes: Array.from({ length: 239 }, (_, index) => index + 1),
      error: { code: 'SYNTHETIC_FAILURE', message: 'synthetic failure' },
    });
    const failed = verifyPilotOutput(root);
    assert.equal(failed.classification, 'failed', failed.reason);

    const cellTerminalPath = join(cellRoot, 'terminal.json');
    const cellTerminal = JSON.parse(readFileSync(cellTerminalPath, 'utf8'));
    cellTerminal.evidence = {
      cell: schedule[0], model: claim.scheduleManifest.model,
      effort: claim.scheduleManifest.effort, revision: claim.revision,
      actor: actorResult(schedule[0].condition),
    };
    json(cellTerminalPath, cellTerminal);
    assert.equal(verifyPilotOutput(root).classification, 'failed');
    cellTerminal.evidence.extra = true;
    json(cellTerminalPath, cellTerminal);
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');

    rmSync(join(cellRoot, 'terminal.json'));
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects schema 2 extra keys and unsafe fixture files', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-fixture-input-'));
  try {
    const claim = claimFor();
    json(join(root, '.pilot-execute-claim.json'), { ...claim, extra: true });
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');

    json(join(root, '.pilot-execute-claim.json'), claim);
    const fixturePath = join(root, 'fixture.json');
    const linkPath = join(root, 'fixture-link.json');
    json(fixturePath, fixture());
    symlinkSync(fixturePath, linkPath);
    assert.equal(verifyPilotOutput(root, {
      fixturePath: linkPath, expectedFixtureDigest: claim.fixtureDigest,
    }).classification, 'nonterminal');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects symlinked cell and generation directories plus oversized generation artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-study-output-safety-'));
  try {
    const fixtureValue = fixture();
    const claim = claimFor(fixtureValue);
    const schedule = harness.buildPilotSchedule(fixtureValue);
    json(join(root, '.pilot-execute-claim.json'), claim);
    for (let index = 0; index < schedule.length; index += 1) writeCell(root, claim, schedule, index);
    const published = writeGeneration(root, claim, schedule);
    const terminalPath = join(root, '.pilot-execute-terminal.json');
    const terminal = {
      schema: 2, kind: 'execute-terminal', status: 'succeeded', invocationId: claim.invocationId,
      revision: claim.revision, at: '2026-08-11T00:00:03.000Z', claimDigest: canonicalDigest(claim),
      completedIndexes: schedule.map((_, index) => index), failedIndexes: [], unstartedIndexes: [],
      ...published,
    };
    json(terminalPath, terminal);
    assert.equal(verifyPilotOutput(root,
      authorityFor(fixtureValue, claim)).classification, 'succeeded');

    const fixturePath = join(root, 'fixture.json');
    const fixtureLinkPath = join(root, 'fixture-link.json');
    json(fixturePath, fixtureValue);
    const cli = spawnSync(process.execPath, [
      join(ROOT, 'scripts/verify-harness-pilot.mjs'), root,
      '--fixture', realpathSync(fixturePath), '--fixture-digest', claim.fixtureDigest,
    ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
    assert.equal(JSON.parse(cli.stdout).classification, 'succeeded');
    symlinkSync(fixturePath, fixtureLinkPath);
    assert.equal(verifyPilotOutput(root, {
      fixturePath: fixtureLinkPath, expectedFixtureDigest: claim.fixtureDigest,
    }).classification, 'corrupt');
    assert.equal(verifyPilotOutput(root, {
      fixture: fixtureValue, fixturePath, expectedFixtureDigest: claim.fixtureDigest,
    }).classification, 'corrupt');

    const cell = join(root, '.pilot-execute-cells', '000');
    const cellBackup = join(root, '.pilot-execute-cells', '000-real');
    renameSync(cell, cellBackup);
    symlinkSync(cellBackup, cell);
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
    rmSync(cell);
    renameSync(cellBackup, cell);

    const generation = join(root, 'generations', published.generation);
    const generationBackup = join(root, 'generations', `${published.generation}-real`);
    renameSync(generation, generationBackup);
    symlinkSync(generationBackup, generation);
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
    rmSync(generation);
    renameSync(generationBackup, generation);

    const summaryPath = join(generation, 'RUN.md');
    const oversized = Buffer.alloc(4 * 1024 * 1024 + 1, 0x61);
    writeFileSync(summaryPath, oversized);
    const manifestPath = join(generation, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files['RUN.md'] = outputHash(oversized);
    const manifestText = `${JSON.stringify(manifest)}\n`;
    writeFileSync(manifestPath, manifestText);
    const manifestHash = outputHash(manifestText);
    json(join(root, 'current.json'), { schema: 1, generation: published.generation,
      revision: claim.revision, manifestHash });
    json(terminalPath, { ...terminal, manifestHash });
    assert.equal(verifyPilotOutput(root,
      { expectedFixtureDigest: claim.fixtureDigest }).classification, 'corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
