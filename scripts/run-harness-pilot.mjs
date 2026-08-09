#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createEligibleProcessController } from '../hooks/scripts/lib/process-controller.mjs';

import {
  buildCodexArgs,
  buildPilotSchedule,
  loadPilotFixture,
  parseCodexResult,
  runPilot,
  runBoundedProcess,
  scoreHiddenAcceptance,
} from './lib/harness-pilot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURE = join(ROOT, 'scripts', 'fixtures', 'harness-pilot.json');

function parseArgs(argv) {
  const out = { dryRun: false, execute: false, smoke: false, fixture: DEFAULT_FIXTURE,
    outputDir: join(ROOT, 'evals', 'harness-pilot', 'codex'), concurrency: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--execute') out.execute = true;
    else if (arg === '--smoke') out.smoke = true;
    else if (arg === '--fixture') out.fixture = resolve(argv[++index] || '');
    else if (arg === '--output-dir') out.outputDir = resolve(argv[++index] || '');
    else if (arg === '--concurrency') out.concurrency = Number(argv[++index]);
    else throw new TypeError(`unknown argument: ${arg}`);
  }
  if (Number(out.dryRun) + Number(out.execute) + Number(out.smoke) !== 1) {
    throw new TypeError('choose exactly one of --dry-run, --smoke, or --execute');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 4) {
    throw new TypeError('--concurrency must be an integer from 1 to 4');
  }
  return out;
}

