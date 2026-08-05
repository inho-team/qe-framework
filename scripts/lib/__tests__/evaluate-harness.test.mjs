import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, evaluateHarness } from '../../evaluate-harness.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function fixture() {
  const success = {
    'native-ephemeral': false,
    'native-durable': false,
    'full-sivs-ephemeral': true,
    'full-sivs-durable': true,
  };
  return {
    schema: 1,
    budget: { maxInputTokens: 1000, maxOutputTokens: 500, maxWallSeconds: 60 },
    runs: CONDITIONS.map((condition) => ({
      taskId: 'task-1', repetition: 1, condition,
      result: { success: success[condition], escapedDefects: 0, humanCorrections: 0, inputTokens: 100, outputTokens: 50, wallSeconds: 10 },
    })),
  };
}

test('computes four balanced conditions and independent factorial effects', () => {
  const report = evaluateHarness(fixture());
  assert.equal(report.balancedPairs, 1);
  assert.deepEqual(Object.keys(report.conditions), CONDITIONS);
  assert.equal(report.effects.success.assurance, 1);
  assert.equal(report.effects.success.controller, 0);
  assert.equal(report.effects.success.interaction, 0);
});

test('rejects an unbalanced four-condition comparison', () => {
  const data = fixture();
  data.runs.pop();
  assert.throws(() => evaluateHarness(data), /unbalanced/);
});

test('rejects runs that exceed the shared budget', () => {
  const data = fixture();
  data.runs[0].result.inputTokens = 1001;
  assert.throws(() => evaluateHarness(data), /exceeds shared budget/);
});

test('CLI emits the same validated report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qe-harness-eval-'));
  try {
    const file = join(dir, 'results.json');
    writeFileSync(file, JSON.stringify(fixture()));
    const run = spawnSync(process.execPath, ['scripts/evaluate-harness.mjs', file], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).balancedPairs, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
