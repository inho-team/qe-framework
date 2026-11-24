import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { collectGitFacts, computeAlerts, isAncestor } from '../hooks/lib/alerts.mjs';

// Many git processes run in parallel under node --test; the 3 s product timeout is too tight here.
process.env.QE_GIT_TIMEOUT_MS ??= '20000';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qe-alerts-'));
}

function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.hooksPath=', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function repo() {
  const dir = tmp();
  gitIn(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const HASH = 'a'.repeat(64);
const COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';

function task(status, extra = {}) {
  return {
    name: 't',
    status,
    unchecked: 0,
    total: 3,
    hasHandoff: false,
    verdicts: [],
    planHash: HASH,
    ...extra,
  };
}

function status(extra = {}) {
  return {
    goal: 'g',
    project: '/p',
    state: 'active',
    worktrees: [{ path: '/w', branch: 'feat' }],
    sessions: [{ id: 's1' }],
    ...extra,
  };
}

function facts(extra = {}) {
  return {
    project: { path: '/p', exists: true, branch: 'main', head: 'h' },
    worktrees: [{ path: '/w', exists: true, branch: 'feat', branchExists: true, head: 'h', dirty: false, aheadOfBase: 0 }],
    done: null,
    doneCommitOnBranch: null,
    doneNewCommits: null,
    doneMerged: null,
    aheadOfBase: 0,
    ...extra,
  };
}

const live = new Set(['s1']);
const codes = (alerts) => alerts.map((a) => a.code).sort();

const doneStatus = status({ state: 'done', done: { commit: COMMIT, branch: 'feat', verdict: 'verdicts/1-a.json' } });
const okVerdict = { result: '충족', commit: COMMIT.slice(0, 8).toUpperCase(), planHash: HASH, branch: 'feat' };
const doneFacts = (extra = {}) =>
  facts({ done: { branch: 'feat', branchExists: true, aheadOfBase: 0 }, doneCommitOnBranch: true, doneNewCommits: 0, doneMerged: true, ...extra });

test('no alerts for a healthy done task', () => {
  assert.deepEqual(computeAlerts(task(doneStatus, { verdicts: [okVerdict] }), doneFacts(), live), []);
});

test('invalid-status when status.json is invalid', () => {
  assert.deepEqual(codes(computeAlerts(task({ invalid: true }), null, live)), ['invalid-status']);
});

test('checked-no-verdict when every box is checked but no verdict matches the current plan', () => {
  const stale = { result: '충족', commit: COMMIT, planHash: 'b'.repeat(64) };
  assert.deepEqual(codes(computeAlerts(task(status(), { verdicts: [stale] }), facts(), live)), ['checked-no-verdict']);
  // a verdict for the current plan clears it; unchecked boxes or an empty plan never raise it
  assert.deepEqual(computeAlerts(task(status(), { verdicts: [{ ...stale, planHash: HASH }] }), facts(), live), []);
  assert.deepEqual(computeAlerts(task(status(), { unchecked: 1 }), facts(), live), []);
  assert.deepEqual(computeAlerts(task(status(), { total: 0 }), facts(), live), []);
});

test('done-without-verdict when no 충족 verdict matches done.commit', () => {
  const other = { ...okVerdict, commit: '1234567' };
  const partial = { ...okVerdict, result: '일부 미충족' };
  for (const verdicts of [[], [other], [partial]]) {
    assert.deepEqual(codes(computeAlerts(task(doneStatus, { verdicts }), doneFacts(), live)), ['done-without-verdict']);
  }
});

test('changed-after-verdict when done.commit left the branch or the branch moved on', () => {
  const t = task(doneStatus, { verdicts: [okVerdict] });
  assert.deepEqual(codes(computeAlerts(t, doneFacts({ doneCommitOnBranch: false }), live)), ['changed-after-verdict']);
  assert.deepEqual(codes(computeAlerts(t, doneFacts({ doneNewCommits: 2 }), live)), ['changed-after-verdict']);
});

test('worktree-missing when an active task lost its worktree', () => {
  const f = facts({ worktrees: [{ ...facts().worktrees[0], exists: false }] });
  assert.deepEqual(codes(computeAlerts(task(status({ state: 'verifying' }), { unchecked: 1 }), f, live)), ['worktree-missing']);
});

test('branch-missing when a recorded branch is gone, unless a done task was merged', () => {
  const f = facts({ worktrees: [{ ...facts().worktrees[0], branchExists: false }] });
  assert.deepEqual(codes(computeAlerts(task(status(), { unchecked: 1 }), f, live)), ['branch-missing']);
  const merged = doneFacts({
    worktrees: [{ ...facts().worktrees[0], exists: false, branchExists: false }],
    done: { branch: 'feat', branchExists: false, aheadOfBase: null },
    doneCommitOnBranch: null,
    doneNewCommits: null,
    doneMerged: true,
  });
  assert.deepEqual(computeAlerts(task(doneStatus, { verdicts: [okVerdict] }), merged, live), []);
  assert.deepEqual(codes(computeAlerts(task(doneStatus, { verdicts: [okVerdict] }), { ...merged, doneMerged: false }, live)), ['branch-missing']);
  // unknown merge state (git failed) is not evidence of a lost branch
  assert.deepEqual(computeAlerts(task(doneStatus, { verdicts: [okVerdict] }), { ...merged, doneMerged: null }, live), []);
});

test('unmerged when a done task has commits not in the base branch; normal for active tasks', () => {
  const ahead = { ...facts().worktrees[0], aheadOfBase: 3 };
  const f = doneFacts({ worktrees: [ahead], done: { branch: 'feat', branchExists: true, aheadOfBase: 3 }, aheadOfBase: 3, doneMerged: false });
  assert.deepEqual(codes(computeAlerts(task(doneStatus, { verdicts: [okVerdict] }), f, live)), ['unmerged']);
  assert.deepEqual(computeAlerts(task(status(), { unchecked: 1 }), facts({ worktrees: [ahead], aheadOfBase: 3 }), live), []);
});

test('orphaned when no recorded session is live and there is no handoff', () => {
  const t = task(status(), { unchecked: 1 });
  assert.deepEqual(codes(computeAlerts(t, facts(), new Set(['other']))), ['orphaned']);
  assert.deepEqual(computeAlerts({ ...t, hasHandoff: true }, facts(), new Set()), []);
  // unknown live set (claude agents failed) never claims orphaned
  assert.deepEqual(computeAlerts(t, facts(), null), []);
});

test('every alert carries a Korean message', () => {
  const t = task(status({ sessions: [] }));
  for (const a of computeAlerts(t, facts({ worktrees: [{ ...facts().worktrees[0], exists: false, branchExists: false }] }), live)) {
    assert.equal(typeof a.message, 'string');
    assert.match(a.message, /[가-힣]/);
  }
});

test('collectGitFacts reports a missing worktree without running git there', () => {
  const project = repo();
  const gone = path.join(tmp(), 'gone');
  const f = collectGitFacts(status({ project, worktrees: [{ path: gone, branch: 'nope' }] }));
  assert.equal(f.project.exists, true);
  assert.equal(f.project.branch, 'main');
  assert.equal(f.worktrees[0].exists, false);
  assert.equal(f.worktrees[0].head, null);
  assert.equal(f.worktrees[0].branchExists, false);
});

test('collectGitFacts counts commits on a branch that the base does not have', () => {
  const project = repo();
  const wt = path.join(tmp(), 'wt');
  gitIn(project, 'worktree', 'add', '-q', '-b', 'feat', wt);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'b');
  const done = gitIn(wt, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(wt, 'c.txt'), 'c\n');
  const f = collectGitFacts(
    status({ project, state: 'done', worktrees: [{ path: wt, branch: 'feat' }], done: { commit: done.slice(0, 9), branch: 'feat' } }),
  );
  assert.equal(f.worktrees[0].exists, true);
  assert.equal(f.worktrees[0].branchExists, true);
  assert.equal(f.worktrees[0].head, done);
  assert.equal(f.worktrees[0].dirty, true);
  assert.equal(f.worktrees[0].aheadOfBase, 1);
  assert.equal(f.aheadOfBase, 1);
  assert.equal(f.doneCommitOnBranch, true);
  assert.equal(f.doneNewCommits, 0);
  assert.equal(f.doneMerged, false);
  // a commit after the verdict moves the branch past done.commit
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'c');
  assert.equal(collectGitFacts(status({ project, state: 'done', worktrees: [{ path: wt, branch: 'feat' }], done: { commit: done, branch: 'feat' } })).doneNewCommits, 1);
});

