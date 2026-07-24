/**
 * Deterministic, advisory goal routing for UserPromptSubmit.  This module does
 * no I/O at import time; state persistence is opt-in through issueGoalMarker.
 */
import { createHash } from 'node:crypto';
import { getNamespace, setNamespace } from './state.mjs';

export const GOAL_SCAN_LIMIT = 2000;
export const GOAL_TAIL_LIMIT = 200;
export const GOAL_HINT_MAX_BYTES = 512;
export const MARKER_TTL_MS = 10 * 60 * 1000;
const EXTENSIONS = '(?:mjs|js|tsx|ts|jsx|json|md|yml|yaml)';
const EXTENSION_RE = new RegExp(`^(.+\\.${EXTENSIONS})(?:[^0-9A-Za-z_\\s]*)$`, 'i');
const KO_ACTION_STEMS = ['구현', '추가', '수정', '리팩터링', '테스트', '검증', '문서', '가이드', '배포', '마이그레이션'];
const ACTION_WORDS = new Set([...KO_ACTION_STEMS, 'implement', 'add', 'fix', 'refactor', 'test', 'verify', 'document', 'deploy', 'migrate']);
const STOP_WORDS = new Set([...ACTION_WORDS, '을', '를', '이', '가', '은', '는', '및', '그리고', 'the', 'a', 'an', 'to', 'for', 'with', 'please']);

const codePoints = (text) => Array.from(String(text ?? ''));
/** True when text has more than `limit` code points; bails after limit+1 iterations. */
function exceedsCodePoints(text, limit) {
  const s = String(text ?? '');
  if (s.length <= limit) return false;
  let n = 0;
  for (const _ of s) { if (++n > limit) return true; }
  return false;
}
/** First GOAL_SCAN_LIMIT code points without materializing the whole message. */
function headWindow(text) {
  const s = String(text ?? '');
  if (s.length <= GOAL_SCAN_LIMIT) return s;
  let out = ''; let n = 0;
  for (const cp of s) { if (n++ >= GOAL_SCAN_LIMIT) break; out += cp; }
  return out;
}
/** Last GOAL_TAIL_LIMIT code points via a bounded UTF-16 slice (surrogate-safe at the used edge). */
function tailWindow(text) {
  const s = String(text ?? '');
  const approx = s.slice(-(GOAL_TAIL_LIMIT * 2 + 2));
  return Array.from(approx).slice(-GOAL_TAIL_LIMIT).join('');
}
const trimUtf8 = (text, max = GOAL_HINT_MAX_BYTES) => {
  let bytes = 0; let out = '';
  for (const cp of codePoints(text)) { const n = Buffer.byteLength(cp, 'utf8'); if (bytes + n > max) break; out += cp; bytes += n; }
  return out;
};

