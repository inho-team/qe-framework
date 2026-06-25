#!/usr/bin/env node
'use strict';

/**
 * style-gate.mjs — Stage-1 regex pre-filter for the OUTPUT_STYLE drama gate.
 *
 * Role in the 2-stage gate (ADR-025 R3):
 *   Stage 1 (THIS file, cost 0): scan the last assistant message for high-precision
 *     drama markers (의식의 흐름 / 추임새 / 금지 오프너). If nothing trips, the Stop
 *     hook allows stop with ZERO API cost — the common case.
 *   Stage 2 (later): only on a Stage-1 trip does the Stop hook escalate to a Haiku
 *     judge that decides "심한 위반?" against core/OUTPUT_STYLE.md.
 *
 * Design rule: the pattern set MUST stay HIGH-PRECISION. A gate that blocks a clean
 * answer is worse than the drama it prevents. So we never flag a bare em-dash (the
 * style doc itself uses `—` everywhere) — only specific interjection LEXEMES followed
 * by a dash, filler openers, and the two banned openers OUTPUT_STYLE.md:182 names.
 *
 * Every function is fault-tolerant: any failure returns the "no violation / empty"
 * shape so the gate can never crash the Stop hook.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * High-precision drama markers. Each entry is enforcing a rule that ALREADY exists
 * in core/OUTPUT_STYLE.md (line 35 example, line 178 anti-pattern, line 182 openers) —
 * the gate exposes/enforces it, it does not invent new style policy.
 *
 * `m` flag + (^|\n) anchor: a marker only counts at the START of a line/clause, where
 * 의식의 흐름 actually surfaces. Mid-sentence occurrences (e.g. a word that happens to
 * contain 음) do not trip.
 */
export const DRAMA_PATTERNS = [
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
];

/**
 * Scan a block of assistant prose for drama markers.
 *
 * @param {string} text - The assistant's user-facing text.
 * @returns {{ tripped: boolean, hits: Array<{rule: string, match: string}> }}
 */
export function scanStyleViolations(text) {
  if (!text || typeof text !== 'string') return { tripped: false, hits: [] };

  const hits = [];
  for (const { rule, re } of DRAMA_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      hits.push({ rule, match: m[0].trim().slice(0, 40) });
    }
  }
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
    // Grab from the "## 안티패턴" heading to the next "---" or "## " heading.
    const m = src.match(/##\s*안티패턴[^\n]*\n([\s\S]*?)(?:\n---|\n##\s|$)/);
    const body = m && m[1] ? m[1].trim() : '';
    return body || RUBRIC_FALLBACK;
  } catch {
    return RUBRIC_FALLBACK;
  }
}

/**
 * Read the Claude Code OAuth access token.
 *
 * Two sources, in order:
 *   1. ~/.claude/.credentials.json   (Linux / some setups)
 *   2. macOS Keychain item "Claude Code-credentials"  (darwin default — the file
 *      does NOT exist on macOS, which is why the old x-api-key/.credentials.json
 *      path silently failed here).
 *
 * Both yield the same JSON shape: { claudeAiOauth: { accessToken } }. The token is
 * an `sk-ant-oat01-*` OAuth token — it authenticates via `Authorization: Bearer`,
 * NOT `x-api-key` (which returns 401). See judgeStyle().
 *
 * @returns {string|null}
 */
function readOauthToken() {
  // 1) credentials file
  try {
    const credPath = join(process.env.HOME || '/root', '.claude', '.credentials.json');
    if (existsSync(credPath)) {
      const creds = JSON.parse(readFileSync(credPath, 'utf8'));
      const t = creds?.claudeAiOauth?.accessToken;
      if (t) return t;
    }
  } catch {
    // fall through to keychain
  }
  // 2) macOS Keychain (fixed command, no interpolation → no injection surface)
  if (process.platform === 'darwin') {
    try {
      const out = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const creds = JSON.parse(out);
      return creds?.claudeAiOauth?.accessToken || null;
    } catch {
      return null;
    }
  }
  return null;
}

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
  const token = opts.token || readOauthToken();
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
    '당신은 답변 문체 심판이다. 아래 금지 규칙을 어긴 **심한 위반만** 잡는다. ' +
    '미묘한 밀도/형식 문제는 통과(PASS)시킨다.\n\n' +
    `금지 규칙 (core/OUTPUT_STYLE.md 안티패턴):\n${rubric}\n\n` +
    '심한 위반의 예: 의식의 흐름·추임새("잠깐 —","음, 그러네"), 인위적 드라마(확신했다 곧장 뒤집기,"즉시 …한다"), 금지 오프너("좋은 질문입니다").\n\n' +
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
