// PreToolUse (Write|Edit): the completion gate. The main model may not mark a goal
// `done` in ~/.qe/tasks/<task>/status.json unless a hook-recorded 충족 verdict exists
// for the same commit, and may not write verdict files itself. Fails open on any error.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qeHome, tasksDir } from './lib/qe-home.mjs';
import { readStatus, listVerdicts, taskOfPath } from './lib/tasks.mjs';

const HEX = /^[0-9a-f]{7,40}$/;

function sameCommit(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  return HEX.test(x) && HEX.test(y) && (x.startsWith(y) || y.startsWith(x));
}

// The file content after the tool call, or null when it cannot be determined.
function resultContent(toolName, ti, file) {
  if (toolName === 'Write') return typeof ti.content === 'string' ? ti.content : null;
  if (toolName !== 'Edit') return null;
  let cur;
  try {
    cur = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { old_string: o, new_string: n } = ti;
  if (typeof o !== 'string' || typeof n !== 'string' || o === '' || !cur.includes(o)) return null;
  return ti.replace_all === true ? cur.split(o).join(n) : cur.replace(o, () => n);
}

export function decide(input, env = process.env) {
  try {
    const ti = input?.tool_input;
    const filePath = ti?.file_path;
    if (typeof filePath !== 'string' || !filePath) return null;
    const home = qeHome(env);
    const task = taskOfPath(home, filePath);
    if (!task) return null;
    const taskDir = path.join(tasksDir(home), task);
    const rel = path.relative(path.resolve(taskDir), path.resolve(filePath));
    const parts = rel.split(path.sep);

    if (parts[0] === 'verdicts') {
      return { deny: '검수 기록(verdicts/)은 hook만 쓴다. 검증자 서브에이전트가 최종 보고 마지막 줄에 QE-VERDICT 줄을 남기면 SubagentStop hook이 기록한다. 직접 만들거나 고치지 말고 Qverify로 검증자를 실행하라.' };
    }
    if (parts.length !== 1 || parts[0] !== 'status.json') return null;

    const next = resultContent(input.tool_name, ti, filePath);
    if (next === null) return null;
    let parsed;
    try {
      parsed = JSON.parse(next);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.state !== 'done') return null;

    const cur = readStatus(taskDir);
    if (cur && !cur.invalid && cur.state === 'done') return null;

    const commit = parsed.done && typeof parsed.done === 'object' ? parsed.done.commit : null;
    const need = '이 목표를 done으로 바꿀 수 없다. Qverify 검증자 서브에이전트가 QE-VERDICT 줄로 충족을 보고해야 하고(SubagentStop hook이 verdicts/에 기록한다), done.commit은 그 검수 기록의 commit과 같아야 한다.';
    if (typeof commit !== 'string' || !commit.trim()) {
      return { deny: `done.commit이 없다. ${need}` };
    }
    const ok = listVerdicts(taskDir).some((v) => v && v.result === '충족' && sameCommit(v.commit, commit));
    if (ok) return null;
    return { deny: `커밋 ${commit}에 대한 충족 검수 기록이 없다. ${need}` };
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
    const r = decide(JSON.parse(raw));
    if (r) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.deny } }),
      );
    }
  } catch {
    // fail open
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
