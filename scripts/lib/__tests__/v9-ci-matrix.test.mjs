import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateCiPipeline } from '../../check-ci-matrix.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pipeline = readFileSync(resolve(ROOT, 'Jenkinsfile'), 'utf8');
const linuxRunner = readFileSync(resolve(ROOT, '.ci/run-linux.sh'), 'utf8');

test('CI contract covers supported Node lines and native operating systems', () => {
  assert.deepEqual(validateCiPipeline(pipeline, linuxRunner), { ok: true, errors: [] });
  assert.doesNotMatch(pipeline, /NODE_VERSION=20|node20|v20\./);
});

test('CI contract fails closed when a native operating system is removed', () => {
  const result = validateCiPipeline(pipeline.replace("agent { label 'windows' }", "agent { label 'macmini' }"), linuxRunner);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Windows native')));
});

test('CI contract fails closed when a supported Linux Node line is removed', () => {
  const result = validateCiPipeline(pipeline.replace('NODE_VERSION=24.15.0', 'NODE_VERSION=22.23.2'), linuxRunner);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Linux guards')));
});

test('CI contract fails closed when lockfile or full-guard execution is bypassed', () => {
  let result = validateCiPipeline(pipeline, linuxRunner.replace('npm ci --ignore-scripts --omit=optional', 'npm install'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('lockfile')));

  result = validateCiPipeline(pipeline, linuxRunner.replace('node scripts/check-all.mjs', 'node scripts/check-entrypoints.mjs'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('all guards')));
});
