import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as harnessPilot from '../harness-pilot.mjs';

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
});

test('actor prompts require same-turn completion and restrict synthetic work to the task directory', () => {
  for (const condition of CONDITIONS) {
    const prompt = buildActorPrompt('Work only in pilot-task/. Implement it.', condition);
    assert.match(prompt, /Do not wait for approval/);
    assert.match(prompt, /pilot-task/);
  }
});

test('Full prompts bind QE behavior to the archived repository revision while native prompts stay unbound', () => {
  const full = buildActorPrompt('Work only in pilot-task/. Implement it.', 'full-sivs-durable');
  const native = buildActorPrompt('Work only in pilot-task/. Implement it.', 'native-durable');
  assert.match(full, /repository revision under evaluation/);
  assert.match(full, /skills\/Qplan\/SKILL\.md/);
  assert.doesNotMatch(native, /repository revision under evaluation|skills\/Qplan\/SKILL\.md/);
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
