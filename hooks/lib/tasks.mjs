// Read-side helpers for ~/.qe/tasks/<task>/. Every read is guarded; nothing throws.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, tasksDir, normPath } from './qe-home.mjs';

const STATES = ['active', 'verifying', 'done', 'stopped'];
const VERIFY_RESULT = /결과:\s*(충족|일부\s*미충족|미충족)/;

export function countUnchecked(markdown) {
  // List items only: -, *, + bullets or 1. / 1) numbering, then an unchecked box.
  return (markdown.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \]/gm) || []).length;
}

function countChecked(markdown) {
  return (markdown.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\]/gm) || []).length;
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function isValidStatus(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (typeof s.goal !== 'string' || typeof s.project !== 'string') return false;
  if (!STATES.includes(s.state)) return false;
  if (!Array.isArray(s.worktrees) || !Array.isArray(s.sessions)) return false;
  if (s.state === 'done' && (!s.done || typeof s.done !== 'object')) return false;
  return true;
}

export function readStatus(taskDir) {
  const raw = safeRead(path.join(taskDir, 'status.json'));
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw);
    return isValidStatus(s) ? s : { invalid: true };
  } catch {
    return { invalid: true };
  }
}

export function planHash(taskDir) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(taskDir, 'implement-plan.md'))).digest('hex');
  } catch {
    return null;
  }
}

export function listVerdicts(taskDir) {
  const dir = path.join(taskDir, 'verdicts');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const raw = safeRead(path.join(dir, n));
    if (raw === null) continue;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') out.push(v);
    } catch {
      // skip broken file
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

function inspect(dir, name) {
  const stats = {};
  for (const f of ['plan.md', 'implement-plan.md', 'verify.md', 'handoff.md', 'status.json']) {
    try {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) stats[f] = st;
    } catch {
      // absent
    }
  }
  const impl = stats['implement-plan.md'] ? safeRead(path.join(dir, 'implement-plan.md')) ?? '' : '';
  const unchecked = countUnchecked(impl);
  const verifyBody = stats['verify.md'] ? safeRead(path.join(dir, 'verify.md')) ?? '' : '';
  const m = VERIFY_RESULT.exec(verifyBody);
  return {
    name,
    dir,
    status: readStatus(dir),
    unchecked,
    total: unchecked + countChecked(impl),
    hasPlan: Boolean(stats['plan.md']),
    hasImplementPlan: Boolean(stats['implement-plan.md']),
    hasVerify: Boolean(stats['verify.md']),
    hasHandoff: Boolean(stats['handoff.md']),
    verifyResult: m ? m[1].replace(/\s+/g, ' ') : null,
    verdicts: listVerdicts(dir),
    mtimeMs: Math.max(0, ...Object.values(stats).map((s) => s.mtimeMs)),
  };
}

export function listTasks(home) {
  const root = tasksDir(home);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      out.push(inspect(path.join(root, e.name), e.name));
    } catch {
      // skip unreadable task
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

export function projectRootOf(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return common ? path.dirname(common) : null;
}

// Segments of filePath below dir, in the ORIGINAL case; null when filePath is not under dir.
// The containment test uses normPath (case-folded on win32/darwin), so a differently-cased
// path to the same file is still recognized.
export function relParts(dir, filePath, platform = process.platform) {
  const rel = path.relative(normPath(dir, platform), normPath(filePath, platform));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const n = rel.split(path.sep).length;
  return path.resolve(filePath).split(path.sep).slice(-n);
}

export function taskOfPath(home, filePath, platform = process.platform) {
  const parts = relParts(tasksDir(home), filePath, platform);
  return parts && parts[0] ? parts[0] : null;
}
