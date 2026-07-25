#!/usr/bin/env node
/**
 * check-agent-tools.test.mjs
 *
 * Red-green proof for scripts/check-agent-tools.mjs (audit-harvest R7 guard).
 * Each case builds a fixture agents dir in a temp sandbox and runs the REAL
 * guard against it via QE_AGENTS_DIR; the repo's own agents/ are never touched.
 *
 * Run: node --test scripts/__tests__/check-agent-tools.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', 'check-agent-tools.mjs');

/** Run the guard against a fixture agents dir; returns { status, stdout, stderr }. */
function runGuard(agentsDir) {
  const r = spawnSync('node', [GUARD], {
    env: { ...process.env, QE_AGENTS_DIR: agentsDir },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Create a temp agents dir containing the given { name: fileBody } agents. */
function fixture(agents) {
  const dir = mkdtempSync(join(tmpdir(), 'qe-agent-tools-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(agents)) {
    writeFileSync(join(dir, `${name}.md`), body);
  }
  return dir;
}

const WRITES = '## Rules\n- After completion, write result to `.qe/agent-results/X-latest.md`\n';

test('RED: body writes state file but tools omits Write -> exit 1', () => {
  const dir = fixture({ Ebad: `---\nname: Ebad\ntools: Read, Grep, Glob, Bash\n---\n\n${WRITES}` });
  try {
    const r = runGuard(dir);
    assert.equal(r.status, 1, 'guard must FAIL');
    assert.match(r.stderr, /lacks Write/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: body writes state file and tools declares Write -> exit 0', () => {
  const dir = fixture({ Egood: `---\nname: Egood\ntools: Read, Grep, Glob, Bash, Write\n---\n\n${WRITES}` });
  try {
    assert.equal(runGuard(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: body only READS a result file -> not flagged (no false positive)', () => {
  const body = '---\nname: Ereader\ntools: Read, Grep, Glob\n---\n\n## Rules\n- Before starting, read `.qe/agent-results/Other-latest.md` if it exists\n';
  const dir = fixture({ Ereader: body });
  try {
    assert.equal(runGuard(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: agent that never writes state files -> not flagged', () => {
  const dir = fixture({ Eplain: '---\nname: Eplain\ntools: Read, Grep, Glob\n---\n\nJust analyzes and returns text.\n' });
  try {
    assert.equal(runGuard(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GREEN: real repo agents/ pass the guard', () => {
  // No QE_AGENTS_DIR override -> scans the real agents/ dir.
  const r = spawnSync('node', [GUARD], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
