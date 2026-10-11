#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE = resolve(ROOT, 'Jenkinsfile');
const LINUX_RUNNER = resolve(ROOT, '.ci/run-linux.sh');
const NATIVE_TESTS = [
  'scripts/lib/__tests__/npm-lifecycle.test.mjs',
  'scripts/lib/__tests__/package-lifecycle.test.mjs',
  'scripts/lib/__tests__/package-provenance.test.mjs',
];

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

function stage(text, name, nextName) {
  const start = text.indexOf(`stage('${name}')`);
  if (start < 0) return '';
  const end = nextName ? text.indexOf(`stage('${nextName}')`, start + 1) : text.length;
  return text.slice(start, end < 0 ? text.length : end);
}

export function validateCiPipeline(pipeline, linuxRunner) {
  const errors = [];
  const linux = stage(pipeline, 'Linux Node 22 and 24', 'macOS Node 22 native package');
  const macos = stage(pipeline, 'macOS Node 22 native package', 'Windows Node 22 native package');
  const windows = stage(pipeline, 'Windows Node 22 native package');

  if (!linux || !includesAll(linux, [
    "agent { label 'macmini' }",
    "DOCKER_HOST = 'unix:///Users/kimjinseong/.colima/ci/docker.sock'",
    'NODE_VERSION=22.23.2',
    'NODE_VERSION=24.15.0',
    ':node22 sh .ci/run-linux.sh guards',
    ':node24 sh .ci/run-linux.sh guards',
  ])) errors.push('Linux guards must cover Node 22 and 24 in isolated Docker');
  if (!linux.includes(':node22 sh .ci/run-linux.sh native')) {
    errors.push('Linux native package checks must run on Node 22');
  }
  if ((linux.match(/catchError\(/g) || []).length < 3) {
    errors.push('Linux checks must report each Node and native result independently');
  }
  if (!linuxRunner.includes('npm ci --ignore-scripts --omit=optional')) {
    errors.push('Linux runner must install from the lockfile without lifecycle side effects');
  }
  if (!linuxRunner.includes('node scripts/check-all.mjs')) {
    errors.push('Linux runner must run all guards');
  }
  if (!includesAll(linuxRunner, NATIVE_TESTS)) {
    errors.push('Linux runner must run the native package suite');
  }
  if (!macos || !includesAll(macos, [
    "agent { label 'macmini' }",
    '/v22.23.2/bin',
    'npm ci --ignore-scripts --omit=optional',
    ...NATIVE_TESTS,
  ])) errors.push('macOS native package checks must run on Node 22 from the lockfile');
  if (!windows || !includesAll(windows, [
    "agent { label 'windows' }",
    'node-v22.23.2-win-x64',
    'npm.cmd ci --ignore-scripts --omit=optional',
    ...NATIVE_TESTS,
  ])) errors.push('Windows native package checks must run on Node 22 from the lockfile');
  if (/NODE_VERSION=20|node20|v20\./.test(pipeline)) {
    errors.push('Node 20 is outside the supported CI matrix');
  }
  if ((pipeline.match(/cleanWs\(/g) || []).length < 3) {
    errors.push('Every operating system must clean its Jenkins workspace');
  }

  return { ok: errors.length === 0, errors };
}

export function main() {
  const result = validateCiPipeline(readFileSync(PIPELINE, 'utf8'), readFileSync(LINUX_RUNNER, 'utf8'));
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`check-ci-matrix: FAIL — ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('check-ci-matrix: PASS — Linux Node 22/24 guards; Linux/macOS/Windows Node 22 native package suite\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
