#!/usr/bin/env node
'use strict';

/**
 * verification-evidence-gate.mjs — R005 verification-evidence gate library.
 *
 * Exports:
 *   isCompletionClaim(text)          — true when text asserts completion/pass
 *   isAllowlistCommand(input)        — true when the command is on the evidence allowlist
 *   hasVerificationEvidence(events)  — true when same-turn events contain allowlist evidence
 *   evaluateEvidenceGate(cwd, text, transcriptPath)
 *                                    — top-level gate: { fire, reason }
 *
 * Design principles:
 *   - Claim detection uses word-boundary / Korean clause-boundary regexes.
 *     Negation patterns and code-fence/quote embedding are excluded before matching.
 *   - Evidence scope = same-turn (after the last real human user message),
 *     identical boundary to extractLastAssistantText in style-gate.mjs.
 *   - Allowlist is closed-world: only canonical framework checks and recognized
 *     test-runner command families match.
 *   - Fail-open everywhere: any parse/IO error returns fire=false so the gate
 *     can never hard-crash the Stop hook.
 *   - The completionLike export replaces the inline regex in evaluateCodeRiskReportGate
 *     in stop-handler.mjs; that function must import from here, not maintain a
 *     parallel matcher.
 *
 * Attribution: methodology adapted from obra/superpowers verification-before-completion
 * (MIT License, 2024). Rewritten in QE/SIVS terminology without copying original prose.
 */

import { readFileSync, existsSync } from './qe-fs.mjs';
import { execSync } from 'child_process';

// ── Completion/pass claim matcher ─────────────────────────────────────────────
//
// Each pattern targets a word/clause boundary so that partial words don't fire.
// Korean patterns use a negative-lookahead for negation suffixes; English patterns
// use \b and negative lookahead for "not".
//
// Negative fixtures that MUST NOT fire (verified in test):
//   "완료하지 못했습니다" / "완료되지 않았"   — negated Korean
//   code-fence or quote-embedded completion phrases  — structural embedding
//   "not complete"                                   — English negation

/** @type {RegExp[]} */
const COMPLETION_PATTERNS = [
  // Korean: 완료 — but not when preceded by 미 (incomplete prefix) or followed by negation particles
  /(?<![하되못않안미])(완료|구현\s*완료|검증\s*완료|작업\s*완료)(?!\s*(하지|되지|못|않|안))/u,
  // Korean: 끝났 (ended/done) — not negated
  /끝났(?!\s*(지만|을까|어도))/u,
  // Korean: 통과 (pass/through) in a verdict context
  /(?:검증|테스트)\s*통과(?!\s*(하지|못|안))/u,
  // English: complete/completed/finished — word-boundary, not preceded by "not"
  /(?<!\bnot\s)\b(complete[ds]?|all\s+done|finished)\b/i,
  // English: bare "done" — word-boundary, not preceded by "not", not followed by hyphen (e.g. "done-state")
  /(?<!\bnot\s)\bdone\b(?!-)/i,
  // English: "Quality Verification Complete", "Final status", etc.
  /\b(Quality Verification Complete|Final status)\b/i,
];

