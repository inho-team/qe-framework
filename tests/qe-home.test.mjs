import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  qeHome,
  tasksDir,
  ensureHome,
  writeJsonAtomic,
  commitHome,
  isUnder,
} from '../hooks/lib/qe-home.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qe-home-'));
}

test('qeHome uses QE_HOME when set, else ~/.qe', () => {
  assert.equal(qeHome({ QE_HOME: '/x/y' }), '/x/y');
  assert.equal(qeHome({}), path.join(os.homedir(), '.qe'));
  assert.equal(tasksDir('/h'), path.join('/h', 'tasks'));
});

test('ensureHome creates tasks dir and a git repo, and is idempotent', () => {
  const home = path.join(tmp(), '.qe');
  assert.equal(ensureHome(home), true);
  assert.ok(fs.existsSync(path.join(home, '.git')));
  assert.ok(fs.statSync(tasksDir(home)).isDirectory());
  assert.equal(ensureHome(home), true);
});

test('writeJsonAtomic leaves no temp files and the file parses', () => {
  const dir = tmp();
  const file = path.join(dir, 'status.json');
  writeJsonAtomic(file, { a: 1 });
  writeJsonAtomic(file, { a: 2, b: '한글' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2, b: '한글' });
  assert.deepEqual(fs.readdirSync(dir), ['status.json']);
});

test('commitHome returns false with nothing to commit and true after a change', () => {
  const home = path.join(tmp(), '.qe');
  ensureHome(home);
  assert.equal(commitHome(home, 'qe: empty'), false);
  fs.writeFileSync(path.join(home, 'tasks', 'a.txt'), 'x');
  assert.equal(commitHome(home, 'qe: add a'), true);
  assert.equal(commitHome(home, 'qe: again'), false);
});

test('commitHome returns false (no throw) when home is not a git repo', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
  assert.equal(commitHome(dir, 'qe: nope'), false);
  assert.equal(commitHome(path.join(dir, 'missing'), 'qe: nope'), false);
});

test('isUnder treats C:\\A\\b and c:/a/b/x as under on win32', { skip: process.platform !== 'win32' }, () => {
  assert.equal(isUnder('c:/a/b/x', 'C:\\A\\b'), true);
  assert.equal(isUnder('C:\\A\\b\\x\\y.md', 'c:/a/B'), true);
});

test('isUnder rejects sibling prefixes', () => {
  assert.equal(isUnder('/a/bc', '/a/b'), false);
  assert.equal(isUnder('/a/b/c', '/a/b'), true);
});

test('normPath lowercases on win32 and darwin, not on linux', async () => {
  const { normPath } = await import('../hooks/lib/qe-home.mjs');
  assert.equal(normPath('/Tmp/A', 'linux').endsWith('A'), true);
  assert.equal(normPath('/Tmp/A', 'darwin').endsWith('a'), true);
  assert.equal(normPath('/Tmp/A', 'win32').endsWith('a'), true);
});
