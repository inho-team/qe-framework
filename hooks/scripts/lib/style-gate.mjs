#!/usr/bin/env node
'use strict';

/**
 * style-gate.mjs — Stage-1 candidate scanner for the OUTPUT_STYLE response gate.
 *
 * Role in the 2-stage gate (ADR-025 R3):
 *   Stage 1 (THIS file, cost 0): scan the last assistant message for deterministic
 *     structural violations and identify operational responses that need semantic
 *     review. If nothing trips, the Stop hook allows stop with ZERO API cost.
 *   Stage 2 (later): only on a Stage-1 trip does the Stop hook escalate to a Haiku
 *     judge that decides "심한 위반?" against core/OUTPUT_STYLE.md.
 *
 * Design rule: deterministic findings MUST stay HIGH-PRECISION. Semantic rules are
 * candidates only; the Stage-2 judge decides whether they are real violations.
 *
 * Every function is fault-tolerant: any failure returns the "no violation / empty"
 * shape so the gate can never crash the Stop hook.
 */

import { readFileSync, existsSync } from './qe-fs.mjs';
import { join } from 'path';
import { readClaudeOAuthToken } from './claude-token.mjs';

/**
 * High-precision drama markers. Each entry is enforcing a rule that ALREADY exists
 * in core/OUTPUT_STYLE.md (line 35 example, line 178 anti-pattern, line 182 openers) —
 * the gate exposes/enforces it, it does not invent new style policy.
 *
 * `m` flag + (^|\n) anchor: a marker only counts at the START of a line/clause, where
 * 의식의 흐름 actually surfaces. Mid-sentence occurrences (e.g. a word that happens to
 * contain 음) do not trip.
 */
export const STYLE_PATTERNS = [
  {
    // 추임새 + 대시: "잠깐 —", "맞다 —", "아 잠깐 —", "그러네 —" (line 35 / 178)
    rule: 'interjection-dash',
    re: /(^|\n)\s*(잠깐만?|아\s*잠깐|근데\s*잠깐|맞다|맞아|아\s*맞다|아\s*그러네|그러네)\s*[—–\-]/,
  },
  {
    // filler 오프너: "음,", "아,", "어,", "흠," (의식의 흐름 — line 35)
    rule: 'filler-opener',
    re: /(^|\n)\s*(음+|어+|흠+|아+)\s*[,，]/,
  },
  {
    // 금지 오프너 — "좋은 질문입니다" 류 (line 182)
    rule: 'banned-opener-question',
    re: /좋은\s*질문(이(네요|에요|예요|군요)|입니다|이다)/,
  },
  {
    // 금지 오프너 — "~에 대해 설명드리겠습니다" 류 (line 182)
    rule: 'banned-opener-explain',
    re: /(에\s*대해|에\s*관해)\s*설명(을)?\s*(드리겠습니다|하겠습니다|드릴게요|할게요|하겠습니다만)/,
  },
  {
    // 형식적 맺음말 — 마지막 문장에 있을 때만 차단 후보
    rule: 'generic-closer',
    re: /(?:도움이\s*되었(?:길|으면)|필요하시면\s*(?:언제든지\s*)?(?:말씀|알려)|더\s*궁금한\s*(?:점|사항)이\s*있으면|feel free to (?:ask|reach out)|hope (?:this|that) helps)[^\n]*[.!]?\s*$/i,
  },
  {
    // 본문을 다시 말하는 종결 요약 오프너
    rule: 'recap-opener',
    re: /(^|\n)\s*(?:요약하면|정리하면|다시\s*정리하면|recap|to\s+summari[sz]e)\s*[:：,]?/im,
  },
  {
    // 시간 단위를 피한 모호한 예상
    rule: 'vague-time-estimate',
    re: /(?:잠시\s*후|곧\s*(?:끝|완료)|(?:조금|약간)\s*(?:걸립니다|소요됩니다)|\b(?:soon|shortly|in a bit|take a while)\b)/i,
  },
];

// Backward-compatible export for existing consumers and tests.
export const DRAMA_PATTERNS = STYLE_PATTERNS;

const OPERATIONAL_SIGNAL = /(?:현재\s*상태|다음\s*행동|다음\s*단계|진행\s*중|작업\s*중|구현|수정|검증|테스트|완료|오류|실패|current\s+state|next\s+action|next\s+step|implement|verif(?:y|ication)|test(?:ing)?|completed?|failed?|error)/i;

