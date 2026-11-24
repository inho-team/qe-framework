import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from '../hooks/pre-tool-use.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'pre-tool-use.mjs');
const SHA = 'a'.repeat(40);

function setup({ state = 'active', verdicts = [] } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qe-pre-')));
  const env = { QE_HOME: home };
  const taskDir = path.join(home, 'tasks', 'goal-a');
  fs.mkdirSync(path.join(taskDir, 'verdicts'), { recursive: true });
  const status = { goal: 'g', project: 'p', state, worktrees: [], sessions: [] };
  if (state === 'done') status.done = { commit: SHA, branch: 'b' };
  const file = path.join(taskDir, 'status.json');
  fs.writeFileSync(file, JSON.stringify(status, null, 2));
  verdicts.forEach((v, i) => fs.writeFileSync(path.join(taskDir, 'verdicts', `${i}-x.json`), JSON.stringify({ task: 'goal-a', at: i, ...v })));
  return { home, env, taskDir, file, status };
}

const doneStatus = (commit) => JSON.stringify({ goal: 'g', project: 'p', state: 'done', worktrees: [], sessions: [], done: { commit, branch: 'b' } });
const write = (file_path, content) => ({ tool_name: 'Write', tool_input: { file_path, content } });

test('denies Write/Edit under verdicts/', () => {
  const t = setup();
  const f = path.join(t.taskDir, 'verdicts', 'new.json');
  assert.ok(decide(write(f, '{}'), t.env).deny);
  assert.ok(decide({ tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'b' } }, t.env).deny);
});

test('denies setting state done without a matching 충족 verdict', () => {
  const t = setup();
  const r = decide(write(t.file, doneStatus(SHA)), t.env);
  assert.match(r.deny, /QE-VERDICT/);
});

test('denies done without done.commit', () => {
  const t = setup({ verdicts: [{ result: '충족', commit: SHA }] });
  const c = JSON.stringify({ goal: 'g', project: 'p', state: 'done', worktrees: [], sessions: [], done: {} });
  assert.ok(decide(write(t.file, c), t.env).deny);
});

test('denies when the only verdict is 일부 미충족 or has a different commit', () => {
  const t = setup({ verdicts: [{ result: '일부 미충족', commit: SHA }, { result: '충족', commit: 'b'.repeat(40) }] });
  assert.ok(decide(write(t.file, doneStatus(SHA)), t.env).deny);
});

test('allows done with a matching 충족 verdict (case-insensitive, prefix)', () => {
  const t = setup({ verdicts: [{ result: '충족', commit: SHA }] });
  assert.equal(decide(write(t.file, doneStatus(SHA)), t.env), null);
  assert.equal(decide(write(t.file, doneStatus(SHA.toUpperCase())), t.env), null);
  assert.equal(decide(write(t.file, doneStatus('aaaaaaa')), t.env), null);
  const t2 = setup({ verdicts: [{ result: '충족', commit: 'aaaaaaa' }] });
  assert.equal(decide(write(t2.file, doneStatus(SHA)), t2.env), null);
});

test('allows ordinary edits and edits to an already-done status', () => {
  const t = setup();
  const c = JSON.stringify({ ...t.status, goal: 'other' });
  assert.equal(decide(write(t.file, c), t.env), null);
  assert.equal(decide(write(path.join(t.taskDir, 'plan.md'), 'x'), t.env), null);
  const d = setup({ state: 'done' });
  assert.equal(decide(write(d.file, doneStatus('c'.repeat(40))), d.env), null);
});

test('ignores paths outside ~/.qe/tasks without touching the filesystem', () => {
  const home = path.join(os.tmpdir(), 'qe-pre-nonexistent-' + Date.now());
  const r = decide(write(path.join(os.tmpdir(), 'elsewhere', 'status.json'), doneStatus(SHA)), { QE_HOME: home });
  assert.equal(r, null);
  assert.equal(fs.existsSync(home), false);
});

test('applies Edit old_string/new_string (and replace_all) before judging', () => {
  const t = setup();
  const edit = (o, n, replace_all) => ({ tool_name: 'Edit', tool_input: { file_path: t.file, old_string: o, new_string: n, replace_all } });
  assert.ok(decide(edit('"state": "active"', '"state": "done"'), t.env).deny);
  // old_string not found: allow unless new_string mentions done (conservative; see curly-quote test)
  assert.equal(decide(edit('nope', '"state": "x"'), t.env), null);
  // unique old_string touching only the goal -> state stays active -> allow
  fs.writeFileSync(t.file, JSON.stringify({ ...t.status, goal: 'active' }, null, 2));
  assert.equal(decide(edit('"goal": "active"', '"goal": "done"'), t.env), null);
  // replace_all hits state too -> deny
  assert.ok(decide(edit('active', 'done', true), t.env).deny);
});

test('does not block writes producing invalid JSON', () => {
  const t = setup();
  assert.equal(decide(write(t.file, '{ not json'), t.env), null);
});

test('treats a broken current status.json as not done', () => {
  const t = setup();
  fs.writeFileSync(t.file, '{ broken');
  assert.ok(decide(write(t.file, doneStatus(SHA)), t.env).deny);
});

test('script prints deny JSON, or nothing, and exits 0', () => {
  const t = setup();
  const run = (input) => spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, QE_HOME: t.home } });
  const r = run({ ...write(t.file, doneStatus(SHA)) });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'deny');
  assert.ok(out.permissionDecisionReason);
  const ok = run(write(path.join(t.taskDir, 'plan.md'), 'x'));
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, '');
  const bad = spawnSync(process.execPath, [script], { input: 'garbage', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
});

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const ci = win || mac;

