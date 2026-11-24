import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  countUnchecked,
  findOpenTasks,
  buildContext,
  MAX_HANDOFF_CHARS,
} from '../hooks/session-start.mjs';

// Many git processes run in parallel under node --test; the 3 s product timeout is too tight here.
process.env.QE_GIT_TIMEOUT_MS ??= '20000';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hookPath = path.join(repoRoot, 'hooks', 'session-start.mjs');
const guideText = fs.readFileSync(path.join(repoRoot, 'hooks', 'guide.md'), 'utf8');
const guideFirstLine = guideText.split(/\r?\n/)[0];

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qe-hook-'));
}

function writeTask(root, name, files) {
  const dir = path.join(root, 'docs', 'qe', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

// Always a temp QE_HOME: the hook must never touch the real ~/.qe from a test.
function runHook(stdin, cwd) {
  return spawnSync(process.execPath, [hookPath], { input: stdin, cwd, encoding: 'utf8', env: { ...process.env, QE_HOME: tmpRoot() } });
}

test('countUnchecked counts open boxes with CRLF and uppercase X as done', () => {
  assert.equal(countUnchecked('- [ ] a\r\n- [x] b\r\n- [X] c\r\n  - [ ] d\n'), 2);
});

test('findOpenTasks returns [] when docs/qe is missing', () => {
  assert.deepEqual(findOpenTasks(tmpRoot()), []);
});

test('findOpenTasks skips stray files and non-task directories', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'qe', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'qe', 'README.md'), '# notes');
  fs.writeFileSync(path.join(root, 'docs', 'qe', 'notes', 'a.txt'), 'x');
  assert.deepEqual(findOpenTasks(root), []);
});

test('findOpenTasks classifies done, unchecked, and plan-less tasks', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-01-a', { 'plan.md': 's', 'implement-plan.md': '- [x] one\n- [X] two\n', 'verify.md': 'ok' });
  writeTask(root, '2026-11-02-b', { 'plan.md': 's', 'implement-plan.md': '- [x] one\n- [ ] two\n', 'verify.md': 'partial' });
  writeTask(root, '2026-11-03-c', { 'plan.md': 's' });

  const tasks = findOpenTasks(root);
  const names = tasks.map((t) => t.name).sort();
  assert.deepEqual(names, ['2026-11-02-b', '2026-11-03-c']);

  const b = tasks.find((t) => t.name === '2026-11-02-b');
  assert.equal(b.unchecked, 1);
  assert.equal(b.hasImplementPlan, true);
  assert.equal(b.hasVerify, true);

  const c = tasks.find((t) => t.name === '2026-11-03-c');
  assert.equal(c.hasPlan, true);
  assert.equal(c.hasImplementPlan, false);
  assert.equal(c.hasVerify, false);
  assert.equal(c.handoffPath, null);
});

test('buildContext with no tasks is just the guide', () => {
  const ctx = buildContext(tmpRoot(), guideText);
  assert.equal(ctx, guideText.trim());
  assert.ok(!ctx.includes('## 미완료 작업'));
});

test('buildContext lists open tasks and truncates a large handoff', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-02-b', {
    'implement-plan.md': '- [ ] two\n',
    'handoff.md': 'H'.repeat(20000),
  });
  const ctx = buildContext(root, guideText);
  assert.ok(ctx.includes('## 미완료 작업'));
  assert.ok(ctx.includes('docs/qe/2026-11-02-b'));
  assert.ok(ctx.includes('잘림'));
  assert.ok(ctx.length < MAX_HANDOFF_CHARS + guideText.length + 1000);
});

test('CLI falls back to cwd on malformed stdin and exits 0', () => {
  const res = runHook('not json', tmpRoot());
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(out.hookSpecificOutput.additionalContext.includes(guideFirstLine));
});

test('CLI uses input.cwd and injects the open task handoff', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-05-d', { 'implement-plan.md': '- [ ] next\n', 'handoff.md': 'NEXT: run the migration test' });
  const res = runHook(JSON.stringify({ cwd: root, source: 'compact' }), tmpRoot());
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('NEXT: run the migration test'));
});

test('findOpenTasks treats a handoff-only folder as an open task in understanding', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-06-e', { 'handoff.md': 'still talking with the user' });
  const tasks = findOpenTasks(root);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].name, '2026-11-06-e');
  const ctx = buildContext(root, guideText);
  assert.ok(ctx.includes('이해 중'));
  assert.ok(ctx.includes('still talking with the user'));
});

test('findOpenTasks keeps a fully checked task open when verify.md reports 미충족', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-07-f', { 'implement-plan.md': '- [x] one\n', 'verify.md': '# t\n\n- 결과: 일부 미충족\n' });
  writeTask(root, '2026-11-07-g', { 'implement-plan.md': '- [x] one\n', 'verify.md': '# t\r\n\r\n- 결과: 충족\r\n' });
  const tasks = findOpenTasks(root);
  assert.deepEqual(tasks.map((t) => t.name), ['2026-11-07-f']);
  assert.ok(buildContext(root, guideText).includes('verify 미충족'));
});

