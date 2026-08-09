import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { CONDITIONS, evaluateHarness } from '../evaluate-harness.mjs';

export { CONDITIONS };

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a finite positive number`);
  return value;
}

function validControllerEvidence(condition, value) {
  if (condition.endsWith('-ephemeral')) return value === null;
  return value && value.admitted === true && value.initializeCode === 'INITIALIZED'
    && value.activeCode === 'ALLOWED' && value.terminalCode === 'ALLOWED'
    && nonEmpty(value.processId) && /^[0-9a-f]{64}$/.test(value.auditDigest || '');
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

export function buildActorPrompt(taskPrompt, condition) {
  const mode = condition.endsWith('-durable')
    ? 'Execution metadata: durable=true, longRunning=true. Maintain bounded durable progress and recover safely after interruption.'
    : 'Execution metadata: durable=false, longRunning=false. Use an ephemeral solo execution path.';
  const assurance = condition.startsWith('full-sivs-')
    ? '$Qplan Execute the task through Full SIVS with independent verification before claiming completion.'
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
    const prompt = buildActorPrompt(task.prompt, cell.condition);
    const actorResult = await actor({ ...cell, workspace, prompt, model: fixture.model,
      effort: fixture.effort, budget: fixture.budget });
    if (actorResult?.modelTurn !== true || !Number.isFinite(actorResult.inputTokens)
      || actorResult.inputTokens <= 0 || !Number.isFinite(actorResult.outputTokens)
      || !Number.isFinite(actorResult.wallSeconds)
      || !validControllerEvidence(cell.condition, actorResult.controller)) {
      throw new PilotInvalidActorError({ cell, model: fixture.model, effort: fixture.effort,
        revision, actor: actorResult });
    }
    const hiddenAcceptance = await scorer({ ...cell, workspace, task, actorResult });
    const success = actorResult.ok === true && hiddenAcceptance.passed === true;
    rawRuns[index] = {
      ...cell,
      model: fixture.model,
      effort: fixture.effort,
      revision,
      promptDigest: createHash('sha256').update(prompt).digest('hex'),
      actor: actorResult,
      hiddenAcceptance,
    };
    if (!success && hiddenAcceptance.passed !== false) throw new TypeError('hidden scorer must return a boolean passed value');
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
        success: run.actor.ok === true && run.hiddenAcceptance.passed === true,
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
