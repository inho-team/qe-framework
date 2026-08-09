#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpus, platform, arch, totalmem } from 'node:os';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOMAIN = 'qe-runtime-controller-adoption-decision-v1';
const EVIDENCE_DOMAIN = 'qe-runtime-controller-adoption-evidence-v1';
const EXPECTED_GUARDS = 41;
const GUARD_MANIFEST_SHA256 = 'a9591c526059341f6b6878fa04104a25b46cc4ffb8b0b2bbee8554daab399ac3';
const TIMEOUT_MS = 30_000;
const REAP_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const UNSAFE_RUNTIME_ENV = Object.freeze([
  'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
]);
const ELIGIBLE = Object.freeze(['durable', 'long-running', 'high-risk']);
const EXCLUDED = Object.freeze(['ordinary-solo', 'ordinary-subagent', 'ordinary-wave', 'ordinary-isolated']);
const CANARY_TESTS = 98;

const COMMANDS = Object.freeze({
  shadow: Object.freeze([process.execPath, '--test', 'hooks/scripts/lib/__tests__/process-controller-e2e.test.mjs']),
  canary: Object.freeze([process.execPath, 'scripts/check-runtime-controller.mjs']),
  scale: Object.freeze([process.execPath, 'scripts/benchmark-process-metrics.mjs']),
  regression: Object.freeze([process.execPath, 'scripts/check-all.mjs']),
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  const walk = item => {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol'
      || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('NON_CANONICAL_VALUE');
    if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === 'object') Object.values(item).forEach(walk);
  };
  walk(value); return JSON.stringify(stable(value));
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function assertCleanRuntimeEnv(env = process.env) {
  const found = UNSAFE_RUNTIME_ENV.filter(name => typeof env[name] === 'string' && env[name].trim() !== '');
  if (found.length > 0) throw new Error(`UNSAFE_RUNTIME_ENV:${found.join(',')}`);
}

function sanitizedChildEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const name of UNSAFE_RUNTIME_ENV) delete env[name];
  return { ...env, NO_COLOR: '1', FORCE_COLOR: '0' };
}

function realSpawnRunner({ argv, cwd, timeoutMs = TIMEOUT_MS }) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false,
      env: sanitizedChildEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let timedOut = false;
    let truncated = false; let settled = false; let closeSeen = false;
    const append = (current, chunk) => {
      if (settled) return current;
      const next = Buffer.concat([current, chunk]);
      if (next.length <= MAX_OUTPUT_BYTES) return next;
      truncated = true; child.kill('SIGKILL'); return next.subarray(0, MAX_OUTPUT_BYTES);
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const finish = (code, signal, error = null, reaped = closeSeen) => {
      if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(reapTimer);
      const stdoutText = stdout.toString('utf8'); const stderrText = stderr.toString('utf8');
      resolve({ startedAt, completedAt: new Date().toISOString(), argv, code, signal,
        timedOut, truncated, reaped, error: error ? String(error.message || error) : null,
        settlementCount: 1, stdout: stdoutText, stderr: stderrText, stdoutSha256: sha256(stdoutText) });
    };
    let reapTimer;
    const timeout = setTimeout(() => {
      timedOut = true; child.kill('SIGKILL');
      reapTimer = setTimeout(() => finish(null, 'SIGKILL', new Error('CHILD_NOT_REAPED'), false), REAP_TIMEOUT_MS);
    }, timeoutMs);
    child.once('error', error => finish(null, null, error, false));
    child.once('close', (code, signal) => { closeSeen = true; finish(code, signal, null, true); });
  });
}

export function probeSpawnLifecycleForTest(mode) {
  if (mode !== 'timeout') throw new Error('INVALID_PROBE');
  return realSpawnRunner({ argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
    cwd: process.cwd(), timeoutMs: 10 });
}