/**
 * Return true if `text` makes a completion/pass claim that would trigger the gate.
 *
 * Exclusions applied before pattern matching:
 *   1. Code-fence content (``` … ```) is stripped — completion phrases inside fences are docs.
 *   2. Inline backtick spans (`…`) are stripped.
 *   3. Quoted strings ("…" / '…' / 「…」/ 「…」) are stripped.
 *   4. Negation-prefixed Korean: "완료하지 못했", "완료되지 않았" checked in patterns above.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isCompletionClaim(text) {
  if (!text || typeof text !== 'string') return false;

  // Strip code fences (``` … ```) to avoid matching phrases inside code blocks
  const stripped = text
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`\n]*`/g, '')        // inline code spans
    .replace(/"[^"\n]{0,200}"/g, '')  // double-quoted strings (bounded to avoid catastrophic backtrack)
    .replace(/'[^'\n]{0,200}'/g, '')  // single-quoted strings
    .replace(/「[^」\n]{0,200}」/g, '')// CJK 「quotes」
    .replace(/『[^』\n]{0,200}』/g, '');// CJK 『quotes』

  for (const re of COMPLETION_PATTERNS) {
    if (re.test(stripped)) return true;
  }
  return false;
}

// ── Allowlist command matcher ─────────────────────────────────────────────────
//
// Closed-world list. Only single leading `cd X &&` strip is applied; no multi-hop,
// npm --prefix, subshell, or chained commands are accepted.

const ALLOWLIST_EXACT = [
  'npm run qe:validate',
  'node scripts/check-all.mjs',
];

const ALLOWLIST_PREFIX_RE = /^node\s+--test\s+\S/;
const BEHAVIORAL_COMMANDS = [
  /^(?:python(?:3(?:\.\d+)?)?\s+-m\s+pytest|pytest)(?:\s+\S.*)?$/,
  /^go\s+test(?:\s+\S.*)?$/,
  /^cargo\s+test(?:\s+\S.*)?$/,
  /^dotnet\s+test(?:\s+\S.*)?$/,
  /^(?:\.\/)?(?:gradle|gradlew)\s+test(?:\s+\S.*)?$/,
  /^(?:\.\/)?(?:mvn|mvnw)\s+test(?:\s+\S.*)?$/,
  /^(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?::[A-Za-z0-9_.-]+)?(?:\s+\S.*)?$/,
  /^bundle\s+exec\s+rspec(?:\s+\S.*)?$/,
];
const UNSAFE_SHELL_RE = /(?:&&|\|\||[;|<>`]|\$\(|[\r\n])/;

/**
 * Classify a command by the kind of assurance it provides.
 *
 * `qe:validate` and `check-all` prove repository/configuration structure. A
 * focused `node --test` run exercises behavior and is therefore the minimum
 * evidence accepted for a completion claim when code files changed.
 *
 * @param {string} input
 * @returns {'structural'|'behavioral'|null}
 */
export function evidenceCommandKind(input) {
  if (!input || typeof input !== 'string') return null;
  const cmd = stripCdPrefix(input).trim();
  if (ALLOWLIST_EXACT.includes(cmd)) return 'structural';
  if (!UNSAFE_SHELL_RE.test(cmd) && (ALLOWLIST_PREFIX_RE.test(cmd)
      || BEHAVIORAL_COMMANDS.some(pattern => pattern.test(cmd)))) {
    return 'behavioral';
  }
  return null;
}

/** @param {string} input @returns {boolean} */
export function isBehavioralEvidenceCommand(input) {
  return evidenceCommandKind(input) === 'behavioral';
}

/**
 * Strip a single leading `cd <dir> &&` prefix from a command string.
 * Only matches exactly one `cd X &&` at the start; anything more complex is left as-is.
 *
 * @param {string} cmd
 * @returns {string}
 */
function stripCdPrefix(cmd) {
  if (typeof cmd !== 'string') return '';
  return cmd.replace(/^cd\s+\S+\s*&&\s*/, '').trim();
}

/**
 * Return true if the command (after stripping one leading `cd X &&`) is on the allowlist.
 *
 * After the cd-strip and allowlist match, the command must NOT contain a trailing compound
 * operator (`&&`, `||`, `;`) beyond the matched command itself.  For example,
 * `node --test x || true` is NOT evidence because an unknown secondary command follows.
 * ALLOWLIST_EXACT entries are full-string matches, so no remainder can exist — they are
 * implicitly safe.  The prefix regex for `node --test <path>` does require an explicit
 * compound-operator check (F3).
 *
 * @param {string} input - Raw command string from a Bash tool_use input.
 * @returns {boolean}
 */
export function isAllowlistCommand(input) {
  return evidenceCommandKind(input) !== null;
}

/**
 * Return true if `text` (Agent toolUseResult body) contains a trace of an allowlist
 * command execution plus a PASS/FAIL summary line.
 * This is the Agent-result variant of the allowlist check: the result text must
 * contain the command name (so we can identify what ran) plus some outcome indicator.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function agentResultContainsTrace(text, { requireBehavioral = false } = {}) {
  if (!text || typeof text !== 'string') return false;

  // Check that at least one allowlist command name appears in the text
  const hasStructuralCmd =
    /npm\s+run\s+qe:validate/.test(text) ||
    /node\s+scripts\/check-all\.mjs/.test(text);
  const hasBehavioralCmd = /node\s+--test\s+\S/.test(text);
  const hasPortableBehavioralCmd = /(?:pytest|python\S*\s+-m\s+pytest|go\s+test|cargo\s+test|dotnet\s+test|(?:gradle|gradlew|mvn|mvnw)\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test|bundle\s+exec\s+rspec)/.test(text);
  const hasCmd = requireBehavioral ? hasBehavioralCmd || hasPortableBehavioralCmd
    : hasStructuralCmd || hasBehavioralCmd || hasPortableBehavioralCmd;

  if (!hasCmd) return false;

  // Check that a PASS or FAIL outcome indicator also appears
  const hasOutcome = /\b(PASS|FAIL|passed|failed|✓|✗|all\s+tests?\s+pass)/i.test(text);
  return hasOutcome;
}

// ── Same-turn transcript parser ───────────────────────────────────────────────
//
// Reads transcript events after the last real human user message (same boundary
// as extractLastAssistantText in style-gate.mjs). Returns the raw event objects
// from that slice.

/**
 * Decide whether an event is a real human user turn (not a tool_result pseudo-user).
 * Mirrors isHumanUserLine in style-gate.mjs.
 *
 * @param {object} obj
 * @returns {boolean}
 */
