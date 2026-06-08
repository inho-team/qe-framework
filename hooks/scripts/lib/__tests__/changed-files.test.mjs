import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import path from 'node:path';

import { getChangedFiles } from '../changed-files.mjs';

/** Create a temp dir, optionally init a committed git repo. @returns {string} */
function makeRepo({ init = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'changed-files-test-'));
  if (init) {
    const g = (cmd) => execSync(cmd, { cwd: dir, stdio: 'ignore' });
    g('git init -q');
    g('git config user.email t@t.t');
    g('git config user.name t');
    g('git config commit.gpgsign false');
    writeFileSync(path.join(dir, 'base.txt'), 'base\n');
    g('git add base.txt');
    g('git commit -q -m base');
  }
  return dir;
}

test('changed-files: clean committed repo → isEmpty true, gitAvailable true', () => {
  const dir = makeRepo();
  try {
    const r = getChangedFiles(dir);
    assert.equal(r.gitAvailable, true);
    assert.equal(r.isEmpty, true);
    assert.deepEqual(r.all, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed-files: working-tree modification detected', () => {
  const dir = makeRepo();
  try {
    writeFileSync(path.join(dir, 'base.txt'), 'changed\n');
    const r = getChangedFiles(dir);
    assert.ok(r.workingTree.includes('base.txt'));
    assert.equal(r.isEmpty, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed-files: staged file detected (not just working tree)', () => {
  const dir = makeRepo();
  try {
    writeFileSync(path.join(dir, 'new.txt'), 'x\n');
    execSync('git add new.txt', { cwd: dir, stdio: 'ignore' });
    const r = getChangedFiles(dir);
    assert.ok(r.staged.includes('new.txt'));
    assert.equal(r.isEmpty, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed-files: untracked file detected (empty-diff bypass guard)', () => {
  const dir = makeRepo();
  try {
    writeFileSync(path.join(dir, 'untracked.txt'), 'x\n');
    const r = getChangedFiles(dir);
    assert.ok(r.untracked.includes('untracked.txt'));
    assert.equal(r.isEmpty, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed-files: all is the deduped union of the three sets', () => {
  const dir = makeRepo();
  try {
    writeFileSync(path.join(dir, 'base.txt'), 'changed\n'); // working tree
    writeFileSync(path.join(dir, 'untracked.txt'), 'x\n');  // untracked
    const r = getChangedFiles(dir);
    assert.deepEqual([...r.all].sort(), ['base.txt', 'untracked.txt']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed-files: non-git directory → fail-closed (isEmpty false, gitAvailable false)', () => {
  const dir = makeRepo({ init: false });
  try {
    const r = getChangedFiles(dir);
    // Fail-closed: indeterminate git state must NOT grant a free empty-diff PASS.
    assert.equal(r.gitAvailable, false);
    assert.equal(r.isEmpty, false);
    assert.deepEqual(r.all, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed-files: filename with spaces preserved losslessly (-z)', () => {
  const dir = makeRepo();
  try {
    writeFileSync(path.join(dir, 'a b c.txt'), 'x\n');
    const r = getChangedFiles(dir);
    assert.ok(r.untracked.includes('a b c.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
