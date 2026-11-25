import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { shouldBlock, findBlock } from '../hooks/stop.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'stop.mjs');

function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// Many git processes run in parallel under node --test; the 3 s product timeout is too tight here.
process.env.QE_GIT_TIMEOUT_MS ??= '20000';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function setup() {
  const home = tmp('qe-stop-');
  return { home, env: { QE_HOME: home } };
}

function addTask(home, name, { state = 'active', sessions = ['s1'], plan = '- [x] a\n- [x] b\n' } = {}) {
  const dir = path.join(home, 'tasks', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'status.json'),
    JSON.stringify({
      goal: 'g',
      project: '/p',
      state,
      worktrees: [],
      sessions: sessions.map((id) => ({ id, firstSeen: 0, lastSeen: 0 })),
      ...(state === 'done' ? { done: { commit: 'abc1234', branch: 'main', verdict: 'v' } } : {}),
    }),
  );
  if (plan !== null) fs.writeFileSync(path.join(dir, 'implement-plan.md'), plan);
  return dir;
}

test('blocks once for a fully checked plan without a verdict, then not again for the same plan', () => {
  const { home, env } = setup();
  const dir = addTask(home, 't1');
  const r = shouldBlock({ session_id: 's1' }, env);
  assert.ok(r);
  assert.deepEqual(r.tasks, ['t1']);
  assert.match(r.reason, /^t1 plan이 모두 체크됐지만 레드팀 검수 기록이 없다\. Qverify로 검증자 서브에이전트를 돌려라\./);
  assert.match(r.reason, /status\.json state를 stopped로 바꿔라\.$/);
  const markers = fs.readdirSync(dir).filter((f) => f.startsWith('.stop-blocked-'));
  assert.equal(markers.length, 1);
  assert.equal(shouldBlock({ session_id: 's1' }, env), null);
});

test('blocks again after implement-plan.md changes (new planHash)', () => {
  const { home, env } = setup();
  const dir = addTask(home, 't1');
  assert.ok(shouldBlock({ session_id: 's1' }, env));
  assert.equal(shouldBlock({ session_id: 's1' }, env), null);
  fs.writeFileSync(path.join(dir, 'implement-plan.md'), '- [x] a\n- [x] b\n- [x] c\n');
  assert.ok(shouldBlock({ session_id: 's1' }, env));
});

test('does not block when any verdict for this planHash exists, even 미충족', () => {
  const { home, env } = setup();
  const dir = addTask(home, 't1');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'implement-plan.md'))).digest('hex');
  fs.mkdirSync(path.join(dir, 'verdicts'));
  fs.writeFileSync(
    path.join(dir, 'verdicts', '1-a.json'),
    JSON.stringify({ task: 't1', result: '미충족', planHash: hash, at: 1 }),
  );
  assert.equal(shouldBlock({ session_id: 's1' }, env), null);
  // a verdict for an older plan state does not count
  fs.writeFileSync(path.join(dir, 'implement-plan.md'), '- [x] a\n- [x] z\n');
  assert.ok(shouldBlock({ session_id: 's1' }, env));
});

test('ignores stopped and done tasks, other sessions\' tasks, and stop_hook_active', () => {
  const { home, env } = setup();
  addTask(home, 'stopped', { state: 'stopped' });
  addTask(home, 'done', { state: 'done' });
  addTask(home, 'other', { sessions: ['s9'] });
  addTask(home, 'unchecked', { plan: '- [x] a\n- [ ] b\n' });
  addTask(home, 'noplan', { plan: null });
  assert.equal(shouldBlock({ session_id: 's1' }, env), null);
  const dir = addTask(home, 'mine');
  assert.equal(shouldBlock({ session_id: 's1', stop_hook_active: true }, env), null);
  assert.equal(shouldBlock({ session_id: 's1', agent_id: 'a' }, env), null);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('.stop-blocked-')).length, 0);
  const r = shouldBlock({ session_id: 's1' }, env);
  assert.deepEqual(r.tasks, ['mine']);
});

test('does nothing when ~/.qe/tasks does not exist', () => {
  const home = path.join(tmp('qe-stop-'), 'nope');
  assert.equal(shouldBlock({ session_id: 's1' }, { QE_HOME: home }), null);
  assert.equal(fs.existsSync(home), false);
});

test('verifying state also blocks, and several tasks are joined in one reason', () => {
  const { home, env } = setup();
  addTask(home, 'a', { state: 'verifying' });
  addTask(home, 'b');
  const r = shouldBlock({ session_id: 's1' }, env);
  assert.deepEqual([...r.tasks].sort(), ['a', 'b']);
  assert.ok(r.reason.startsWith(r.tasks.join(', ') + ' plan이'));
});

test('an implement-plan.md with no checkboxes is not a finished plan', () => {
  const { home, env } = setup();
  const dir = addTask(home, 't1', { plan: '# 계획\n\n아직 단계 없음\n' });
  assert.equal(shouldBlock({ session_id: 's1' }, env), null);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('.stop-blocked-')).length, 0);
});

test('findBlock decides without writing markers or committing', () => {
  const { home, env } = setup();
  const dir = addTask(home, 't1');
  const r = findBlock({ session_id: 's1' }, env);
  assert.deepEqual(r.tasks, ['t1']);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('.stop-blocked-')).length, 0);
});

test('script prints the block, then marks every task and commits ~/.qe once', () => {
  const { home } = setup();
  const a = addTask(home, 'a');
  const b = addTask(home, 'b');
  gitIn(home, 'init', '-q');
  gitIn(home, 'add', '-A');
  gitIn(home, 'commit', '-q', '-m', 'seed');
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, QE_HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /레드팀 검수 기록이 없다/);
  for (const dir of [a, b]) assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('.stop-blocked-')).length, 1);
  assert.equal(gitIn(home, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(gitIn(home, 'status', '--porcelain'), '');
});
