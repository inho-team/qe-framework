import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson, probeSpawnLifecycleForTest, runAdoption } from '../qualify-runtime-controller-adoption.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/qualify-runtime-controller-adoption.mjs');
const hash = value => createHash('sha256').update(value).digest('hex');

function nodeSummary(count) {
  return `ℹ tests ${count}\nℹ pass ${count}\nℹ fail 0\n`;
}

function scaleOutput() {
  return JSON.stringify({ status: 'QUALIFIED', digest: 'a'.repeat(64),
    coverage: { requiredCardinalities: [0, 100, 1000, 10000], measuredCardinalities: [0, 100, 1000, 10000] },
    rows: [0, 100, 1000, 10000].map(cardinality => ({ cardinality, executionCount: 7,
      qualification: 'PASS', p95Ms: 1, rssDeltaBytes: 1 })) });
}

function regressionOutput() {
  const rows = Array.from({ length: 41 }, (_, index) => `  [PASS] check-${index}.mjs`).join('\n');
  return `check-all: found 41 guard(s): x\ncheck-all SUMMARY\n${rows}\nResult: PASS — all 41 guard(s) passed\n`;
}

function successRunner(overrides = {}) {
  return async request => {
    const stdout = request.id === 'shadow-1' ? nodeSummary(11)
      : request.id.startsWith('canary-') ? nodeSummary(98)
        : request.id === 'scale' ? scaleOutput() : regressionOutput();
    return { argv: request.argv, code: 0, signal: null, timedOut: false, truncated: false,
      reaped: true, error: null, startedAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:01.000Z', settlementCount: 1,
      stdout, stderr: '', stdoutSha256: hash(stdout),
      ...(overrides[request.id] || {}) };
  };
}

test('complete evidence adopts only eligible lanes and seals canonical digests', async () => {
  const result = await runAdoption({ cwd: root, runner: successRunner(), now: () => '2026-08-08T00:00:02.000Z' });
  assert.equal(result.decision.decision, 'ADOPTED_ELIGIBLE_LANES');
  assert.deepEqual(result.decision.eligibleLanes, ['durable', 'long-running', 'high-risk']);
  assert.deepEqual(result.decision.excludedLanes,
    ['ordinary-solo', 'ordinary-subagent', 'ordinary-wave', 'ordinary-isolated']);
  assert.equal(result.evidence.canary.length, 3);
  assert.equal(result.evidence.guardManifest.count, 41);
  assert.equal(result.evidence.guardManifest.digest,
    'a9591c526059341f6b6878fa04104a25b46cc4ffb8b0b2bbee8554daab399ac3');
  assert.equal(result.evidenceDigest, hash(canonicalJson(['qe-runtime-controller-adoption-evidence-v1', result.evidence])));
  const { decisionDigest, ...withoutDigest } = result.decision;
  assert.equal(decisionDigest, hash(canonicalJson(['qe-runtime-controller-adoption-decision-v1',
    result.evidenceDigest, withoutDigest])));
});

test('timeouts, truncation, malformed scale and incomplete canary evidence fail closed', async () => {
  const cases = [
    { 'canary-2': { code: null, signal: 'SIGKILL', timedOut: true } },
    { shadow: {}, 'shadow-1': { truncated: true } },
    { scale: { stdout: '{', stdoutSha256: hash('{') } },
    { 'canary-3': { stdout: nodeSummary(92), stdoutSha256: hash(nodeSummary(92)) } },
    { regression: { stdout: 'check-all: found 40 guard(s)', stdoutSha256: hash('check-all: found 40 guard(s)') } },
    { 'canary-1': { stdout: nodeSummary(98), stdoutSha256: hash(nodeSummary(98)) },
      'canary-2': { stdout: nodeSummary(92), stdoutSha256: hash(nodeSummary(92)) } },
  ];
  for (const overrides of cases) {
    const result = await runAdoption({ cwd: root, runner: successRunner(overrides), now: () => '2026-08-08T00:00:02.000Z' });
    assert.equal(result.decision.decision, 'NOT_ADOPTED');
  }
});

test('parseable but different canary cohorts fail closed', async () => {
  const different = `${nodeSummary(98)}cohort: different\n`;
  const result = await runAdoption({ cwd: root, runner: successRunner({
    'canary-2': { stdout: different, stdoutSha256: hash(different) },
  }), now: () => '2026-08-08T00:00:02.000Z' });
  assert.deepEqual(result.evidence.canary.map(item => item.summary.tests), [98, 98, 98]);
  assert.equal(result.decision.decision, 'NOT_ADOPTED');
});

test('parseable scale evidence with one off-by-one cardinality fails closed', async () => {
  const report = JSON.parse(scaleOutput());
  report.rows[2].cardinality = 999;
  const stdout = JSON.stringify(report);
  const result = await runAdoption({ cwd: root, runner: successRunner({
    scale: { stdout, stdoutSha256: hash(stdout) },
  }), now: () => '2026-08-08T00:00:02.000Z' });
  assert.equal(result.evidence.scale.summary, null);
  assert.equal(result.decision.decision, 'NOT_ADOPTED');
});

test('non-canonical evidence is rejected', () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /NON_CANONICAL_VALUE/);
  assert.throws(() => canonicalJson({ value: undefined }), /NON_CANONICAL_VALUE/);
});

test('real spawn timeout sends SIGKILL, reaps the child and settles once', async () => {
  const result = await probeSpawnLifecycleForTest('timeout');
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.reaped, true);
  assert.equal(result.settlementCount, 1);
});

test('production CLI subprocess ignores runner-injection environment and executes the real plan', { timeout: 180_000 }, () => {
  const child = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024, env: { ...process.env, QE_ADOPTION_RUNNER: 'mock-pass', NO_COLOR: '1' } });
  assert.equal(child.status, 0, child.stderr || child.stdout.slice(-2000));
  assert.equal(child.signal, null);
  const report = JSON.parse(child.stdout);
  assert.equal(report.decision.decision, 'ADOPTED_ELIGIBLE_LANES');
  assert.equal(report.evidence.shadow.summary.tests, 11);
  assert.deepEqual(report.evidence.canary.map(item => item.summary.tests), [98, 98, 98]);
  assert.equal(report.evidence.scale.summary.status, 'QUALIFIED');
  assert.equal(report.evidence.regression.summary.passed, 41);
});

test('production CLI rejects Node preload environments before collecting evidence', () => {
  const child = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: '--no-warnings', NO_COLOR: '1' } });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /UNSAFE_RUNTIME_ENV:NODE_OPTIONS/);
  assert.equal(child.stdout, '');
});
