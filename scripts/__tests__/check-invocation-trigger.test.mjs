#!/usr/bin/env node
/**
 * check-invocation-trigger.test.mjs
 *
 * Red-green proof for scripts/check-invocation-trigger.mjs (audit-harvest R7 guard).
 * Each case builds a fixture skills dir in a temp sandbox and runs the REAL guard
 * against it via QE_SKILLS_DIR; the repo's own skills/ are never touched.
 *
 * Run: node --test scripts/__tests__/check-invocation-trigger.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', 'check-invocation-trigger.mjs');
const FORBIDDEN = 'When framework initialization, maintenance, or audit is required.';

/** Run the guard against a fixture skills dir. */
function runGuard(skillsDir) {
  const r = spawnSync('node', [GUARD], {
    env: { ...process.env, QE_SKILLS_DIR: skillsDir },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Create a temp skills dir with { name: trigger } skills (nested {name}/SKILL.md). */
function fixture(skills) {
  const dir = mkdtempSync(join(tmpdir(), 'qe-trigger-'));
  for (const [name, trigger] of Object.entries(skills)) {
    const sd = join(dir, name);
    mkdirSync(sd, { recursive: true });
    writeFileSync(join(sd, 'SKILL.md'), `---\nname: ${name}\ninvocation_trigger: ${trigger}\n---\n\nbody\n`);
  }
  return dir;
}

test('RED: non-baseline skill with forbidden template trigger -> exit 1', () => {
  const dir = fixture({ Qbadskill: FORBIDDEN });
  try {
    const r = runGuard(dir);
    assert.equal(r.status, 1, 'guard must FAIL');
    assert.match(r.stderr, /forbidden copy-paste template/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: Qinit with forbidden trigger is allowlisted -> exit 0', () => {
  const dir = fixture({ Qinit: FORBIDDEN });
  try {
    assert.equal(runGuard(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: skill with a real, specific trigger -> exit 0', () => {
  const dir = fixture({ Qfoo: 'When the user wants to do foo.' });
  try {
    assert.equal(runGuard(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RED: forbidden trigger detected case-insensitively / period-agnostically', () => {
  const dir = fixture({ Qcase: 'when framework initialization, maintenance, or audit is required' });
  try {
    assert.equal(runGuard(dir).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: real repo skills/ pass the guard (Qinit baseline)', () => {
  const r = spawnSync('node', [GUARD], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
