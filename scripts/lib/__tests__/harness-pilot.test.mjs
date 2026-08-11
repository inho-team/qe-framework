import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as harnessPilot from '../harness-pilot.mjs';
import * as pilotCli from '../../run-harness-pilot.mjs';

import {
  CONDITIONS,
  buildClaudeArgs,
  buildCodexArgs,
  buildActorPrompt,
  buildPilotSchedule,
  classifyPilotRun,
  cloneBaselineRepository,
  deriveSmokeAdmission,
  loadPilotFixture,
  materializeTask,
  parseClaudeResult,
  parseCodexResult,
  projectPilotAttempts,
  runPilot,
  runBoundedProcess,
  scoreHiddenAcceptance,
  appendPilotAttemptEvent,
  validatePilotFixture,
} from '../harness-pilot.mjs';

const {
  createPilotAttemptContext,
  createPilotCell,
  createPilotRuntimeBudget,
  createPilotTerminalRun,
  pilotBudgetDigest,
  pilotCellIdentity,
} = harnessPilot;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function fixtureDigest(value) {
  const canonical = JSON.stringify(value, (_, item) => item && typeof item === 'object'
    && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function fixture() {
  return {
    schema: 1,
    seed: 'progressive-assurance-pilot-v1',
    model: 'sonnet',
    effort: 'medium',
    repetition: 1,
    budget: { maxInputTokens: 20000, maxOutputTokens: 8000, maxWallSeconds: 300, maxBudgetUsd: 0.5 },
    tasks: Array.from({ length: 5 }, (_, index) => ({
      id: `task-${index + 1}`,
      category: ['micro-fix', 'feature', 'debugging', 'security', 'integration'][index],
      prompt: `Implement task ${index + 1} and run the public test.`,
      starterFiles: {
        'package.json': '{"type":"module"}\n',
        'src/value.mjs': `export const value = ${index};\n`,
      },
      hiddenAcceptance: {
        command: "node --input-type=module -e \"process.exit(0)\"",
      },
    })),
  };
}

const REVISION = '0'.repeat(40);
const RUNTIME_BUDGET = Object.freeze({
  maxInputTokens: 20_000,
  maxOutputTokens: 8_000,
  maxWallSeconds: 300,
});

function pilotCell(condition = 'full-sivs-durable') {
  return createPilotCell({
    taskId: 'task-1', repetition: 1, condition, model: 'sonnet', effort: 'medium',
  }, RUNTIME_BUDGET);
}

function attemptId(sequence) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function startedEvent(sequence, cell = pilotCell()) {
  const id = attemptId(sequence);
  const workspaceId = `workspace-${id}`;
  const controllerProcessId = `pilot-${id}`;
  const context = createPilotAttemptContext({
    sequence, attemptId: id, revision: REVISION, cell, workspaceId, controllerProcessId,
  });
  return {
    kind: 'started', sequence, attemptId: id, revision: REVISION, cell,
    cellIdentity: context.cellIdentity, workspaceId, controllerProcessId,
    at: `2026-08-10T00:0${sequence}:00.000Z`, contextDigest: context.contextDigest,
  };
}

function durableRawRun({ cell = pilotCell(), controllerProcessId = 'pilot-task-1', ...overrides } = {}) {
  const base = {
    taskId: cell.taskId, repetition: cell.repetition, condition: cell.condition,
    model: cell.model, effort: cell.effort, revision: REVISION,
    actor: {
      ok: true, modelTurn: true, inputTokens: 20_000, outputTokens: 8_000,
      wallSeconds: 300, timedOut: false, bufferExceeded: false,
      controller: {
        admitted: true, admissionCode: 'ADMITTED', initializeCode: 'INITIALIZED', activeCode: 'ALLOWED',
        terminalCode: 'ALLOWED', processId: controllerProcessId, auditDigest: 'a'.repeat(64),
      },
    },
    hiddenAcceptance: { passed: true, exitCode: 0, signal: null, outputHash: 'b'.repeat(64) },
  };
  return {
    ...base,
    ...overrides,
    actor: { ...base.actor, ...(overrides.actor || {}) },
    hiddenAcceptance: overrides.hiddenAcceptance === null
      ? null
      : { ...base.hiddenAcceptance, ...(overrides.hiddenAcceptance || {}) },
  };
}

function terminalEvent(start, rawOverrides = {}) {
  const context = createPilotAttemptContext(start);
  const raw = durableRawRun({
    cell: start.cell, controllerProcessId: start.controllerProcessId, ...rawOverrides,
  });
  return {
    kind: 'terminal', sequence: start.sequence, attemptId: start.attemptId,
    contextDigest: start.contextDigest, at: start.at.replace(':00.000Z', ':10.000Z'),
    run: createPilotTerminalRun(raw, context),
  };
}

function history(events = []) {
  return { schema: 2, budget: { ...RUNTIME_BUDGET }, events };
}

function runHarnessPilotSnippet(source, { cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('derives golden canonical budget, cell, and attempt digests', () => {
  assert.deepEqual(createPilotRuntimeBudget(fixture().budget), RUNTIME_BUDGET);
  assert.equal(pilotBudgetDigest(RUNTIME_BUDGET),
    'c4ad47b0f673aaef7816a7690e0b789697f05ac817b53c34594a3e77d3831470');
  const cell = pilotCell();
  assert.equal(cell.budgetDigest,
    'c4ad47b0f673aaef7816a7690e0b789697f05ac817b53c34594a3e77d3831470');
  assert.equal(pilotCellIdentity(cell),
    '1fb487349f7f220d057f26f0d7683109718278bdd953266ac6b5ada5b65315b2');
  assert.equal(startedEvent(1).contextDigest,
    '53091272ae3ffe1cc928535914e52fbeb37cb35b20b295d104f4a4242a89b5f5');
  for (const malformed of [
    { ...RUNTIME_BUDGET, maxInputTokens: 0.5 },
    { ...RUNTIME_BUDGET, maxOutputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...RUNTIME_BUDGET, maxWallSeconds: Infinity },
    { ...RUNTIME_BUDGET, maxBudgetUsd: 0.5 },
  ]) assert.throws(() => pilotBudgetDigest(malformed), /budget/i);
});

test('classifies equality as valid, separates observed failure, and rejects malformed ceilings', () => {
  const budget = RUNTIME_BUDGET;
  assert.deepEqual(classifyPilotRun(durableRawRun(), budget), { valid: true, success: true, reasons: [] });
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { inputTokens: budget.maxInputTokens + 1 } }), budget),
    { valid: false, success: false, reasons: ['INPUT_TOKENS_EXCEEDED'] },
  );
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { outputTokens: budget.maxOutputTokens + 1 } }), budget),
    { valid: false, success: false, reasons: ['OUTPUT_TOKENS_EXCEEDED'] },
  );
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { wallSeconds: budget.maxWallSeconds + 0.001 } }), budget),
    { valid: false, success: false, reasons: ['WALL_SECONDS_EXCEEDED'] },
  );
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { ok: false } }), budget),
    { valid: true, success: false, reasons: ['ACTOR_FAILED'] },
  );
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ hiddenAcceptance: { passed: false, exitCode: 1 } }), budget),
    { valid: true, success: false, reasons: ['HIDDEN_ACCEPTANCE_FAILED'] },
  );
});