function initializeGit(workspace) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  const commands = [
    ['init', '-q'],
    ['config', 'user.name', 'QE Harness'],
    ['config', 'user.email', 'qe-harness@example.invalid'],
    ['add', '.'],
    ['commit', '-q', '-m', 'starter'],
  ];
  for (const args of commands) {
    const run = spawnSync('git', args, { cwd: workspace, env, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args[0]} failed: ${run.stderr || run.stdout}`);
  }
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).stdout.trim();
}

function createCodexActor() {
  return async request => {
    const starterRevision = initializeGit(request.workspace);
    const startedAt = Date.now();
    const durable = request.condition.endsWith('-durable');
    const processId = `pilot-${request.taskId}-${request.condition}`;
    let controller = null;
    let controllerEvidence = null;
    if (durable) {
      const admitted = createEligibleProcessController({
        cwd: request.workspace,
        layer: 'goal',
        authority: 'goal-controller',
        executionMode: 'durable',
        longRunning: false,
        highRisk: false,
      });
      controller = admitted.controller;
      const initialized = controller?.initialize({ processId, requestId: `${processId}-initialize` });
      const active = controller?.transition({ processId, requestId: `${processId}-active`,
        to: 'active', expectedRevision: 0 });
      controllerEvidence = {
        admitted: admitted.admitted === true,
        admissionCode: admitted.code,
        initializeCode: initialized?.code || null,
        activeCode: active?.code || null,
        terminalCode: null,
        processId,
        auditDigest: null,
      };
    }
    const args = buildCodexArgs(request);
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    let signal = null;
    const run = await runBoundedProcess('codex', args, {
      cwd: request.workspace,
      timeoutMs: request.budget.maxWallSeconds * 1000,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = run.stdout;
    stderr = run.stderr;
    exitCode = run.exitCode;
    timedOut = run.timedOut;
    signal = run.signal;
    const bufferExceeded = run.bufferExceeded;
    const wallSeconds = (Date.now() - startedAt) / 1000;
    const parsed = parseCodexResult(stdout, { wallSeconds, exitCode });
    if (!parsed.result && stderr) parsed.result = stderr.slice(0, 8000);
    if (controller) {
      const terminal = controller.transition({ processId, requestId: `${processId}-blocked`,
        to: 'blocked', expectedRevision: 1 });
      controllerEvidence.terminalCode = terminal.code;
      controllerEvidence.auditDigest = createHash('sha256')
        .update(JSON.stringify(controller.audit(processId))).digest('hex');
      controller.close();
      parsed.wallSeconds = (Date.now() - startedAt) / 1000;
    }
    const diff = spawnSync('git', ['diff', '--binary', '--no-ext-diff'], {
      cwd: request.workspace,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    }).stdout || '';
    return {
      ...parsed,
      exitCode,
      timedOut,
      signal,
      bufferExceeded,
      controller: controllerEvidence,
      starterRevision,
      patchHash: createHash('sha256').update(diff).digest('hex'),
      patch: diff,
    };
  };
}

function markdownSummary(output) {
  const lines = [
    '# Progressive Assurance Harness Pilot',
    '',
    `- Model: ${output.rawRuns[0]?.model || 'unknown'}`,
    `- Revision: ${output.rawRuns[0]?.revision || 'unknown'}`,
    `- Balanced task/repetition pairs: ${output.report.balancedPairs}`,
    `- Runs: ${output.dataset.runs.length}`,
    '',
    '| Condition | Success | Input tokens | Output tokens | Wall seconds |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const [condition, result] of Object.entries(output.report.conditions)) {
    const means = result.means;
    lines.push(`| ${condition} | ${means.success.toFixed(3)} | ${means.inputTokens.toFixed(1)} | ${means.outputTokens.toFixed(1)} | ${means.wallSeconds.toFixed(1)} |`);
  }
  lines.push('', '> Pilot only: one repetition cannot establish production effectiveness.', '');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = loadPilotFixture(options.fixture);
  const schedule = buildPilotSchedule(fixture);
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', model: fixture.model,
      effort: fixture.effort, budget: fixture.budget, schedule }, null, 2)}\n`);
    return;
  }

  const revisionRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const revision = revisionRun.stdout.trim();
  if (revisionRun.status !== 0 || !/^[0-9a-f]{40}$/.test(revision)) throw new Error('cannot resolve starting revision');
  const runRoot = mkdtempSync(join(tmpdir(), 'qe-harness-pilot-'));
  try {
    let output;
    try {
      output = await runPilot(fixture, {
        root: runRoot,
        revision,
        concurrency: options.concurrency,
        baselineRepository: ROOT,
        cellLimit: options.smoke ? 1 : null,
        actor: createCodexActor(),
        scorer: request => scoreHiddenAcceptance(request),
      });
    } catch (error) {
      if (error?.code === 'PILOT_INVALID_ACTOR_RUN') {
        mkdirSync(options.outputDir, { recursive: true });
        writeFileSync(join(options.outputDir, 'failure.json'), `${JSON.stringify({
          schema: 1,
          status: 'invalid',
          reason: error.code,
          budget: fixture.budget,
          ...error.details,
        }, null, 2)}\n`, 'utf8');
      }
      throw error;
    }
    if (options.smoke) {
      mkdirSync(options.outputDir, { recursive: true });
      writeFileSync(join(options.outputDir, 'smoke.json'), `${JSON.stringify({
        schema: 1, status: 'valid', revision, run: output.rawRuns[0],
      }, null, 2)}\n`, 'utf8');
      process.stdout.write(`${JSON.stringify({ mode: 'smoke', outputDir: options.outputDir,
        taskId: output.rawRuns[0].taskId, condition: output.rawRuns[0].condition })}\n`);
      return;
    }
    mkdirSync(options.outputDir, { recursive: true });
    writeFileSync(join(options.outputDir, 'results.json'), `${JSON.stringify({ ...output.dataset, rawRuns: output.rawRuns }, null, 2)}\n`, 'utf8');
    writeFileSync(join(options.outputDir, 'report.json'), `${JSON.stringify(output.report, null, 2)}\n`, 'utf8');
    writeFileSync(join(options.outputDir, 'RUN.md'), markdownSummary(output), 'utf8');
    process.stdout.write(`${JSON.stringify({ mode: 'execute', outputDir: options.outputDir,
      runs: output.dataset.runs.length, balancedPairs: output.report.balancedPairs })}\n`);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`run-harness-pilot: ${error.message}\n`);
  process.exitCode = 2;
});