function baseCheck(run) {
  return run && run.code === 0 && run.signal === null && run.timedOut === false
    && run.truncated === false && run.reaped === true && run.settlementCount === 1 && !run.error
    && /^[0-9a-f]{64}$/.test(run.stdoutSha256) && run.startedAt && run.completedAt;
}

function parseNodeTest(run, expected) {
  const tests = Number(run.stdout.match(/(?:^|\n)ℹ tests (\d+)/)?.[1]);
  const pass = Number(run.stdout.match(/(?:^|\n)ℹ pass (\d+)/)?.[1]);
  const fail = Number(run.stdout.match(/(?:^|\n)ℹ fail (\d+)/)?.[1]);
  if (!baseCheck(run) || tests !== expected || pass !== expected || fail !== 0) return null;
  const normalizedOutput = run.stdout
    .replace(/\d+(?:\.\d+)?ms/g, '<duration>')
    .replace(/duration_ms\s+\d+(?:\.\d+)?/g, 'duration_ms <duration>');
  return { tests, pass, fail, normalizedOutputSha256: sha256(normalizedOutput) };
}

function parseScale(run) {
  if (!baseCheck(run)) return null; let report;
  try { report = JSON.parse(run.stdout); } catch { return null; }
  const required = [0, 100, 1000, 10000];
  if (report.status !== 'QUALIFIED' || canonicalJson(report.coverage?.requiredCardinalities) !== canonicalJson(required)
    || canonicalJson(report.coverage?.measuredCardinalities) !== canonicalJson(required)
    || !Array.isArray(report.rows) || report.rows.length !== 4
    || report.rows.some((row, index) => row.cardinality !== required[index]
      || row.executionCount !== 7 || row.qualification !== 'PASS')) return null;
  return { status: report.status, digest: report.digest, cardinalities: required,
    executions: report.rows.map(row => row.executionCount), p95Ms: report.rows.map(row => row.p95Ms),
    rssDeltaBytes: report.rows.map(row => row.rssDeltaBytes) };
}

function guardManifest(cwd) {
  const names = readdirSync(new URL('../scripts/', import.meta.url))
    .filter(name => /^check-.*\.mjs$/.test(name) && name !== 'check-all.mjs').sort();
  return { names, count: names.length, digest: sha256(JSON.stringify(names)), cwd };
}

function parseRegression(run, manifest) {
  if (!baseCheck(run) || manifest.count !== EXPECTED_GUARDS || manifest.digest !== GUARD_MANIFEST_SHA256) return null;
  const found = Number(run.stdout.match(/check-all: found (\d+) guard\(s\)/)?.[1]);
  const summary = run.stdout.split('check-all SUMMARY').at(-1);
  const passed = [...summary.matchAll(/^  \[PASS\] check-[^\n]+$/gm)].length;
  if (found !== EXPECTED_GUARDS || passed !== EXPECTED_GUARDS
    || !run.stdout.includes('Result: PASS — all 41 guard(s) passed')) return null;
  return { found, passed, manifestDigest: manifest.digest };
}

function publicRun(id, run, summary) {
  return { id, argv: run.argv.slice(1), startedAt: run.startedAt, completedAt: run.completedAt,
    exitCode: run.code, signal: run.signal, stdoutSha256: run.stdoutSha256, summary };
}

