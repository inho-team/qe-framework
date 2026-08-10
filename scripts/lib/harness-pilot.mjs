import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

import { CONDITIONS, evaluateHarness } from '../evaluate-harness.mjs';

export { CONDITIONS };

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a finite positive number`);
  return value;
}

const PILOT_METRICS = Object.freeze([
  ['inputTokens', 'maxInputTokens', 'INPUT_TOKENS'],
  ['outputTokens', 'maxOutputTokens', 'OUTPUT_TOKENS'],
  ['wallSeconds', 'maxWallSeconds', 'WALL_SECONDS'],
]);

const RUNTIME_BUDGET_KEYS = Object.freeze(['maxInputTokens', 'maxOutputTokens', 'maxWallSeconds']);
const CELL_KEYS = Object.freeze(['budgetDigest', 'condition', 'effort', 'model', 'repetition', 'taskId']);
const HISTORY_KEYS = Object.freeze(['budget', 'events', 'schema']);
const STARTED_KEYS = Object.freeze([
  'at', 'cell', 'cellIdentity', 'contextDigest', 'controllerProcessId', 'kind',
  'attemptId', 'revision', 'sequence', 'workspaceId',
]);
const TERMINAL_KEYS = Object.freeze(['at', 'attemptId', 'contextDigest', 'kind', 'run', 'sequence']);
const RUN_KEYS = Object.freeze([
  'actor', 'attemptContext', 'condition', 'effort', 'hiddenAcceptance', 'model',
  'repetition', 'revision', 'taskId',
]);
const CONTEXT_KEYS = Object.freeze([
  'attemptId', 'cell', 'cellIdentity', 'contextDigest', 'controllerProcessId',
  'revision', 'workspaceId',
]);
const CONTROLLER_REQUIRED_KEYS = Object.freeze([
  'activeCode', 'admissionCode', 'admitted', 'auditDigest', 'initializeCode', 'processId',
  'terminalCode',
]);
const HIDDEN_KEYS = Object.freeze(['exitCode', 'outputHash', 'passed', 'signal']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX40_RE = /^[0-9a-f]{40}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function canonicalDigest(payload) {
  return createHash('sha256').update(Buffer.from(JSON.stringify(payload), 'utf8')).digest('hex');
}

function validateRuntimeBudget(budget, { exact = true } = {}) {
  if (!plainObject(budget) || (exact && !exactKeys(budget, RUNTIME_BUDGET_KEYS))) {
    throw new TypeError('invalid pilot runtime budget');
  }
  if (!Number.isSafeInteger(budget.maxInputTokens) || budget.maxInputTokens <= 0
    || !Number.isSafeInteger(budget.maxOutputTokens) || budget.maxOutputTokens <= 0
    || !Number.isFinite(budget.maxWallSeconds) || budget.maxWallSeconds <= 0) {
    throw new TypeError('invalid pilot runtime budget');
  }
  return {
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    maxWallSeconds: budget.maxWallSeconds,
  };
}

export function pilotBudgetDigest(budget) {
  const value = validateRuntimeBudget(budget);
  return canonicalDigest(['qe-pilot-budget-v1',
    value.maxInputTokens, value.maxOutputTokens, value.maxWallSeconds]);
}

/** Project the three observable admission ceilings from a validated launch budget. */
export function createPilotRuntimeBudget(source) {
  return validateRuntimeBudget(source, { exact: false });
}

function validateCell(cell) {
  if (!exactKeys(cell, CELL_KEYS) || !nonEmpty(cell.taskId)
    || !Number.isSafeInteger(cell.repetition) || cell.repetition <= 0
    || !CONDITIONS.includes(cell.condition) || !nonEmpty(cell.model) || !nonEmpty(cell.effort)
    || !HEX64_RE.test(cell.budgetDigest || '')) {
    throw new TypeError('invalid pilot cell');
  }
  return cell;
}

export function createPilotCell(source, budget) {
  if (!plainObject(source)) throw new TypeError('invalid pilot cell source');
  const cell = {
    taskId: source.taskId,
    repetition: source.repetition,
    condition: source.condition,
    model: source.model,
    effort: source.effort,
    budgetDigest: pilotBudgetDigest(createPilotRuntimeBudget(budget)),
  };
  validateCell(cell);
  return structuredClone(cell);
}

export function pilotCellIdentity(cell) {
  const value = validateCell(cell);
  return canonicalDigest(['qe-pilot-cell-v1', value.taskId, value.repetition,
    value.condition, value.model, value.effort, value.budgetDigest]);
}

function canonicalIso(value) {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

export function createPilotAttemptContext(input) {
  if (!plainObject(input) || !Number.isSafeInteger(input.sequence) || input.sequence < 1
    || !UUID_RE.test(input.attemptId || '') || !HEX40_RE.test(input.revision || '')) {
    throw new TypeError('invalid pilot attempt context');
  }
  const cellIdentity = pilotCellIdentity(input.cell);
  const workspaceId = `workspace-${input.attemptId}`;
  const controllerProcessId = `pilot-${input.attemptId}`;
  if (input.workspaceId !== workspaceId || input.controllerProcessId !== controllerProcessId
    || (input.cellIdentity !== undefined && input.cellIdentity !== cellIdentity)) {
    throw new TypeError('pilot attempt context identity conflict');
  }
  const contextDigest = canonicalDigest(['qe-pilot-attempt-v1', input.sequence,
    input.attemptId, input.revision, cellIdentity, workspaceId, controllerProcessId]);
  if (input.contextDigest !== undefined && input.contextDigest !== contextDigest) {
    throw new TypeError('pilot attempt context digest conflict');
  }
  return {
    attemptId: input.attemptId,
    revision: input.revision,
    cell: structuredClone(input.cell),
    cellIdentity,
    workspaceId,
    controllerProcessId,
    contextDigest,
  };
}

function validControllerEvidence(condition, value, expectedProcessId = null) {
  if (condition.endsWith('-ephemeral')) return value === null;
  if (!exactKeys(value, CONTROLLER_REQUIRED_KEYS) || value.admissionCode !== 'ADMITTED') return false;
  return value.admitted === true && value.initializeCode === 'INITIALIZED'
    && value.activeCode === 'ALLOWED' && value.terminalCode === 'ALLOWED'
    && nonEmpty(value.processId) && (!expectedProcessId || value.processId === expectedProcessId)
    && HEX64_RE.test(value.auditDigest || '');
}

/** Classify one raw pilot run against the same ceilings used by the balanced evaluator. */
export function classifyPilotRun(run, budget, { controllerProcessId = null } = {}) {
  const reasons = [];
  let invalid = false;
  let runtimeBudget = null;
  try { runtimeBudget = validateRuntimeBudget(budget, { exact: false }); }
  catch {
    invalid = true;
    for (const [, , code] of PILOT_METRICS) reasons.push(`INVALID_BUDGET_${code}`);
  }
  const actor = run?.actor;
  if (!CONDITIONS.includes(run?.condition)) { reasons.push('INVALID_CONDITION'); invalid = true; }
  if (!plainObject(actor)) {
    reasons.push('MISSING_ACTOR');
    invalid = true;
  } else {
    if (actor.modelTurn !== true) { reasons.push('NO_MODEL_TURN'); invalid = true; }
    for (const [metric, ceilingKey, code] of PILOT_METRICS) {
      const metricValid = metric === 'wallSeconds'
        ? Number.isFinite(actor[metric]) && actor[metric] >= 0
        : Number.isSafeInteger(actor[metric]) && actor[metric] >= 0;
      if (!metricValid) { reasons.push(`INVALID_${code}`); invalid = true; }
      else if (runtimeBudget && actor[metric] > runtimeBudget[ceilingKey]) {
        reasons.push(`${code}_EXCEEDED`); invalid = true;
      }
    }
    if (typeof actor.timedOut !== 'boolean') { reasons.push('INVALID_ACTOR_TIMEOUT_STATE'); invalid = true; }
    else if (actor.timedOut) { reasons.push('ACTOR_TIMED_OUT'); invalid = true; }
    if (typeof actor.bufferExceeded !== 'boolean') { reasons.push('INVALID_ACTOR_BUFFER_STATE'); invalid = true; }
    else if (actor.bufferExceeded) { reasons.push('ACTOR_BUFFER_EXCEEDED'); invalid = true; }
    if (!validControllerEvidence(run?.condition || '', actor.controller, controllerProcessId)) {
      reasons.push('INVALID_CONTROLLER_EVIDENCE');
      invalid = true;
    }
    if (typeof actor.ok !== 'boolean') { reasons.push('INVALID_ACTOR_OUTCOME'); invalid = true; }
    else if (actor.ok === false) reasons.push('ACTOR_FAILED');
  }
  const hidden = run?.hiddenAcceptance;
  if (!exactKeys(hidden, HIDDEN_KEYS) || typeof hidden.passed !== 'boolean'
    || !(Number.isInteger(hidden.exitCode) || hidden.exitCode === null)
    || !(typeof hidden.signal === 'string' || hidden.signal === null)
    || !HEX64_RE.test(hidden.outputHash || '')
    || (hidden.passed === true && (hidden.exitCode !== 0 || hidden.signal !== null))) {
    reasons.push('MISSING_HIDDEN_ACCEPTANCE');
    invalid = true;
  }
  else if (hidden.passed === false
    && (!Number.isInteger(hidden.exitCode) || hidden.exitCode === 0 || hidden.signal !== null)) {
    reasons.push('INVALID_HIDDEN_EXECUTION');
    invalid = true;
  }
  else if (hidden.passed === false) reasons.push('HIDDEN_ACCEPTANCE_FAILED');
  return { valid: !invalid, success: !invalid && actor?.ok === true && hidden?.passed === true, reasons };
}

export function createPilotTerminalRun(run, attemptContext) {
  if (!exactKeys(attemptContext, CONTEXT_KEYS)) throw new TypeError('invalid pilot attempt context');
  const output = {
    taskId: run?.taskId,
    repetition: run?.repetition,
    condition: run?.condition,
    model: run?.model,
    effort: run?.effort,
    revision: run?.revision,
    actor: structuredClone(run?.actor),
    hiddenAcceptance: structuredClone(run?.hiddenAcceptance),
    attemptContext: structuredClone(attemptContext),
  };
  const expectedIdentity = {
    taskId: attemptContext.cell.taskId,
    repetition: attemptContext.cell.repetition,
    condition: attemptContext.cell.condition,
    model: attemptContext.cell.model,
    effort: attemptContext.cell.effort,
    revision: attemptContext.revision,
  };
  if (!Object.entries(expectedIdentity).every(([key, value]) => output[key] === value)) {
    throw new TypeError('pilot terminal run identity conflict');
  }
  return output;
}

function validateStarted(event, expectedSequence, budgetDigest, expectedCell = null) {
  if (!exactKeys(event, STARTED_KEYS) || event.kind !== 'started'
    || event.sequence !== expectedSequence || !canonicalIso(event.at)) {
    throw new TypeError('invalid pilot started event sequence or schema');
  }
  validateCell(event.cell);
  if (event.cell.budgetDigest !== budgetDigest
    || (expectedCell && !isDeepStrictEqual(event.cell, expectedCell))) {
    throw new TypeError('pilot started event cell budget conflict');
  }
  const context = createPilotAttemptContext(event);
  if (event.cellIdentity !== context.cellIdentity || event.contextDigest !== context.contextDigest) {
    throw new TypeError('pilot started event context conflict');
  }
  return context;
}

function validateTerminal(event, started, context, budget) {
  if (!exactKeys(event, TERMINAL_KEYS) || event.kind !== 'terminal'
    || event.sequence !== started.sequence || event.attemptId !== started.attemptId
    || event.contextDigest !== started.contextDigest || !canonicalIso(event.at)
    || !exactKeys(event.run, RUN_KEYS)) {
    throw new TypeError('invalid pilot terminal event');
  }
  if (Date.parse(event.at) < Date.parse(started.at)) {
    throw new TypeError('pilot terminal timestamp precedes its start');
  }
  if (!isDeepStrictEqual(event.run.attemptContext, context)) {
    throw new TypeError('pilot terminal run context conflict');
  }
  const identity = {
    taskId: started.cell.taskId,
    repetition: started.cell.repetition,
    condition: started.cell.condition,
    model: started.cell.model,
    effort: started.cell.effort,
    revision: started.revision,
  };
  if (!Object.entries(identity).every(([key, value]) => event.run[key] === value)) {
    throw new TypeError('pilot terminal run identity conflict');
  }
  const verdict = classifyPilotRun(event.run, budget,
    { controllerProcessId: started.controllerProcessId });
  if (!verdict.valid) {
    throw new TypeError(`invalid pilot terminal run evidence: ${verdict.reasons.join(',')}`);
  }
  return verdict;
}

function replayHistory(history, { expectedBudget = null, expectedCell = null } = {}) {
  if (!exactKeys(history, HISTORY_KEYS) || history.schema !== 2 || !Array.isArray(history.events)) {
    throw new TypeError('invalid pilot attempt history schema');
  }
  const budget = validateRuntimeBudget(history.budget);
  if (expectedBudget !== null) {
    const trusted = validateRuntimeBudget(expectedBudget);
    if (!isDeepStrictEqual(budget, trusted)) throw new TypeError('pilot history budget conflict');
  }
  const budgetDigest = pilotBudgetDigest(budget);
  if (expectedCell !== null) {
    validateCell(expectedCell);
    if (expectedCell.budgetDigest !== budgetDigest) throw new TypeError('pilot expected cell budget conflict');
  }
  const attempts = [];
  let canonicalCell = expectedCell;
  let active = null;
  let expectedSequence = 1;
  let lastTimestamp = -Infinity;
  const seenAttemptIds = new Set();
  for (const event of history.events) {
    if (event?.kind === 'started') {
      if (Date.parse(event.at) < lastTimestamp) throw new TypeError('pilot event timestamps must be monotonic');
      if (active) attempts.push({ ...active.started, status: 'interrupted', run: null,
        verdict: { valid: false, success: false, reasons: ['ATTEMPT_INTERRUPTED'] } });
      const context = validateStarted(event, expectedSequence, budgetDigest, canonicalCell);
      if (canonicalCell === null) canonicalCell = structuredClone(event.cell);
      if (seenAttemptIds.has(event.attemptId)) throw new TypeError('duplicate pilot attempt identity');
      seenAttemptIds.add(event.attemptId);
      active = { started: structuredClone(event), context };
      expectedSequence += 1;
    } else if (event?.kind === 'terminal') {
      if (Date.parse(event.at) < lastTimestamp) throw new TypeError('pilot event timestamps must be monotonic');
      if (!active) throw new TypeError('pilot terminal event has no immediately preceding start');
      const verdict = validateTerminal(event, active.started, active.context, budget);
      attempts.push({ ...active.started, status: 'completed', completedAt: event.at,
        run: structuredClone(event.run), verdict });
      active = null;
    } else {
      throw new TypeError('unknown pilot attempt event');
    }
    lastTimestamp = Date.parse(event.at);
  }
  if (active) attempts.push({ ...active.started, status: 'interrupted', run: null,
    verdict: { valid: false, success: false, reasons: ['ATTEMPT_INTERRUPTED'] } });
  return { budget, attempts };
}

/** Append one immutable event only after the whole resulting history replays. */
export function appendPilotAttemptEvent(history, event) {
  const next = structuredClone(history);
  if (!plainObject(next) || !Array.isArray(next.events)) throw new TypeError('invalid pilot attempt history');
  next.events.push(structuredClone(event));
  replayHistory(next);
  return next;
}

/** Project attempts in original event order under trusted budget and cell inputs. */
export function projectPilotAttempts(history, { cell, expectedBudget }) {
  return replayHistory(history, { expectedBudget, expectedCell: cell }).attempts;
}

/** Re-derive admission from the last two adjacent attempts; stored aggregate state is never trusted. */
export function deriveSmokeAdmission(history, { revision, cell, expectedBudget }) {
  if (!HEX40_RE.test(revision || '')) throw new TypeError('invalid smoke admission revision');
  const attempts = projectPilotAttempts(history, { cell, expectedBudget });
  const selected = attempts.slice(-2);
  const admitted = cell.condition === 'full-sivs-durable' && selected.length === 2
    && selected[1].sequence === selected[0].sequence + 1
    && selected.every(attempt => attempt.revision === revision
      && attempt.cellIdentity === pilotCellIdentity(cell) && attempt.verdict.success === true);
  return { admitted, attempts, selectedAttemptIds: selected.map(attempt => attempt.attemptId) };
}

function safeRelativePath(value) {
  if (!nonEmpty(value) || isAbsolute(value) || value.includes('\0')) return false;
  const normalized = relative('.', value);
  return normalized !== '..' && !normalized.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

export class PilotInvalidActorError extends Error {
  constructor({ cell, model, effort, revision, actor }) {
    super(`PILOT_INVALID_ACTOR_RUN ${cell.taskId} ${cell.condition}`);
    this.name = 'PilotInvalidActorError';
    this.code = 'PILOT_INVALID_ACTOR_RUN';
    this.details = { cell: structuredClone(cell), model, effort, revision,
      actor: structuredClone(actor || null) };
  }
}

export function validatePilotFixture(input) {
  if (!input || input.schema !== 1 || !nonEmpty(input.seed) || !nonEmpty(input.model)
    || !nonEmpty(input.effort) || input.repetition !== 1 || !Array.isArray(input.tasks)
    || input.tasks.length !== 5) {
    throw new TypeError('pilot fixture must define schema, seed, model, effort, repetition 1, and exactly five tasks');
  }
  const budget = input.budget || {};
  finitePositive(budget.maxInputTokens, 'budget.maxInputTokens');
  finitePositive(budget.maxOutputTokens, 'budget.maxOutputTokens');
  finitePositive(budget.maxWallSeconds, 'budget.maxWallSeconds');
  finitePositive(budget.maxBudgetUsd, 'budget.maxBudgetUsd');

  const ids = new Set();
  for (const [index, task] of input.tasks.entries()) {
    if (!task || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(task.id || '') || ids.has(task.id)
      || !nonEmpty(task.category) || !nonEmpty(task.prompt)
      || !task.starterFiles || typeof task.starterFiles !== 'object' || Array.isArray(task.starterFiles)
      || Object.keys(task.starterFiles).length === 0
      || !Object.entries(task.starterFiles).every(([path, content]) => safeRelativePath(path) && typeof content === 'string')
      || !task.hiddenAcceptance || !nonEmpty(task.hiddenAcceptance.command)) {
      throw new TypeError(`tasks[${index}] is invalid`);
    }
    ids.add(task.id);
  }
  return structuredClone(input);
}

export function loadPilotFixture(file) {
  if (!nonEmpty(file)) throw new TypeError('fixture path is required');
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new TypeError('pilot fixture must be readable JSON'); }
  return validatePilotFixture(parsed);
}

function orderDigest(seed, taskId, repetition, condition) {
  return createHash('sha256').update(`${seed}\0${taskId}\0${repetition}\0${condition}`).digest('hex');
}

export function buildPilotSchedule(input) {
  const fixture = validatePilotFixture(input);
  return fixture.tasks.flatMap(task => CONDITIONS
    .map(condition => ({ taskId: task.id, repetition: fixture.repetition, condition }))
    .sort((left, right) => orderDigest(fixture.seed, task.id, fixture.repetition, left.condition)
      .localeCompare(orderDigest(fixture.seed, task.id, fixture.repetition, right.condition))));
}

export function materializeTask(root, task) {
  const workspace = resolve(root, task.id);
  mkdirSync(workspace, { recursive: true });
  for (const [path, content] of Object.entries(task.starterFiles)) {
    const target = resolve(workspace, path);
    if (target !== workspace && !target.startsWith(`${workspace}/`)) throw new TypeError(`unsafe starter path: ${path}`);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return workspace;
}

export function cloneBaselineRepository({ repository, revision, workspace }) {
  if (!nonEmpty(repository) || !/^[0-9a-f]{40}$/.test(revision || '') || !nonEmpty(workspace)) {
    throw new TypeError('baseline clone requires repository, revision, and workspace');
  }
  const parent = resolve(workspace, '..');
  const archivePath = join(parent, '.qe-harness-baseline.tar');
  mkdirSync(resolve(workspace), { recursive: true });
  const archive = spawnSync('git', ['archive', '--format=tar', `--output=${archivePath}`, revision], {
    cwd: resolve(repository), encoding: 'utf8',
  });
  if (archive.status !== 0) throw new Error(`baseline archive failed: ${archive.stderr || archive.stdout}`);
  try {
    const extract = spawnSync('tar', ['-xf', archivePath, '-C', resolve(workspace)], { encoding: 'utf8' });
    if (extract.status !== 0) throw new Error(`baseline extract failed: ${extract.stderr || extract.stdout}`);
  } finally {
    rmSync(archivePath, { force: true });
  }
  for (const hiddenPath of ['scripts/fixtures/harness-pilot.json', 'evals/harness-pilot']) {
    rmSync(resolve(workspace, hiddenPath), { recursive: true, force: true });
  }
  return resolve(workspace);
}

export function buildActorPrompt(taskPrompt, condition, taskCategory) {
  if (typeof taskPrompt !== 'string' || taskPrompt.includes('\0')
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(taskCategory || '')) {
    throw new TypeError('actor task prompt and category must be well-formed');
  }
  for (let index = 0; index < taskPrompt.length; index += 1) {
    const unit = taskPrompt.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = taskPrompt.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('actor task prompt and category must be well-formed');
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('actor task prompt and category must be well-formed');
    }
  }
  const mode = condition.endsWith('-durable')
    ? 'Execution metadata: durable=true, longRunning=true. Maintain bounded durable progress and recover safely after interruption.'
    : 'Execution metadata: durable=false, longRunning=false. Use an ephemeral solo execution path.';
  const microTreatment = taskCategory === 'micro-fix';
  const goalEntry = microTreatment
    ? '$Qgoal Enter the repository Qplan path for this preregistered Micro harness task, then apply the treatment boundary below.'
    : '$Qgoal Complete the user task through the repository default Plan-owned Goal path.';
  const scaleDirective = microTreatment
    ? 'Harness Micro boundary: Goal/Plan entry is the only mandatory QE treatment. Do not create QE artifacts, invoke other QE skills or subagents, or run repository-wide checks. Work only in pilot-task/, run exactly the public test named in the user task, and stop after reporting that result.'
    : `Qplan input: preregistered task category=${taskCategory}. Apply the repository Qplan scale gate and use the smallest admitted Plan-owned Goal lane for this task.`;
  const revisionBinding = microTreatment
    ? 'This boundary is the controlling Qplan scale decision for this disposable cell. Use the QE implementation in this repository revision under evaluation; do not substitute a globally installed skill copy.'
    : 'Use the QE implementation and contracts in this repository revision under evaluation as normative, including skills/Qgoal/SKILL.md and skills/Qplan/SKILL.md; do not substitute a globally installed skill copy.';
  const assurance = condition.startsWith('full-sivs-')
    ? [
      goalEntry,
      scaleDirective,
      revisionBinding,
    ].join('\n')
    : 'Execute the task directly with native agent behavior.';
  const completion = 'Do not wait for approval or stop after planning; implement, verify, and finish in this turn.';
  return `${assurance}\n${mode}\n${completion}\n\nUser task:\n${taskPrompt}`;
}

export function buildCodexArgs(request) {
  if (!request || !CONDITIONS.includes(request.condition) || !nonEmpty(request.model)
    || !nonEmpty(request.effort) || !nonEmpty(request.prompt) || !request.budget
    || !Number.isFinite(request.budget.maxWallSeconds)) {
    throw new TypeError('invalid Codex actor request');
  }
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--json',
    '--sandbox', 'workspace-write',
    '--model', request.model,
    '--config', `model_reasoning_effort=${JSON.stringify(request.effort)}`,
  ];
  if (request.condition.startsWith('native-')) {
    for (const feature of ['plugins', 'hooks', 'goals', 'multi_agent', 'skill_search']) {
      args.push('--disable', feature);
    }
    args.push('--config', 'project_doc_max_bytes=0');
  }
  args.push(request.prompt);
  return args;
}

export function buildClaudeArgs(request, { pluginDir }) {
  if (!request || !CONDITIONS.includes(request.condition) || !nonEmpty(request.model)
    || !nonEmpty(request.effort) || !nonEmpty(request.prompt)
    || !request.budget || !Number.isFinite(request.budget.maxBudgetUsd)) {
    throw new TypeError('invalid Claude actor request');
  }
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', request.model,
    '--effort', request.effort,
    '--max-budget-usd', String(request.budget.maxBudgetUsd),
    '--permission-mode', 'bypassPermissions',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--setting-sources', 'project',
  ];
  if (request.condition.startsWith('native-')) args.push('--safe-mode');
  else {
    if (!nonEmpty(pluginDir)) throw new TypeError('Full SIVS conditions require a plugin directory');
    args.push('--plugin-dir', pluginDir);
  }
  args.push(request.prompt);
  return args;
}

export function parseClaudeResult(stdout) {
  let value;
  try { value = JSON.parse(stdout); } catch { throw new TypeError('Claude output must be one JSON result object'); }
  if (!value || value.type !== 'result' || !value.usage || !Number.isFinite(value.duration_ms)) {
    throw new TypeError('Claude result is missing usage or duration');
  }
  const inputTokens = Number(value.usage.input_tokens || 0)
    + Number(value.usage.cache_read_input_tokens || 0)
    + Number(value.usage.cache_creation_input_tokens || 0);
  const outputTokens = Number(value.usage.output_tokens || 0);
  return {
    ok: value.is_error !== true && value.subtype === 'success',
    inputTokens,
    outputTokens,
    wallSeconds: value.duration_ms / 1000,
    costUsd: Number(value.total_cost_usd || 0),
    result: typeof value.result === 'string' ? value.result : '',
  };
}

export function parseCodexResult(stdout, { wallSeconds, exitCode }) {
  if (typeof stdout !== 'string' || !Number.isFinite(wallSeconds) || !Number.isInteger(exitCode)) {
    throw new TypeError('invalid Codex process result');
  }
  let usage = null;
  let result = '';
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message'
      && typeof event.item.text === 'string') result = event.item.text;
    if (event?.type === 'turn.completed' && event.usage) usage = event.usage;
  }
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) {
    return { ok: false, modelTurn: false, inputTokens: 0, outputTokens: 0,
      wallSeconds, costUsd: null, result, exitCode };
  }
  return {
    ok: exitCode === 0,
    modelTurn: true,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    wallSeconds,
    costUsd: null,
    result,
    exitCode,
  };
}

export function runBoundedProcess(command, args, { cwd, timeoutMs, maxBuffer }) {
  if (!nonEmpty(command) || !Array.isArray(args) || !nonEmpty(cwd)
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isFinite(maxBuffer) || maxBuffer <= 0) {
    throw new TypeError('bounded process requires command, args, cwd, timeoutMs, and maxBuffer');
  }
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let bufferExceeded = false;
    let spawnError = null;
    let killTimer = null;
    const append = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxBuffer) target.push(chunk);
      else if (!bufferExceeded) {
        bufferExceeded = true;
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', chunk => append(stdout, chunk));
    child.stderr.on('data', chunk => append(stderr, chunk));
    child.on('error', error => { spawnError = error; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
          || (spawnError ? spawnError.message : ''),
        exitCode: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        timedOut,
        bufferExceeded,
      });
    });
  });
}

export async function scoreHiddenAcceptance({ workspace, task }, { timeoutMs = 120_000 } = {}) {
  if (!nonEmpty(workspace) || !task?.hiddenAcceptance || !nonEmpty(task.hiddenAcceptance.command)) {
    throw new TypeError('hidden scorer requires a workspace and command');
  }
  const run = spawnSync('/bin/sh', ['-lc', task.hiddenAcceptance.command], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024,
  });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`.slice(0, 64 * 1024);
  return {
    passed: !run.error && run.status === 0,
    exitCode: Number.isInteger(run.status) ? run.status : null,
    signal: run.signal || null,
    outputHash: createHash('sha256').update(output).digest('hex'),
  };
}