/** Blanks fenced/inline code and quote lines so scanners only see prose (positions preserved). */
function maskedMarkdown(text) {
  let fence = false;
  return text.split(/(\n)/).map((line) => {
    if (line === '\n') return line;
    if (/^\s*```/.test(line)) { fence = !fence; return ' '.repeat(line.length); }
    if (fence || /^\s*>/.test(line)) return ' '.repeat(line.length);
    return line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
  }).join('');
}

const OVERRIDE_TOKENS = new Set(['!direct', '!full']);

/** Overrides are honored only as leading/trailing whitespace-bounded token runs. */
function overrideTokens(message) {
  const main = headWindow(message);
  const words = maskedMarkdown(main).split(/\s+/).filter(Boolean); const tokens = new Set();
  let i = 0;
  if (words[i] && /^\/Qgoal$/i.test(words[i])) i += 1;
  while (i < words.length && OVERRIDE_TOKENS.has(words[i])) { tokens.add(words[i]); i += 1; }
  const promptEndsInMain = !exceedsCodePoints(message, GOAL_SCAN_LIMIT);
  if (promptEndsInMain) {
    let j = words.length - 1;
    while (j >= i && OVERRIDE_TOKENS.has(words[j])) { tokens.add(words[j]); j -= 1; }
  } else {
    // The tail window cannot see markdown context opened between the two
    // windows, so any open/ambiguous context conservatively disables it:
    // unclosed fence, main ending inside a quote line or an unclosed inline
    // code span, or any backtick / quote-line start after the main boundary.
    const mainFenceOpen = (main.match(/^\s*```/gm) || []).length % 2 === 1;
    const lastLine = main.slice(main.lastIndexOf('\n') + 1);
    const lastLineQuote = /^\s*>/.test(lastLine);
    const lastLineOpenInline = ((lastLine.match(/`/g) || []).length % 2) === 1;
    const rest = String(message ?? '').slice(main.length);
    const restOpensContext = rest.includes('`') || /(?:^|\n)[ \t]*>/.test(rest);
    if (!mainFenceOpen && !lastLineQuote && !lastLineOpenInline && !restOpensContext) {
      const tailWords = maskedMarkdown(tailWindow(message)).split(/\s+/).filter(Boolean);
      let k = tailWords.length - 1;
      while (k >= 0 && OVERRIDE_TOKENS.has(tailWords[k])) { tokens.add(tailWords[k]); k -= 1; }
    }
  }
  return tokens.has('!direct') ? 'direct' : tokens.has('!full') ? 'full' : null;
}

/** Strips only boundary-recognized override tokens (case-sensitive, same as recognition).
 *  Boundaries are located on the position-preserving masked text so tokens inside
 *  code fences, inline code, or quote lines are never stripped from goal text. */
function stripBoundaryOverrides(text) {
  const src = String(text);
  const masked = maskedMarkdown(src);
  const lead = /^(?:\s*(?:!direct|!full)(?=\s|$))+\s*/.exec(masked);
  const start = lead ? lead[0].length : 0;
  const trail = /(?:\s+(?:!direct|!full))+\s*$/.exec(masked);
  const end = trail && trail.index >= start ? trail.index : src.length;
  return src.slice(start, end).trim();
}

/** Blanks fenced blocks and quote lines but keeps inline code so `identifiers` count as modules. */
function maskedForFiles(text) {
  let fence = false;
  return text.split(/(\n)/).map((line) => {
    if (line === '\n') return line;
    if (/^\s*```/.test(line)) { fence = !fence; return ' '.repeat(line.length); }
    if (fence || /^\s*>/.test(line)) return ' '.repeat(line.length);
    return line;
  }).join('');
}

/** Counts distinct action-verb groups; EN uses word boundaries, KO uses stem-start (no substring hits). */
function verbGroups(text) {
  const korean = (word) => new RegExp(`(?:^|[^가-힣])${word}`, 'u').test(text);
  const english = (word) => new RegExp(`\\b${word}\\b`, 'i').test(text);
  return [
    ['구현', '추가', '수정', '리팩터링'].some(korean) || ['implement', 'add', 'fix', 'refactor'].some(english),
    ['테스트', '검증'].some(korean) || ['test', 'verify'].some(english),
    ['문서', '가이드'].some(korean) || ['document'].some(english),
    ['배포', '마이그레이션'].some(korean) || ['deploy', 'migrate'].some(english),
  ].filter(Boolean).length;
}

/** Repo-path shaped: has a slash, contains letters, and is not a URL or a date/number run. */
function isPathLike(token) {
  return /\//.test(token) && !token.includes('://') && /[A-Za-z_가-힣]/.test(token) && !/^[\d/.:-]+$/.test(token);
}

/** Dedups file/module mentions by normalized lowercase name; a token cut by the scan window never counts. */
function fileMentions(text, windowComplete) {
  const found = new Set();
  const re = new RegExp('(?:`([^`]+)`|([^\\s`]+))', 'g');
  for (const match of text.matchAll(re)) {
    const raw = match[1] || match[2];
    const endsAtWindow = match.index + match[0].length === text.length && !windowComplete;
    const normalized = raw.replace(/[.,;:!?)]*$/, '');
    const extension = EXTENSION_RE.exec(normalized);
    if (!endsAtWindow && extension && !normalized.includes('://')) found.add(extension[1].toLowerCase());
    else if (match[1] && (isPathLike(raw) || /^[A-Za-z_$][\w$.-]*$/.test(raw))) found.add(raw.toLowerCase());
    else if (isPathLike(normalized)) found.add(normalized.toLowerCase());
  }
  return found;
}

/** Returns an intent descriptor; invalid input intentionally fail-opens. */
export function detectGoalIntent(message) {
  try {
    if (typeof message !== 'string') return { detected: false };
    const scan = headWindow(message); const command = /^\s*\/Qgoal(?=$|\s)/i.exec(scan);
    if (command) {
      const goalText = scan.slice(command[0].length).trim();
      return goalText ? { detected: true, source: 'command', goalText, scan } : { detected: false, source: 'command', goalText: '', usage: '/Qgoal {목표}' };
    }
    // A slash-command-shaped first token that is not /Qgoal is an attempted
    // command (e.g. /Qgoals typo), never a natural-language goal.
    const firstToken = scan.trimStart().split(/\s+/, 1)[0] || '';
    if (/^\/[A-Za-z][\w-]*$/.test(firstToken)) return { detected: false };
    const visible = maskedMarkdown(scan);
    const words = visible.match(/[가-힣A-Za-z0-9][가-힣A-Za-z0-9._/-]*/g) || [];
    const hasAction = words.some((word) => ACTION_WORDS.has(word.toLowerCase())) || verbGroups(visible) > 0;
    // A verb conjugation alone (구현하기, 수정해줘) is not a concrete target.
    const isActionish = (word) => ACTION_WORDS.has(word.toLowerCase()) || KO_ACTION_STEMS.some((stem) => word.startsWith(stem));
    const hasTarget = words.some((word) => codePoints(word).length >= 2 && !STOP_WORDS.has(word.toLowerCase()) && !isActionish(word))
      || /`[^`]+`/.test(maskedForFiles(scan));
    return hasAction && hasTarget ? { detected: true, source: 'natural', goalText: scan.trim(), scan } : { detected: false };
  } catch { return { detected: false }; }
}

/** Deterministically classifies a detected goal. */
export function triageGoal(message, options = {}) {
  const intent = detectGoalIntent(message);
  if (!intent.detected) return { ...intent, route: 'direct', reason: intent.usage ? 'usage' : 'not-goal', instruction: intent.usage ? '/Qgoal {목표}' : '' };
  const override = overrideTokens(message);
  const goalText = stripBoundaryOverrides(intent.goalText);
  const visible = maskedMarkdown(goalText); const files = fileMentions(maskedForFiles(goalText), !exceedsCodePoints(message, GOAL_SCAN_LIMIT));
  const groups = verbGroups(visible); const length = codePoints(goalText).length;
  const concrete = files.size > 0 || (groups > 0 && (visible.match(/[가-힣A-Za-z0-9]{2,}/g) || []).some((w) => !STOP_WORDS.has(w.toLowerCase())));
  let scale = 'Micro'; let reason = 'micro-scale';
  if (!concrete) { reason = 'ambiguous-default-direct'; }
  else if (files.size >= 10 || (/(대규모|massive|적대 검증|adversarial)/i.test(visible) && groups >= 3)) { scale = 'Workflow'; reason = 'workflow-scale'; }
  else if (files.size >= 4 || groups >= 3 || length >= 1000) { scale = 'Full'; reason = 'full-scale'; }
  else if (files.size >= 2 || groups >= 2 || length >= 301) { scale = 'Small'; reason = 'small-scale'; }
  if (override === 'direct') { scale = 'Micro'; reason = 'override-direct'; }
  if (override === 'full') { scale = 'Full'; reason = 'override-full'; }
  const route = scale === 'Full' || scale === 'Workflow' ? 'pipeline' : 'direct';
  const instruction = route === 'pipeline'
    ? `Run PSE: spec → execute → verify for this ${scale} goal.${scale === 'Workflow' ? ' Propose a dynamic workflow before execution.' : ''}`
    : 'Direct handling: keep this goal on the existing direct path.';
  return { detected: true, source: intent.source, goalText, route, reason, instruction, scale, override, fileCount: files.size, verbGroups: groups, length };
}

/** Produces the bounded hook payload; marker persistence remains the caller's choice. */
export function createGoalRoute(message, options = {}) {
  const route = triageGoal(message, options);
  if (!route.detected) return route;
  route.instruction = trimUtf8(`[QE GOAL] ${route.instruction}`);
  return route;
}

/** oldest-first by issuedAt; equal timestamps break ties by routeId for determinism. */
function markerOrder(a, b) { return a.issuedAt - b.issuedAt || String(a.routeId).localeCompare(String(b.routeId)); }
/** Prunes expired (now >= expiresAt) → per-session cap 8 → global cap 32; the fresh marker is exempt this round. */
export function pruneGoalMarkers(entries, { now = Date.now(), freshRouteId } = {}) {
  // Sanitize before any sort: corrupted entries (null, bad timestamps) must not
  // reach markerOrder. Then the circuit breaker keeps the O(entries × sessions)
  // grouping pass off unbounded input from a corrupted/hand-edited state file.
  let list = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && Number.isFinite(entry.expiresAt) && Number.isFinite(entry.issuedAt));
  if (list.length > 512) list = [...list].sort(markerOrder).slice(-512);
  let kept = list.filter((entry) => now < entry.expiresAt);
  // routeId is unique by construction; duplicates only exist in corrupted
  // state and would ride the fresh-exemption past both caps — dedup, newest wins.
  const byId = new Map();
  for (const entry of [...kept].sort(markerOrder)) byId.set(entry.routeId, entry);
  kept = [...byId.values()];
  for (const sessionId of [...new Set(kept.map((entry) => entry.sessionId))]) {
    const group = kept.filter((entry) => entry.sessionId === sessionId).sort(markerOrder);
    while (group.length > 8) { const victim = group.find((entry) => entry.routeId !== freshRouteId); if (!victim) break; kept = kept.filter((entry) => entry !== victim); group.splice(group.indexOf(victim), 1); }
  }
  while (kept.length > 32) { const victim = [...kept].sort(markerOrder).find((entry) => entry.routeId !== freshRouteId); if (!victim) break; kept = kept.filter((entry) => entry !== victim); }
  return kept.sort(markerOrder);
}

/** Merges an advisory marker into goalRuntime. It is not an authorization primitive. */
export function issueGoalMarker({ cwd, state, sessionId, route, now = Date.now() } = {}) {
  if (!cwd || !state || !sessionId || !route) return null;
  if (!/^[\w.-]{1,128}$/.test(String(sessionId))) return null;
  const routeId = createHash('sha256').update(`${sessionId}:${route}:${now}:${JSON.stringify(getNamespace(state, 'goalRuntime') || {})}`).digest('hex').slice(0, 24);
  const entry = { version: 1, routeId, sessionId, route, issuedAt: now, expiresAt: now + MARKER_TTL_MS };
  const current = getNamespace(state, 'goalRuntime');
  const entries = pruneGoalMarkers([...(Array.isArray(current?.entries) ? current.entries : []), entry], { now, freshRouteId: routeId });
  const hadNamespace = Object.prototype.hasOwnProperty.call(state, 'goalRuntime');
  const previous = state.goalRuntime;
  try {
    setNamespace(cwd, state, 'goalRuntime', { version: 1, entries });
  } catch (err) {
    // setNamespace mutates the shared state object before writing; undo the
    // mutation so a later unrelated writeUnifiedState cannot persist the marker.
    if (hadNamespace) state.goalRuntime = previous; else delete state.goalRuntime;
    throw err;
  }
  return entry;
}
