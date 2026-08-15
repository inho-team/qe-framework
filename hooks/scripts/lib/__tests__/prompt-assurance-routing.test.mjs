import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const HOOK = join(ROOT, 'hooks', 'scripts', 'prompt-check.mjs');
const fixtures = [];

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-assurance-prompt-'));
  const home = mkdtempSync(join(tmpdir(), 'qe-assurance-home-'));
  fixtures.push(cwd, home);
  return { cwd, home };
}

function runPrompt(message, sessionId = 'assurance-session') {
  const { cwd, home } = fixture();
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: ROOT,
    input: JSON.stringify({ cwd, client: 'claude', session_id: sessionId, user_message: message }),
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, QE_CLIENT: 'claude' },
  });
  return { cwd, result, output: `${result.stdout}${result.stderr}` };
}

test.after(() => {
  for (const path of fixtures.reverse()) rmSync(path, { recursive: true, force: true });
});

test('ordinary large planning request stays native and creates no pipeline marker', () => {
  const { cwd, result, output } = runPrompt('대규모 아키텍처 계획을 세우고 a.mjs b.mjs c.mjs d.mjs를 구현하고 테스트와 문서까지 진행해줘');
  assert.equal(result.status, 0, output);
  assert.match(output, /Use native execution/);
  assert.match(output, /PLAN OPTIONAL/);
  assert.doesNotMatch(output, /SKILL REQUIRED:\s*Invoke\s+\/Q(?:plan|goal)/i);
  const statePath = join(cwd, '.qe', 'state', 'unified-state.json');
  if (result.status === 0) {
    try { assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).goalRuntime, undefined); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
});

test('risk wording alone cannot activate Full SIVS', () => {
  const { result, output } = runPrompt('Implement a database migration and authorization fix in migration.js safely');
  assert.equal(result.status, 0, output);
  assert.match(output, /Use native execution/);
  assert.match(output, /High-impact signals: authorization, data-migration/);
  assert.match(output, /Recommend explicit \$Qplan or \/Qplan/);
  assert.doesNotMatch(output, /Enter Qplan Full SIVS/);
});

test('risk signals inside code or quote blocks do not create a recommendation', () => {
  const { result, output } = runPrompt('fix README.md\n```\ndatabase migration authorization\n```\n> payment deployment');
  assert.equal(result.status, 0, output);
  assert.match(output, /Use native execution/);
  assert.doesNotMatch(output, /High-impact signals/);
});

test('explicit Qplan and Qgoal create same-session pipeline markers', () => {
  for (const message of ['/Qplan redesign the runtime', '/Qgoal fix README.md']) {
    const { cwd, result, output } = runPrompt(message);
    assert.equal(result.status, 0, output);
    const state = JSON.parse(readFileSync(join(cwd, '.qe', 'state', 'unified-state.json'), 'utf8'));
    assert.equal(state.goalRuntime.entries.length, 1, message);
    assert.equal(state.goalRuntime.entries[0].route, 'pipeline', message);
  }
});

test('an existing session Plan may emit a continuity hint without a new marker', () => {
  const { cwd, home } = fixture();
  const sessionId = 'continuity-session';
  mkdirSync(join(cwd, '.qe', 'state'), { recursive: true });
  mkdirSync(join(cwd, '.qe', 'planning', '.sessions'), { recursive: true });
  mkdirSync(join(cwd, '.qe', 'planning', 'plans', 'existing-plan'), { recursive: true });
  writeFileSync(join(cwd, '.qe', 'state', 'current-session.json'), JSON.stringify({ session_id: sessionId }));
  writeFileSync(join(cwd, '.qe', 'planning', '.sessions', `${sessionId}.json`), JSON.stringify({ activePlanSlug: 'existing-plan' }));
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', 'existing-plan', 'ROADMAP.md'), '# Roadmap\n\n## Phase 1\n\n### Wave 1.1\n- Continue\n');
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', 'existing-plan', 'STATE.md'), '# STATE\n\nCurrent phase: Phase 1\n');
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: ROOT,
    input: JSON.stringify({ cwd, client: 'claude', session_id: sessionId, user_message: 'continue the current work' }),
    encoding: 'utf8', timeout: 30_000, env: { ...process.env, HOME: home, QE_CLIENT: 'claude' },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /\[PSE\]/);
  try { assert.equal(JSON.parse(readFileSync(join(cwd, '.qe', 'state', 'unified-state.json'), 'utf8')).goalRuntime, undefined); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
});