function structuralHits(text) {
  const hits = [];
  const lines = text.split('\n');
  let inFence = false;
  let listCount = 0;
  let listStart = '';

  const flushList = () => {
    if (listCount > 5) {
      hits.push({ rule: 'list-over-5', match: `${listStart} (${listCount} items)` });
    }
    listCount = 0;
    listStart = '';
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      flushList();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)/);
    if (item) {
      listCount += 1;
      if (!listStart) listStart = item[0].trim().slice(0, 40);
      continue;
    }
    if (line.trim() && !/^\s*>/.test(line)) flushList();
  }
  flushList();

  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const operational = nonEmpty.length >= 3 && OPERATIONAL_SIGNAL.test(text);
  if (operational) {
    hits.push({ rule: 'operational-response-review', match: nonEmpty[0].slice(0, 40) });

    if (!/^(?:다음\s*행동|next\s+action)\s*[:：]/i.test(nonEmpty[0])) {
      hits.push({ rule: 'missing-action-lead', match: nonEmpty[0].slice(0, 40) });
    }
    if (!/(^|\n)\s*(?:현재\s*상태|current\s+state)\s*[:：]/i.test(text)) {
      hits.push({ rule: 'missing-current-state', match: 'current-state marker absent' });
    }
    const last = nonEmpty[nonEmpty.length - 1];
    if (!/^(?:다음\s*단계|next\s+step)\s*[:：]/i.test(last)) {
      hits.push({ rule: 'missing-next-step', match: last.slice(0, 40) });
    }
  }

  return hits;
}

/**
 * Scan assistant prose for deterministic violations and semantic-review candidates.
 *
 * @param {string} text - The assistant's user-facing text.
 * @returns {{ tripped: boolean, hits: Array<{rule: string, match: string}> }}
 */
export function scanStyleViolations(text) {
  if (!text || typeof text !== 'string') return { tripped: false, hits: [] };

  const hits = [];
  for (const { rule, re } of STYLE_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      hits.push({ rule, match: m[0].trim().slice(0, 40) });
    }
  }
  hits.push(...structuralHits(text));
  return { tripped: hits.length > 0, hits };
}

/**
 * Decide whether a transcript line is a REAL human user turn (not a tool_result,
 * which Claude Code also encodes as a `user`-type line).
 */
function isHumanUserLine(obj) {
  if (!obj || obj.type !== 'user') return false;
  const c = obj.message?.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return c.some((b) => b && b.type === 'text');
  return false;
}

/**
 * Pull the concatenated text of an assistant transcript line's text blocks.
 * tool_use / thinking blocks are ignored — only user-facing `text` blocks count.
 */
function assistantText(obj) {
  if (!obj || obj.type !== 'assistant') return '';
  const c = obj.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  }
  return '';
}

/**
 * Extract the final user-facing assistant prose from a Claude Code transcript (JSONL).
 *
 * Returns the concatenation of every assistant text block that appears AFTER the last
 * human user message — i.e. the full closing turn, even if it was split across multiple
 * assistant events by intervening tool calls.
 *
 * Fault-tolerant: returns '' on any read/parse failure or empty transcript.
 *
 * @param {string} transcriptPath - Absolute path to the .jsonl transcript.
 * @returns {string}
 */
export function extractLastAssistantText(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return '';

  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }

  const lines = raw.split('\n');
  const parsed = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      parsed.push(JSON.parse(t));
    } catch {
      // skip malformed line — never throw
    }
  }
  if (parsed.length === 0) return '';

  // Find the last human user turn; collect assistant prose after it.
  let lastUserIdx = -1;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (isHumanUserLine(parsed[i])) {
      lastUserIdx = i;
      break;
    }
  }

  const chunks = [];
  for (let i = lastUserIdx + 1; i < parsed.length; i++) {
    const txt = assistantText(parsed[i]);
    if (txt) chunks.push(txt);
  }
  return chunks.join('\n').trim();
}

// ── Stage 2: Haiku judge ──────────────────────────────────────────────────────
//
// Only runs when Stage 1 trips. Reads the live OUTPUT_STYLE.md anti-pattern section
// as the rubric so the document IS the verdict criterion (not a hardcoded copy that
// can drift). Fail-OPEN everywhere: a judge error/timeout returns { severe:false } so
// an API hiccup can never block a legit turn — blocking on infra failure is the worst
// outcome, strictly worse than letting one dramatic turn through.

/**
 * Built-in rubric fallback — used only when core/OUTPUT_STYLE.md is missing/unreadable.
 * Mirrors the "안티패턴" section so the judge still has criteria off-grid.
 */
const RUBRIC_FALLBACK = [
  '- 작업·진행 응답은 `다음 행동:`으로 시작하고 `현재 상태:`를 밝히며 마지막 `다음 단계:` 하나로 끝낸다',
  '- 실행 순서가 둘 이상이면 번호를 붙이고, 한 목록은 최대 5개다',
  '- 남은 시간은 정수 분으로 말하고, 완료한 성과는 보이게 하며, 오류는 사실·영향·대응만 담백하게 보고한다',
  '- 목표와 무관한 곁가지, 서론, 반복 요약, 형식적 맺음말을 쓰지 않는다',
  '- 의식의 흐름 / 과정 서술 (결론만, 도달 경로 금지)',
  '- 추임새 + 대시 ("잠깐 —", "맞다 —", "음, 그러네")',
  '- 인위적 긴장/드라마 (확신했다 곧장 뒤집기, "즉시 …한다")',
  '- 금지 오프너 ("좋은 질문입니다", "~에 대해 설명드리겠습니다")',
].join('\n');

