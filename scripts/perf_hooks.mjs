#!/usr/bin/env node
'use strict';

import { spawn } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { cpus, platform, arch } from 'os';
import { version } from 'process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// Default iterations (discard first 5 as warmup)
const N = 50;
const WARMUP = 5;

// Scenarios: [hookPath, scenario name, stdin payload object]
const scenarios = [
  // prompt-check scenarios
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'prompt-check.mjs'),
    'prompt-check / empty',
    { user_message: '', cwd: PROJECT_ROOT }
  ],
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'prompt-check.mjs'),
    'prompt-check / plain',
    { user_message: 'hello world', cwd: PROJECT_ROOT }
  ],
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'prompt-check.mjs'),
    'prompt-check / slash',
    { user_message: '/Qcommit --help', cwd: PROJECT_ROOT }
  ],
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'prompt-check.mjs'),
    'prompt-check / help-flag',
    { user_message: '/Qcommit --help', cwd: PROJECT_ROOT }
  ],
  // pre-tool-use scenarios
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'pre-tool-use.mjs'),
    'pre-tool-use / read-cached',
    { tool_name: 'Read', tool_input: { file_path: join(PROJECT_ROOT, 'README.md') }, cwd: PROJECT_ROOT }
  ],
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'pre-tool-use.mjs'),
    'pre-tool-use / read-new',
    { tool_name: 'Read', tool_input: { file_path: join(PROJECT_ROOT, 'package.json') }, cwd: PROJECT_ROOT }
  ],
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'pre-tool-use.mjs'),
    'pre-tool-use / bash',
    { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: PROJECT_ROOT }
  ],
  [
    join(PROJECT_ROOT, 'hooks', 'scripts', 'pre-tool-use.mjs'),
    'pre-tool-use / edit',
    { tool_name: 'Edit', tool_input: { file_path: '/tmp/x' }, cwd: PROJECT_ROOT }
  ],
];

/**
 * Run a single hook invocation and measure wall-clock latency.
 * Returns time in milliseconds, or null on error.
 */
function runHookOnce(hookPath, payload) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const child = spawn('node', [hookPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000, // 30s timeout to catch hangs
    });

    let stdoutData = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 10000);

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;

      if (timedOut) {
        resolve(null); // timeout
      } else if (code !== 0 && code !== null) {
        resolve(null); // non-zero exit
      } else {
        resolve(elapsed);
      }
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Measure latency for a single scenario.
 * Runs N iterations, discards first WARMUP, computes p50, p95, max.
 */
async function measureScenario(hookPath, scenarioName, payload) {
  const times = [];

  for (let i = 0; i < N; i++) {
    const ms = await runHookOnce(hookPath, payload);
    times.push(ms);
  }

  // Filter to discard warmup runs and errors
  const validTimes = times.slice(WARMUP).filter((t) => t !== null && typeof t === 'number');

  if (validTimes.length === 0) {
    return {
      scenario: scenarioName,
      p50: 'ERR',
      p95: 'ERR',
      max: 'ERR',
    };
  }

  validTimes.sort((a, b) => a - b);

  const p50 = validTimes[Math.floor(validTimes.length * 0.5)];
  const p95 = validTimes[Math.floor(validTimes.length * 0.95)];
  const max = validTimes[validTimes.length - 1];

  return {
    scenario: scenarioName,
    p50: p50.toFixed(1),
    p95: p95.toFixed(1),
    max: max.toFixed(1),
  };
}

/**
 * Parse CLI args.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let outPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }

  return { outPath };
}

/**
 * Determine the hook name from the full path.
 */
function getHookName(hookPath) {
  if (hookPath.includes('prompt-check')) return 'prompt-check';
  if (hookPath.includes('pre-tool-use')) return 'pre-tool-use';
  return 'unknown';
}

/**
 * Format a markdown table row.
 */
function formatTableRow(hook, scenario, p50, p95, max) {
  return `| ${hook} | ${scenario} | ${p50} | ${p95} | ${max} |`;
}

/**
 * Generate markdown report.
 */
function generateReport(results) {
  const now = new Date().toISOString();
  const nodeVersion = version;
  const osName = platform();
  const osArch = arch();
  const cpuModel = cpus()[0]?.model || 'unknown';

  let markdown = `# Hook Performance Report

- Node: ${nodeVersion}
- OS: ${osName}/${osArch}
- CPU: ${cpuModel}
- Iterations: ${N} (warmup ${WARMUP})
- Date: ${now}

| Hook | Scenario | p50 (ms) | p95 (ms) | max (ms) |
|------|----------|----------|----------|----------|
`;

  for (const result of results) {
    const hook = getHookName(result.hookPath);
    markdown += formatTableRow(hook, result.scenario, result.p50, result.p95, result.max) + '\n';
  }

  return markdown;
}

/**
 * Main entry point.
 */
async function main() {
  const { outPath } = parseArgs();

  console.log(`Measuring hook performance (${N} iterations, warmup ${WARMUP})...\n`);

  const results = [];

  for (const [hookPath, scenarioName, payload] of scenarios) {
    if (!existsSync(hookPath)) {
      console.log(`[WARN] Hook not found: ${hookPath}`);
      results.push({
        hookPath,
        scenario: scenarioName,
        p50: 'SKIP',
        p95: 'SKIP',
        max: 'SKIP',
      });
      continue;
    }

    process.stdout.write(`Testing ${scenarioName}... `);
    const result = await measureScenario(hookPath, scenarioName, payload);
    results.push({
      hookPath,
      ...result,
    });
    console.log('done');
  }

  // Print table to console
  console.log('\n' + generateReport(results));

  // Write markdown report if requested
  if (outPath) {
    const summaryDir = dirname(outPath);
    if (!existsSync(summaryDir)) {
      mkdirSync(summaryDir, { recursive: true });
    }
    writeFileSync(outPath, generateReport(results), 'utf8');
    console.log(`\nReport written to: ${outPath}`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