export async function runAdoption({ cwd = process.cwd(), runner, now = () => new Date().toISOString() } = {}) {
  if (typeof runner !== 'function') throw new Error('RUNNER_REQUIRED');
  const debug = label => { if (process.env.QE_ADOPTION_DEBUG === '1') process.stderr.write(`[adoption] ${label}\n`); };
  const evidence = { schema: 1, environment: (() => { const cpu = cpus(); return {
    version: process.version, platform: platform(), arch: arch(), cpuModel: cpu[0]?.model ?? null,
    cpuCount: cpu.length, totalMemoryBytes: totalmem() }; })(), guardManifest: guardManifest(cwd),
  };
  let passing = evidence.guardManifest.count === EXPECTED_GUARDS
    && evidence.guardManifest.digest === GUARD_MANIFEST_SHA256;
  debug('regression:start');
  const regressionRun = await runner({ id: 'regression', argv: COMMANDS.regression, cwd, timeoutMs: TIMEOUT_MS });
  debug(`regression:done:${regressionRun.code}:${regressionRun.signal}`);
  const regressionSummary = parseRegression(regressionRun, evidence.guardManifest); passing &&= Boolean(regressionSummary);
  evidence.regression = publicRun('regression', regressionRun, regressionSummary);
  debug('shadow:start');
  const shadowRun = await runner({ id: 'shadow-1', argv: COMMANDS.shadow, cwd, timeoutMs: TIMEOUT_MS });
  debug(`shadow:done:${shadowRun.code}:${shadowRun.signal}`);
  const shadowSummary = parseNodeTest(shadowRun, 11); passing &&= Boolean(shadowSummary);
  evidence.shadow = publicRun('shadow-1', shadowRun, shadowSummary);
  evidence.canary = [];
  for (let index = 1; index <= 3; index += 1) {
    debug(`canary-${index}:start`);
    const run = await runner({ id: `canary-${index}`, argv: COMMANDS.canary, cwd, timeoutMs: TIMEOUT_MS });
    debug(`canary-${index}:done:${run.code}:${run.signal}`);
    const summary = parseNodeTest(run, CANARY_TESTS); passing &&= Boolean(summary);
    evidence.canary.push(publicRun(`canary-${index}`, run, summary));
  }
  const canarySummaries = evidence.canary.map(item => canonicalJson(item.summary));
  if (new Set(canarySummaries).size !== 1 || canarySummaries[0] === 'null') passing = false;
  debug('scale:start');
  const scaleRun = await runner({ id: 'scale', argv: COMMANDS.scale, cwd, timeoutMs: TIMEOUT_MS });
  debug(`scale:done:${scaleRun.code}:${scaleRun.signal}`);
  const scaleSummary = parseScale(scaleRun); passing &&= Boolean(scaleSummary);
  evidence.scale = publicRun('scale', scaleRun, scaleSummary);
  const evidenceDigest = sha256(canonicalJson([EVIDENCE_DOMAIN, evidence]));
  const decisionWithoutDigest = { schema: 1, domain: DOMAIN, evidenceDigest,
    decision: passing ? 'ADOPTED_ELIGIBLE_LANES' : 'NOT_ADOPTED', eligibleLanes: [...ELIGIBLE],
    excludedLanes: [...EXCLUDED], owner: 'QE Runtime Controller maintainers', decidedAt: now(),
    reviewDate: '2026-11-08', limitations: ['local-single-host-only', 'no-deployment-or-release-authority',
      'ordinary-task-router-unchanged'] };
  const decisionDigest = sha256(canonicalJson([DOMAIN, evidenceDigest, decisionWithoutDigest]));
  return { evidence, evidenceDigest, decision: { ...decisionWithoutDigest, decisionDigest } };
}

async function main() {
  assertCleanRuntimeEnv();
  const result = await runAdoption({ cwd: process.cwd(), runner: realSpawnRunner });
  const reparsed = JSON.parse(canonicalJson(result));
  const expectedEvidence = sha256(canonicalJson([EVIDENCE_DOMAIN, reparsed.evidence]));
  const { decisionDigest, ...withoutDigest } = reparsed.decision;
  const expectedDecision = sha256(canonicalJson([DOMAIN, expectedEvidence, withoutDigest]));
  if (expectedEvidence !== reparsed.evidenceDigest || expectedDecision !== decisionDigest) throw new Error('DIGEST_MISMATCH');
  process.stdout.write(`${canonicalJson(reparsed)}\n`);
  if (reparsed.decision.decision !== 'ADOPTED_ELIGIBLE_LANES') process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
