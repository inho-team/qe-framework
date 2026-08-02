#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from './lib/qe-fs.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { parseHelpFlag } from './lib/help-flag-parser.mjs';
import { readCurrentSid, readCurrentSessionId } from './lib/session-resolver.mjs';
import { resolvePseStateHint } from './lib/pse-state-router.mjs';
import { renderSkillCommand } from '../../scripts/lib/interaction_adapter.mjs';
import { ensureQeProjectInstructions, isQeInstructionBootstrapCommand } from './lib/project-instructions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let input = '';
try {
  input = readFileSync('/dev/stdin', 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(input);
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// --- Fast-path: empty message early-exit (before config/state I/O) ---
const userMessage = data.user_message || data.message || '';
if (!userMessage || !userMessage.trim()) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || process.cwd();
const cfg = loadConfig(cwd);
const client = data.client || process.env.QE_CLIENT || 'claude';
const skillCommand = (skillName, args = '') => renderSkillCommand(skillName, args, { client });

// --- Load Unified State ---
const state = readUnifiedState(cwd);

const hints = [];
const msgLower = userMessage.toLowerCase();

// Explicit QE entry commands establish the project instruction contract before
// the skill body runs. This is deliberately narrow: ordinary goal-like prose
// keeps the existing fail-open, no-new-file behavior.
if (isQeInstructionBootstrapCommand(userMessage)) {
  try {
    const bootstrapped = ensureQeProjectInstructions(cwd, client);
    if (bootstrapped.errors.length > 0) {
      hints.push(`[QE] Instruction bootstrap incomplete: ${bootstrapped.errors.join(', ')}.`);
    }
  } catch {
    // A filesystem failure must never block the user's goal routing.
  }
}

// --- Goal Router (isolated fail-open adapter) ---
// Keep this entire route in one boundary: an import, resolver, state, or writer
// failure must have no new hint or state side effect.
try {
  const { createGoalRoute, issueGoalMarker } = await import('./lib/goal-router.mjs');
  const goalRoute = createGoalRoute(userMessage);
  if (goalRoute.detected) {
    const sessionId = data.session_id || data.sessionId || readCurrentSessionId(cwd) || readCurrentSid(cwd);
    // Markers are advisory workflow signals, not authorization; only router-owned
    // pipeline routes issue them, while direct/ordinary prompts retain no marker.
    if (sessionId && goalRoute.route === 'pipeline') {
      issueGoalMarker({ cwd, state, sessionId, route: goalRoute.route });
    }
    hints.push(goalRoute.instruction);
  } else if (goalRoute.usage) {
    hints.push(`[QE GOAL] ${goalRoute.instruction}`);
  }
} catch {
  // Goal routing is advisory; leave the established hook result untouched.
}

// --- Help Flag Detection (early, before other classifications) ---
const helpFlag = parseHelpFlag(userMessage);
if (helpFlag.matched) {
  hints.push(`[HELP] Invoke ${skillCommand(helpFlag.skillName)} and summarize that skill's own usage contract.`);
}

// --- QE Conventions Memory Check ---
// ... (omitted for brevity, assume unchanged until negative feedback) ...

// --- QE Conventions Memory Check ---
// If the user's auto-memory doesn't have qe_conventions_routing.md, hint Claude to read QE_CONVENTIONS.md
try {
  const home = process.env.HOME || '/root';
  const encodedCwd = cwd.replace(/\//g, '-');
  const memoryDir = join(home, '.claude', 'projects', encodedCwd, 'memory');
  const conventionsMemory = join(memoryDir, 'qe_conventions_routing.md');
  if (!existsSync(conventionsMemory)) {
    hints.push('[QE_CONVENTIONS] No routing rules in memory. Read QE_CONVENTIONS.md from the QE Framework plugin and save the Override Map + key skill routing table to auto-memory as a feedback type. File: find QE_CONVENTIONS.md in the project or plugin root.');
  }
} catch {
  // Fault-tolerant: skip on error
}

// --- Ambiguity Detection (BEFORE classification — short messages only) ---
const words = userMessage.trim().split(/\s+/);
let isAmbiguous = false;
if (words.length <= cfg.ambiguous_max_words && userMessage.length <= cfg.ambiguous_max_chars) {
  const ambiguousPatterns = [
    /^help\s*me$/i,
    /^fix\s*it$/i,
    /^make\s*it\s*better$/i,
    /^do\s*something$/i,
    /^change\s*this$/i,
    /^update\s*it$/i,
    /^improve\s*this$/i,
    /^clean\s*it\s*up$/i,
    /^just\s*do\s*it$/i,
    /^handle\s*it$/i,
  ];

  isAmbiguous = ambiguousPatterns.some(pattern => pattern.test(userMessage.trim()));
  if (isAmbiguous) {
    hints.push('Ambiguous request detected. Ask the user to clarify: what file, what behavior, what result?');
  }
}

// --- Negative Feedback Detection (save-to-memory hint) ---
if (!isAmbiguous && words.length > 5) {
  const koreanCorrection = /몇\s*번을?\s*말해|또\s*그러|아까\s*말했|이미\s*말했|반복하지|다시\s*말하|왜\s*안\s|하지\s*마|하지\s*말고|그만|안\s*된다고|몇\s*번이나/.test(userMessage);
  const englishCorrection = /\b(stop doing|don't do|never do|I already told|how many times|I said don't|stop repeating)\b/i.test(userMessage);

  // Exclude code blocks
  const hasCodeBlock = /```[\s\S]*```|`[^`]+`/.test(userMessage);

  if ((koreanCorrection || englishCorrection) && !hasCodeBlock) {
    hints.push('[FEEDBACK] User correction detected. Save this feedback to auto-memory as a feedback type memory so it persists across sessions. Extract the specific rule the user is enforcing.');
    // Persist feedback for follow-up enforcement
    state.pending_feedback = {
      message: userMessage,
      detected_at: new Date().toISOString(),
      acted: false
    };
    writeUnifiedState(cwd, state);
  }
}

// --- Strategic Planning Hint ---
if (!isAmbiguous) {
  const planKeywords = /\b(new project|start project|roadmap|milestone|planning|plan phase|architecture|overall|전략|계획|로드맵|마일스톤)\b/i;
  if (planKeywords.test(userMessage)) {
    hints.push(`[PLAN] Strategic roadmap detected. This project uses the PSE Loop (Plan-Spec-Execute). Run \`${skillCommand('Qplan')}\` first to establish/update the roadmap before Spec generation.`);
  }
}

