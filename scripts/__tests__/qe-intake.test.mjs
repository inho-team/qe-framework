import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'qe-intake.mjs');
const OWNER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-intake-cli-'));
  mkdirSync(join(cwd, '.qe'), { recursive: true });
  return cwd;
}

function input(cwd, name, value) {
  const path = join(cwd, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function run(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  const stream = result.status === 0 ? result.stdout : result.stderr;
  return { ...result, json: JSON.parse(stream.trim()) };
}

test('CLI initializes, issues, answers, pauses, resumes, and reports status', () => {
  const cwd = project();
  const initFile = input(cwd, 'init.json', { inventory: [
    { id: 'q1', text: 'What is success?', dimension: 'acceptance', kind: 'base', ordinal: 1 },
    { id: 'q2', text: 'Preferred name?', dimension: 'naming', material: false, reversible: true, kind: 'base', ordinal: 2 },
  ] });
  let result = run(cwd, ['init', '--slug', 'demo', '--session', OWNER, '--input', initFile]);
  assert.equal(result.status, 0);
  assert.equal(result.json.record.revision, 1);

  result = run(cwd, ['next', '--slug', 'demo', '--session', OWNER, '--expected-revision', '1']);
  assert.equal(result.json.record.revision, 2);
  assert.deepEqual(result.json.result.questions.map((item) => item.label), ['[1/2]', '[2/2]']);

  const answerFile = input(cwd, 'answer.json', { questionId: 'q1', response: { value: 'All tests pass' } });
  result = run(cwd, ['answer', '--slug', 'demo', '--session', OWNER, '--expected-revision', '2', '--input', answerFile]);
  assert.equal(result.json.record.revision, 3);

  result = run(cwd, ['pause', '--slug', 'demo', '--session', OWNER, '--expected-revision', '3']);
  assert.equal(result.json.record.intake.status, 'paused');
  assert.equal(result.json.record.intake.earliestUnresolvedLabel, '[2/2]');
  result = run(cwd, ['claim', '--slug', 'demo', '--session', OTHER,
    '--previous-session', OWNER, '--expected-revision', '4']);
  assert.equal(result.json.record.ownerSession, OTHER);
  assert.equal(result.json.record.revision, 5);
  result = run(cwd, ['resume', '--slug', 'demo', '--session', OTHER, '--expected-revision', '5']);
  assert.equal(result.json.record.intake.status, 'questioning');
  assert.equal(result.json.record.intake.earliestUnresolvedLabel, '[2/2]');

  result = run(cwd, ['status', '--slug', 'demo']);
  assert.equal(result.status, 0);
  assert.equal(result.json.changed, false);
  assert.equal(result.json.record.revision, 6);
});

test('CLI returns structured nonzero failures without changing accepted state', () => {
  const cwd = project();
  const initFile = input(cwd, 'init.json', { inventory: [] });
  assert.equal(run(cwd, ['init', '--slug', 'demo', '--session', OWNER, '--input', initFile]).status, 0);
  let result = run(cwd, ['confirm', '--slug', 'demo', '--session', OWNER, '--expected-revision', '2']);
  assert.equal(result.status, 1);
  assert.equal(result.json.code, 'INTAKE_STORE_STALE_REVISION');
  assert.equal(run(cwd, ['status', '--slug', 'demo']).json.record.revision, 1);
  const bad = join(cwd, 'bad.json');
  writeFileSync(bad, '{broken');
  result = run(cwd, ['answer', '--slug', 'demo', '--session', OWNER, '--expected-revision', '1', '--input', bad]);
  assert.equal(result.status, 1);
  assert.equal(result.json.code, 'INTAKE_CLI_INVALID_JSON');
});

test('CLI supports rebaseline, synthesis correction, confirmation, and stop dispatch', () => {
  const cwd = project();
  const initFile = input(cwd, 'init.json', { inventory: [] });
  assert.equal(run(cwd, ['init', '--slug', 'demo', '--session', OWNER, '--input', initFile]).status, 0);
  const correction = input(cwd, 'synthesis.json', { action: 'correct', synthesis: 'Updated' });
  let result = run(cwd, ['synthesize', '--slug', 'demo', '--session', OWNER, '--expected-revision', '1', '--input', correction]);
  assert.equal(result.status, 0);
  result = run(cwd, ['confirm', '--slug', 'demo', '--session', OWNER, '--expected-revision', '2']);
  assert.equal(result.json.record.intake.status, 'confirmed');

  const second = project();
  const base = input(second, 'init.json', { inventory: [{ id: 'q1', text: 'Scope?', dimension: 'scope', kind: 'base', ordinal: 1 }] });
  assert.equal(run(second, ['init', '--slug', 'demo', '--session', OWNER, '--input', base]).status, 0);
  const request = input(second, 'request.json', { action: 'request' });
  result = run(second, ['rebaseline', '--slug', 'demo', '--session', OWNER, '--expected-revision', '1', '--input', request]);
  assert.equal(result.json.record.intake.status, 'awaiting-rebaseline');
  result = run(second, ['stop', '--slug', 'demo', '--session', OWNER, '--expected-revision', '2']);
  assert.equal(result.json.record.intake.reason, 'BLOCKED_BY_USER');
});
