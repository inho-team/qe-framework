// QE SessionStart hook: injects the path guide, this session's id, this project's open
// ~/.qe goals, legacy docs/qe tasks (under an "이전 위치" heading), and the latest
// handoff.md. It only reads: ~/.qe is created by the write hooks, and the one git call
// finds the project root. It must never fail a session start, so every read is guarded
// and the process always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countUnchecked, listTasks, projectRootOf } from './lib/tasks.mjs';
import { normPath, qeHome } from './lib/qe-home.mjs';

export { countUnchecked };

export const MAX_HANDOFF_CHARS = 8000;

const TASK_MARKERS = ['plan.md', 'implement-plan.md', 'handoff.md'];

// verify.md's header line, e.g. "- 결과: 일부 미충족" (see skills/Qverify/verify-template.md).
const VERIFY_FAILED = /결과:\s*(일부\s*)?미충족/;

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function inspectTask(dir, name) {
  const stats = {};
  for (const file of ['plan.md', 'implement-plan.md', 'verify.md', 'handoff.md']) {
    const st = safeStat(path.join(dir, file));
    if (st && st.isFile()) stats[file] = st;
  }
  if (!TASK_MARKERS.some((f) => stats[f])) return null;

  const implementPlan = stats['implement-plan.md'] ? safeRead(path.join(dir, 'implement-plan.md')) ?? '' : '';
  const unchecked = countUnchecked(implementPlan);
  const hasVerify = Boolean(stats['verify.md']);
  const verifyFailed = hasVerify && VERIFY_FAILED.test(safeRead(path.join(dir, 'verify.md')) ?? '');
  if (hasVerify && unchecked === 0 && !verifyFailed) return null;

  return {
    name,
    dir,
    unchecked,
    hasPlan: Boolean(stats['plan.md']),
    hasImplementPlan: Boolean(stats['implement-plan.md']),
    hasVerify,
    verifyFailed,
    handoffPath: stats['handoff.md'] ? path.join(dir, 'handoff.md') : null,
    handoffMtimeMs: stats['handoff.md'] ? stats['handoff.md'].mtimeMs : 0,
    mtimeMs: Math.max(...Object.values(stats).map((s) => s.mtimeMs)),
  };
}

export function findOpenTasks(projectRoot) {
  const qeDir = path.join(projectRoot, 'docs', 'qe');
  let entries;
  try {
    entries = fs.readdirSync(qeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const task = inspectTask(path.join(qeDir, entry.name), entry.name);
    if (task) tasks.push(task);
  }
  // Newest first; equal times (e.g. right after a git clone) fall back to the
  // date-prefixed folder name, newest name first.
  return tasks.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

function describe(task) {
  const steps = task.hasImplementPlan
    ? `남은 단계 ${task.unchecked}`
    : task.hasPlan
      ? 'implement-plan.md 없음 (계획 중)'
      : '이해 중 (handoff만 있음)';
  const verify = task.verifyFailed ? 'verify 미충족' : task.hasVerify ? 'verify 있음' : 'verify 없음';
  const handoff = task.handoffPath ? ', handoff 있음' : '';
  return `- docs/qe/${task.name} — ${steps}, ${verify}${handoff}`;
}

// Open ~/.qe tasks of this project. Any failure yields [] so the legacy output still prints.
function findOpenHomeTasks(cwd, home) {
  try {
    const tasks = listTasks(home);
    if (!tasks.length) return [];
    const root = projectRootOf(cwd);
    const want = normPath(root ?? cwd);
    return tasks.filter((t) => {
      const s = t.status;
      if (!s || s.invalid) return false;
      // An empty project is not yet claimed; path.resolve('') would turn it into the cwd.
      if (!s.project) return false;
      if (normPath(s.project) !== want) return false;
      return s.state === 'active' || s.state === 'verifying';
    });
  } catch {
    return [];
  }
}

function describeHome(t) {
  const steps = t.hasImplementPlan ? `남은 단계 ${t.unchecked}/${t.total}` : 'implement-plan.md 없음';
  return `- ~/.qe/tasks/${t.name} — ${t.status.state}, ${steps}${t.hasHandoff ? ', handoff 있음' : ''}`;
}

function handoffMtime(p) {
  const st = safeStat(p);
  return st ? st.mtimeMs : 0;
}

export function buildContext(projectRoot, guideText, { home, sessionId } = {}) {
  const parts = [guideText.trim()];
  if (sessionId) parts.push(`이 세션 id: ${sessionId}`);

  const homeTasks = home ? findOpenHomeTasks(projectRoot, home) : [];
  const tasks = findOpenTasks(projectRoot);
  if (homeTasks.length > 0) parts.push(['## 미완료 작업 (~/.qe)', ...homeTasks.map(describeHome)].join('\n'));
  if (tasks.length > 0) {
    const heading = home ? '## 이전 위치(docs/qe)의 미완료 작업 — ~/.qe/tasks로 옮길 것' : '## 미완료 작업';
    parts.push([heading, ...tasks.map(describe)].join('\n'));
  }

  // The handoff to inject is the most recently written handoff.md, not the task
  // whose implement-plan.md happened to change last.
  const candidates = [
    ...tasks.filter((t) => t.handoffPath).map((t) => ({ file: t.handoffPath, name: t.name, rel: `docs/qe/${t.name}/handoff.md`, mtimeMs: t.handoffMtimeMs })),
    ...homeTasks
      .filter((t) => t.hasHandoff)
      .map((t) => {
        const file = path.join(t.dir, 'handoff.md');
        return { file, name: t.name, rel: `~/.qe/tasks/${t.name}/handoff.md`, mtimeMs: handoffMtime(file) };
      }),
  ];
  const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))[0];
  if (latest) {
    let body = safeRead(latest.file);
    if (body !== null) {
      if (body.length > MAX_HANDOFF_CHARS) {
        body = `${body.slice(0, MAX_HANDOFF_CHARS)}\n…(잘림 — 전체는 ${latest.rel})`;
      }
      parts.push(`## 최근 handoff (${latest.rel})\n\n${body.trim()}`);
    }
  }
  return parts.join('\n\n');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let projectRoot = process.cwd();
  let sessionId;
  try {
    const input = JSON.parse(readStdin());
    if (input && typeof input.cwd === 'string' && input.cwd) projectRoot = input.cwd;
    if (input && typeof input.session_id === 'string' && input.session_id) sessionId = input.session_id;
  } catch {
    // Malformed or empty stdin: keep process.cwd().
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const guideText = safeRead(path.join(here, 'guide.md')) ?? '# QE — 이해 → 계획 → 실행 → 검증 → 마무리';

  let context;
  try {
    context = buildContext(projectRoot, guideText, { home: qeHome(), sessionId });
  } catch {
    try {
      context = buildContext(projectRoot, guideText);
    } catch {
      context = guideText.trim();
    }
  }

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
