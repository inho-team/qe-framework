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

function runHook(stdin, cwd) {
  return spawnSync(process.execPath, [hookPath], { input: stdin, cwd, encoding: 'utf8' });
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
  writeTask(root, '2026-11-01-a', { 'spec.md': 's', 'plan.md': '- [x] one\n- [X] two\n', 'verify.md': 'ok' });
  writeTask(root, '2026-11-02-b', { 'spec.md': 's', 'plan.md': '- [x] one\n- [ ] two\n', 'verify.md': 'partial' });
  writeTask(root, '2026-11-03-c', { 'spec.md': 's' });

  const tasks = findOpenTasks(root);
  const names = tasks.map((t) => t.name).sort();
  assert.deepEqual(names, ['2026-11-02-b', '2026-11-03-c']);

  const b = tasks.find((t) => t.name === '2026-11-02-b');
  assert.equal(b.unchecked, 1);
  assert.equal(b.hasPlan, true);
  assert.equal(b.hasVerify, true);

  const c = tasks.find((t) => t.name === '2026-11-03-c');
  assert.equal(c.hasPlan, false);
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
    'plan.md': '- [ ] two\n',
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
  writeTask(root, '2026-11-05-d', { 'plan.md': '- [ ] next\n', 'handoff.md': 'NEXT: run the migration test' });
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
  writeTask(root, '2026-11-07-f', { 'plan.md': '- [x] one\n', 'verify.md': '# t\n\n- 결과: 일부 미충족\n' });
  writeTask(root, '2026-11-07-g', { 'plan.md': '- [x] one\n', 'verify.md': '# t\r\n\r\n- 결과: 충족\r\n' });
  const tasks = findOpenTasks(root);
  assert.deepEqual(tasks.map((t) => t.name), ['2026-11-07-f']);
  assert.ok(buildContext(root, guideText).includes('verify 미충족'));
});