test('enforces the exact floating-point wall-time ceiling without tolerance', () => {
  const budget = { ...RUNTIME_BUDGET, maxWallSeconds: 600 };
  const view = new DataView(new ArrayBuffer(8));
  const adjacent = direction => {
    view.setFloat64(0, 600, false);
    let bits = view.getBigUint64(0, false);
    bits += direction;
    view.setBigUint64(0, bits, false);
    return view.getFloat64(0, false);
  };
  const below = adjacent(-1n);
  const above = adjacent(1n);
  assert.equal(classifyPilotRun(durableRawRun({ actor: { wallSeconds: below } }), budget).valid, true);
  assert.equal(classifyPilotRun(durableRawRun({ actor: { wallSeconds: 600 } }), budget).valid, true);
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { wallSeconds: above } }), budget).reasons,
    ['WALL_SECONDS_EXCEEDED'],
  );
  for (const wallSeconds of [below, 600]) {
    assert.ok(classifyPilotRun(durableRawRun({ actor: { wallSeconds, timedOut: true } }), budget)
      .reasons.includes('ACTOR_TIMED_OUT'));
  }
});

test('fails closed for malformed metrics, controller isolation, and hidden evidence', () => {
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { inputTokens: Number.NaN } }), RUNTIME_BUDGET),
    { valid: false, success: false, reasons: ['INVALID_INPUT_TOKENS'] },
  );
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ actor: { controller: null } }), RUNTIME_BUDGET),
    { valid: false, success: false, reasons: ['INVALID_CONTROLLER_EVIDENCE'] },
  );
  assert.deepEqual(
    classifyPilotRun(durableRawRun({ hiddenAcceptance: null }), RUNTIME_BUDGET),
    { valid: false, success: false, reasons: ['MISSING_HIDDEN_ACCEPTANCE'] },
  );
  const ephemeral = pilotCell('full-sivs-ephemeral');
  assert.equal(classifyPilotRun(durableRawRun({ cell: ephemeral }), RUNTIME_BUDGET).valid, false);
  assert.deepEqual(classifyPilotRun(durableRawRun({
    cell: ephemeral, actor: { controller: null },
  }), RUNTIME_BUDGET), { valid: true, success: true, reasons: [] });

  for (const actor of [
    { inputTokens: -1 }, { inputTokens: '20000' }, { outputTokens: Infinity },
    { wallSeconds: null }, { timedOut: true }, { timedOut: null },
    { bufferExceeded: true }, { bufferExceeded: undefined },
  ]) assert.equal(classifyPilotRun(durableRawRun({ actor }), RUNTIME_BUDGET).valid, false);

  for (const hiddenAcceptance of [
    { passed: 'true' },
    { passed: true, exitCode: 0, signal: null, outputHash: 'A'.repeat(64) },
    { passed: true, exitCode: 0, signal: null, outputHash: 'b'.repeat(64), extra: true },
    { passed: true, exitCode: 1, signal: null, outputHash: 'b'.repeat(64) },
    { passed: false, exitCode: null, signal: 'SIGTERM', outputHash: 'b'.repeat(64) },
    { passed: false, exitCode: null, signal: null, outputHash: 'b'.repeat(64) },
  ]) assert.equal(classifyPilotRun(durableRawRun({ hiddenAcceptance }), RUNTIME_BUDGET).valid, false);

  for (const controller of [
    { processId: '' },
    { auditDigest: 'A'.repeat(64) },
    { admissionCode: 'DENIED' },
    { unexpected: true },
  ]) assert.equal(classifyPilotRun(durableRawRun({ actor: {
    controller: { ...durableRawRun().actor.controller, ...controller },
  } }), RUNTIME_BUDGET).valid, false);
});

test('projects incomplete starts and admits only the last two bound Full-durable successes', () => {
  const cell = pilotCell();
  const starts = [startedEvent(1, cell), startedEvent(2, cell), startedEvent(3, cell)];
  let value = history();
  value = appendPilotAttemptEvent(value, starts[0]);
  value = appendPilotAttemptEvent(value, starts[1]);
  value = appendPilotAttemptEvent(value, terminalEvent(starts[1]));
  value = appendPilotAttemptEvent(value, starts[2]);
  value = appendPilotAttemptEvent(value, terminalEvent(starts[2]));

  const attempts = projectPilotAttempts(value, { cell, expectedBudget: RUNTIME_BUDGET });
  assert.deepEqual(attempts.map(attempt => [attempt.attemptId, attempt.status, attempt.verdict.success]), [
    [attemptId(1), 'interrupted', false],
    [attemptId(2), 'completed', true],
    [attemptId(3), 'completed', true],
  ]);
  assert.equal(deriveSmokeAdmission(value, {
    revision: REVISION, cell, expectedBudget: RUNTIME_BUDGET,
  }).admitted, true);
});

