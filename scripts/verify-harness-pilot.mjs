#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_GENERATION_BYTES = 8 * 1024 * 1024;
const REQUIRED_GENERATION_FILES = Object.freeze(['RUN.md', 'report.json', 'results.json', 'runtime.json']);
const LEGACY_EXPECTED_INDEXES = Array.from({ length: 20 }, (_, index) => index);
const CONDITIONS = Object.freeze([
  'native-ephemeral',
  'native-durable',
  'full-sivs-ephemeral',
  'full-sivs-durable',
]);
const CLAIM_V2_KEYS = Object.freeze([
  'budget', 'createdAt', 'expectedCellCount', 'fixtureDigest', 'invocationId', 'kind',
  'revision', 'scheduleDigest', 'scheduleManifest', 'schema', 'smokeAttemptIds',
]);
const MANIFEST_KEYS = Object.freeze([
  'budgetDigest', 'conditions', 'effort', 'model', 'orderedTaskIds', 'repetition', 'schema', 'seed',
]);
const BUDGET_KEYS = Object.freeze(['maxInputTokens', 'maxOutputTokens', 'maxWallSeconds']);
const FIXTURE_KEYS = Object.freeze([
  'budget', 'effort', 'model', 'repetition', 'schema', 'seed', 'tasks',
]);
const FIXTURE_BUDGET_KEYS = Object.freeze([
  'maxBudgetUsd', 'maxInputTokens', 'maxOutputTokens', 'maxWallSeconds',
]);
const FIXTURE_TASK_KEYS = Object.freeze([
  'category', 'hiddenAcceptance', 'id', 'prompt', 'starterFiles',
]);
const CELL_KEYS = Object.freeze(['budgetDigest', 'condition', 'effort', 'model', 'repetition', 'taskId']);
const SCHEDULE_CELL_KEYS = Object.freeze(['condition', 'repetition', 'taskId']);
const FAILED_EVIDENCE_KEYS = Object.freeze(['actor', 'cell', 'effort', 'model', 'revision']);
const STARTED_V2_KEYS = Object.freeze([
  'at', 'cell', 'cellIdentity', 'index', 'invocationId', 'kind', 'revision', 'schema',
]);
const TERMINAL_COMPLETED_V2_KEYS = Object.freeze([
  ...STARTED_V2_KEYS, 'run', 'status',
]);
const TERMINAL_FAILED_V2_KEYS = Object.freeze([
  ...TERMINAL_COMPLETED_V2_KEYS, 'error', 'evidence',
]);
const EXECUTE_TERMINAL_COMMON_KEYS = Object.freeze([
  'at', 'claimDigest', 'completedIndexes', 'failedIndexes', 'invocationId', 'kind',
  'revision', 'schema', 'status', 'unstartedIndexes',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX40_RE = /^[0-9a-f]{40}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const RAW_RUN_KEYS = Object.freeze([
  'actor', 'condition', 'effort', 'hiddenAcceptance', 'model', 'promptDigest',
  'repetition', 'revision', 'taskId', 'verdict',
]);
const DATASET_RESULT_KEYS = Object.freeze([
  'escapedDefects', 'humanCorrections', 'inputTokens', 'outputTokens', 'success', 'wallSeconds',
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function canonicalIso(value) {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function digest(value) {
  const canonical = JSON.stringify(value, (_, item) => item && typeof item === 'object'
    && !Array.isArray(item) ? Object.fromEntries(Object.entries(item)
      .sort(([a], [b]) => a.localeCompare(b))) : item);
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readBytesNoFollow(path, maxBytes = MAX_EVIDENCE_BYTES) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error(`unsafe evidence: ${path}`);
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`evidence changed: ${path}`);
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error(`short evidence read: ${path}`);
      offset += count;
    }
    return bytes;
  } finally { closeSync(fd); }
}

function readJsonNoFollow(path, maxBytes = MAX_EVIDENCE_BYTES) {
  return JSON.parse(readBytesNoFollow(path, maxBytes).toString('utf8'));
}

function entryExists(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function exactPartition(terminal, expectedCount) {
  const groups = [terminal.completedIndexes, terminal.failedIndexes, terminal.unstartedIndexes];
  if (!groups.every(Array.isArray)) return false;
  const flat = groups.flat();
  return flat.length === expectedCount && new Set(flat).size === expectedCount
    && flat.every(Number.isInteger)
    && [...flat].sort((a, b) => a - b).every((value, index) => value === index);
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`));
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value) || value.includes('\0')) {
    return false;
  }
  const normalized = relative('.', value);
  return normalized !== '..' && !normalized.startsWith(`..${sep}`) && !isAbsolute(normalized);
}

function validateTrustedFixture(value) {
  if (!exactKeys(value, FIXTURE_KEYS) || value.schema !== 1
    || typeof value.seed !== 'string' || !value.seed.trim()
    || typeof value.model !== 'string' || !value.model.trim()
    || typeof value.effort !== 'string' || !value.effort.trim()
    || !Number.isSafeInteger(value.repetition) || !Array.isArray(value.tasks)
    || !((value.tasks.length === 5 && value.repetition === 1)
      || (value.tasks.length === 20 && value.repetition === 3))) {
    throw new Error('invalid trusted fixture profile');
  }
  const budget = value.budget;
  if (!exactKeys(budget, FIXTURE_BUDGET_KEYS)
    || !Number.isSafeInteger(budget.maxInputTokens) || budget.maxInputTokens <= 0
    || !Number.isSafeInteger(budget.maxOutputTokens) || budget.maxOutputTokens <= 0
    || !Number.isFinite(budget.maxWallSeconds) || budget.maxWallSeconds <= 0
    || !Number.isFinite(budget.maxBudgetUsd) || budget.maxBudgetUsd <= 0) {
    throw new Error('invalid trusted fixture budget');
  }
  const ids = new Set();
  for (const task of value.tasks) {
    if (!exactKeys(task, FIXTURE_TASK_KEYS) || !TASK_ID_RE.test(task.id || '') || ids.has(task.id)
      || typeof task.category !== 'string' || !task.category.trim()
      || typeof task.prompt !== 'string' || !task.prompt.trim()
      || !plainObject(task.starterFiles) || Object.keys(task.starterFiles).length === 0
      || !Object.entries(task.starterFiles)
        .every(([path, content]) => safeRelativePath(path) && typeof content === 'string')
      || !exactKeys(task.hiddenAcceptance, ['command'])
      || typeof task.hiddenAcceptance.command !== 'string'
      || !task.hiddenAcceptance.command.trim()) {
      throw new Error(`invalid trusted fixture task: ${task?.id || 'unknown'}`);
    }
    ids.add(task.id);
  }
  return value;
}

function readTrustedFixture(path) {
  const absolute = resolve(path);
  if (realpathSync(absolute) !== absolute) throw new Error('unsafe trusted fixture path');
  return readJsonNoFollow(absolute);
}

function bindTrustedFixture(claim, options) {
  const hasObject = options.fixture !== undefined;
  const hasPath = options.fixturePath !== undefined;
  const hasDigest = options.expectedFixtureDigest !== undefined;
  if (hasObject && hasPath) throw new Error('trusted fixture sources conflict');
  if ((!hasObject && !hasPath) || !hasDigest) return null;
  if (!HEX64_RE.test(options.expectedFixtureDigest || '')) {
    throw new Error('invalid trusted fixture digest');
  }
  const fixture = validateTrustedFixture(hasObject ? options.fixture : readTrustedFixture(options.fixturePath));
  const fixtureDigest = digest(fixture);
  if (fixtureDigest !== options.expectedFixtureDigest || fixtureDigest !== claim.fixtureDigest) {
    throw new Error('trusted fixture digest mismatch');
  }
  const runtimeBudget = {
    maxInputTokens: fixture.budget.maxInputTokens,
    maxOutputTokens: fixture.budget.maxOutputTokens,
    maxWallSeconds: fixture.budget.maxWallSeconds,
  };
  const expectedManifest = {
    schema: 1,
    seed: fixture.seed,
    orderedTaskIds: fixture.tasks.map(task => task.id),
    repetition: fixture.repetition,
    conditions: [...CONDITIONS],
    model: fixture.model,
    effort: fixture.effort,
    budgetDigest: digest(['qe-pilot-budget-v1', runtimeBudget.maxInputTokens,
      runtimeBudget.maxOutputTokens, runtimeBudget.maxWallSeconds]),
  };
  if (!sameValue(claim.budget, runtimeBudget)
    || !sameValue(claim.scheduleManifest, expectedManifest)) {
    throw new Error('trusted fixture manifest mismatch');
  }
  return fixtureDigest;
}

function assertRealDirectory(path, parent = null) {
  const absolute = resolve(path);
  const entry = lstatSync(absolute);
  const canonical = realpathSync(absolute);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || (parent && !within(realpathSync(resolve(parent)), canonical))) {
    throw new Error(`unsafe directory: ${path}`);
  }
  return absolute;
}

function validateSchema2Run(run, claim, entry) {
  if (!exactKeys(run, RAW_RUN_KEYS) || run.taskId !== entry.taskId
    || run.repetition !== entry.repetition || run.condition !== entry.condition
    || run.model !== claim.scheduleManifest.model || run.effort !== claim.scheduleManifest.effort
    || run.revision !== claim.revision || !HEX64_RE.test(run.promptDigest || '')
    || !plainObject(run.actor) || run.actor.modelTurn !== true || typeof run.actor.ok !== 'boolean'
    || !Number.isSafeInteger(run.actor.inputTokens) || run.actor.inputTokens < 0
    || !Number.isSafeInteger(run.actor.outputTokens) || run.actor.outputTokens < 0
    || !Number.isFinite(run.actor.wallSeconds) || run.actor.wallSeconds < 0
    || typeof run.actor.timedOut !== 'boolean' || typeof run.actor.bufferExceeded !== 'boolean'
    || !exactKeys(run.hiddenAcceptance, ['exitCode', 'outputHash', 'passed', 'signal'])
    || typeof run.hiddenAcceptance.passed !== 'boolean'
    || !HEX64_RE.test(run.hiddenAcceptance.outputHash || '')
    || !(Number.isInteger(run.hiddenAcceptance.exitCode) || run.hiddenAcceptance.exitCode === null)
    || !(typeof run.hiddenAcceptance.signal === 'string' || run.hiddenAcceptance.signal === null)
    || !exactKeys(run.verdict, ['reasons', 'success', 'valid'])
    || typeof run.verdict.valid !== 'boolean' || typeof run.verdict.success !== 'boolean'
    || !Array.isArray(run.verdict.reasons) || !run.verdict.reasons.every(reason => typeof reason === 'string')) {
    throw new Error(`invalid generation run: ${entry.taskId}/${entry.repetition}/${entry.condition}`);
  }
  return run;
}

function classifySchema2Run(run, claim, entry) {
  validateSchema2Run(run, claim, entry);
  const actor = run.actor;
  const budget = claim.budget;
  if (actor.inputTokens > budget.maxInputTokens || actor.outputTokens > budget.maxOutputTokens
    || actor.wallSeconds > budget.maxWallSeconds || actor.timedOut || actor.bufferExceeded) {
    throw new Error(`run exceeds its evidence budget: ${entry.taskId}/${entry.repetition}/${entry.condition}`);
  }
  const durable = entry.condition.endsWith('-durable');
  const controller = actor.controller;
  if ((!durable && controller !== null) || (durable
    && (!exactKeys(controller, ['activeCode', 'admissionCode', 'admitted', 'auditDigest',
      'initializeCode', 'processId', 'terminalCode'])
      || controller.admitted !== true || controller.admissionCode !== 'ADMITTED'
      || controller.initializeCode !== 'INITIALIZED' || controller.activeCode !== 'ALLOWED'
      || controller.terminalCode !== 'ALLOWED' || typeof controller.processId !== 'string'
      || !controller.processId || !HEX64_RE.test(controller.auditDigest || '')))) {
    throw new Error(`invalid controller evidence: ${entry.taskId}/${entry.repetition}/${entry.condition}`);
  }
  const hidden = run.hiddenAcceptance;
  if ((hidden.passed && (hidden.exitCode !== 0 || hidden.signal !== null))
    || (!hidden.passed && (!Number.isInteger(hidden.exitCode)
      || hidden.exitCode === 0 || hidden.signal !== null))) {
    throw new Error(`invalid hidden acceptance: ${entry.taskId}/${entry.repetition}/${entry.condition}`);
  }
  const reasons = [];
  if (!actor.ok) reasons.push('ACTOR_FAILED');
  if (!hidden.passed) reasons.push('HIDDEN_ACCEPTANCE_FAILED');
  const success = actor.ok === true && hidden.passed === true;
  if (run.verdict.valid !== true || run.verdict.success !== success
    || !sameValue(run.verdict.reasons, reasons)) {
    throw new Error(`stored verdict mismatch: ${entry.taskId}/${entry.repetition}/${entry.condition}`);
  }
  return { success, reasons };
}

function expectedDatasetResult(run) {
  return {
    success: run.verdict.success,
    escapedDefects: run.hiddenAcceptance.passed === true ? 0 : 1,
    humanCorrections: 0,
    inputTokens: run.actor.inputTokens,
    outputTokens: run.actor.outputTokens,
    wallSeconds: run.actor.wallSeconds,
  };
}

function evaluateStoredDataset(dataset) {
  const metrics = ['success', 'escapedDefects', 'humanCorrections',
    'inputTokens', 'outputTokens', 'wallSeconds'];
  const groups = new Set();
  const values = Object.fromEntries(CONDITIONS.map(condition => [condition,
    Object.fromEntries(metrics.map(metric => [metric, []]))]));
  for (const run of dataset.runs) {
    groups.add(`${run.taskId}\0${run.repetition}`);
    for (const metric of metrics) {
      values[run.condition][metric].push(metric === 'success'
        ? (run.result[metric] ? 1 : 0) : run.result[metric]);
    }
  }
  const mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
  const conditions = Object.fromEntries(CONDITIONS.map(condition => [condition, {
    runs: values[condition].success.length,
    means: Object.fromEntries(metrics.map(metric => [metric, mean(values[condition][metric])])),
  }]));
  const contrast = (metric, plus, minus) => mean(plus.map(condition => conditions[condition].means[metric]))
    - mean(minus.map(condition => conditions[condition].means[metric]));
  const effects = {};
  for (const metric of metrics) {
    effects[metric] = {
      assurance: contrast(metric, ['full-sivs-ephemeral', 'full-sivs-durable'],
        ['native-ephemeral', 'native-durable']),
      controller: contrast(metric, ['native-durable', 'full-sivs-durable'],
        ['native-ephemeral', 'full-sivs-ephemeral']),
      interaction: (conditions['full-sivs-durable'].means[metric]
        - conditions['full-sivs-ephemeral'].means[metric])
        - (conditions['native-durable'].means[metric]
          - conditions['native-ephemeral'].means[metric]),
    };
  }
  return { schema: 1, balancedPairs: groups.size, sharedBudget: dataset.budget,
    conditions, effects };
}

function validateRunSummary(summary, claim, schedule) {
  const lines = summary.split(/\r?\n/).map(line => line.trim());
  const repetitions = claim.scheduleManifest.repetition;
  const expected = [
    `- Runs: ${schedule.length}`,
    `- Balanced task/repetition pairs: ${claim.scheduleManifest.orderedTaskIds.length * repetitions}`,
  ];
  for (const line of expected) {
    const prefix = line.slice(0, line.indexOf(':') + 1);
    if (lines.filter(candidate => candidate.startsWith(prefix)).length !== 1
      || !lines.includes(line)) throw new Error('run summary does not match schedule');
  }
  const notes = lines.filter(line => line.startsWith('> Pilot only:') || line.startsWith('> Study run:'));
  const expectedNote = repetitions === 1
    ? '> Pilot only: one repetition cannot establish production effectiveness.'
    : `> Study run: ${repetitions} repetitions per task; interpret results with the preregistered limitations.`;
  if (notes.length !== 1 || notes[0] !== expectedNote) {
    throw new Error('run summary does not match schedule');
  }
}

function verifyGeneration(root, terminal, { claim = null, schedule = null } = {}) {
  const current = readJsonNoFollow(join(root, 'current.json'));
  if (current.generation !== terminal.generation || current.manifestHash !== terminal.manifestHash) {
    throw new Error('terminal/current identity mismatch');
  }
  const strict = claim !== null;
  if (strict && (!exactKeys(current, ['generation', 'manifestHash', 'revision', 'schema'])
    || current.schema !== 1 || current.revision !== claim.revision
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(current.generation)
    || !HEX64_RE.test(current.manifestHash || ''))) throw new Error('invalid current pointer');
  if (strict) assertRealDirectory(root);
  const generationsRoot = strict ? assertRealDirectory(join(root, 'generations'), root)
    : join(root, 'generations');
  const generationRoot = strict
    ? assertRealDirectory(join(generationsRoot, current.generation), generationsRoot)
    : join(generationsRoot, current.generation);
  const manifestText = strict
    ? readBytesNoFollow(join(generationRoot, 'manifest.json'))
    : readFileSync(join(generationRoot, 'manifest.json'));
  if (sha256(manifestText) !== current.manifestHash) throw new Error('manifest hash mismatch');
  const manifest = JSON.parse(manifestText.toString('utf8'));
  if (strict && (!exactKeys(manifest, ['files', 'generation', 'revision', 'schema'])
    || manifest.schema !== 1 || manifest.generation !== current.generation
    || manifest.revision !== claim.revision || !exactKeys(manifest.files,
      REQUIRED_GENERATION_FILES))) throw new Error('invalid generation manifest');
  const contents = new Map();
  let totalBytes = 0;
  for (const [name, expected] of Object.entries(manifest.files || {})) {
    const content = strict ? readBytesNoFollow(join(generationRoot, name))
      : readFileSync(join(generationRoot, name));
    totalBytes += content.length;
    if (basename(name) !== name || !HEX64_RE.test(expected || '')
      || sha256(content) !== expected || (strict && totalBytes > MAX_GENERATION_BYTES)) {
      throw new Error(`artifact hash mismatch: ${name}`);
    }
    contents.set(name, content);
  }
  if (!strict) return null;
  const runtime = JSON.parse(contents.get('runtime.json').toString('utf8'));
  const results = JSON.parse(contents.get('results.json').toString('utf8'));
  const report = JSON.parse(contents.get('report.json').toString('utf8'));
  const summary = contents.get('RUN.md').toString('utf8');
  if (!exactKeys(runtime, ['budget', 'mode', 'revision', 'schema', 'smokeAttemptIds'])
    || runtime.schema !== 1 || runtime.mode !== 'execute' || runtime.revision !== claim.revision
    || !sameValue(runtime.budget, claim.budget)
    || !sameValue(runtime.smokeAttemptIds, claim.smokeAttemptIds)
    || !exactKeys(results, ['budget', 'rawRuns', 'runs', 'schema']) || results.schema !== 1
    || !sameValue(results.budget, claim.budget) || !Array.isArray(results.rawRuns)
    || !Array.isArray(results.runs) || results.rawRuns.length !== schedule.length
    || results.runs.length !== schedule.length || !plainObject(report) || !summary.trim()) {
    throw new Error('invalid generation payload');
  }
  for (let index = 0; index < schedule.length; index += 1) {
    const entry = schedule[index];
    const rawRun = results.rawRuns[index];
    classifySchema2Run(rawRun, claim, entry);
    const datasetRun = results.runs[index];
    if (!exactKeys(datasetRun, ['condition', 'repetition', 'result', 'taskId'])
      || datasetRun.taskId !== entry.taskId || datasetRun.repetition !== entry.repetition
      || datasetRun.condition !== entry.condition || !exactKeys(datasetRun.result, DATASET_RESULT_KEYS)
      || !sameValue(datasetRun.result, expectedDatasetResult(rawRun))) {
      throw new Error(`invalid dataset run: ${index}`);
    }
  }
  if (!sameValue(report, evaluateStoredDataset(results))) throw new Error('report does not match dataset');
  validateRunSummary(summary, claim, schedule);
  return results.rawRuns;
}

function verifyLegacy(root, claim, terminalPath, cellsRoot) {
  if (claim.kind !== 'execute-claim' || typeof claim.invocationId !== 'string'
    || !HEX40_RE.test(claim.revision || '')) throw new Error('invalid execute claim');
  if (!entryExists(terminalPath)) return { classification: 'nonterminal', invocationId: claim.invocationId };
  const terminal = readJsonNoFollow(terminalPath);
  if (terminal.schema !== 1 || terminal.kind !== 'execute-terminal'
    || terminal.invocationId !== claim.invocationId || terminal.revision !== claim.revision
    || terminal.claimDigest !== digest(claim) || !exactPartition(terminal, 20)) {
    throw new Error('invalid execute terminal');
  }
  if (terminal.status === 'failed') return {
    classification: 'failed', invocationId: claim.invocationId,
    completedIndexes: terminal.completedIndexes, failedIndexes: terminal.failedIndexes,
    unstartedIndexes: terminal.unstartedIndexes,
  };
  if (terminal.status !== 'succeeded' || terminal.completedIndexes.length !== 20
    || terminal.failedIndexes.length || terminal.unstartedIndexes.length) {
    throw new Error('invalid success partition');
  }
  for (const index of LEGACY_EXPECTED_INDEXES) {
    const cellRoot = join(cellsRoot, String(index).padStart(3, '0'));
    const started = readJsonNoFollow(join(cellRoot, 'started.json'));
    const cellTerminal = readJsonNoFollow(join(cellRoot, 'terminal.json'));
    const schema2CellShape = value => value.schema === 2 || Object.hasOwn(value, 'cellIdentity')
      || (plainObject(value.cell) && ['budgetDigest', 'effort', 'model']
        .some(key => Object.hasOwn(value.cell, key)));
    if (schema2CellShape(started) || schema2CellShape(cellTerminal)) {
      throw new Error(`schema 2 cell evidence cannot use the legacy route: ${index}`);
    }
    if (started.invocationId !== claim.invocationId || started.index !== index
      || cellTerminal.invocationId !== claim.invocationId || cellTerminal.index !== index
      || cellTerminal.status !== 'completed') throw new Error(`invalid cell evidence: ${index}`);
  }
  verifyGeneration(root, terminal);
  return { classification: 'succeeded', invocationId: claim.invocationId,
    generation: terminal.generation };
}

function orderDigest(seed, taskId, repetition, condition) {
  return sha256(Buffer.from(`${seed}\0${taskId}\0${repetition}\0${condition}`, 'utf8'));
}

function validateBudget(budget) {
  if (!exactKeys(budget, BUDGET_KEYS)
    || !Number.isSafeInteger(budget.maxInputTokens) || budget.maxInputTokens <= 0
    || !Number.isSafeInteger(budget.maxOutputTokens) || budget.maxOutputTokens <= 0
    || !Number.isFinite(budget.maxWallSeconds) || budget.maxWallSeconds <= 0) {
    throw new Error('invalid claim budget');
  }
  return budget;
}

function reconstructSchedule(claim) {
  if (!exactKeys(claim, CLAIM_V2_KEYS) || claim.schema !== 2 || claim.kind !== 'execute-claim'
    || !UUID_RE.test(claim.invocationId || '') || !HEX40_RE.test(claim.revision || '')
    || !canonicalIso(claim.createdAt) || !HEX64_RE.test(claim.fixtureDigest || '')
    || !Array.isArray(claim.smokeAttemptIds) || claim.smokeAttemptIds.length !== 2
    || !claim.smokeAttemptIds.every(id => UUID_RE.test(id))) throw new Error('invalid schema 2 claim');
  const budget = validateBudget(claim.budget);
  const manifest = claim.scheduleManifest;
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.schema !== 1
    || typeof manifest.seed !== 'string' || !manifest.seed.trim()
    || typeof manifest.model !== 'string' || !manifest.model.trim()
    || typeof manifest.effort !== 'string' || !manifest.effort.trim()
    || !HEX64_RE.test(manifest.budgetDigest || '')
    || !Array.isArray(manifest.orderedTaskIds)
    || !manifest.orderedTaskIds.every(id => TASK_ID_RE.test(id))
    || new Set(manifest.orderedTaskIds).size !== manifest.orderedTaskIds.length
    || JSON.stringify(manifest.conditions) !== JSON.stringify(CONDITIONS)) {
    throw new Error('invalid schedule manifest');
  }
  const profileValid = (manifest.orderedTaskIds.length === 5 && manifest.repetition === 1
    && claim.expectedCellCount === 20)
    || (manifest.orderedTaskIds.length === 20 && manifest.repetition === 3
      && claim.expectedCellCount === 240);
  if (!profileValid || !Number.isSafeInteger(claim.expectedCellCount)) {
    throw new Error('invalid schedule profile');
  }
  const budgetDigest = digest(['qe-pilot-budget-v1', budget.maxInputTokens,
    budget.maxOutputTokens, budget.maxWallSeconds]);
  if (manifest.budgetDigest !== budgetDigest) throw new Error('budget digest mismatch');
  const schedule = manifest.orderedTaskIds.flatMap(taskId =>
    Array.from({ length: manifest.repetition }, (_, index) => index + 1)
      .flatMap(repetition => CONDITIONS.map((condition, conditionIndex) => ({
        taskId, repetition, condition, conditionIndex,
        order: orderDigest(manifest.seed, taskId, repetition, condition),
      })).sort((left, right) => left.order.localeCompare(right.order)
        || left.conditionIndex - right.conditionIndex)
        .map(({ conditionIndex, order, ...cell }) => cell)));
  if (schedule.length !== claim.expectedCellCount
    || digest(schedule.map((entry, index) => ({ index, ...entry }))) !== claim.scheduleDigest) {
    throw new Error('schedule digest mismatch');
  }
  return { schedule, budgetDigest };
}

function fullCell(claim, entry) {
  return {
    taskId: entry.taskId,
    repetition: entry.repetition,
    condition: entry.condition,
    model: claim.scheduleManifest.model,
    effort: claim.scheduleManifest.effort,
    budgetDigest: claim.scheduleManifest.budgetDigest,
  };
}

function cellIdentity(cell) {
  return digest(['qe-pilot-cell-v1', cell.taskId, cell.repetition, cell.condition,
    cell.model, cell.effort, cell.budgetDigest]);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyCellEvidence(root, claim, terminal, schedule, rawRuns = null) {
  const cellsRoot = join(root, '.pilot-execute-cells');
  assertRealDirectory(cellsRoot, root);
  const expectedStarted = new Set([...terminal.completedIndexes, ...terminal.failedIndexes]
    .map(index => String(index).padStart(3, '0')));
  const actual = readdirSync(cellsRoot).sort();
  if (actual.length !== expectedStarted.size || actual.some(name => !expectedStarted.has(name))) {
    throw new Error('cell directory partition mismatch');
  }
  const completed = new Set(terminal.completedIndexes);
  for (const index of [...terminal.completedIndexes, ...terminal.failedIndexes]) {
    const cellRoot = assertRealDirectory(
      join(cellsRoot, String(index).padStart(3, '0')), cellsRoot);
    const started = readJsonNoFollow(join(cellRoot, 'started.json'));
    const cellTerminal = readJsonNoFollow(join(cellRoot, 'terminal.json'));
    const expectedCell = fullCell(claim, schedule[index]);
    const expectedIdentity = cellIdentity(expectedCell);
    if (!exactKeys(started, STARTED_V2_KEYS) || started.schema !== 2
      || started.kind !== 'cell-started' || started.invocationId !== claim.invocationId
      || started.revision !== claim.revision || !canonicalIso(started.at) || started.index !== index
      || !exactKeys(started.cell, CELL_KEYS) || !sameValue(started.cell, expectedCell)
      || started.cellIdentity !== expectedIdentity) throw new Error(`invalid cell start: ${index}`);
    const isCompleted = completed.has(index);
    const terminalKeys = isCompleted ? TERMINAL_COMPLETED_V2_KEYS : TERMINAL_FAILED_V2_KEYS;
    if (!exactKeys(cellTerminal, terminalKeys) || cellTerminal.schema !== 2
      || cellTerminal.kind !== 'cell-terminal' || cellTerminal.invocationId !== claim.invocationId
      || cellTerminal.revision !== claim.revision || !canonicalIso(cellTerminal.at)
      || cellTerminal.index !== index || !exactKeys(cellTerminal.cell, CELL_KEYS)
      || !sameValue(cellTerminal.cell, expectedCell) || cellTerminal.cellIdentity !== expectedIdentity
      || cellTerminal.status !== (isCompleted ? 'completed' : 'failed')) {
      throw new Error(`invalid cell terminal: ${index}`);
    }
    if (isCompleted) {
      const run = cellTerminal.run;
      classifySchema2Run(run, claim, schedule[index]);
      if (rawRuns && !sameValue(run, rawRuns[index])) {
        throw new Error(`invalid completed run identity: ${index}`);
      }
    } else {
      if (cellTerminal.run !== null) classifySchema2Run(cellTerminal.run, claim, schedule[index]);
      if (!(cellTerminal.evidence === null || plainObject(cellTerminal.evidence))
        || !exactKeys(cellTerminal.error, ['code', 'message'])
        || typeof cellTerminal.error.code !== 'string'
        || typeof cellTerminal.error.message !== 'string') {
        throw new Error(`invalid failed cell error: ${index}`);
      }
      if (plainObject(cellTerminal.evidence)) {
        const evidence = cellTerminal.evidence;
        if (!exactKeys(evidence, FAILED_EVIDENCE_KEYS)
          || !exactKeys(evidence.cell, SCHEDULE_CELL_KEYS)
          || !sameValue(evidence.cell, schedule[index])
          || evidence.model !== expectedCell.model || evidence.effort !== expectedCell.effort
          || evidence.revision !== claim.revision
          || !(evidence.actor === null || plainObject(evidence.actor))) {
          throw new Error(`invalid failed cell evidence identity: ${index}`);
        }
      }
    }
  }
}

function verifySchema2(root, claim, terminalPath, options) {
  assertRealDirectory(root);
  const { schedule } = reconstructSchedule(claim);
  if (!entryExists(terminalPath)) return { classification: 'nonterminal', invocationId: claim.invocationId };
  const terminal = readJsonNoFollow(terminalPath);
  const terminalKeys = terminal.status === 'succeeded'
    ? [...EXECUTE_TERMINAL_COMMON_KEYS, 'generation', 'manifestHash']
    : terminal.status === 'failed' ? [...EXECUTE_TERMINAL_COMMON_KEYS, 'error'] : [];
  if (!exactKeys(terminal, terminalKeys) || terminal.schema !== 2
    || terminal.kind !== 'execute-terminal' || terminal.invocationId !== claim.invocationId
    || terminal.revision !== claim.revision || !canonicalIso(terminal.at)
    || terminal.claimDigest !== digest(claim)
    || !exactPartition(terminal, claim.expectedCellCount)) throw new Error('invalid schema 2 terminal');
  if (terminal.status === 'succeeded' && (terminal.completedIndexes.length !== claim.expectedCellCount
    || terminal.failedIndexes.length || terminal.unstartedIndexes.length)) {
    throw new Error('invalid schema 2 success partition');
  }
  if (terminal.status === 'failed' && (!exactKeys(terminal.error, ['code', 'message'])
    || typeof terminal.error.code !== 'string' || typeof terminal.error.message !== 'string')) {
    throw new Error('invalid schema 2 failure');
  }
  if (terminal.status === 'failed') {
    verifyCellEvidence(root, claim, terminal, schedule);
    return {
      classification: 'failed', invocationId: claim.invocationId,
      completedIndexes: terminal.completedIndexes, failedIndexes: terminal.failedIndexes,
      unstartedIndexes: terminal.unstartedIndexes,
    };
  }
  const rawRuns = verifyGeneration(root, terminal, { claim, schedule });
  verifyCellEvidence(root, claim, terminal, schedule, rawRuns);
  if (bindTrustedFixture(claim, options) === null) return {
    classification: 'unbound', invocationId: claim.invocationId,
    reason: 'schema 2 success requires one trusted fixture preimage and its out-of-band digest',
  };
  return { classification: 'succeeded', invocationId: claim.invocationId,
    generation: terminal.generation };
}

/**
 * Verify an immutable pilot/study output tree without trusting the runner's schedule projection.
 * @param {string} outputRoot - Harness-owned output directory.
 * @param {{fixture?: object, fixturePath?: string, expectedFixtureDigest?: string}} options - Trusted schema-2 binding.
 * @returns {{classification: string, reason?: string, invocationId?: string, generation?: string,
 * completedIndexes?: number[], failedIndexes?: number[], unstartedIndexes?: number[]}}
 */
export function verifyPilotOutput(outputRoot, options = {}) {
  const root = resolve(outputRoot);
  const claimPath = join(root, '.pilot-execute-claim.json');
  const terminalPath = join(root, '.pilot-execute-terminal.json');
  const cellsRoot = join(root, '.pilot-execute-cells');
  const hasClaim = entryExists(claimPath);
  const hasOther = entryExists(terminalPath) || entryExists(cellsRoot) || entryExists(join(root, 'current.json'));
  if (!hasClaim) return hasOther
    ? { classification: 'corrupt', reason: 'execute evidence exists without claim' }
    : { classification: 'empty', reason: 'no execute claim' };
  try {
    const claim = readJsonNoFollow(claimPath);
    if (claim.schema === 1) {
      const schema2Keys = ['expectedCellCount', 'scheduleManifest'];
      const hasSchema2Authority = options.fixture !== undefined || options.fixturePath !== undefined
        || options.expectedFixtureDigest !== undefined;
      if (schema2Keys.some(key => Object.hasOwn(claim, key)) || hasSchema2Authority) {
        throw new Error('schema 2 evidence cannot use the legacy verification route');
      }
      return verifyLegacy(root, claim, terminalPath, cellsRoot);
    }
    if (claim.schema === 2) return verifySchema2(root, claim, terminalPath, options);
    throw new Error('invalid execute claim schema');
  } catch (error) {
    return { classification: 'corrupt', reason: error.message };
  }
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const args = process.argv.slice(2);
  const outputRoot = args.shift();
  let fixturePath;
  let expectedFixtureDigest;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--fixture') fixturePath = args.shift();
    else if (arg === '--fixture-digest') expectedFixtureDigest = args.shift();
    else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      process.exitCode = 2;
    }
  }
  if (!outputRoot || process.exitCode) {
    if (!outputRoot) process.stderr.write('usage: verify-harness-pilot.mjs <output-root> [--fixture <path> --fixture-digest <sha256>]\n');
    process.exitCode = 2;
  } else {
    const result = verifyPilotOutput(outputRoot, { fixturePath, expectedFixtureDigest });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.classification !== 'succeeded') process.exitCode = 2;
  }
}