test('collectGitFacts ignores commits after done.commit that only export docs/qe', () => {
  const project = repo();
  gitIn(project, 'checkout', '-q', '-b', 'feat');
  fs.writeFileSync(path.join(project, 'b.txt'), 'b\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'b');
  const done = gitIn(project, 'rev-parse', 'HEAD');
  const st = () => status({ project, state: 'done', worktrees: [], done: { commit: done, branch: 'feat' } });
  // Qfinish exports the goal docs onto the verified branch: not a change to what was verified
  fs.mkdirSync(path.join(project, 'docs', 'qe', '2026-11-24-g'), { recursive: true });
  fs.writeFileSync(path.join(project, 'docs', 'qe', '2026-11-24-g', 'plan.md'), '# plan\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'docs: export');
  assert.equal(collectGitFacts(st()).doneNewCommits, 0);
  assert.deepEqual(codes(computeAlerts(task(st(), { verdicts: [{ result: '충족', commit: done, planHash: HASH }] }), collectGitFacts(st()), new Set())).filter((c) => c === 'changed-after-verdict'), []);
  // a code commit after that is a change
  fs.writeFileSync(path.join(project, 'c.txt'), 'c\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'c');
  assert.equal(collectGitFacts(st()).doneNewCommits, 1);
});

test('collectGitFacts never rewrites the index (polling must not take git locks)', () => {
  const project = repo();
  const file = path.join(project, 'a.txt');
  const index = path.join(project, '.git', 'index');
  // same content, newer mtime: the index stat is stale, so a plain `git status` would refresh and rewrite it
  const later = new Date(Date.now() + 60_000);
  fs.writeFileSync(file, 'a\n');
  fs.utimesSync(file, later, later);
  const past = new Date(Date.now() - 3_600_000);
  fs.utimesSync(index, past, past);
  const before = fs.statSync(index).mtimeMs;
  const f = collectGitFacts(status({ project, worktrees: [{ path: project, branch: 'main' }] }));
  assert.equal(f.worktrees[0].dirty, false);
  assert.equal(fs.statSync(index).mtimeMs, before);
});

test('collectGitFacts treats a path that is not a worktree root as missing', () => {
  const project = repo();
  const sub = path.join(project, 'sub');
  fs.mkdirSync(sub);
  const plain = tmp();
  const f = collectGitFacts(status({ project, worktrees: [{ path: sub, branch: 'main' }, { path: plain, branch: 'main' }] }));
  assert.equal(f.worktrees[0].exists, false);
  assert.equal(f.worktrees[0].head, null);
  assert.equal(f.worktrees[1].exists, false);
});

test('collectGitFacts reports unknown (null), not false, when git cannot answer', () => {
  // project is not a git repo: nothing about the done commit or branch can be known
  const project = tmp();
  const f = collectGitFacts(status({ project, state: 'done', worktrees: [], done: { commit: COMMIT, branch: 'feat' } }));
  assert.equal(f.doneCommitOnBranch, null);
  assert.equal(f.doneMerged, null);
  assert.equal(f.done.branchExists, null);
  // a done commit that does not exist in a real repo is a definite false
  const real = repo();
  gitIn(real, 'branch', 'feat');
  const g = collectGitFacts(status({ project: real, state: 'done', worktrees: [], done: { commit: COMMIT, branch: 'feat' } }));
  assert.equal(g.doneCommitOnBranch, false);
  assert.equal(g.doneMerged, false);
});

test('isAncestor separates "no" (exit 1) from "git could not answer" (null)', () => {
  const project = repo();
  const first = gitIn(project, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(project, 'b.txt'), 'b\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'b');
  assert.equal(isAncestor(project, first, 'HEAD'), true);
  assert.equal(isAncestor(project, 'HEAD', first), false);
  assert.equal(isAncestor(project, first, 'refs/heads/no-such-branch'), null);
  assert.equal(isAncestor(tmp(), 'HEAD', 'HEAD'), null);
});

test('collectGitFacts accepts a worktree recorded through a symlink or junction', (t) => {
  const project = repo();
  const link = path.join(tmp(), 'link');
  try {
    fs.symlinkSync(project, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    t.skip(`cannot create link: ${err.code}`);
    return;
  }
  const f = collectGitFacts(status({ project: link, worktrees: [{ path: link, branch: 'main' }] }));
  assert.equal(f.worktrees[0].exists, true);
  assert.equal(f.worktrees[0].head, gitIn(project, 'rev-parse', 'HEAD'));
  assert.equal(f.worktrees[0].dirty, false);
});

test('a done task finished as PR or kept branch raises neither unmerged nor branch-missing', () => {
  // squash/rebase-merged PR: done.commit is not an ancestor of the base, branch may be gone
  const gone = doneFacts({
    worktrees: [{ ...facts().worktrees[0], exists: false, branchExists: false }],
    done: { branch: 'feat', branchExists: false, aheadOfBase: null },
    doneCommitOnBranch: null,
    doneNewCommits: null,
    doneMerged: false,
    aheadOfBase: 3,
  });
  for (const finish of ['pr', 'keep']) {
    const st = { ...doneStatus, done: { ...doneStatus.done, finish } };
    assert.deepEqual(computeAlerts(task(st, { verdicts: [okVerdict] }), gone, live), [], finish);
  }
  // a local merge that did not reach the base is still reported
  const merge = { ...doneStatus, done: { ...doneStatus.done, finish: 'merge' } };
  assert.deepEqual(codes(computeAlerts(task(merge, { verdicts: [okVerdict] }), gone, live)), ['branch-missing', 'unmerged']);
});

test('collectGitFacts compares against the default branch, not what the main checkout has checked out', () => {
  const project = repo();
  gitIn(project, 'checkout', '-q', '-b', 'feat');
  fs.writeFileSync(path.join(project, 'b.txt'), 'b\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'b');
  const done = gitIn(project, 'rev-parse', 'HEAD');
  gitIn(project, 'checkout', '-q', 'main');
  gitIn(project, 'merge', '-q', '--ff-only', 'feat');
  // the main checkout now sits on an unrelated branch made before the merge
  gitIn(project, 'checkout', '-q', '-b', 'scratch', 'HEAD~1');
  const st = status({ project, state: 'done', worktrees: [], done: { commit: done, branch: 'feat' } });
  const f = collectGitFacts(st);
  assert.equal(f.base, 'refs/heads/main');
  assert.equal(f.doneMerged, true);
  assert.equal(f.aheadOfBase, 0);
});

test('collectGitFacts prefers origin/HEAD, using the remote ref when no local branch has that name', () => {
  const project = repo();
  const first = gitIn(project, 'rev-parse', 'HEAD');
  gitIn(project, 'checkout', '-q', '-b', 'feat');
  fs.writeFileSync(path.join(project, 'b.txt'), 'b\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'b');
  const done = gitIn(project, 'rev-parse', 'HEAD');
  // remote default is "trunk", which has the work; local main does not
  gitIn(project, 'update-ref', 'refs/remotes/origin/trunk', done);
  gitIn(project, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  gitIn(project, 'checkout', '-q', 'main');
  assert.equal(gitIn(project, 'rev-parse', 'main'), first);
  const f = collectGitFacts(status({ project, state: 'done', worktrees: [], done: { commit: done, branch: 'feat' } }));
  assert.equal(f.base, 'refs/remotes/origin/trunk');
  assert.equal(f.doneMerged, true);
  assert.equal(f.aheadOfBase, 0);
  // with a local branch of that name, the local branch is the base (a local merge counts before push)
  gitIn(project, 'branch', 'trunk', first);
  const g = collectGitFacts(status({ project, state: 'done', worktrees: [], done: { commit: done, branch: 'feat' } }));
  assert.equal(g.base, 'refs/heads/trunk');
  assert.equal(g.doneMerged, false);
  assert.equal(g.aheadOfBase, 1);
});
