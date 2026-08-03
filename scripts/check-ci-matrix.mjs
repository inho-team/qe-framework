#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = resolve(ROOT, '.github/workflows/ci.yml');

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

export function validateCiWorkflow(text) {
  const errors = [];
  const guards = text.match(/\n  guards:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|$)/)?.[1] || '';
  const nativePackage = text.match(/\n  native-package:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|$)/)?.[1] || '';

  if (!/permissions:\s*\n\s+contents:\s*read/.test(text)) errors.push('workflow must declare read-only contents permission');
  if (!guards) errors.push('guards job is missing');
  if (!nativePackage) errors.push('native-package job is missing');
  if (guards && !/runs-on:\s*ubuntu-latest/.test(guards)) errors.push('guards job must run on ubuntu-latest');
  if (guards && !includesAll(guards, ["node: ['22', '24']", 'npm ci --ignore-scripts --omit=optional', 'node scripts/check-all.mjs'])) {
    errors.push('guards job must cover Node 22/24 from the lockfile and run all guards');
  }
  if (nativePackage && !includesAll(nativePackage, [
    'os: [ubuntu-latest, macos-latest, windows-latest]',
    "node: ['22']",
    'npm ci --ignore-scripts --omit=optional',
    'scripts/lib/__tests__/npm-lifecycle.test.mjs',
    'scripts/lib/__tests__/package-lifecycle.test.mjs',
    'scripts/lib/__tests__/package-provenance.test.mjs',
  ])) errors.push('native-package job must cover Linux/macOS/Windows on Node 22 with the focused package suite');
  if ((text.match(/fail-fast:\s*false/g) || []).length < 2) errors.push('both matrices must keep fail-fast disabled');
  if ((text.match(/uses:\s*actions\/checkout@v7/g) || []).length !== 2) errors.push('both jobs must use checkout v7');
  if ((text.match(/uses:\s*actions\/setup-node@v7/g) || []).length !== 2) errors.push('both jobs must use setup-node v7');

  return { ok: errors.length === 0, errors };
}

export function main() {
  const result = validateCiWorkflow(readFileSync(WORKFLOW, 'utf8'));
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`check-ci-matrix: FAIL — ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('check-ci-matrix: PASS — Linux Node 22/24 guards; Linux/macOS/Windows Node 22 native package suite\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
