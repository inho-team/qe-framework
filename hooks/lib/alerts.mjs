// Where what was claimed (status.json, checkboxes) and the evidence (git, verdicts) disagree.
// collectGitFacts reads git; computeAlerts is pure so the rules can be tested on plain values.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normPath, gitTimeout } from './qe-home.mjs';
import { sameCommit } from './tasks.mjs';

// The board polls while the user works in other sessions, so every git call here is
// lock-free (`--no-optional-locks`: `git status` would otherwise take index.lock and
// rewrite .git/index). Returns { status, out }; status null = could not run or timed out.
function run(cwd, args) {
  try {
    const r = spawnSync('git', ['--no-optional-locks', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: gitTimeout(),
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    if (r.error || typeof r.status !== 'number') return { status: null, out: null };
    return { status: r.status, out: (r.stdout ?? '').trim() };
  } catch {
    return { status: null, out: null };
  }
}

function git(cwd, args) {
  const r = run(cwd, args);
  return r.status === 0 ? r.out : null;
}

// Exit 0 → true, exit 1 → false, anything else (error, timeout, bad ref) → null (unknown).
function yesNo(cwd, args) {
  const { status } = run(cwd, args);
  return status === 0 ? true : status === 1 ? false : null;
}

function exists(p) {
  try {
    return typeof p === 'string' && p !== '' && fs.existsSync(p);
  } catch {
    return false;
  }
}

function count(out) {
  const n = out === null ? NaN : Number.parseInt(out, 10);
  return Number.isFinite(n) ? n : null;
}

export function isAncestor(cwd, a, b) {
  return yesNo(cwd, ['merge-base', '--is-ancestor', a, b]);
}

// The recorded path must be the root of a checkout; a plain folder or a subfolder of another
// repo would otherwise report that repo's HEAD and dirt as this worktree's.
// git resolves symlinks/junctions (and macOS /var → /private/var), so compare real paths.
function real(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

function isWorktreeRoot(p) {
  const top = git(p, ['rev-parse', '--show-toplevel']);
  return top !== null && normPath(real(top)) === normPath(real(p));
}

export function collectGitFacts(status) {
  const projectPath = status && typeof status.project === 'string' ? status.project : '';
  const pExists = exists(projectPath);
  const project = {
    path: projectPath,
    exists: pExists,
    branch: pExists ? git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']) : null,
    head: pExists ? git(projectPath, ['rev-parse', 'HEAD']) : null,
  };
  const inRepo = pExists && project.head !== null;

  // Branch questions are asked in the project repo: worktrees share its refs.
  const branchInfo = new Map();
  function branch(name) {
    if (typeof name !== 'string' || !name) return { branchExists: null, aheadOfBase: null, tip: null };
    if (branchInfo.has(name)) return branchInfo.get(name);
    let info = { branchExists: null, aheadOfBase: null, tip: null };
    if (inRepo) {
      const r = run(projectPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`]);
      const tip = r.status === 0 ? r.out : null;
      info = {
        branchExists: r.status === 0 ? true : r.status === 1 ? false : null,
        tip,
        aheadOfBase: tip !== null ? count(git(projectPath, ['rev-list', '--count', `HEAD..refs/heads/${name}`])) : null,
      };
    }
    branchInfo.set(name, info);
    return info;
  }

  const worktrees = (Array.isArray(status?.worktrees) ? status.worktrees : []).map((w) => {
    const p = w && typeof w.path === 'string' ? w.path : '';
    const ok = exists(p) && isWorktreeRoot(p);
    const b = branch(w?.branch);
    return {
      path: p,
      exists: ok,
      branch: w?.branch ?? null,
      branchExists: b.branchExists,
      head: ok ? git(p, ['rev-parse', 'HEAD']) : null,
      dirty: ok ? (() => {
        const s = git(p, ['status', '--porcelain']);
        return s === null ? null : s !== '';
      })() : null,
      aheadOfBase: b.aheadOfBase,
    };
  });

  let done = null;
  let doneCommitOnBranch = null;
  let doneNewCommits = null;
  let doneMerged = null;
  const d = status?.state === 'done' && status.done && typeof status.done === 'object' ? status.done : null;
  if (d) {
    const b = branch(d.branch);
    done = { branch: d.branch ?? null, branchExists: b.branchExists, aheadOfBase: b.aheadOfBase };
    const commit = typeof d.commit === 'string' && d.commit.trim() ? d.commit.trim() : null;
    if (inRepo && commit) {
      const r = run(projectPath, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]);
      // exit 1: no such commit (definitely not on any branch); other failures stay unknown
      const missing = r.status === 1;
      const resolved = r.status === 0 ? r.out : null;
      doneMerged = missing ? false : resolved ? isAncestor(projectPath, resolved, 'HEAD') : null;
      if (b.tip) {
        doneCommitOnBranch = missing ? false : resolved ? isAncestor(projectPath, resolved, b.tip) : null;
        // Qfinish commits the exported goal docs (docs/qe/) onto the verified branch; those
        // commits do not change what was verified, so only commits touching other paths count.
        if (doneCommitOnBranch) {
          doneNewCommits = count(git(projectPath, ['rev-list', '--count', `${resolved}..${b.tip}`, '--', '.', ':(exclude)docs/qe']));
        }
      }
    }
  }

  const aheads = [...branchInfo.values()].map((i) => i.aheadOfBase).filter((n) => typeof n === 'number');
  return {
    project,
    worktrees,
    done,
    doneCommitOnBranch,
    doneNewCommits,
    doneMerged,
    aheadOfBase: aheads.length ? Math.max(...aheads) : null,
  };
}

const LIVE_STATES = ['active', 'verifying'];

export function computeAlerts(task, facts, liveSessionIds) {
  const s = task?.status;
  if (s && s.invalid) return [{ code: 'invalid-status', message: 'status.json 형식이 깨졌다' }];
  if (!s) return [];
  const out = [];
  const add = (code, message) => out.push({ code, message });
  const verdicts = Array.isArray(task.verdicts) ? task.verdicts : [];
  const f = facts || {};
  const wts = Array.isArray(f.worktrees) ? f.worktrees : [];

  if (task.total > 0 && task.unchecked === 0 && !['done', 'stopped'].includes(s.state)) {
    if (!task.planHash || !verdicts.some((v) => v && v.planHash === task.planHash)) {
      add('checked-no-verdict', '체크박스는 다 찼는데 지금 계획에 대한 검수 기록이 없다');
    }
  }

  if (s.state === 'done') {
    const commit = s.done?.commit;
    if (!verdicts.some((v) => v && v.result === '충족' && sameCommit(v.commit, commit))) {
      add('done-without-verdict', `완료로 표시됐지만 커밋 ${short(commit)}에 대한 충족 검수 기록이 없다`);
    }
    if (f.doneCommitOnBranch === false) {
      add('changed-after-verdict', `완료 커밋 ${short(commit)}이 브랜치 ${s.done?.branch ?? '?'}에 없다`);
    } else if (f.doneNewCommits > 0) {
      add('changed-after-verdict', `완료 뒤 브랜치에 커밋 ${f.doneNewCommits}개가 더 쌓였다`);
    }
  }

  if (LIVE_STATES.includes(s.state)) {
    const gone = wts.filter((w) => w.exists === false).map((w) => w.path);
    if (gone.length) add('worktree-missing', `worktree가 없다: ${gone.join(', ')}`);
  }

  // A finished task whose commit reached the base had its branch cleaned up on purpose;
  // only a done task known NOT to be merged has really lost its branch.
  if (s.state !== 'stopped' && !(s.state === 'done' && f.doneMerged !== false)) {
    const missing = new Set(wts.filter((w) => w.branchExists === false).map((w) => w.branch));
    if (s.state === 'done' && f.done?.branchExists === false) missing.add(f.done.branch);
    if (missing.size) add('branch-missing', `브랜치가 없다: ${[...missing].join(', ')}`);
  }

  if (s.state === 'done' && f.aheadOfBase > 0) {
    add('unmerged', `완료됐지만 기준 브랜치에 없는 커밋 ${f.aheadOfBase}개가 남아 있다`);
  }

  if (LIVE_STATES.includes(s.state) && liveSessionIds instanceof Set && !task.hasHandoff) {
    const ids = (Array.isArray(s.sessions) ? s.sessions : []).map((x) => x?.id);
    if (!ids.some((id) => liveSessionIds.has(id))) add('orphaned', '진행 중인데 살아 있는 세션도 handoff.md도 없다');
  }
  return out;
}

function short(c) {
  return typeof c === 'string' && c ? c.slice(0, 8) : '?';
}
