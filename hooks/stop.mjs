// Stop: when this session touched a goal whose implement-plan.md is fully checked but
// has no red-team verdict for the current plan state, block the stop once and ask for
// the verifier. The once-per-planHash marker is the guard; every problem ends in null.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qeHome, tasksDir, commitHome } from './lib/qe-home.mjs';
import { listTasks, planHash } from './lib/tasks.mjs';

export function shouldBlock(input, env = process.env) {
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
      if (!t.hasImplementPlan || t.unchecked !== 0) continue;
      const hash = planHash(t.dir);
      if (!hash) continue;
      if (t.verdicts.some((v) => v.planHash === hash)) continue;
      const marker = path.join(t.dir, `.stop-blocked-${hash}`);
      if (fs.existsSync(marker)) continue;
      hits.push({ name: t.name, marker });
    }
    if (!hits.length) return null;

    for (const h of hits) {
      try {
        fs.writeFileSync(h.marker, '');
      } catch {
        // failing to block is worse than a missing marker: still block
      }
      commitHome(home, `qe: stop-block ${h.name}`);
    }
    const tasks = hits.map((h) => h.name);
    return {
      reason: `${tasks.join(', ')} plan이 모두 체크됐지만 레드팀 검수 기록이 없다. Qverify로 검증자 서브에이전트를 돌려라. 사용자가 멈추기로 했다면 status.json state를 stopped로 바꿔라.`,
      tasks,
    };
  } catch {
    return null;
  }
}

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    // no stdin
  }
  try {
    const r = shouldBlock(JSON.parse(raw));
    if (r) process.stdout.write(JSON.stringify({ decision: 'block', reason: r.reason }));
  } catch {
    // malformed stdin: pass through silently
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
