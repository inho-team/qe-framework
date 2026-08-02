#!/usr/bin/env node
/**
 * Regression guard for the instruction bootstrap invoked by explicit QE entry
 * commands. It exercises the real UserPromptSubmit hook, not just the helper.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'hooks', 'scripts', 'prompt-check.mjs');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-instruction-bootstrap-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(cwd, user_message, client) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd, user_message, client }),
    encoding: 'utf8',
  });
  expect(r.status === 0, `${user_message}: hook exited ${r.status}: ${r.stderr}`);
  try { JSON.parse(r.stdout); } catch { expect(false, `${user_message}: hook did not return JSON`); }
}

{
  const { dir, cleanup } = fixture();
  try {
    run(dir, '/Qplan initialize project', 'claude');
    expect(existsSync(join(dir, 'QE.md')), 'Qplan did not create QE.md');
    expect(existsSync(join(dir, 'CLAUDE.md')), 'Qplan did not create CLAUDE.md for Claude');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8').includes('qe-framework:begin'), 'Qplan pointer missing');
  } finally { cleanup(); }
}

{
  const { dir, cleanup } = fixture();
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '# Existing Codex rules\nKeep this text.\n');
    run(dir, '$Qgoal add audit trail', 'codex');
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents.includes('Keep this text.'), 'Qgoal overwrote user AGENTS.md content');
    expect(agents.includes('QE.md'), 'Qgoal did not add the AGENTS.md pointer');
    expect(existsSync(join(dir, 'QE.md')), 'Qgoal did not create QE.md');
  } finally { cleanup(); }
}

{
  const { dir, cleanup } = fixture();
  try {
    mkdirSync(join(dir, '.qe'), { recursive: true });
    run(dir, 'please plan the project structure', 'claude');
    expect(!existsSync(join(dir, 'QE.md')), 'ordinary language unexpectedly created QE.md');
    expect(!existsSync(join(dir, 'CLAUDE.md')), 'ordinary language unexpectedly created CLAUDE.md');
  } finally { cleanup(); }
}

if (failures.length) {
  console.error(`check-project-instruction-bootstrap: FAIL\n\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('check-project-instruction-bootstrap: PASS (Qplan/Qgoal hook bootstrap, client pointer preservation, no natural-language side effect)');
