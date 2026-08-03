import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function run(script, args = [], cwd = ROOT) {
  return spawnSync(process.execPath, [resolve(ROOT, script), ...args], { cwd, encoding: 'utf8' });
}

test('shared runtime surfaces pass client-neutrality', () => {
  const result = run('scripts/check-client-neutrality.mjs');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /check-client-neutrality: PASS/);
});

test('doc convention guard accepts a clean checkout with no execution documents', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'qe-clean-docs-'));
  try {
    const result = run('scripts/check-doc-conventions.mjs', [fixture]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('doc convention guard still rejects a missing index when execution documents exist', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'qe-dirty-docs-'));
  try {
    const taskDir = join(fixture, '.qe/tasks/pending');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'TASK_REQUEST_a0000001.md'), '# Task\n');
    const result = run('scripts/check-doc-conventions.mjs', [fixture]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.qe\/index\.md — missing/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('skill surface guard supports either managed instruction artifact', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/check-skill-surface-integrity.mjs'), 'utf8');
  assert.match(source, /\['CLAUDE\.md', 'AGENTS\.md'\]\.filter/);
  assert.match(source, /missing project instruction artifact/);
  assert.doesNotMatch(source, /'README\.md', 'CLAUDE\.md'/);
});