test('denies case-variant status.json and Verdicts paths on case-insensitive platforms', { skip: !ci }, () => {
  const t = setup();
  assert.ok(decide(write(path.join(t.taskDir, 'STATUS.JSON'), doneStatus(SHA)), t.env).deny);
  assert.ok(decide(write(path.join(t.taskDir, 'Verdicts', 'x.json'), '{}'), t.env).deny);
});

test('denies case-variant tasks/ task folder (win32)', { skip: !win }, () => {
  const t = setup();
  const f = path.join(t.home, 'TASKS', 'GOAL-A', 'Status.json');
  assert.ok(decide(write(f, doneStatus(SHA)), t.env).deny);
});

test('denies NTFS stream suffix on status.json (win32)', { skip: !win }, () => {
  const t = setup();
  assert.ok(decide(write(t.file + '::$DATA', doneStatus(SHA)), t.env).deny);
  assert.ok(decide(write(path.join(t.taskDir, 'verdicts', 'x.json::$DATA'), '{}'), t.env).deny);
});

test('denies \\?\ extended-length prefix (win32)', { skip: !win }, () => {
  const t = setup();
  assert.ok(decide(write('\\\\?\\' + t.file, doneStatus(SHA)), t.env).deny);
});

test('denies Git Bash style /c/... path (win32)', { skip: !win }, () => {
  const t = setup();
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(t.file);
  const gb = '/' + m[1].toLowerCase() + '/' + m[2].split('\\').join('/');
  assert.ok(decide(write(gb, doneStatus(SHA)), t.env).deny);
});

test('denies ~/... paths that resolve into QE_HOME', () => {
  const t = setup();
  const home = fs.realpathSync(os.homedir());
  const rel = path.relative(home, t.file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return; // QE_HOME not under the user home on this machine
  assert.ok(decide(write('~/' + rel.split(path.sep).join('/'), doneStatus(SHA)), t.env).deny);
});

test('ignores a ~ path outside QE_HOME', () => {
  const t = setup();
  assert.equal(decide(write('~/elsewhere/status.json', doneStatus(SHA)), t.env), null);
});

test('Edit with curly quotes is normalized like the real tool', () => {
  const t = setup();
  const edit = (o, n) => ({ tool_name: 'Edit', tool_input: { file_path: t.file, old_string: o, new_string: n } });
  // normalizes to a real match -> judged as done -> deny
  assert.ok(decide(edit('\u201cstate\u201d: \u201cactive\u201d', '\u201cstate\u201d: \u201cdone\u201d'), t.env).deny);
  // unresolvable edit that mentions done on status.json -> conservative deny
  const r = decide(edit('no such text', 'x done y'), t.env);
  assert.match(r.deny, /Write/);
  // unresolvable edit without done -> allow
  assert.equal(decide(edit('no such text', 'x'), t.env), null);
});

test('curly-quote Edit splices into the original (curly quote inside a value)', () => {
  const t = setup();
  fs.writeFileSync(t.file, JSON.stringify({ ...t.status, goal: 'fix \u201cfoo\u201d' }, null, 2));
  const e = {
    tool_name: 'Edit',
    tool_input: {
      file_path: t.file,
      old_string: '\u201cstate\u201d: \u201cactive\u201d',
      new_string: '"state": "done", "done": {"commit": "abc1234"}',
    },
  };
  assert.ok(decide(e, t.env).deny);
});

test('replace_all with curly quotes splices every match', () => {
  const t = setup();
  fs.writeFileSync(t.file, JSON.stringify({ ...t.status, goal: 'active' }, null, 2));
  const e = { tool_name: 'Edit', tool_input: { file_path: t.file, old_string: '\u201cactive\u201d', new_string: '"done"', replace_all: true } };
  assert.ok(decide(e, t.env).deny);
});

test('darwin: TASKS/.QE case variants are recognized as under the tasks dir', { skip: process.platform !== 'darwin' }, () => {
  const t = setup();
  const f = path.join(t.home.toUpperCase(), 'TASKS', 'GOAL-A', 'status.json');
  assert.ok(decide(write(f, doneStatus(SHA)), t.env).deny);
});

test('literal old_string match wins over quote-normalized matching', () => {
  const t = setup();
  fs.writeFileSync(t.file, JSON.stringify({ ...t.status, goal: 'note \u201cstate\u201d: \u201cactive\u201d' }, null, 2));
  const e = {
    tool_name: 'Edit',
    tool_input: { file_path: t.file, old_string: '"state": "active"', new_string: '"state": "done", "done": {"commit": "abc1234"}' },
  };
  assert.ok(decide(e, t.env).deny);
});

test('Edit mentioning done that yields invalid JSON is denied with a Write hint', () => {
  const t = setup();
  const e = { tool_name: 'Edit', tool_input: { file_path: t.file, old_string: '"state": "active"', new_string: '"state": "done",,' } };
  assert.match(decide(e, t.env).deny, /Write/);
  // without done in new_string, invalid JSON still passes
  const e2 = { tool_name: 'Edit', tool_input: { file_path: t.file, old_string: '"state": "active"', new_string: '"state": ,,' } };
  assert.equal(decide(e2, t.env), null);
});

test('Edit mentioning done but leaving state not done is allowed', () => {
  const t = setup();
  const e = { tool_name: 'Edit', tool_input: { file_path: t.file, old_string: '"goal": "g"', new_string: '"goal": "done soon"' } };
  assert.equal(decide(e, t.env), null);
});