// --- Behavioral Contexts (core/contexts/*.md) ---
// Each context file declares in its header the intent it activates on, but nothing
// ever loaded core/contexts/ — every one of them was an orphan (issue #16). Match
// the intent here and inject that file's Principles digest, so the guidelines reach
// the model on the turn they apply to. Full guidelines stay in the file; only the
// digest is injected to bound token cost.
//
// Keywords are deliberately narrow. A context that fires on an unrelated turn costs
// tokens and dilutes the hints that do matter, so prefer missing a turn over firing
// on every one. ("check" is intentionally absent from the review route for this
// reason — it is too common in ordinary conversation.)
const CONTEXT_ROUTES = [
  { label: 'DEV', file: 'dev.md', keywords: /\b(implement|build|create|add feature|refactor|구현|개발|만들어)\b/i },
  { label: 'DEBUG', file: 'debug.md', keywords: /\b(bug|error|not working|broken|crash|stack ?trace|버그|에러|오류|안 ?됨)\b/i },
  { label: 'REVIEW', file: 'review.md', keywords: /\b(review this|code review|audit|리뷰|검토해|감사해)\b/i },
  { label: 'RESEARCH', file: 'research.md', keywords: /\b(research|compare|evaluate|which is better|조사해|비교해)\b/i },
  { label: 'DEPLOY', file: 'deploy.md', keywords: /\b(deploy|release|ship it|배포|릴리스|릴리즈)\b/i },
];