test('countUnchecked also counts plus-bullet, numbered, and tab-separated checkboxes', () => {
  const md = '+ [ ] a\n1. [ ] b\n2) [ ] c\n-\t[ ] d\n- [x] done\n10. [X] done\n';
  assert.equal(countUnchecked(md), 4);
});

test('countUnchecked ignores checkbox-looking text that is not a list item', () => {
  assert.equal(countUnchecked('see [ ] later\n`- [ ]` in code\n'), 0);
});

test('buildContext picks the handoff by handoff.md time, newest folder name breaking ties', () => {
  const root = tmpRoot();
  const older = writeTask(root, '2026-11-01-older', { 'implement-plan.md': '- [ ] a\n', 'handoff.md': 'OLDER HANDOFF' });
  const newer = writeTask(root, '2026-11-09-newer', { 'implement-plan.md': '- [ ] a\n', 'handoff.md': 'NEWER HANDOFF' });
  // Same mtime everywhere, as after a fresh git clone: the later-dated folder wins.
  const t = new Date('2026-11-10T00:00:00Z');
  for (const dir of [older, newer]) {
    for (const f of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, f), t, t);
  }
  assert.ok(buildContext(root, guideText).includes('NEWER HANDOFF'));

  // An implement-plan.md edit in the older task must not outrank the newer task's handoff.
  fs.utimesSync(path.join(older, 'implement-plan.md'), new Date('2026-11-12T00:00:00Z'), new Date('2026-11-12T00:00:00Z'));
  const ctx = buildContext(root, guideText);
  assert.ok(ctx.includes('NEWER HANDOFF'));
  assert.ok(!ctx.includes('OLDER HANDOFF'));
});

test('a folder with only plan.md is listed as still planning', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-08-h', { 'plan.md': '# h — Plan\n' });
  const tasks = findOpenTasks(root);
  assert.deepEqual(tasks.map((t) => t.name), ['2026-11-08-h']);
  assert.ok(buildContext(root, guideText).includes('implement-plan.md 없음 (계획 중)'));
});

test('the old layout (spec.md only) is not recognized as a task', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-08-old', { 'spec.md': '# old — Spec\n' });
  assert.deepEqual(findOpenTasks(root), []);
});

function writeHomeTask(home, name, project, extra = {}, files = {}) {
  const dir = path.join(home, 'tasks', name);
  fs.mkdirSync(dir, { recursive: true });
  const status = { goal: 'g', project, state: 'active', worktrees: [], sessions: [], ...extra };
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), b);
  return dir;
}

test('lists open ~/.qe tasks of this project only', () => {
  const root = tmpRoot();
  const home = tmpRoot();
  writeHomeTask(home, 'mine', root, {}, { 'implement-plan.md': '- [x] a\n- [ ] b\n', 'handoff.md': 'HOME HANDOFF' });
  writeHomeTask(home, 'other', path.join(root, 'elsewhere'));
  writeHomeTask(home, 'finished', root, { state: 'stopped' });
  const ctx = buildContext(root, guideText, { home });
  assert.ok(ctx.includes('## 미완료 작업 (~/.qe)'));
  assert.ok(ctx.includes('- ~/.qe/tasks/mine — active, 남은 단계 1/2, handoff 있음'));
  assert.ok(!ctx.includes('tasks/other'));
  assert.ok(!ctx.includes('tasks/finished'));
  assert.ok(ctx.includes('HOME HANDOFF'));
});

test('includes the session id line when provided', () => {
  const ctx = buildContext(tmpRoot(), guideText, { home: tmpRoot(), sessionId: 'abc-123' });
  assert.ok(ctx.includes('이 세션 id: abc-123'));
  assert.ok(ctx.indexOf('이 세션 id') > ctx.indexOf(guideFirstLine));
});

test('keeps listing legacy docs/qe tasks under the legacy heading', () => {
  const root = tmpRoot();
  writeTask(root, '2026-11-02-b', { 'implement-plan.md': '- [ ] two\n' });
  const ctx = buildContext(root, guideText, { home: tmpRoot() });
  assert.ok(ctx.includes('## 이전 위치(docs/qe)의 미완료 작업 — ~/.qe/tasks로 옮길 것'));
  assert.ok(ctx.includes('docs/qe/2026-11-02-b'));
});

test('still prints the guide when QE_HOME is unwritable', () => {
  const blocker = path.join(tmpRoot(), 'file');
  fs.writeFileSync(blocker, 'x');
  const res = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ cwd: tmpRoot(), session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, QE_HOME: path.join(blocker, 'home') },
  });
  assert.equal(res.status, 0);
  const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(guideFirstLine));
  assert.ok(ctx.includes('이 세션 id: s1'));
});