function isHumanUserLine(obj) {
  if (!obj || obj.type !== 'user') return false;
  const c = obj.message?.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return c.some((b) => b && b.type === 'text');
  return false;
}

/**
 * Parse a transcript JSONL file and return only the events that appear after the
 * last real human user message. Returns [] on any error (fail-open).
 *
 * @param {string} transcriptPath
 * @returns {object[]}
 */
export function parseSameTurnEvents(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return [];
  if (!existsSync(transcriptPath)) return [];

  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const parsed = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      parsed.push(JSON.parse(t));
    } catch {
      // skip malformed lines
    }
  }
  if (parsed.length === 0) return [];

  // Find the last human user turn
  let lastUserIdx = -1;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (isHumanUserLine(parsed[i])) {
      lastUserIdx = i;
      break;
    }
  }

  return parsed.slice(lastUserIdx + 1);
}

// ── Evidence judge ────────────────────────────────────────────────────────────

/**
 * Scan same-turn events for verification evidence.
 *
 * Evidence types:
 *   - Bash toolUseResult: `is_error` absent AND `interrupted !== true`, with allowlist cmd.
 *     Correlated by tool_use_id to a Bash tool_use block (see _hasBashAllowlistSuccess).
 *   - Task/Agent toolUseResult: result text contains allowlist command trace + PASS/FAIL summary.
 *     Trace-based evidence is ONLY accepted when the paired tool_use name is 'Task' or 'Agent'.
 *     A non-Agent tool result (e.g. Read/Bash cat output) containing a trace string is NOT evidence.
 *
 * @param {object[]} events - Same-turn transcript events.
 * @returns {boolean}
 */
export function hasVerificationEvidence(events, { requireBehavioral = false } = {}) {
  if (!Array.isArray(events) || events.length === 0) return false;

  // Build a map from tool_use_id → tool_use name so we can gate trace-based evidence
  // to Task/Agent tool results only (F1: spoof prevention).
  /** @type {Map<string, string>} */
  const toolUseNames = new Map();
  for (const ev of events) {
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block?.id) {
        toolUseNames.set(block.id, block.name || '');
      }
    }
  }

  // Pass: check Agent/Task tool_result blocks for trace-based evidence.
  // Only tool results whose paired tool_use name is 'Task' or 'Agent' may use the trace check.
  for (const ev of events) {
    if (ev.type !== 'user') continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    // Real-transcript shape: top-level toolUseResult carries interrupted flag.
    const topLevelInterrupted = ev.toolUseResult?.interrupted === true;
    for (const block of content) {
      if (block?.type !== 'tool_result') continue;
      // Unit-fixture shape: block.interrupted; real shape: ev.toolUseResult.interrupted.
      if (block.is_error || block.interrupted === true || topLevelInterrupted) continue;
      const pairedName = toolUseNames.get(block.tool_use_id) || '';
      const isAgentTool = pairedName === 'Task' || pairedName === 'Agent';
      if (!isAgentTool) continue;
      const resultText = Array.isArray(block.content)
        ? block.content.filter(b => b?.type === 'text').map(b => b.text || '').join('\n')
        : typeof block.content === 'string' ? block.content : '';
      if (agentResultContainsTrace(resultText, { requireBehavioral })) return true;
    }
  }

  // Pass: correlate Bash tool_use → tool_result pairs via allowlist + success check.
  return _hasBashAllowlistSuccess(events, { requireBehavioral });
}