test('rejects history injection, budget substitution, malformed cells, and lifecycle grammar', () => {
  const cell = pilotCell();
  const start = startedEvent(1, cell);
  const terminal = terminalEvent(start);
  const valid = history([start, terminal]);
  assert.throws(() => projectPilotAttempts({ ...valid, admission: true }, {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /history/i);
  const larger = { ...RUNTIME_BUDGET, maxInputTokens: 99_999 };
  const largerCell = createPilotCell({ ...cell, budgetDigest: undefined }, larger);
  assert.throws(() => projectPilotAttempts({ ...valid, budget: larger }, {
    cell: largerCell, expectedBudget: RUNTIME_BUDGET,
  }), /budget|cell/i);
  for (const badCell of [
    { ...cell, taskId: '' }, { ...cell, repetition: 0 },
    { ...cell, repetition: 1.5 }, { ...cell, condition: 'unknown' },
    { ...cell, budgetDigest: 'A'.repeat(64) },
  ]) assert.throws(() => pilotCellIdentity(badCell), /cell/i);
  assert.throws(() => projectPilotAttempts(history([terminal]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /terminal|event/i);
  assert.throws(() => projectPilotAttempts(history([{ ...start, sequence: 2 }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /sequence|event/i);
  assert.throws(() => projectPilotAttempts(history([{ ...start, extra: true }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /event|started/i);
  assert.throws(() => projectPilotAttempts(history([start, terminal, terminal]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /terminal|event/i);

  const second = startedEvent(2, cell);
  assert.throws(() => projectPilotAttempts(history([start, second, terminal]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /terminal|event/i);
  assert.throws(() => projectPilotAttempts(history([start, { ...second, sequence: 3 }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /sequence|event/i);
  assert.throws(() => projectPilotAttempts(history([start, {
    ...second, attemptId: start.attemptId, workspaceId: start.workspaceId,
    controllerProcessId: start.controllerProcessId,
  }]), { cell, expectedBudget: RUNTIME_BUDGET }), /attempt|context/i);
  assert.throws(() => projectPilotAttempts(history([start, { ...terminal, unknown: true }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /terminal|event/i);
  const otherCell = createPilotCell({
    taskId: 'task-2', repetition: 1, condition: 'full-sivs-durable',
    model: 'sonnet', effort: 'medium',
  }, RUNTIME_BUDGET);
  const otherStart = startedEvent(2, otherCell);
  assert.throws(() => appendPilotAttemptEvent(history([start]), otherStart), /cell/i);
  assert.throws(() => projectPilotAttempts(history([start, {
    ...terminal, at: '2026-08-10T00:00:00.000Z',
  }]), { cell, expectedBudget: RUNTIME_BUDGET }), /timestamp/i);
});

test('rejects every run identity, context, and controller process substitution', () => {
  const cell = pilotCell();
  const start = startedEvent(1, cell);
  const terminal = terminalEvent(start);
  for (const key of ['taskId', 'repetition', 'condition', 'model', 'effort', 'revision']) {
    const run = structuredClone(terminal.run);
    run[key] = key === 'repetition' ? 2 : `wrong-${key}`;
    assert.throws(() => projectPilotAttempts(history([start, { ...terminal, run }]), {
      cell, expectedBudget: RUNTIME_BUDGET,
    }), /identity|run/i, key);
  }
  for (const key of ['taskId', 'repetition', 'condition', 'model', 'effort', 'revision']) {
    const run = structuredClone(terminal.run);
    delete run[key];
    assert.throws(() => projectPilotAttempts(history([start, { ...terminal, run }]), {
      cell, expectedBudget: RUNTIME_BUDGET,
    }), /terminal|run/i, key);
  }
  const injectedRun = { ...structuredClone(terminal.run), verdict: { success: true } };
  assert.throws(() => projectPilotAttempts(history([start, { ...terminal, run: injectedRun }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /terminal|run/i);
  const contextRun = structuredClone(terminal.run);
  contextRun.attemptContext.workspaceId = 'workspace-substituted';
  assert.throws(() => projectPilotAttempts(history([start, { ...terminal, run: contextRun }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /context|run/i);
  const controllerRun = structuredClone(terminal.run);
  controllerRun.actor.controller.processId = 'pilot-substituted';
  assert.throws(() => projectPilotAttempts(history([start, { ...terminal, run: controllerRun }]), {
    cell, expectedBudget: RUNTIME_BUDGET,
  }), /controller|run/i);
});

test('well-formed non-Full-durable histories never admit', () => {
  for (const condition of CONDITIONS) {
    const cell = pilotCell(condition);
    const starts = [startedEvent(1, cell), startedEvent(2, cell)];
    const actor = condition.endsWith('-ephemeral') ? { controller: null } : {};
    const value = history([
      starts[0], terminalEvent(starts[0], { actor }),
      starts[1], terminalEvent(starts[1], { actor }),
    ]);
    assert.equal(deriveSmokeAdmission(value, {
      revision: REVISION, cell, expectedBudget: RUNTIME_BUDGET,
    }).admitted, condition === 'full-sivs-durable');
  }
});

test('freezes exactly five tasks into a deterministic balanced randomized 20-cell schedule', () => {
  const input = validatePilotFixture(fixture());
  const first = buildPilotSchedule(input);
  const second = buildPilotSchedule(input);

  assert.deepEqual(first, second);
  assert.equal(first.length, 20);
  assert.deepEqual(new Set(first.map(cell => cell.taskId)), new Set(input.tasks.map(task => task.id)));
  for (const task of input.tasks) {
    assert.deepEqual(
      first.filter(cell => cell.taskId === task.id).map(cell => cell.condition).sort(),
      [...CONDITIONS].sort(),
    );
  }
  const orders = input.tasks.map(task => first.filter(cell => cell.taskId === task.id).map(cell => cell.condition).join('|'));
  assert.ok(new Set(orders).size > 1, 'condition order must not be identical for every task');
});

test('materializes only starter files and never exposes the hidden acceptance command', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-materialize-'));
  try {
    const task = fixture().tasks[0];
    const workspace = materializeTask(root, task);
    assert.equal(readFileSync(join(workspace, 'src/value.mjs'), 'utf8'), 'export const value = 0;\n');
    assert.doesNotMatch(JSON.stringify({ workspace, files: readFileSync(join(workspace, 'package.json'), 'utf8') }), /process\.exit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('materializes a sanitized QE baseline without git history or hidden fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-baseline-'));
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  try {
    const workspace = join(root, 'workspace');
    cloneBaselineRepository({ repository: ROOT, revision, workspace });
    assert.match(readFileSync(join(workspace, 'AGENTS.md'), 'utf8'), /QE/);
    assert.equal(existsSync(join(workspace, '.git')), false);
    assert.equal(existsSync(join(workspace, 'scripts/fixtures/harness-pilot.json')), false);
    assert.equal(existsSync(join(workspace, 'evals/harness-pilot')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parses Claude JSON usage and cost without estimating model tokens', () => {
  const parsed = parseClaudeResult(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: 'done',
    duration_ms: 1234, total_cost_usd: 0.12,
    usage: { input_tokens: 321, output_tokens: 45, cache_read_input_tokens: 100 },
  }));
  assert.deepEqual(parsed, {
    ok: true,
    inputTokens: 421,
    outputTokens: 45,
    wallSeconds: 1.234,
    costUsd: 0.12,
    result: 'done',
  });
});

test('runs every cell through an injected actor and hidden scorer with raw provenance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-run-'));
  try {
    const input = validatePilotFixture(fixture());
    const actorCalls = [];
    let activeActors = 0;
    let maxActiveActors = 0;
    const output = await runPilot(input, {
      root,
      revision: '0123456789abcdef0123456789abcdef01234567',
      concurrency: 2,
      actor: async request => {
        activeActors += 1;
        maxActiveActors = Math.max(maxActiveActors, activeActors);
        await new Promise(resolve => setTimeout(resolve, 5));
        actorCalls.push(request);
        assert.doesNotMatch(request.prompt, /process\.exit/);
        activeActors -= 1;
        return {
          ok: true, modelTurn: true, inputTokens: 100, outputTokens: 20, wallSeconds: 1,
          costUsd: 0.01, result: 'implemented', exitCode: 0,
          timedOut: false, bufferExceeded: false,
          controller: request.condition.endsWith('-durable') ? {
            admitted: true, admissionCode: 'ADMITTED', initializeCode: 'INITIALIZED', activeCode: 'ALLOWED',
            terminalCode: 'ALLOWED', processId: `pilot-${request.taskId}`,
            auditDigest: 'a'.repeat(64),
          } : null,
        };
      },
      scorer: async () => ({ passed: true, exitCode: 0, signal: null,
        outputHash: 'd'.repeat(64) }),
    });

    assert.equal(actorCalls.length, 20);
    assert.equal(maxActiveActors, 2);
    assert.match(actorCalls.find(call => call.taskId === 'task-1'
      && call.condition === 'full-sivs-durable').prompt,
    /Harness Micro boundary: Goal\/Plan entry is the only mandatory QE treatment/);
    assert.match(actorCalls.find(call => call.taskId === 'task-2'
      && call.condition === 'full-sivs-durable').prompt,
    /Qplan input: preregistered task category=feature\./);
    assert.equal(output.dataset.runs.length, 20);
    assert.equal(output.rawRuns.length, 20);
    assert.equal(output.report.balancedPairs, 5);
    assert.ok(output.rawRuns.every(run => run.revision === '0123456789abcdef0123456789abcdef01234567'));
    assert.ok(output.rawRuns.every(run => run.model === 'sonnet' && run.effort === 'medium'));
    assert.ok(output.rawRuns.every(run => run.hiddenAcceptance.outputHash === 'd'.repeat(64)));
    assert.ok(output.rawRuns.every(run => run.verdict.valid && run.verdict.success));
    assert.ok(output.dataset.runs.every(run => run.result.success));
    assert.ok(output.rawRuns.filter(run => run.condition.endsWith('-durable'))
      .every(run => run.actor.controller?.terminalCode === 'ALLOWED'));
    assert.ok(output.rawRuns.filter(run => run.condition.endsWith('-ephemeral'))
      .every(run => run.actor.controller === null));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runs one preregistered smoke cell without manufacturing a balanced report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-smoke-'));
  try {
    const output = await runPilot(validatePilotFixture(fixture()), {
      root,
      revision: '0123456789abcdef0123456789abcdef01234567',
      concurrency: 1,
      cellLimit: 1,
      actor: async request => ({
        ok: true, modelTurn: true, inputTokens: 100, outputTokens: 20, wallSeconds: 1,
        costUsd: 0, result: 'done', exitCode: 0, timedOut: false, bufferExceeded: false,
        controller: request.condition.endsWith('-durable') ? {
          admitted: true, admissionCode: 'ADMITTED', initializeCode: 'INITIALIZED', activeCode: 'ALLOWED',
          terminalCode: 'ALLOWED', processId: 'pilot-smoke', auditDigest: 'b'.repeat(64),
        } : null,
      }),
      scorer: async () => ({ passed: true, exitCode: 0, signal: null, outputHash: 'c'.repeat(64) }),
    });
    assert.equal(output.rawRuns.length, 1);
    assert.equal(output.dataset, null);
    assert.equal(output.report, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps structurally valid actor failures as unsuccessful balanced measurements', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-harness-valid-failure-'));
  try {
    const output = await runPilot(validatePilotFixture(fixture()), {
      root,
      revision: '0123456789abcdef0123456789abcdef01234567',
      concurrency: 2,
      actor: async request => ({
        ok: false, modelTurn: true, inputTokens: 0, outputTokens: 0, wallSeconds: 0,
        costUsd: 0, result: 'failed', exitCode: 1, timedOut: false, bufferExceeded: false,
        controller: request.condition.endsWith('-durable') ? {
          admitted: true, admissionCode: 'ADMITTED', initializeCode: 'INITIALIZED', activeCode: 'ALLOWED',
          terminalCode: 'ALLOWED', processId: `pilot-${request.taskId}`,
          auditDigest: 'e'.repeat(64),
        } : null,
      }),
      scorer: async () => ({ passed: true, exitCode: 0, signal: null,
        outputHash: 'f'.repeat(64) }),
    });
    assert.equal(output.rawRuns.length, 20);
    assert.ok(output.rawRuns.every(run => run.verdict.valid && !run.verdict.success));
    assert.ok(output.dataset.runs.every(run => run.result.success === false));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('parses Codex JSONL from turn.completed and does not double-count cached input', () => {
  const parsed = parseCodexResult([
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
    JSON.stringify({ type: 'turn.completed', usage: {
      input_tokens: 21419, cached_input_tokens: 6912, cache_write_input_tokens: 0,
      output_tokens: 105, reasoning_output_tokens: 80,
    } }),
  ].join('\n'), { wallSeconds: 2.5, exitCode: 0 });
  assert.deepEqual(parsed, {
    ok: true,
    modelTurn: true,
    inputTokens: 21419,
    outputTokens: 105,
    wallSeconds: 2.5,
    costUsd: null,
    result: 'done',
    exitCode: 0,
  });
});

test('bounded actor process closes stdin so Codex cannot wait for additional input', async () => {
  const result = await runBoundedProcess(process.execPath, [
    '--input-type=module', '-e',
    "process.stdin.resume();process.stdin.on('end',()=>console.log('STDIN_EOF'))",
  ], { cwd: ROOT, timeoutMs: 2000, maxBuffer: 64 * 1024 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /STDIN_EOF/);
});

test('keeps model and runtime budgets equal while disabling QE control surfaces only for native', () => {
  const base = {
    model: 'gpt-5.6-sol', effort: 'medium', prompt: 'task',
    budget: { maxWallSeconds: 300 },
  };
  const invocations = CONDITIONS.map(condition => buildCodexArgs({ ...base, condition }));
  for (const args of invocations) {
    assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('--json'));
    assert.ok(args.includes('--sandbox') && args.includes('workspace-write'));
    assert.ok(args.includes('--model') && args.includes('gpt-5.6-sol'));
    assert.ok(args.includes('model_reasoning_effort="medium"'));
  }
  assert.ok(invocations.every(args => args.filter(value => value === '--ignore-user-config').length === 1));
  const native = buildCodexArgs({ ...base, condition: 'native-ephemeral' });
  const full = buildCodexArgs({ ...base, condition: 'full-sivs-ephemeral' });
  for (const feature of ['plugins', 'hooks', 'goals', 'multi_agent', 'skill_search']) {
    assert.ok(native.some((value, index) => value === '--disable' && native[index + 1] === feature));
    assert.ok(!full.some((value, index) => value === '--disable' && full[index + 1] === feature));
  }
  assert.ok(native.includes('project_doc_max_bytes=0'));
  assert.ok(!full.includes('project_doc_max_bytes=0'));

  const stripNativeTreatment = args => {
    const output = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--disable'
        && ['plugins', 'hooks', 'goals', 'multi_agent', 'skill_search'].includes(args[index + 1])) {
        index += 1;
      } else if (args[index] === '--config' && args[index + 1] === 'project_doc_max_bytes=0') {
        index += 1;
      } else output.push(args[index]);
    }
    return output;
  };
  for (const durability of ['ephemeral', 'durable']) {
    const nativeArgs = buildCodexArgs({ ...base, condition: `native-${durability}` });
    const fullArgs = buildCodexArgs({ ...base, condition: `full-sivs-${durability}` });
    assert.deepEqual(stripNativeTreatment(nativeArgs), fullArgs);
    for (const feature of ['plugins', 'hooks', 'goals', 'multi_agent', 'skill_search']) {
      assert.equal(nativeArgs.filter((value, index) => value === '--disable'
        && nativeArgs[index + 1] === feature).length, 1);
    }
    assert.equal(nativeArgs.filter(value => value === 'project_doc_max_bytes=0').length, 1);
  }
});

test('actor prompts require same-turn completion and restrict synthetic work to the task directory', () => {
  for (const condition of CONDITIONS) {
    const prompt = buildActorPrompt('Work only in pilot-task/. Implement it.', condition, 'feature');
    assert.match(prompt, /Do not wait for approval/);
    assert.match(prompt, /pilot-task/);
  }
});

test('Full prompts bind QE behavior to the archived repository revision while native prompts stay unbound', () => {
  const full = buildActorPrompt('Work only in pilot-task/. Implement it.', 'full-sivs-durable', 'feature');
  const native = buildActorPrompt('Work only in pilot-task/. Implement it.', 'native-durable', 'micro-fix');
  assert.match(full, /repository revision under evaluation/);
  assert.match(full, /skills\/Qplan\/SKILL\.md/);
  assert.doesNotMatch(native, /repository revision under evaluation|skills\/Qplan\/SKILL\.md/);
});

test('builds byte-exact scale-aware treatment prompts without mutating arbitrary Unicode tasks', () => {
  const fullAssurance = [
    '$Qgoal Enter the repository Qplan path for this preregistered Micro harness task, then apply the treatment boundary below.',
    'Harness Micro boundary: Goal/Plan entry is the only mandatory QE treatment. Do not create QE artifacts, invoke other QE skills or subagents, or run repository-wide checks. Work only in pilot-task/, run exactly the public test named in the user task, and stop after reporting that result.',
    'This boundary is the controlling Qplan scale decision for this disposable cell. Use the QE implementation in this repository revision under evaluation; do not substitute a globally installed skill copy.',
  ].join('\n');
  const nativeAssurance = 'Execute the task directly with native agent behavior.';
  const durableMode = 'Execution metadata: durable=true, longRunning=true. Maintain bounded durable progress and recover safely after interruption.';
  const ephemeralMode = 'Execution metadata: durable=false, longRunning=false. Use an ephemeral solo execution path.';
  const completion = 'Do not wait for approval or stop after planning; implement, verify, and finish in this turn. Keep the final response conclusion-first, separate facts from assumptions, and name the recommended option.';
  const task = '한글🙂e\u0301\r\nUser task:\n$Qgoal Full SIVS with independent verification';
  const expected = (assurance, mode) => `${assurance}\n${mode}\n${completion}\n\nUser task:\n${task}`;

  for (const [condition, assurance, mode] of [
    ['full-sivs-durable', fullAssurance, durableMode],
    ['full-sivs-ephemeral', fullAssurance, ephemeralMode],
    ['native-durable', nativeAssurance, durableMode],
    ['native-ephemeral', nativeAssurance, ephemeralMode],
  ]) {
    const actual = buildActorPrompt(task, condition, 'micro-fix');
    assert.ok(Buffer.from(actual, 'utf8').equals(Buffer.from(expected(assurance, mode), 'utf8')));
  }
  assert.throws(() => buildActorPrompt('bad\0task', 'full-sivs-durable', 'micro-fix'), TypeError);
  assert.throws(() => buildActorPrompt('bad\ud800task', 'full-sivs-durable', 'micro-fix'), TypeError);
  assert.throws(() => buildActorPrompt('task', 'full-sivs-durable', 'bad category'), TypeError);
});

test('Full prompts carry preregistered non-Micro category into the Qplan scale gate', () => {
  const prompt = buildActorPrompt('Implement it.', 'full-sivs-ephemeral', 'security');
  assert.match(prompt, /Qplan input: preregistered task category=security\./);
  assert.match(prompt, /only Qgoal and Qplan entry are mandatory/);
  assert.match(prompt, /Do not invoke other QE skills, subagents, distinct-session verification, repository-wide checks, or unrelated-file work/);
  assert.match(prompt, /run exactly the public test named in the user task/);
  assert.match(prompt, /Goal-only boundary above overrides downstream ceremony/);
  assert.match(prompt, /final response conclusion-first, separate facts from assumptions/);
  assert.doesNotMatch(prompt, /Qplan scale: Micro/);
});

test('Micro treatment forbids downstream QE ceremony while preserving Goal and Plan entry', () => {
  const prompt = buildActorPrompt('Work only in pilot-task/. Run node --test pilot-task/test/public.test.mjs.',
    'full-sivs-durable', 'micro-fix');
  assert.match(prompt, /^\$Qgoal Enter the repository Qplan path/);
  assert.match(prompt, /Do not create QE artifacts, invoke other QE skills or subagents/);
  assert.match(prompt, /run exactly the public test named in the user task/);
});

test('rejects a pre-model actor failure before producing a scored dataset', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-invalid-actor-'));
  try {
    let error;
    try {
      await runPilot(validatePilotFixture(fixture()), {
        root,
        revision: '0123456789abcdef0123456789abcdef01234567',
        concurrency: 1,
        actor: async () => ({ ok: false, modelTurn: false, inputTokens: 0, outputTokens: 0,
          wallSeconds: 0.2, costUsd: 0, result: 'authentication failed', exitCode: 1 }),
        scorer: async () => ({ passed: false, exitCode: 1, signal: null, outputHash: 'x'.repeat(64) }),
      });
      assert.fail('expected an invalid actor rejection');
    } catch (caught) {
      error = caught;
    }
    assert.match(error.message, /PILOT_INVALID_ACTOR_RUN/);
    assert.equal(error.code, 'PILOT_INVALID_ACTOR_RUN');
    assert.equal(error.details.cell.taskId, 'task-1');
    assert.equal(error.details.actor.modelTurn, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('builds equal-budget Claude invocations while isolating native and Full SIVS loading', () => {
  const request = {
    model: 'sonnet', effort: 'medium', prompt: 'task',
    budget: { maxBudgetUsd: 0.5, maxWallSeconds: 300 },
  };
  const native = buildClaudeArgs({ ...request, condition: 'native-ephemeral' }, { pluginDir: '/qe' });
  const full = buildClaudeArgs({ ...request, condition: 'full-sivs-ephemeral' }, { pluginDir: '/qe' });

  for (const args of [native, full]) {
    assert.ok(args.includes('--no-session-persistence'));
    assert.ok(args.includes('--output-format') && args.includes('json'));
    assert.ok(args.includes('--model') && args.includes('sonnet'));
    assert.ok(args.includes('--max-budget-usd') && args.includes('0.5'));
  }
  assert.ok(native.includes('--safe-mode'));
  assert.ok(!native.includes('--plugin-dir'));
  assert.ok(full.includes('--plugin-dir') && full.includes('/qe'));
  assert.ok(!full.includes('--safe-mode'));
});

test('executes hidden acceptance outside the workspace and returns only bounded evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-hidden-score-'));
  try {
    writeFileSync(join(root, 'answer.txt'), 'pass\n', 'utf8');
    const task = {
      id: 'score-task',
      hiddenAcceptance: { command: "node --input-type=module -e \"import{readFileSync}from'node:fs';if(readFileSync('answer.txt','utf8').trim()!=='pass')process.exit(1)\"" },
    };
    const result = await scoreHiddenAcceptance({ workspace: root, task }, { timeoutMs: 1000 });
    assert.equal(result.passed, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.outputHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(result).sort(), ['exitCode', 'outputHash', 'passed', 'signal'].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loads the frozen five-task production fixture', () => {
  const loaded = loadPilotFixture(join(ROOT, 'scripts/fixtures/harness-pilot.json'));
  assert.equal(loaded.tasks.length, 5);
  assert.deepEqual(loaded.tasks.map(task => task.category), ['micro-fix', 'feature', 'debugging', 'security', 'integration']);
});

test('CLI dry-run emits the frozen 20-cell schedule without hidden acceptance text', () => {
  const run = spawnSync(process.execPath, ['scripts/run-harness-pilot.mjs', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.schedule.length, 20);
  assert.equal(output.model, 'gpt-5.6-sol');
  assert.doesNotMatch(run.stdout, /hiddenAcceptance|process\.exit|node --input-type/);
});

test('CLI imports expose a canonical runtime output root, fixture capture, lock authority, and generation publish seams', () => {
  const run = runHarnessPilotSnippet(`
    import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    import { tmpdir } from 'node:os';
    import { spawnSync } from 'node:child_process';
    import * as pilotCli from './scripts/run-harness-pilot.mjs';
    const {
      resolvePilotOutputRoot,
      loadCapturedPilotFixture,
      acquirePilotOutputLock,
      publishPilotGeneration,
    } = pilotCli;
    if (![resolvePilotOutputRoot, loadCapturedPilotFixture, acquirePilotOutputLock,
      publishPilotGeneration].every(value => typeof value === 'function')) {
      throw new Error('atomic CLI test seams are not implemented');
    }

    const repoRoot = process.cwd();
    const defaultRoot = resolvePilotOutputRoot({ repoRoot });
    if (!defaultRoot.endsWith('/.qe/runtime/harness-pilot/codex')) {
      throw new Error(\`unexpected default root: \${defaultRoot}\`);
    }
    const allowed = resolvePilotOutputRoot({
      repoRoot,
      outputDir: join(repoRoot, '.qe/runtime/harness-pilot/custom'),
    });
    if (!allowed.endsWith('/.qe/runtime/harness-pilot/custom')) {
      throw new Error(\`unexpected allowed root: \${allowed}\`);
    }
    let rejected = false;
    try {
      resolvePilotOutputRoot({ repoRoot, outputDir: join(repoRoot, 'evals/harness-pilot') });
    } catch (error) {
      rejected = /runtime/.test(String(error.message));
    }
    if (!rejected) throw new Error('expected non-runtime repo output to be rejected');

    const tempRepo = mkdtempSync(join(tmpdir(), 'qe-harness-fixture-'));
    try {
      const fixtureRoot = join(tempRepo, 'fixture-repo');
      const fixtureDir = join(fixtureRoot, 'scripts/fixtures');
      const fixturePath = join(fixtureDir, 'harness-pilot.json');
      const fixtureText = readFileSync(join(repoRoot, 'scripts/fixtures/harness-pilot.json'), 'utf8');
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(join(fixtureRoot, 'package.json'), '{"type":"module"}\\n', 'utf8');
      writeFileSync(fixturePath, fixtureText, 'utf8');
      const init = args => {
        const result = spawnSync('git', args, { cwd: fixtureRoot, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr || result.stdout);
        return result;
      };
      await init(['init', '-q']);
      await init(['config', 'user.name', 'QE Harness']);
      await init(['config', 'user.email', 'qe-harness@example.invalid']);
      await init(['add', 'package.json', 'scripts/fixtures/harness-pilot.json']);
      await init(['commit', '-q', '-m', 'fixture']);
      const revision = (await init(['rev-parse', 'HEAD'])).stdout.trim();
      writeFileSync(fixturePath, fixtureText.replace('"schema": 1', '"schema": 99'), 'utf8');
      const loaded = loadCapturedPilotFixture({
        repoRoot: fixtureRoot,
        revision,
        fixturePath,
      });
      if (loaded.schema !== 1) throw new Error('fixture bytes were not read from the captured revision');
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }

    const lockRoot = mkdtempSync(join(tmpdir(), 'qe-harness-lock-'));
    try {
      const lockResult = acquirePilotOutputLock(lockRoot);
      if (!existsSync(join(lockRoot, '.pilot-lock', 'owner.json'))) {
        throw new Error('missing lock owner');
      }
      const owner = JSON.parse(readFileSync(join(lockRoot, '.pilot-lock', 'owner.json'), 'utf8'));
      if (owner.schema !== 1 || typeof owner.pid !== 'number' || typeof owner.token !== 'string') {
        throw new Error('unexpected lock owner schema');
      }
      let locked = false;
      try { acquirePilotOutputLock(lockRoot); } catch (error) { locked = /PILOT_LOCKED|PILOT_LOCK_INVALID/.test(String(error.message)); }
      if (!locked) throw new Error('expected a live lock conflict');
      lockResult.release();
    } finally {
      rmSync(lockRoot, { recursive: true, force: true });
    }

    const outputParent = realpathSync(mkdtempSync(join(tmpdir(), 'qe-harness-output-')));
    const outputRoot = join(outputParent, 'owned');
    const outputIdentity = pilotCli.preparePilotOutputRoot({ repoRoot, outputDir: outputRoot });
    const outputLock = acquirePilotOutputLock(outputRoot);
    try {
      const published = publishPilotGeneration({
        outputIdentity,
        lockAuthority: outputLock,
        revision: '0'.repeat(40),
        generation: 'g-1',
        runtime: { schema: 1, mode: 'smoke' },
        results: { schema: 1, runs: [] },
        report: { schema: 1, balancedPairs: 0 },
        runSummary: '# Pilot',
      });
      if (!existsSync(join(outputRoot, 'current.json'))) throw new Error('missing current pointer');
      if (!existsSync(join(outputRoot, 'generations', 'g-1', 'results.json'))) throw new Error('missing generation artifacts');
      if (published.manifestHash.length !== 64) throw new Error('manifest hash must be sha-256');
    } finally {
      outputLock.release();
      rmSync(outputParent, { recursive: true, force: true });
    }
  `);

  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /choose exactly one of --dry-run, --smoke, or --execute/);
});

test('atomic CLI boundaries reject broad paths and preserve targets and malformed locks', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qe-harness-boundary-')));
  try {
    const repoRoot = join(root, 'repo');
    mkdirSync(repoRoot);
    assert.throws(() => pilotCli.resolvePilotOutputRoot({ repoRoot, outputDir: repoRoot }),
      /PILOT_OUTPUT_UNSAFE/);
    assert.throws(() => pilotCli.resolvePilotOutputRoot({ repoRoot, outputDir: '/' }),
      /PILOT_OUTPUT_UNSAFE/);
    assert.throws(() => pilotCli.resolvePilotOutputRoot({ repoRoot, outputDir: homedir() }),
      /PILOT_OUTPUT_UNSAFE/);
    const runtime = join(repoRoot, '.qe/runtime');
    mkdirSync(runtime, { recursive: true });
    symlinkSync(join(repoRoot, 'tracked-target'), join(runtime, 'alias'));
    assert.throws(() => pilotCli.resolvePilotOutputRoot({ repoRoot,
      outputDir: join(runtime, 'alias', 'pilot') }), /symlink component/);

    const unrelated = join(root, 'unrelated');
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, 'keep.txt'), 'keep', 'utf8');
    assert.throws(() => pilotCli.preparePilotOutputRoot({ repoRoot, outputDir: unrelated }),
      /not harness-owned/);
    assert.equal(readFileSync(join(unrelated, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(existsSync(join(unrelated, '.qe-harness-owner.json')), false);
    const emptyExternal = join(root, 'empty-external');
    mkdirSync(emptyExternal);
    assert.throws(() => pilotCli.preparePilotOutputRoot({ repoRoot, outputDir: emptyExternal }),
      /not harness-owned/);
    assert.equal(existsSync(join(emptyExternal, '.qe-harness-owner.json')), false);
    const mismatched = join(root, 'mismatched');
    mkdirSync(mismatched);
    writeFileSync(join(mismatched, '.qe-harness-owner.json'), `${JSON.stringify({
      schema: 1, kind: 'qe-harness-runtime', repository: '/different/repository',
    })}\n`, 'utf8');
    assert.throws(() => pilotCli.preparePilotOutputRoot({ repoRoot, outputDir: mismatched }),
      /marker mismatch/);

    const target = join(root, 'atomic.json');
    writeFileSync(target, 'old', 'utf8');
    assert.throws(() => pilotCli.atomicWritePilotFile(target, 'new', {
      beforeRename: () => { throw new Error('injected pre-rename failure'); },
    }), /pre-rename/);
    assert.equal(readFileSync(target, 'utf8'), 'old');
    assert.throws(() => pilotCli.atomicWritePilotFile(target, 'new', {
      directorySync: () => {
        const error = new Error('PILOT_DURABILITY_UNCERTAIN: injected directory failure');
        error.code = 'PILOT_DURABILITY_UNCERTAIN';
        throw error;
      },
    }), error => error.code === 'PILOT_DURABILITY_UNCERTAIN');
    assert.equal(readFileSync(target, 'utf8'), 'new');

    const lockRoot = join(root, 'lock-root');
    mkdirSync(join(lockRoot, '.pilot-lock'), { recursive: true });
    assert.throws(() => pilotCli.acquirePilotOutputLock(lockRoot), /PILOT_LOCK_INVALID/);
    assert.equal(existsSync(join(lockRoot, '.pilot-lock')), true);

    const staleRoot = join(root, 'stale-root');
    mkdirSync(join(staleRoot, '.pilot-lock'), { recursive: true });
    writeFileSync(join(staleRoot, '.pilot-lock', 'owner.json'), `${JSON.stringify({
      schema: 1, pid: 2_147_483_647, token: '20000000-0000-4000-8000-000000000001',
      createdAt: '2026-08-10T00:00:00.000Z',
    })}\n`, 'utf8');
    const recovered = pilotCli.acquirePilotOutputLock(staleRoot);
    assert.notEqual(recovered.owner.token, '20000000-0000-4000-8000-000000000001');
    recovered.release();
    assert.equal(existsSync(join(staleRoot, '.pilot-lock')), false);

    const publishRoot = join(repoRoot, '.qe/runtime/publish-root');
    const escapedRoot = join(root, 'escaped-root');
    const publishIdentity = pilotCli.preparePilotOutputRoot({ repoRoot, outputDir: publishRoot });
    mkdirSync(escapedRoot);
    symlinkSync(escapedRoot, join(publishRoot, 'generations'));
    const publishLock = pilotCli.acquirePilotOutputLock(publishRoot);
    try {
      assert.throws(() => pilotCli.publishPilotGeneration({
        outputIdentity: publishIdentity, lockAuthority: publishLock,
        revision: '0'.repeat(40), generation: 'blocked', runtime: {}, results: {},
        report: {}, runSummary: '# blocked\n',
      }), /PILOT_OUTPUT_UNSAFE/);
    } finally { publishLock.release(); }
    assert.equal(existsSync(join(escapedRoot, 'blocked')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('captured operation journals before actor launch and admits execute only after two successes', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'qe-harness-operation-'));
  let operationLock = null;
  try {
    const git = args => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    writeFileSync(join(repoRoot, 'tracked.txt'), 'captured\n', 'utf8');
    assert.equal(git(['init', '-q']).status, 0);
    assert.equal(git(['config', 'user.name', 'QE Harness']).status, 0);
    assert.equal(git(['config', 'user.email', 'qe-harness@example.invalid']).status, 0);
    assert.equal(git(['add', 'tracked.txt']).status, 0);
    assert.equal(git(['commit', '-q', '-m', 'captured']).status, 0);
    const revision = git(['rev-parse', 'HEAD']).stdout.trim();
    const input = loadPilotFixture(join(ROOT, 'scripts/fixtures/harness-pilot.json'));
    const outputIdentity = pilotCli.preparePilotOutputRoot({ repoRoot });
    operationLock = pilotCli.acquirePilotOutputLock(outputIdentity.path);
    let prematureExecuteCalls = 0;
    await assert.rejects(() => pilotCli.runCapturedPilotOperation({ mode: 'execute', repoRoot,
      fixture: input, expectedFixtureDigest: fixtureDigest(input), revision, outputIdentity,
      lockAuthority: operationLock,
      actor: async () => { prematureExecuteCalls += 1; },
      scorer: async () => ({}), runPilotImpl: async () => { prematureExecuteCalls += 1; } }),
    /PILOT_SMOKE_NOT_ADMITTED/);
    assert.equal(prematureExecuteCalls, 0);
    let actorCalls = 0;
    const actor = async request => {
      actorCalls += 1;
      const historyValue = JSON.parse(readFileSync(join(outputIdentity.path, 'smoke-history.json'), 'utf8'));
      assert.equal(historyValue.events.at(-1).kind, 'started');
      return {
        ok: true, modelTurn: true, inputTokens: 1, outputTokens: 1, wallSeconds: 0.01,
        timedOut: false, bufferExceeded: false,
        controller: {
          admitted: true, admissionCode: 'ADMITTED', initializeCode: 'INITIALIZED',
          activeCode: 'ALLOWED', terminalCode: 'ALLOWED', processId: request.controllerProcessId,
          auditDigest: 'a'.repeat(64),
        },
      };
    };
    const smokeRun = async (fixtureValue, options) => {
      const first = buildPilotSchedule(fixtureValue)[0];
      const actorResult = await options.actor({ ...first, model: fixtureValue.model,
        effort: fixtureValue.effort, budget: fixtureValue.budget });
      return { dataset: null, report: null, rawRuns: [{ ...first, model: fixtureValue.model,
        effort: fixtureValue.effort, revision, actor: actorResult,
        hiddenAcceptance: { passed: true, exitCode: 0, signal: null, outputHash: 'b'.repeat(64) } }] };
    };
    const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
    for (const id of ids) {
      await pilotCli.runCapturedPilotOperation({ mode: 'smoke', repoRoot, fixture: input,
        revision, outputIdentity, lockAuthority: operationLock,
        actor, scorer: async () => ({}), runPilotImpl: smokeRun,
        attemptIdFactory: () => id });
    }
    const historyValue = JSON.parse(readFileSync(join(outputIdentity.path, 'smoke-history.json'), 'utf8'));
    assert.deepEqual(historyValue.events.map(event => event.kind), ['started', 'terminal', 'started', 'terminal']);

    let executeActorCalls = 0;
    const balancedRun = async (_fixtureValue, options) => {
      executeActorCalls += 1;
      await options.actor({ condition: 'native-ephemeral' });
      return { dataset: { schema: 1, budget: createPilotRuntimeBudget(input.budget), runs: [] },
        rawRuns: [], report: { balancedPairs: 0, conditions: {} } };
    };
    let postrunVerifications = 0;
    const authorityDigest = fixtureDigest(input);
    const executed = await pilotCli.runCapturedPilotOperation({ mode: 'execute', repoRoot,
      fixture: input, expectedFixtureDigest: authorityDigest, revision, outputIdentity,
      lockAuthority: operationLock,
      actor: async () => ({ controller: null }),
      scorer: async () => ({}), runPilotImpl: balancedRun,
      verifyPilotOutputImpl: (verifiedRoot, authority) => {
        postrunVerifications += 1;
        assert.equal(verifiedRoot, outputIdentity.path);
        assert.equal(authority.fixture, input);
        assert.equal(authority.expectedFixtureDigest, authorityDigest);
        return { classification: 'succeeded' };
      } });
    assert.equal(executeActorCalls, 1);
    assert.equal(executed.admission.admitted, true);
    assert.equal(postrunVerifications, 1);
    assert.equal(existsSync(join(outputIdentity.path, 'current.json')), true);
    assert.equal(actorCalls, 2);

    await assert.rejects(() => pilotCli.runCapturedPilotOperation({ mode: 'smoke', repoRoot,
      fixture: input, revision, outputIdentity, lockAuthority: operationLock,
      actor: async request => {
        writeFileSync(join(repoRoot, 'tracked.txt'), 'drifted\n', 'utf8');
        return actor(request);
      }, scorer: async () => ({}), runPilotImpl: smokeRun,
      attemptIdFactory: () => '10000000-0000-4000-8000-000000000003' }),
    /PILOT_EXECUTE_CONSUMED/);
    const unchanged = JSON.parse(readFileSync(join(outputIdentity.path, 'smoke-history.json'), 'utf8'));
    assert.equal(unchanged.events.at(-1).kind, 'terminal');
  } finally {
    operationLock?.release();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
