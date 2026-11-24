// PostToolUse: when a Write/Edit lands under ~/.qe/tasks/<task>/, record which
// session and worktree touched that task in its status.json. Evidence, not claims.
// Never fails the tool call: every problem ends in null and exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qeHome, tasksDir, ensureHome, writeJsonAtomic, commitHome, git, normPath } from './lib/qe-home.mjs';
import { readStatus, taskOfPath, projectRootOf } from './lib/tasks.mjs';

export function recordTouch(input, env = process.env) {
  try {
    const filePath = input?.tool_input?.file_path;
    if (typeof filePath !== 'string' || !filePath) return null;
    const home = qeHome(env);
    const task = taskOfPath(home, filePath);
    if (!task) return null;
    if (!ensureHome(home)) return null;

    const statusFile = path.join(tasksDir(home), task, 'status.json');
    const status = readStatus(path.dirname(statusFile));
    if (!status || status.invalid) return null;

    const now = Date.now();
    // Subagents report the parent's session_id too, so one field covers both.
    const sid = typeof input.session_id === 'string' ? input.session_id : null;
    if (sid) {
      const s = status.sessions.find((x) => x && x.id === sid);
      if (s) s.lastSeen = now;
      else status.sessions.push({ id: sid, firstSeen: now, lastSeen: now });
    }

    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : null;
    if (cwd) {
      const top = git(cwd, ['rev-parse', '--show-toplevel']);
      if (top) {
        const wtPath = path.resolve(top);
        const branch = git(cwd, ['branch', '--show-current']) || '';
        const w = status.worktrees.find((x) => x && typeof x.path === 'string' && normPath(x.path) === normPath(wtPath));
        if (w) {
          w.branch = branch;
          w.lastSeen = now;
        } else {
          status.worktrees.push({ path: wtPath, branch, lastSeen: now });
        }
      }
      if (!status.project) {
        const root = projectRootOf(cwd);
        if (root) status.project = root;
      }
    }

    writeJsonAtomic(statusFile, status);
    commitHome(home, `qe: touch ${task}`);
    return { task };
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
    recordTouch(JSON.parse(raw));
  } catch {
    // malformed stdin: pass through silently
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