/**
 * Correlate Bash tool_use calls (allowlist) with their paired tool_result successes.
 *
 * Success means: is_error absent AND not interrupted. Two transcript shapes are checked:
 *
 *   Unit-fixture shape (lab/test JSONL):
 *     The `tool_result` content block carries `block.interrupted = true` directly.
 *
 *   Real-transcript shape (60-transcript audit, 1019 hits):
 *     `interrupted` lives at the top-level `toolUseResult.interrupted` on the user event,
 *     never inside the content block. Each user event carries one `toolUseResult` object
 *     (with `stdout`, `stderr`, `interrupted`, ...) parallel to its `message.content` array.
 *
 * Both shapes are checked so the gate works correctly against both test fixtures and
 * real session transcripts.
 *
 * @param {object[]} events
 * @returns {boolean}
 */
function _hasBashAllowlistSuccess(events, { requireBehavioral = false } = {}) {
  // Collect tool_use_id → command for Bash allowlist calls
  const allowlistIds = new Set();

  for (const ev of events) {
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type === 'tool_use' && block?.name === 'Bash') {
        const cmd = block?.input?.command || block?.input?.cmd || '';
        if (isAllowlistCommand(cmd) && (!requireBehavioral || isBehavioralEvidenceCommand(cmd))) {
          const id = block.id || block.tool_use_id;
          if (id) allowlistIds.add(id);
        }
      }
    }
  }

  if (allowlistIds.size === 0) return false;

  // Now scan for paired tool_result with success
  for (const ev of events) {
    if (ev.type !== 'user') continue;
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;

    // Real-transcript shape: top-level toolUseResult carries interrupted flag.
    const topLevelInterrupted = ev.toolUseResult?.interrupted === true;

    for (const block of content) {
      if (block?.type !== 'tool_result') continue;
      const resultId = block.tool_use_id;
      if (!allowlistIds.has(resultId)) continue;
      // Unit-fixture shape: block.interrupted; real shape: ev.toolUseResult.interrupted.
      // is_error lives inside the block for both shapes.
      if (!block.is_error && block.interrupted !== true && !topLevelInterrupted) return true;
    }
  }

  return false;
}

// ── Top-level gate ────────────────────────────────────────────────────────────

/**
 * Evaluate the verification-evidence gate.
 *
 * Preconditions (checked inside):
 *   1. text is a completion/pass claim (isCompletionClaim)
 *   2. cwd has changed code files (changedCodeFiles > 0)
 *   3. same-turn events lack allowlist evidence
 *
 * @param {string} cwd
 * @param {string} text                   - Last assistant text (already extracted by caller).
 * @param {string} transcriptPath         - Path to transcript JSONL (used only when parsedEvents is absent).
 * @param {Function} [changedCodeFilesFn] - Injected for tests; defaults to the real helper.
 * @param {object[]} [parsedEvents]       - Pre-parsed same-turn events from the caller (F2: avoids
 *                                          a second full transcript read).  When supplied,
 *                                          transcriptPath is ignored for event parsing.
 *                                          Optional; when absent the function falls back to
 *                                          parseSameTurnEvents(transcriptPath) internally.
 * @returns {{ fire: boolean, reason: string }}
 */
export function evaluateEvidenceGate(cwd, text, transcriptPath, changedCodeFilesFn, parsedEvents) {
  try {
    if (!text || typeof text !== 'string') return { fire: false, reason: '' };
    if (!isCompletionClaim(text)) return { fire: false, reason: '' };

    const ccf = changedCodeFilesFn || changedCodeFiles;
    const files = ccf(cwd);
    if (files.length === 0) return { fire: false, reason: '' };

    // Use pre-parsed events when available (F2: zero extra reads); fall back to internal parse.
    const events = Array.isArray(parsedEvents)
      ? parsedEvents
      : parseSameTurnEvents(transcriptPath);
    if (hasVerificationEvidence(events, { requireBehavioral: true })) return { fire: false, reason: '' };

    return {
      fire: true,
      reason: 'verification-evidence-missing',
    };
  } catch {
    // Fail-open: any error means the gate does NOT fire
    return { fire: false, reason: '' };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the list of changed code files in the given working directory.
 * Mirrors the implementation in stop-handler.mjs (shared logic, no import cycle).
 *
 * @param {string} cwd
 * @returns {string[]}
 */
function changedCodeFiles(cwd) {
  const commands = [
    'git diff --name-only',
    'git diff --name-only --cached',
    'git ls-files --others --exclude-standard',
  ];
  const names = new Set();
  for (const cmd of commands) {
    try {
      const out = execSync(cmd, { cwd, encoding: 'utf8', timeout: 3000 });
      for (const line of out.split('\n')) {
        const name = line.trim();
        if (name) names.add(name);
      }
    } catch {}
  }
  const codeLike = /\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte)$/i;
  return [...names].filter(name => codeLike.test(name));
}
