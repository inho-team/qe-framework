import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { tasksDir, normPath } from '../hooks/lib/qe-home.mjs';
import {
  readStatus,
  planHash,
  listVerdicts,
  listTasks,
  projectRootOf,
  taskOfPath,
  countUnchecked,
} from '../hooks/lib/tasks.mjs';

// Many git processes run in parallel under node --test; the 3 s product timeout is too tight here.
process.env.QE_GIT_TIMEOUT_MS ??= '20000';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qe-tasks-'));
}

function mkTask(home, name, files = {}) {
  const dir = path.join(tasksDir(home), name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
  return dir;
}

const goodStatus = { goal: 'g', project: '/p', state: 'active', worktrees: [], sessions: [] };

test('countUnchecked is exported from the library', () => {
  assert.equal(countUnchecked('- [ ] a\n- [x] b\n'), 1);
});

test('readStatus returns null when missing and {invalid:true} for broken JSON or unknown state', () => {
  const dir = tmp();
  assert.equal(readStatus(dir), null);
  fs.writeFileSync(path.join(dir, 'status.json'), '{ nope');
  assert.deepEqual(readStatus(dir), { invalid: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ ...goodStatus, state: 'weird' }));
  assert.deepEqual(readStatus(dir), { invalid: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ goal: 'g' }));
  assert.deepEqual(readStatus(dir), { invalid: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(goodStatus));
  assert.deepEqual(readStatus(dir), goodStatus);
  fs.writeFileSync(path.join(dir, 'status.json'), '﻿' + JSON.stringify(goodStatus));
  assert.deepEqual(readStatus(dir), goodStatus);
});

test('planHash is stable for same content and changes when implement-plan.md changes; null without it', () => {
  const dir = tmp();
  assert.equal(planHash(dir), null);
  fs.writeFileSync(path.join(dir, 'implement-plan.md'), '- [ ] a\n');
  const h1 = planHash(dir);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(planHash(dir), h1);
  fs.writeFileSync(path.join(dir, 'implement-plan.md'), '- [x] a\n');
  assert.notEqual(planHash(dir), h1);
});

test('listVerdicts skips unparsable files', () => {
  const dir = tmp();
  assert.deepEqual(listVerdicts(dir), []);
  const v = path.join(dir, 'verdicts');
  fs.mkdirSync(v);
  fs.writeFileSync(path.join(v, '2-b.json'), JSON.stringify({ result: '충족', at: 2 }));
  fs.writeFileSync(path.join(v, '1-a.json'), JSON.stringify({ result: '미충족', at: 1 }));
  fs.writeFileSync(path.join(v, '3-c.json'), '{broken');
  assert.deepEqual(listVerdicts(dir).map((x) => x.at), [1, 2]);
});

test('listTasks reports unchecked count, verifyResult from "결과:" line, and newest first', () => {
  const home = tmp();
  const old = mkTask(home, 'old', {
    'implement-plan.md': '- [x] a\n- [ ] b\n- [ ] c\n',
    'verify.md': '# v\n- 결과: 일부 미충족\n',
    'status.json': JSON.stringify(goodStatus),
  });
  const fresh = mkTask(home, 'fresh', { 'plan.md': '# p\n' });
  fs.writeFileSync(path.join(tasksDir(home), 'stray.txt'), 'x');
  const t = Date.now() / 1000;
  for (const f of ['implement-plan.md', 'verify.md', 'status.json']) {
    fs.utimesSync(path.join(old, f), t - 100, t - 100);
  }
  fs.utimesSync(path.join(fresh, 'plan.md'), t, t);

  const list = listTasks(home);
  assert.deepEqual(list.map((x) => x.name), ['fresh', 'old']);
  const o = list[1];
  assert.equal(o.unchecked, 2);
  assert.equal(o.total, 3);
  assert.equal(o.verifyResult, '일부 미충족');
  assert.equal(o.hasVerify, true);
  assert.equal(o.hasImplementPlan, true);
  assert.equal(o.hasPlan, false);
  assert.equal(o.hasHandoff, false);
  assert.deepEqual(o.status, goodStatus);
  assert.deepEqual(o.verdicts, []);
  const f = list[0];
  assert.equal(f.verifyResult, null);
  assert.equal(f.status, null);
  assert.equal(f.total, 0);
  assert.deepEqual(listTasks(path.join(home, 'missing')), []);
});

test('projectRootOf returns the main checkout for a linked worktree', () => {
  const base = tmp();
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  const g = (cwd, ...a) =>
    assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=', ...a], { cwd }).status, 0);
  g(main, 'init', '-q');
  fs.writeFileSync(path.join(main, 'f'), 'x');
  g(main, 'add', '-A');
  g(main, 'commit', '-q', '-m', 'init');
  const wt = path.join(base, 'wt');
  g(main, 'worktree', 'add', '-q', '-b', 'side', wt);
  assert.equal(normPath(projectRootOf(wt)), normPath(main));
  assert.equal(normPath(projectRootOf(main)), normPath(main));
  assert.equal(projectRootOf(tmp()), null);
});

test('taskOfPath returns the task name for <home>/tasks/T/plan.md and null outside', () => {
  const home = tmp();
  assert.equal(taskOfPath(home, path.join(home, 'tasks', 'T', 'plan.md')), 'T');
  assert.equal(taskOfPath(home, path.join(home, 'tasks', 'T')), 'T');
  assert.equal(taskOfPath(home, path.join(home, 'tasks')), null);
  assert.equal(taskOfPath(home, path.join(home, 'other', 'T', 'plan.md')), null);
  assert.equal(taskOfPath(home, path.join(home, 'tasksX', 'T')), null);
});

test('taskOfPath recognizes case-variant paths on darwin/win32 and keeps original task case', () => {
  const home = path.join(os.tmpdir(), 'Qe-Home-X');
  const f = path.join(home.toUpperCase(), 'TASKS', 'Goal-A', 'status.json');
  assert.equal(taskOfPath(home, f, 'darwin'), 'Goal-A');
  assert.equal(taskOfPath(home, f, 'win32'), 'Goal-A');
  if (process.platform !== 'win32') assert.equal(taskOfPath(home, f, 'linux'), null);
});
