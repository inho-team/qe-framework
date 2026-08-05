#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CONDITIONS = Object.freeze([
  'native-ephemeral',
  'native-durable',
  'full-sivs-ephemeral',
  'full-sivs-durable',
]);

const METRICS = Object.freeze([
  'success',
  'escapedDefects',
  'humanCorrections',
  'inputTokens',
  'outputTokens',
  'wallSeconds',
]);

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite non-negative number`);
  return value;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Validate a balanced four-condition dataset and compute descriptive effects. */
export function evaluateHarness(dataset) {
  if (!dataset || dataset.schema !== 1 || !Array.isArray(dataset.runs) || dataset.runs.length === 0) {
    throw new TypeError('dataset must use schema 1 and contain runs');
  }
  const budget = dataset.budget || {};
  const ceilings = {
    inputTokens: finiteNonNegative(budget.maxInputTokens, 'budget.maxInputTokens'),
    outputTokens: finiteNonNegative(budget.maxOutputTokens, 'budget.maxOutputTokens'),
    wallSeconds: finiteNonNegative(budget.maxWallSeconds, 'budget.maxWallSeconds'),
  };

  const groups = new Map();
  const values = Object.fromEntries(CONDITIONS.map((condition) => [condition, Object.fromEntries(METRICS.map((metric) => [metric, []]))]));
  for (const [index, run] of dataset.runs.entries()) {
    if (!run || typeof run.taskId !== 'string' || !run.taskId.trim() || !Number.isInteger(run.repetition) || run.repetition < 1) {
      throw new TypeError(`runs[${index}] has an invalid taskId or repetition`);
    }
    if (!CONDITIONS.includes(run.condition)) throw new TypeError(`runs[${index}] has an unknown condition`);
    const key = `${run.taskId}\u0000${run.repetition}`;
    const seen = groups.get(key) || new Set();
    if (seen.has(run.condition)) throw new TypeError(`duplicate condition for ${run.taskId} repetition ${run.repetition}`);
    seen.add(run.condition);
    groups.set(key, seen);

    const result = run.result || {};
    const normalized = {
      success: result.success === true ? 1 : result.success === false ? 0 : NaN,
      escapedDefects: finiteNonNegative(result.escapedDefects, `runs[${index}].escapedDefects`),
      humanCorrections: finiteNonNegative(result.humanCorrections, `runs[${index}].humanCorrections`),
      inputTokens: finiteNonNegative(result.inputTokens, `runs[${index}].inputTokens`),
      outputTokens: finiteNonNegative(result.outputTokens, `runs[${index}].outputTokens`),
      wallSeconds: finiteNonNegative(result.wallSeconds, `runs[${index}].wallSeconds`),
    };
    if (!Number.isFinite(normalized.success)) throw new TypeError(`runs[${index}].success must be boolean`);
    for (const [metric, ceiling] of Object.entries(ceilings)) {
      if (normalized[metric] > ceiling) throw new RangeError(`runs[${index}].${metric} exceeds shared budget`);
    }
    for (const metric of METRICS) values[run.condition][metric].push(normalized[metric]);
  }

  for (const [key, seen] of groups) {
    const missing = CONDITIONS.filter((condition) => !seen.has(condition));
    if (missing.length) throw new TypeError(`unbalanced task/repetition ${JSON.stringify(key)}; missing ${missing.join(', ')}`);
  }

  const conditions = Object.fromEntries(CONDITIONS.map((condition) => [condition, {
    runs: values[condition].success.length,
    means: Object.fromEntries(METRICS.map((metric) => [metric, mean(values[condition][metric])])),
  }]));
  const contrast = (metric, plus, minus) => mean(plus.map((condition) => conditions[condition].means[metric]))
    - mean(minus.map((condition) => conditions[condition].means[metric]));
  const effects = {};
  for (const metric of METRICS) {
    const assurance = contrast(metric, ['full-sivs-ephemeral', 'full-sivs-durable'], ['native-ephemeral', 'native-durable']);
    const controller = contrast(metric, ['native-durable', 'full-sivs-durable'], ['native-ephemeral', 'full-sivs-ephemeral']);
    const interaction = (conditions['full-sivs-durable'].means[metric] - conditions['full-sivs-ephemeral'].means[metric])
      - (conditions['native-durable'].means[metric] - conditions['native-ephemeral'].means[metric]);
    effects[metric] = { assurance, controller, interaction };
  }

  return { schema: 1, balancedPairs: groups.size, sharedBudget: budget, conditions, effects };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('usage: node scripts/evaluate-harness.mjs <results.json>');
    const result = evaluateHarness(JSON.parse(readFileSync(file, 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`evaluate-harness: ${error.message}\n`);
    process.exitCode = 2;
  }
}
