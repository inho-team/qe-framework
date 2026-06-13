#!/usr/bin/env node
/**
 * check-all.mjs
 * Discovers and runs every scripts/check-*.mjs (except itself) sequentially.
 * Prints a pass/fail summary and exits non-zero if any guard failed.
 */

import { readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const SELF = basename(fileURLToPath(import.meta.url));

// Discover check-*.mjs files, excluding self
const guards = readdirSync(SCRIPTS_DIR)
  .filter(f => f.startsWith('check-') && f.endsWith('.mjs') && f !== SELF)
  .sort();

if (guards.length === 0) {
  console.log('check-all: no check-*.mjs guards found.');
  process.exit(0);
}

console.log(`check-all: found ${guards.length} guard(s): ${guards.join(', ')}\n`);

const results = [];

for (const guard of guards) {
  const guardPath = join(SCRIPTS_DIR, guard);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${guard}`);
  console.log('='.repeat(60));

  const result = spawnSync('node', [guardPath], { stdio: 'inherit' });
  const passed = result.status === 0 && !result.error;
  results.push({ guard, passed, status: result.status, signal: result.signal });

  if (result.error) {
    console.error(`  ERROR spawning ${guard}: ${result.error.message}`);
  }
}

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log('check-all SUMMARY');
console.log('='.repeat(60));

let anyFailed = false;
for (const { guard, passed, status, signal } of results) {
  const icon = passed ? 'PASS' : 'FAIL';
  const detail = passed ? '' : signal ? ` (signal ${signal})` : ` (exit ${status ?? '?'})`;
  console.log(`  [${icon}] ${guard}${detail}`);
  if (!passed) anyFailed = true;
}

console.log('');
if (anyFailed) {
  const failed = results.filter(r => !r.passed).map(r => r.guard);
  console.log(`Result: FAIL — ${failed.length} guard(s) failed: ${failed.join(', ')}`);
  process.exit(1);
} else {
  console.log(`Result: PASS — all ${results.length} guard(s) passed`);
  process.exit(0);
}
