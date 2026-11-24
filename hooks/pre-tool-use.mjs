// PreToolUse (Write|Edit): the completion gate. The main model may not mark a goal
// `done` in ~/.qe/tasks/<task>/status.json unless a hook-recorded 충족 verdict exists
// for the same commit, and may not write verdict files itself. Fails open on any error.
import fs from 'node:fs';
import os from 'node:os';
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
  if (typeof o !== 'string' || typeof n !== 'string' || o === '') return null;
  // Match on a quote-normalized copy (one char maps to one char, so positions line up),
  // then splice into the ORIGINAL text like the real tool does.
  const q = (x) => x.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const hay = q(cur);
  const needle = q(o);
  const at = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    at.push(i);
    if (ti.replace_all !== true) break;
  }
  if (at.length === 0) return { unknown: true };
  const splice = (ins) => {
    let out = '';
    let last = 0;
    for (const i of at) {
      out += cur.slice(last, i) + ins;
      last = i + o.length;
    }
    return out + cur.slice(last);
  };
  // The real tool rewrites new_string in the file's quote style; judge both readings.
  return { candidates: [...new Set([splice(q(n)), splice(n)])] };
}

// Make a tool-supplied path comparable: ~ expansion, Win32 extended prefixes, Git Bash drive paths.
function cleanPath(p) {
  let f = p;
  if (f === '~' || f.startsWith('~/') || f.startsWith('~\\')) f = os.homedir() + f.slice(1);
  if (process.platform === 'win32') {
    f = f.replace(/^[\\/]{2}[?.][\\/]/, '');
    f = f.replace(/^[\\/]([a-zA-Z])(?=[\\/]|$)/, (_, d) => d.toUpperCase() + ':');
  }
  return f;
}

// Segment as the filesystem sees it: case-folded where the FS usually is, NTFS stream and trailing dots/spaces dropped.
function foldSegment(seg) {
  let s = seg;
  if (process.platform === 'win32') {
    const i = s.indexOf(':');
    if (i >= 0) s = s.slice(0, i);
    s = s.replace(/[. ]+$/, '');
  }
  if (process.platform === 'win32' || process.platform === 'darwin') s = s.toLowerCase();
  return s;
}

export function decide(input, env = process.env) {
  try {
    const ti = input?.tool_input;
    const rawPath = ti?.file_path;
    if (typeof rawPath !== 'string' || !rawPath) return null;
    const filePath = cleanPath(rawPath);
    const home = qeHome(env);
    const task = taskOfPath(home, filePath);
    if (!task) return null;
    const taskDir = path.join(tasksDir(home), task);
    const rel = path.relative(path.resolve(taskDir), path.resolve(filePath));
    const parts = rel.split(path.sep).map(foldSegment);

    if (parts[0] === 'verdicts') {
      return { deny: '검수 기록(verdicts/)은 hook만 쓴다. 검증자 서브에이전트가 최종 보고 마지막 줄에 QE-VERDICT 줄을 남기면 SubagentStop hook이 기록한다. 직접 만들거나 고치지 말고 Qverify로 검증자를 실행하라.' };
    }
    if (parts.length !== 1 || parts[0] !== 'status.json') return null;

    const next = resultContent(input.tool_name, ti, filePath);
    if (next === null) return null;
    if (typeof next === 'object' && next.unknown) {
      // Edit could not be simulated although the file exists; be conservative only when it may write done.
      if (typeof ti.new_string === 'string' && ti.new_string.includes('done')) {
        return { deny: 'status.json 편집 결과를 확인할 수 없고 done이 포함되어 있어 막는다. 부분 편집 대신 Write로 status.json 전체를 쓰라. done으로 바꾸려면 Qverify 검증자의 QE-VERDICT 충족 검수 기록이 먼저 필요하다.' };
      }
      return null;
    }
    let parsed = null;
    for (const text of typeof next === 'string' ? [next] : next.candidates) {
      try {
        const v = JSON.parse(text);
        if (v && typeof v === 'object' && v.state === 'done') {
          parsed = v;
          break;
        }
      } catch {
        // not JSON: this reading does not gate
      }
    }
    if (!parsed) return null;

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