export async function runPilot(input, {
  root, revision, actor, scorer, concurrency = 1, baselineRepository = null, cellLimit = null,
}) {
  const fixture = validatePilotFixture(input);
  if (!nonEmpty(root) || !/^[0-9a-f]{40}$/.test(revision || '')
    || typeof actor !== 'function' || typeof scorer !== 'function'
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4
    || (cellLimit !== null && (!Number.isInteger(cellLimit) || cellLimit < 1 || cellLimit > 20))) {
    throw new TypeError('runPilot requires root, a 40-character revision, actor, and scorer');
  }
  const tasks = new Map(fixture.tasks.map(task => [task.id, task]));
  const fullSchedule = buildPilotSchedule(fixture);
  const schedule = cellLimit === null ? fullSchedule : fullSchedule.slice(0, cellLimit);
  const rawRuns = new Array(schedule.length);
  let cursor = 0;
  const runCell = async index => {
    const cell = schedule[index];
    const task = tasks.get(cell.taskId);
    const cellRoot = join(root, `${cell.taskId}-${cell.condition}`);
    if (baselineRepository) {
      cloneBaselineRepository({ repository: baselineRepository, revision,
        workspace: resolve(cellRoot, task.id) });
    }
    const workspace = materializeTask(cellRoot, task);
    const prompt = buildActorPrompt(task.prompt, cell.condition, task.category);
    const actorResult = await actor({ ...cell, workspace, prompt, model: fixture.model,
      effort: fixture.effort, budget: fixture.budget });
    if (actorResult?.modelTurn !== true || !Number.isSafeInteger(actorResult.inputTokens)
      || actorResult.inputTokens < 0 || !Number.isSafeInteger(actorResult.outputTokens)
      || actorResult.outputTokens < 0 || !Number.isFinite(actorResult.wallSeconds)
      || actorResult.wallSeconds < 0
      || !validControllerEvidence(cell.condition, actorResult.controller)) {
      throw new PilotInvalidActorError({ cell, model: fixture.model, effort: fixture.effort,
        revision, actor: actorResult });
    }
    const hiddenAcceptance = await scorer({ ...cell, workspace, task, actorResult });
    if (typeof hiddenAcceptance?.passed !== 'boolean') {
      throw new TypeError('hidden scorer must return a boolean passed value');
    }
    const rawRun = {
      ...cell,
      model: fixture.model,
      effort: fixture.effort,
      revision,
      promptDigest: createHash('sha256').update(prompt).digest('hex'),
      actor: actorResult,
      hiddenAcceptance,
    };
    const verdict = classifyPilotRun(rawRun, fixture.budget);
    if (!verdict.valid) throw new TypeError(`PILOT_INVALID_RUN_EVIDENCE ${verdict.reasons.join(',')}`);
    rawRuns[index] = { ...rawRun, verdict };
  };
  const worker = async () => {
    while (cursor < schedule.length) {
      const index = cursor;
      cursor += 1;
      await runCell(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, schedule.length) }, () => worker()));
  if (cellLimit !== null) return { dataset: null, rawRuns, report: null };
  const dataset = {
    schema: 1,
    budget: {
      maxInputTokens: fixture.budget.maxInputTokens,
      maxOutputTokens: fixture.budget.maxOutputTokens,
      maxWallSeconds: fixture.budget.maxWallSeconds,
    },
    runs: rawRuns.map(run => ({
      taskId: run.taskId,
      repetition: run.repetition,
      condition: run.condition,
      result: {
        success: run.verdict.success,
        escapedDefects: run.hiddenAcceptance.passed === true ? 0 : 1,
        humanCorrections: 0,
        inputTokens: run.actor.inputTokens,
        outputTokens: run.actor.outputTokens,
        wallSeconds: run.actor.wallSeconds,
      },
    })),
  };
  return { dataset, rawRuns, report: evaluateHarness(dataset) };
}
