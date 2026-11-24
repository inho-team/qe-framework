import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordTouch } from '../hooks/post-tool-use.mjs';
import { normPath } from '../hooks/lib/qe-home.mjs';

// Many git processes run in parallel under node --test; the 3 s product timeout is too tight here.
process.env.QE_GIT_TIMEOUT_MS ??= '20000';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'post-tool-use.mjs');

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function setup({ status } = {}) {
  const home = tmp('qe-home-');
  const env = { QE_HOME: home };
  const repo = tmp('qe-repo-');
  gitIn(repo, 'init', '-q', '-b', 'main');
  gitIn(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  const taskDir = path.join(home, 'tasks', 'goal-a');
  fs.mkdirSync(taskDir, { recursive: true });
  const file = path.join(taskDir, 'status.json');
  const initial = status ?? { goal: 'g', project: '', state: 'active', worktrees: [], sessions: [] };
  fs.writeFileSync(file, typeof initial === 'string' ? initial : JSON.stringify(initial));
  gitIn(home, 'init', '-q');
  gitIn(home, 'add', '-A');
  gitIn(home, 'commit', '-q', '-m', 'seed');
  return { home, env, repo, taskDir, file };
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('adds the session and worktree on first touch and only bumps lastSeen on the second', () => {
  const { env, repo, taskDir, file } = setup();
  const input = {
    session_id: 's1',
    cwd: repo,
    tool_name: 'Write',
    tool_input: { file_path: path.join(taskDir, 'plan.md') },
  };
  assert.deepEqual(recordTouch(input, env), { task: 'goal-a' });
  const a = read(file);
  assert.equal(a.sessions.length, 1);
  assert.equal(a.sessions[0].id, 's1');
  assert.equal(a.worktrees.length, 1);
  assert.equal(normPath(a.worktrees[0].path), normPath(repo));
  assert.equal(a.worktrees[0].branch, 'main');
  assert.ok(a.project);

  assert.deepEqual(recordTouch(input, env), { task: 'goal-a' });
  const b = read(file);
  assert.equal(b.sessions.length, 1);
  assert.equal(b.worktrees.length, 1);
  assert.equal(b.sessions[0].firstSeen, a.sessions[0].firstSeen);
  assert.ok(b.sessions[0].lastSeen >= a.sessions[0].lastSeen);
});

test('records a subagent touch under the parent session id', () => {
  const { env, repo, taskDir, file } = setup();
  recordTouch(
    { session_id: 'parent', agent_id: 'sub1', cwd: repo, tool_input: { file_path: path.join(taskDir, 'x.md') } },
    env,
  );
  assert.deepEqual(read(file).sessions.map((s) => s.id), ['parent']);
});

test('records the session even when cwd is not a git repo', () => {
  const { env, taskDir, file } = setup();
  const plain = tmp('qe-plain-');
  assert.ok(recordTouch({ session_id: 's1', cwd: plain, tool_input: { file_path: path.join(taskDir, 'x.md') } }, env));
  const s = read(file);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.worktrees.length, 0);
});

test('ignores files outside ~/.qe/tasks', () => {
  const { env, repo, file } = setup();
  const before = fs.readFileSync(file, 'utf8');
  const out = recordTouch({ session_id: 's1', cwd: repo, tool_input: { file_path: path.join(repo, 'a.txt') } }, env);
  assert.equal(out, null);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const fresh = path.join(tmp('qe-none-'), 'absent-home');
  assert.equal(recordTouch({ session_id: 's1', cwd: repo, tool_input: { file_path: path.join(repo, 'a.txt') } }, { QE_HOME: fresh }), null);
  assert.equal(fs.existsSync(fresh), false);
});

test('leaves an invalid status.json untouched', () => {
  const { env, repo, taskDir, file } = setup({ status: '{ not json' });
  const out = recordTouch({ session_id: 's1', cwd: repo, tool_input: { file_path: path.join(taskDir, 'plan.md') } }, env);
  assert.equal(out, null);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('commits the change in ~/.qe', () => {
  const { home, env, repo, taskDir } = setup();
  const count = () => gitIn(home, 'log', '--oneline').split('\n').length;
  const before = count();
  recordTouch({ session_id: 's1', cwd: repo, tool_input: { file_path: path.join(taskDir, 'plan.md') } }, env);
  assert.equal(count(), before + 1);
});

test('exits 0 with no output on malformed stdin', () => {
  for (const input of ['not json', '', '{"tool_input":null}']) {
    const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...process.env, QE_HOME: tmp('qe-home-') } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  }
});