for (const route of CONTEXT_ROUTES) {
  if (!route.keywords.test(userMessage)) continue;

  try {
    const contextPath = join(__dirname, '..', '..', 'core', 'contexts', route.file);
    if (!existsSync(contextPath)) continue;

    const contextDoc = readFileSync(contextPath, 'utf8');
    const principlesMatch = contextDoc.match(/## Principles\n([\s\S]*?)(?=\n## |\n---|$)/);
    if (!principlesMatch) continue;

    const principles = principlesMatch[1].trim().slice(0, 700);
    hints.push(`[${route.label} CONTEXT] ${principles} Full guidelines: core/contexts/${route.file}`);
  } catch {
    // fail-open: contexts are advisory, never block the prompt
  }
}

// --- Intent Auto-Classification (skip if ambiguous or help-flag matched) ---
if (!isAmbiguous && !helpFlag.matched) try {
  const routesConfig = JSON.parse(readFileSync(join(__dirname, 'lib', 'intent-routes.json'), 'utf8'));
  let bestMatch = null;
  let bestScore = 0;

  const hasCJK = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(userMessage);

  // Routing is deliberately local and deterministic. CJK terms live in the
  // route table; prompt admission never sends user text to a network service.
  const matchMsg = msgLower;
  const msgWords = matchMsg
    .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3\u4e00-\u9fff\u3040-\u30ff]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Build bigrams for contextual matching (e.g., "create skill" vs "create command")
  const msgBigrams = [];
  for (let i = 0; i < msgWords.length - 1; i++) {
    msgBigrams.push(msgWords[i] + ' ' + msgWords[i + 1]);
  }

  for (const [keywords, routeEntry] of Object.entries(routesConfig.routes)) {
    const target = typeof routeEntry === 'object' ? routeEntry.skill : routeEntry;
    const parts = keywords.split('/');
    let matchedParts = 0;
    let totalWeight = 0;

    for (const part of parts) {
      const term = part.toLowerCase().replace(/-/g, ' ');
      const termWords = term.split(/\s+/);
      const isCJKTerm = /[\u3131-\u318E\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(term);

      // CJK terms use substring matching with high weight (no word boundaries in CJK)
      if (isCJKTerm && hasCJK) {
        if (matchMsg.includes(term)) {
          matchedParts++;
          totalWeight += term.length * 3;  // CJK substring = 3x weight
          continue;
        }
        // Partial CJK match: check each word in the term
        const cjkWords = term.split(/\s+/);
        const partialMatch = cjkWords.some(w => w.length >= 2 && matchMsg.includes(w));
        if (partialMatch) {
          matchedParts += 0.7;
          totalWeight += term.length * 1.5;
          continue;
        }
        continue;
      }

      // Multi-word term: check bigram match first, then all-words fallback
      const bigramMatch = termWords.length === 2 && msgBigrams.includes(term);
      const allWordsMatch = !bigramMatch && termWords.length > 1 &&
        termWords.every(tw => msgWords.includes(tw) || matchMsg.includes(tw));

      // Single-word exact match. Multi-word route terms must match as phrases
      // or all words; otherwise broad fragments like "command" in
      // "create-command" drown out core PSE routes.
      const hasExactWord = termWords.length === 1 && termWords.some(tw => {
        if (tw.length <= 2) return false; // skip very short words
        return msgWords.includes(tw);
      });

      // Substring match — only for longer terms (4+ chars) to avoid false positives
      const hasSubstring = term.length >= 4 && matchMsg.includes(term);

      if (bigramMatch) {
        matchedParts++;
        totalWeight += term.length * 5;  // bigram exact = 5x weight (strongest signal)
      } else if (allWordsMatch && termWords.length > 1) {
        matchedParts++;
        totalWeight += term.length * 4;  // multi-word exact = 4x weight
      } else if (hasExactWord) {
        matchedParts++;
        totalWeight += term.length * 2;  // exact word match = 2x weight
      } else if (hasSubstring && !hasExactWord) {
        // Penalize substring-only matches for common short words
        const penalty = term.length < 6 ? 0.3 : 0.7;
        matchedParts += penalty;
        totalWeight += term.length * penalty;
      }
    }

    // Score = matched keyword ratio * total weight
    // Normalize by number of parts to favor routes where more keywords match
    const matchRatio = parts.length > 0 ? matchedParts / parts.length : 0;
    const score = matchedParts > 0 ? matchRatio * 5 + totalWeight : 0;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { intent: keywords, routed_to: target };
    }
  }

  // --- 3-Tier Confidence Classification ---
  const threshold = cfg.intent_confidence_threshold || 10;
  let confidence_level = 'LOW';
  if (bestScore >= threshold * 1.5) {
    confidence_level = 'HIGH';
  } else if (bestScore >= threshold) {
    confidence_level = 'MEDIUM';
  }

  if (bestMatch && confidence_level !== 'LOW') {
    state.intent_route = {
      intent: bestMatch.intent,
      routed_to: bestMatch.routed_to,
      confidence: bestScore,
      confidence_level: confidence_level,
      classified_at: new Date().toISOString()
    };
    writeUnifiedState(cwd, state);

    if (confidence_level === 'HIGH') {
      hints.push(`[INTENT] SKILL REQUIRED: Invoke ${skillCommand(bestMatch.routed_to)} BEFORE generating any response. Do NOT answer without the skill. (intent: ${bestMatch.intent})`);
    } else {
      hints.push(`[INTENT] Skill suggested: ${skillCommand(bestMatch.routed_to)} may be relevant to this request. (intent: ${bestMatch.intent}, confidence: MEDIUM)`);
    }
  }
} catch {
  // Fault-tolerant: skip classification on error
}

