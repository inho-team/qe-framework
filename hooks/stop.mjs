// Stop: when this session touched a goal whose implement-plan.md is fully checked but
// has no red-team verdict for the current plan state, block the stop once and ask for
// the verifier. The once-per-planHash marker is the guard; every problem ends in null.
// The block is printed BEFORE markers are written and ~/.qe is committed: if git is slow
// and the hook is killed, a marker without a delivered block would silence that plan forever.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qeHome, tasksDir, commitHome } from './lib/qe-home.mjs';
import { listTasks, planHash } from './lib/tasks.mjs';

// What to block, with no side effects; null when nothing should be blocked.
export function findBlock(input, env = process.env) {
  try {
    if (!input || typeof input !== 'object') return null;
    if (input.stop_hook_active === true) return null;
    if (input.agent_id) return null;
    const sessionId = input.session_id;
    if (typeof sessionId !== 'string' || !sessionId) return null;

    const home = qeHome(env);
    if (!fs.statSync(tasksDir(home), { throwIfNoEntry: false })?.isDirectory()) return null;

    const hits = [];
    for (const t of listTasks(home)) {
      const s = t.status;
      if (!s || s.invalid) continue;
      if (s.state !== 'active' && s.state !== 'verifying') continue;
      if (!s.sessions.some((x) => x && x.id === sessionId)) continue;
      // A plan with no checkboxes yet is not "fully checked".
      if (!t.hasImplementPlan || t.total === 0 || t.unchecked !== 0) continue;
      const hash = planHash(t.dir);
      if (!hash) continue;
      if (t.verdicts.some((v) => v.planHash === hash)) continue;
      const marker = path.join(t.dir, `.stop-blocked-${hash}`);
      if (fs.existsSync(marker)) continue;
      hits.push({ name: t.name, marker });
    }
    if (!hits.length) return null;

    const tasks = hits.map((h) => h.name);
    return {
      reason: `${tasks.join(', ')} plan이 모두 체크됐지만 레드팀 검수 기록이 없다. Qverify로 검증자 서브에이전트를 돌려라. 사용자가 멈추기로 했다면 status.json state를 stopped로 바꿔라.`,
      tasks,
      home,
      markers: hits.map((h) => h.marker),
    };
  } catch {
    return null;
  }
}

// Remember that these plan states were blocked, then commit ~/.qe once.
export function markBlocked(block) {
  try {
    if (!block || !Array.isArray(block.markers)) return;
    for (const m of block.markers) {
      try {
        fs.writeFileSync(m, '');
      } catch {
        // a missing marker only means the stop may be blocked once more
      }
    }
    commitHome(block.home, `qe: stop-block ${block.tasks.join(', ')}`);
  } catch {
    // fail open
  }
}

export function shouldBlock(input, env = process.env) {
  const r = findBlock(input, env);
  if (r) markBlocked(r);
  return r;
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    // no stdin
  }
  let r = null;
  try {
    r = findBlock(JSON.parse(raw));
  } catch {
    // malformed stdin: pass through silently
  }
  if (!r) process.exit(0);
  try {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: r.reason }), (err) => {
      if (!err) markBlocked(r);
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
