import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateCiWorkflow } from '../../check-ci-matrix.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');

test('CI contract covers supported Node lines and native operating systems', () => {
  assert.deepEqual(validateCiWorkflow(workflow), { ok: true, errors: [] });
  assert.doesNotMatch(workflow, /node:\s*\[[^\]]*['"]20['"]/);
  assert.equal((workflow.match(/actions\/checkout@v7/g) || []).length, 2);
  assert.equal((workflow.match(/actions\/setup-node@v7/g) || []).length, 2);
});

test('CI contract fails closed when a native operating system is removed', () => {
  const result = validateCiWorkflow(workflow.replace(', windows-latest', ''));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Linux/macOS/Windows')));
});

test('CI contract fails closed when lockfile or full-guard execution is bypassed', () => {
  let result = validateCiWorkflow(workflow.replace('npm ci --ignore-scripts --omit=optional', 'npm install'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('lockfile')));

  result = validateCiWorkflow(workflow.replace('node scripts/check-all.mjs', 'node scripts/check-entrypoints.mjs'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('all guards')));
});
