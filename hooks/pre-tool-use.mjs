// PreToolUse (Write|Edit): the completion gate. The main model may not mark a goal
// `done` in ~/.qe/tasks/<task>/status.json, or move an already-done goal's done.commit,
// unless a hook-recorded 충족 verdict exists for that commit, and may not write verdict
// files itself. Fails open on any error.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qeHome, tasksDir, cleanPath } from './lib/qe-home.mjs';
import { readStatus, listVerdicts, relParts, sameCommit, stripBom } from './lib/tasks.mjs';

// The file content after the tool call, or null when it cannot be determined.
function resultContent(toolName, ti, file) {
  if (toolName === 'Write') return typeof ti.content === 'string' ? { candidates: [ti.content] } : null;
  if (toolName !== 'Edit') return null;
  let cur;
  try {
    cur = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let { old_string: o, new_string: n } = ti;
  if (typeof o !== 'string' || typeof n !== 'string' || o === '') return null;
  // The real tool edits a CRLF file as LF (file, old_string and new_string) and writes CRLF back,
  // so an LF multi-line old_string matches there. Line endings do not change the parsed JSON.
  if (cur.includes('\r\n')) {
    const lf = (x) => x.replaceAll('\r\n', '\n');
    cur = lf(cur);
    o = lf(o);
    n = lf(n);
  }
  // The real tool uses a literal match when there is one; quote-normalized matching is only the fallback.
  if (cur.includes(o)) {
    return { candidates: [ti.replace_all === true ? cur.split(o).join(n) : cur.replace(o, () => n)] };
  }
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
    const all = relParts(tasksDir(home), filePath);
    if (!all || all.length < 2) return null; // not under a task folder
    const taskDir = path.join(tasksDir(home), all[0]);
    const parts = all.slice(1).map(foldSegment);

    if (parts[0] === 'verdicts') {
      return { deny: '검수 기록(verdicts/)은 hook만 쓴다. 검증자 서브에이전트가 최종 보고 마지막 줄에 QE-VERDICT 줄을 남기면 SubagentStop hook이 기록한다. 직접 만들거나 고치지 말고 Qverify로 검증자를 실행하라.' };
    }
    if (parts.length !== 1 || parts[0] !== 'status.json') return null;

    const cur = readStatus(taskDir);
    // An already-done goal is an archive: edits that keep its recorded commit pass, so Qfinish can add
    // done.finish to goals done before verdicts existed. Moving done.commit is judged like a first done,
    // because a done goal was observed re-pointed to later commits that no verifier saw.
    const wasDone = Boolean(cur && !cur.invalid && cur.state === 'done');
    const doneCommit = wasDone ? cur.done.commit : null;

    const next = resultContent(input.tool_name, ti, filePath);
    if (next === null) return null;
    // An Edit whose old_string is nowhere in the file, even after the tool's line-ending and quote matching,
    // fails in the real tool; on an archive there is nothing to judge.
    if (wasDone && next.unknown) return null;
    const q = (x) => x.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    // A partial Edit that mentions done is only trusted when we can fully simulate it.
    const mentionsDone = input.tool_name === 'Edit' && typeof ti.new_string === 'string' && q(ti.new_string).includes('done');
    const writeAll = { deny: 'status.json 편집 결과를 확인할 수 없고 done이 포함되어 있어 막는다. 부분 편집 대신 Write로 status.json 전체를 쓰라. done으로 바꾸려면 Qverify 검증자의 QE-VERDICT 충족 검수 기록이 먼저 필요하다.' };
    const need = '이 목표를 done으로 바꿀 수 없다. Qverify 검증자 서브에이전트가 QE-VERDICT 줄로 충족을 보고해야 하고(SubagentStop hook이 verdicts/에 기록한다), done.commit은 그 검수 기록의 commit과 같아야 한다.';
    if (next.unknown) return mentionsDone ? writeAll : null;

    for (const text of next.candidates) {
      let v;
      try {
        // Judged as the JSON a reader sees: readStatus also drops a leading BOM.
        v = JSON.parse(stripBom(text));
      } catch {
        if (mentionsDone) return writeAll;
        continue; // a write producing invalid JSON is not ours to block
      }
      if (!v || typeof v !== 'object') {
        if (mentionsDone) return writeAll;
        continue;
      }
      if (v.state !== 'done') continue;
      const commit = v.done && typeof v.done === 'object' ? v.done.commit : null;
      if (typeof commit !== 'string' || !commit.trim()) return { deny: `done.commit이 없다. ${need}` };
      if (wasDone && sameCommit(commit, doneCommit)) continue;
      const ok = listVerdicts(taskDir).some((x) => x && x.result === '충족' && sameCommit(x.commit, commit));
      if (!ok) return { deny: `커밋 ${commit}에 대한 충족 검수 기록이 없다. ${need}` };
    }
    return null;
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