/**
 * Extract the "안티패턴" section from core/OUTPUT_STYLE.md as the judge rubric.
 * @param {string} cwd - Project root.
 * @returns {string} The anti-pattern bullets, or RUBRIC_FALLBACK if unreadable.
 */
export function loadStyleRubric(cwd) {
  try {
    const p = join(cwd, 'core', 'OUTPUT_STYLE.md');
    if (!existsSync(p)) return RUBRIC_FALLBACK;
    const src = readFileSync(p, 'utf8');
    const operational = src.match(/##\s*Tier 1A[^\n]*\n([\s\S]*?)(?:\n---|\n##\s|$)/);
    const antiPatterns = src.match(/##\s*안티패턴[^\n]*\n([\s\S]*?)(?:\n---|\n##\s|$)/);
    const sections = [operational?.[1], antiPatterns?.[1]].filter(Boolean).map((s) => s.trim());
    return sections.length > 0 ? sections.join('\n\n') : RUBRIC_FALLBACK;
  } catch {
    return RUBRIC_FALLBACK;
  }
}

// Token source: shared helper (file → macOS Keychain). See lib/claude-token.mjs.

/**
 * Judge whether assistant prose is a SEVERE OUTPUT_STYLE violation.
 *
 * @param {string} text - The assistant's user-facing prose (Stage-1 already tripped).
 * @param {object} [opts]
 * @param {string} [opts.rubric]    - Rubric text; defaults to RUBRIC_FALLBACK.
 * @param {string} [opts.token]     - OAuth token; defaults to the credentials file.
 * @param {Function} [opts.fetchImpl] - Injectable fetch (for tests).
 * @param {number} [opts.timeoutMs] - Network timeout (default 2500).
 * @param {string} [opts.model]     - Model id (default claude-haiku-4-5-20251001).
 * @returns {Promise<{severe: boolean, reason: string, judged: boolean}>}
 *          judged=false means the judge did not run (no token / error / timeout) →
 *          callers treat it as NOT severe (fail-open).
 */
export async function judgeStyle(text, opts = {}) {
  const NO = { severe: false, reason: '', judged: false };
  if (!text || typeof text !== 'string') return NO;

  const rubric = opts.rubric || RUBRIC_FALLBACK;
  const token = opts.token || readClaudeOAuthToken();
  if (!token) return NO; // can't judge → fail-open

  const doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return NO;

  // OAuth tokens (sk-ant-oat01-*) only reach the current model ids; the legacy
  // claude-3-5-haiku-* ids 404 on this auth path. Haiku 4.5 is the cheap judge tier.
  const model = opts.model || 'claude-haiku-4-5-20251001';
  const timeoutMs = opts.timeoutMs || 2500;

  // Cap the prose we send — a closing answer is rarely huge, and the markers we care
  // about cluster near the top/structure. Keeps tokens (and cost) bounded.
  const snippet = text.length > 2000 ? text.slice(0, 2000) : text;

  const prompt =
    '당신은 사용자 대상 작업 응답의 문체 심판이다. 아래 계약의 명백하고 실질적인 위반만 잡는다. ' +
    '정보성 단답에는 작업 상태 형식을 억지로 요구하지 말고, 작업·진행·완료 보고에는 전부 적용한다.\n\n' +
    `응답 계약 (core/OUTPUT_STYLE.md):\n${rubric}\n\n` +
    '특히 다음 행동 시작, 번호 있는 다단계 작업, 매 턴 현재 상태, 분 단위 예상, 보이는 성과, 담백한 오류, 목록 5개 제한, 곁가지 억제, 서론·반복 요약·형식적 맺음말 금지, 마지막의 구체적 다음 단계 하나를 검사한다.\n\n' +
    `판정할 답변:\n"""\n${snippet}\n"""\n\n` +
    '규칙: 심한 위반이 있으면 첫 줄을 `BLOCK <사유 15자 이내>`로, 없으면 `PASS`만 출력. 다른 말 금지.';

  try {
    const resp = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        // OAuth token → Bearer (x-api-key returns 401 for sk-ant-oat01-* tokens).
        'authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 30,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp || !resp.ok) return NO;
    const body = await resp.json();
    const out = (body?.content?.[0]?.text || '').trim();
    return parseJudgeOutput(out);
  } catch {
    return NO; // timeout / network / parse → fail-open
  }
}

/**
 * Parse the judge's first line into a verdict.
 * `BLOCK <reason>` → severe; anything else (incl. `PASS`) → not severe.
 * Exported for unit testing the parse contract independently of the network.
 * @param {string} out
 * @returns {{severe: boolean, reason: string, judged: boolean}}
 */
export function parseJudgeOutput(out) {
  if (!out || typeof out !== 'string') return { severe: false, reason: '', judged: false };
  const firstLine = out.split('\n')[0].trim();
  const m = firstLine.match(/^BLOCK\b[:\s]*(.*)$/i);
  if (m) {
    return { severe: true, reason: (m[1] || '문체 위반').trim().slice(0, 40), judged: true };
  }
  return { severe: false, reason: '', judged: true };
}
