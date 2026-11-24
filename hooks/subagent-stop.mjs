// SubagentStop: when a verifier subagent ends with a QE-VERDICT line, write it to
// ~/.qe/tasks/<task>/verdicts/. Completion is then judged from this hook-written
// record, not from the main model's claim. Never fails: every problem ends in null.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qeHome, tasksDir, ensureHome, writeJsonAtomic, commitHome } from './lib/qe-home.mjs';
import { planHash } from './lib/tasks.mjs';

const RESULTS = ['충족', '일부 미충족', '미충족'];
const MAX_BYTES = 5 * 1024 * 1024;

// Last valid `QE-VERDICT: <task> | <result> | <branch> | <sha>` line, or null.
export function parseVerdictLine(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*QE-VERDICT:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const parts = m[1].split('|').map((s) => s.trim());
    if (parts.length !== 4) continue;
    const [task, rawResult, branch, commit] = parts;
    const result = rawResult.replace(/\s+/g, ' ');
    // The task becomes a folder name: no separators or dot-segments.
    if (!/^[^\s/\\.][^/\\]*$/.test(task) || task.includes('..')) continue;
    if (!RESULTS.includes(result)) continue;
    if (!/^[0-9a-fA-F]{7,40}$/.test(commit)) continue;
    return { task, result, branch, commit };
  }
  return null;
}

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, MAX_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export function findVerdict(input) {
  try {
    const fromMsg = parseVerdictLine(input?.last_assistant_message);
    if (fromMsg) return fromMsg;
    const tp = input?.agent_transcript_path;
    if (typeof tp !== 'string' || !tp) return null;
    const lines = readTail(tp).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let obj;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (obj?.type !== 'assistant') continue;
      const strings = [];
      collectStrings(obj, strings);
      for (let j = strings.length - 1; j >= 0; j--) {
        const v = parseVerdictLine(strings[j]);
        if (v) return v;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function recordVerdict(input, env = process.env) {
  try {
    const v = findVerdict(input);
    if (!v) return null;
    const home = qeHome(env);
    const taskDir = path.join(tasksDir(home), v.task);
    if (!fs.statSync(taskDir, { throwIfNoEntry: false })?.isDirectory()) return null;

    const agentId = (typeof input.agent_id === 'string' ? input.agent_id : '').replace(/[^A-Za-z0-9_-]/g, '') || 'unknown';
    const at = Date.now();
    const dir = path.join(taskDir, 'verdicts');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${at}-${agentId}.json`);
    writeJsonAtomic(file, {
      task: v.task,
      result: v.result,
      branch: v.branch,
      commit: v.commit,
      planHash: planHash(taskDir),
      agentId,
      agentType: typeof input.agent_type === 'string' ? input.agent_type : '',
      at,
    });
    ensureHome(home);
    commitHome(home, `qe: verdict ${v.task}`);
    return file;
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
    recordVerdict(JSON.parse(raw));
  } catch {
    // malformed stdin: pass through silently
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