// --- PSE State Soft Hint ---
// This is deliberately weaker than explicit commands and hard intent routes.
// It only nudges the next PSE stage when the prompt is work-related and no
// stronger routing surface already owns the turn.
try {
  const hasExplicitSkillInvocation = /(?:^|\s)(?:\$|\/)(?:Q|M)[A-Za-z0-9-]+/i.test(userMessage);
  const hasHardIntentRoute = hints.some((hint) => hint.includes('SKILL REQUIRED'));
  const hasSafetyIntent = /\b(commit|push|version bump|bump version|context save|save state|handoff)\b|커밋|푸시|버전\s*올|버전\s*변경|컨텍스트\s*저장|상태\s*저장/i.test(userMessage);

  if (!isAmbiguous && !helpFlag.matched && !hasExplicitSkillInvocation && !hasHardIntentRoute && !hasSafetyIntent && !isGeneralNoRouteQuestion(userMessage)) {
    const stateHint = resolvePseStateHint(cwd, { sessionId: readCurrentSessionId(cwd) });
    if (stateHint?.message) {
      hints.push(`[PSE] ${stateHint.message}`);
    }
  }
} catch {
  // fail-open: state hints are advisory and must never block prompt handling
}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `[QE] ${hints.join(' | ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}

/**
 * Detects informational prompts that should not receive workflow nudges.
 * @param {string} message - User message.
 * @returns {boolean}
 */
function isGeneralNoRouteQuestion(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return false;
  if (/\b(next|continue|work|task|plan|spec|execute|verify|qe|skill|route|roadmap)\b|다음|계속|작업|계획|명세|실행|검증|스킬|라우팅/.test(text)) {
    return false;
  }
  return /^(what|who|when|where|why|how|tell me|explain|weather|joke)\b|오늘\s*날씨|농담|무엇|뭐야|누구|언제|어디|왜|어떻게/.test(text);
}
