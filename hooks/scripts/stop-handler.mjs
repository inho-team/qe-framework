#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readState, readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { captureFailureQuietly } from './lib/failure-capture.mjs';
import { notify } from './lib/notify.mjs';
import { appendRating } from './lib/rating-capture.mjs';
import { isPersistentModeActiveFromState } from './lib/persistent-mode.mjs';
import {
  readRalphState,
  cleanupRalphState,
  checkRateLimit,
  recordCircuitBreaker,
  formatProgressMessage,
  generateReport,
} from './lib/ralph-state.mjs';
import { isAllComplete, parseChecklist } from './lib/checklist-parser.mjs';
import { analyze as sweepAnalyze } from './lib/sweep-analyzer.mjs';
import { execute as sweepExecute, executeVolatileOnly as sweepVolatileOnly } from './lib/sweep-executor.mjs';
import { extractLastAssistantText, scanStyleViolations, judgeStyle, loadStyleRubric } from './lib/style-gate.mjs';
import { shortenSid } from './lib/session-resolver.mjs';
import { cleanupStaleSessions, removeSession } from './lib/session-registry.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = data.cwd || data.directory || getCwd(data);
const cfg = loadConfig(cwd);
const sessionId = data.session_id || null;
const currentSid = shortenSid(sessionId || data.sessionId || null);

try {
  cleanupStaleSessions(cwd);
} catch {
  // Fault tolerance — registry cleanup must never block Stop.
}

function cleanupRegistryForAllowedStop() {
  try {
    if (currentSid) removeSession(cwd, currentSid);
    else cleanupStaleSessions(cwd);
  } catch {
    // Fault tolerance — registry cleanup must never block shutdown.
  }
}

// --- .qe sweep (auto-apply when cfg.sweep_auto, else volatile-only) ---
// Archive moves use deterministic signals (completed/ folders, fully-checked pairs,
// filename-embedded dates). Files go to .archive/vX.Y.Z/ — recoverable, not deleted.
// Opt-out: .qe/config.json { "hooks": { "sweep_auto": false } }
let sweepAnnouncement = null;
try {
  const plan = sweepAnalyze(cwd);
  if (cfg.sweep_auto && (plan.archive.length > 0 || plan.delete.length > 0)) {
    const res = sweepExecute(cwd, plan, { apply: true });
    const parts = [];
    if (res.moved.length > 0) parts.push(`archived ${res.moved.length} → .qe/.archive/${res.version}`);
    if (res.deleted.length > 0) parts.push(`purged ${res.deleted.length} volatile`);
    if (parts.length > 0) sweepAnnouncement = `[QE Sweep] ${parts.join(', ')}`;
  } else if (plan.delete.length > 0) {
    sweepVolatileOnly(cwd, plan);
  }
} catch {
  // Fault tolerance — never let sweep crash stop handler
}

// --- Ralph Mode Check (highest priority) ---
// Ralph mode: auto-loops PSE Chain until VERIFY_CHECKLIST is fully complete.
// Uses checklist completion as the stop criterion, protected by rate limit + circuit breaker.
let ralphActive = false;
let ralphBlockReason = null;
try {
  const ralphState = readRalphState(cwd);
  if (ralphState && ralphState.enabled && ralphState.taskSource) {
    // Check all safety limits first
    const rateCheck = checkRateLimit(cwd);
    const cb = ralphState.circuitBreaker || {};
    const cbTripped = (cb.consecutiveFailures || 0) >= (cb.maxConsecutiveFailures || 3);
    if (!rateCheck.allowed) {
      // Rate limit hit → abort loop with warning
      process.stderr.write(`[Ralph] Rate limit exceeded (${rateCheck.remaining}/h). Loop aborted. Resets in ${Math.round(rateCheck.resetIn/60000)}min.\n`);
      generateReport(cwd);
      cleanupRalphState(cwd);
    } else if (cbTripped) {
      // Circuit breaker tripped → abort loop with error
      process.stderr.write(`[Ralph] Circuit breaker tripped (${cb.consecutiveFailures} consecutive failures). Aborting loop.\n`);
      generateReport(cwd);
      cleanupRalphState(cwd);
    } else {
      // Check VERIFY_CHECKLIST completion
      const parsed = parseChecklist(ralphState.taskSource);
      if (parsed.total > 0 && parsed.remaining === 0) {
        // All items complete → final report + cleanup + allow stop
        process.stderr.write(`[Ralph] Complete — ${parsed.completed}/${parsed.total} tasks done\n`);
        generateReport(cwd);
        cleanupRalphState(cwd);
      } else if (parsed.total === 0) {
        // Checklist file missing or empty → safety abort
        process.stderr.write(`[Ralph] Checklist not readable (${ralphState.taskSource}). Aborting loop.\n`);
        cleanupRalphState(cwd);
      } else {
        // Items still remaining → block stop and reinforce
        ralphActive = true;
        const progressMsg = formatProgressMessage(cwd);
        ralphBlockReason = `[QE Ralph] ${progressMsg} — Continue with next remaining item from ${ralphState.taskSource}. Do not stop.`;
      }
    }
  }
} catch {
  // Fault tolerance — never let Ralph check crash the stop handler
}

if (ralphActive && ralphBlockReason) {
  console.log(JSON.stringify({
    continue: false,
    decision: "block",
    reason: ralphBlockReason
  }));
  process.exit(0);
}

// Check QE modes in priority order (ultra modes first)
const modes = [
  { name: 'ultrawork', label: 'Ultra Work — autonomous parallel execution in progress' },
  { name: 'ultraqa', label: 'Ultra QA — autonomous quality verification in progress' },
  { name: 'qrun-task', label: 'Qrun-task executing' },
  { name: 'qrefresh', label: 'Erefresh-executor updating analysis' },
  { name: 'qarchive', label: 'Earchive-executor archiving' },
];

let activeMode = null;
for (const mode of modes) {
  const state = readState(cwd, mode.name, sessionId);
  if (state) {
    activeMode = mode;

    // Check reinforcement count to prevent infinite loops
    const maxReinforcements = state.max_reinforcements || cfg.max_reinforcements;
    const reinforcements = state.reinforcement_count || 0;

    if (reinforcements >= maxReinforcements) {
      // Max reached, allow stop
      activeMode = null;
    }
    break;
  }
}

// --- Persistent Mode Check (unified-state.json) ---
// Persistent mode is a separate mechanism from the mode-state files above.
// It protects multi-step pipelines (SIVS loops, Wave execution, Qatomic-run)
// from premature stopping even when no dedicated *-state.json file exists.
if (!activeMode) {
  try {
    const unifiedState = readUnifiedState(cwd);
    const pm = isPersistentModeActiveFromState(unifiedState);
    if (pm.active) {
      // Increment reinforcement counter
      if (unifiedState.persistentMode) {
        const reinforcements = (unifiedState.persistentMode.reinforcements || 0) + 1;
        const maxReinforcements = cfg.max_reinforcements || 5;

        if (reinforcements < maxReinforcements) {
          unifiedState.persistentMode.reinforcements = reinforcements;
          try { writeUnifiedState(cwd, unifiedState); } catch {}
          activeMode = {
            name: 'persistent-mode',
            label: `Persistent Mode (${pm.mode}) — ${pm.reason}`
          };
        } else {
          // Max reinforcements reached — auto-exit persistent mode to prevent infinite loops
          delete unifiedState.persistentMode;
          try { writeUnifiedState(cwd, unifiedState); } catch {}
        }
      }
    }
  } catch {
    // Fault tolerance — never let persistent mode check crash the stop handler
  }
}

// --- Failure Capture ---
if (!activeMode) {
  try {
    captureFailureQuietly(cwd);
  } catch {
    // Fault tolerance — never let failure capture crash the stop handler
  }
}

// --- Completion webhook (opt-in, D022) — best-effort, never blocks the hook ---
// Fires only when stop is actually being allowed (no active mode). No-op unless
// QE_NOTIFY_WEBHOOK is set; failures are swallowed inside notify().
if (!activeMode) {
  try {
    await notify({ event: 'stop', summary: sweepAnnouncement || 'Session stopped.', cwd });
  } catch {
    // Fault tolerance — a notification must never crash the stop handler
  }
}

// --- Satisfaction Signal (opt-in) ---
// Only prompts when satisfaction_enabled is true in .qe/config.json
// appendRating(cwd, score) is called by /Qrating skill to persist to ratings.jsonl
// Stop hook schema only allows systemMessage; hookSpecificOutput is rejected here.
if (!activeMode && cfg.satisfaction_enabled) {
  try {
    cleanupRegistryForAllowedStop();
    console.log(JSON.stringify({
      continue: true,
      systemMessage: [
        '[QE Satisfaction] 이번 세션은 어떠셨나요? 만족도를 알려주세요 (1-5).',
        '1=매우 불만족 2=불만족 3=보통 4=만족 5=매우 만족.',
        '"rating 4" 라고 입력하면 .qe/learning/signals/ratings.jsonl 에 기록됩니다.',
        'opt-out: .qe/config.json 에서 "satisfaction_enabled": false 설정',
      ].join(' '),
    }));
    process.exit(0);
  } catch {
    // Fault tolerance — never let rating prompt crash the stop handler
  }
}

// --- Session Log Recording ---
if (!activeMode) {
  try {
    // Collect session stats
    const statsPath = join(cwd, '.qe', 'state', 'session-stats.json');
    let toolCalls = 0;
    let sessionStart = Date.now();
    if (existsSync(statsPath)) {
      try {
        const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
        toolCalls = stats.tool_calls || 0;
        sessionStart = stats.session_start || Date.now();
      } catch {}
    }

    // Collect recent commits
    let commits = [];
    try {
      const log = execSync('git log --oneline -5', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
      if (log) commits = log.split('\n');
    } catch {}

    // Write session log
    const contextDir = join(cwd, '.qe', 'context');
    mkdirSync(contextDir, { recursive: true });
    const logPath = join(contextDir, 'session-log.json');

    let sessionLog = { sessions: [] };
    if (existsSync(logPath)) {
      try {
        sessionLog = JSON.parse(readFileSync(logPath, 'utf8'));
        if (!Array.isArray(sessionLog.sessions)) sessionLog.sessions = [];
      } catch {}
    }

    // Read skills_used from session stats
    let skillsUsed = [];
    if (existsSync(statsPath)) {
      try {
        const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
        skillsUsed = stats.skills_used || [];
      } catch {}
    }

    sessionLog.sessions.unshift({
      date: new Date().toISOString(),
      tool_calls: toolCalls,
      commits: commits,
      skills_used: skillsUsed,
      duration_ms: Date.now() - sessionStart
    });

    sessionLog.sessions = sessionLog.sessions.slice(0, cfg.session_log_max);

    writeFileSync(logPath, JSON.stringify(sessionLog, null, 2), 'utf8');

    // --- Skill Usage Warnings ---
    const warnings = [];
    // Check if code changes exist but Qcommit was not called
    try {
      const diffStat = execSync('git diff --stat 2>/dev/null', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
      if (diffStat && !skillsUsed.some(s => s.includes('Qcommit') || s.includes('commit'))) {
        warnings.push('Code changes exist but Qcommit was not called this session.');
      }
    } catch {}
    // Long session without Qcompact
    if (toolCalls > 100 && !skillsUsed.some(s => s.includes('Qcompact') || s.includes('compact'))) {
      warnings.push('Long session (100+ tool calls) without Qcompact — context may have been lost.');
    }
    if (warnings.length > 0) {
      process.stderr.write(`[QE Session Summary] ${warnings.join(' ')}\n`);
    }
  } catch {
    // Fault tolerance — ignore session log errors
  }
}

// --- OUTPUT_STYLE drama gate (ADR-025 R3) ---
// 2-stage: Stage-1 regex pre-filter (cost 0) → only on a trip, Stage-2 Haiku judge
// against core/OUTPUT_STYLE.md's anti-patterns. Blocks the stop with a rewrite
// instruction on a SEVERE verdict. Loop guard: never re-block identical text, and at
// most style_gate_max_blocks distinct blocks per rolling window. Fail-open throughout.
if (!activeMode && cfg.style_gate !== false) {
  try {
    const text = extractLastAssistantText(data.transcript_path);
    const scan = scanStyleViolations(text);
    if (scan.tripped && text) {
      const st = readUnifiedState(cwd);
      const sg = st.styleGate || {};
      const hash = styleHash(text);
      const now = Date.now();
      const windowMs = cfg.style_gate_window_ms || 10 * 60 * 1000;
      const maxBlocks = cfg.style_gate_max_blocks || 2;

      // Rolling window reset
      let count = sg.count || 0;
      let windowStart = sg.windowStart || now;
      if (now - windowStart > windowMs) { count = 0; windowStart = now; }

      const sameText = sg.lastHash === hash;
      if (sameText) {
        // Already blocked this exact text — model isn't fixing it (or judge erred).
        // Allow stop to avoid an infinite loop; clear the marker.
        delete st.styleGate;
        try { writeUnifiedState(cwd, st); } catch {}
      } else if (count >= maxBlocks) {
        // Hit the per-window cap — give up, allow stop, warn on stderr.
        process.stderr.write(`[QE Style] Gate gave up after ${count} blocks this window. Allowing stop.\n`);
        delete st.styleGate;
        try { writeUnifiedState(cwd, st); } catch {}
      } else {
        const rubric = loadStyleRubric(cwd);
        const verdict = await judgeStyle(text, { rubric });
        if (verdict.severe) {
          st.styleGate = { lastHash: hash, count: count + 1, windowStart };
          try { writeUnifiedState(cwd, st); } catch {}
          console.log(JSON.stringify({
            continue: false,
            decision: 'block',
            reason: `[QE Style] ${verdict.reason || '문체 위반'} — core/OUTPUT_STYLE.md 위반. 의식의 흐름·추임새("잠깐 —","음,")·과장을 빼고, 결론부터 담백하게 다시 써라.`,
          }));
          process.exit(0);
        } else if (sg.lastHash) {
          // Judged clean → clear any stale marker so a later clean turn starts fresh.
          delete st.styleGate;
          try { writeUnifiedState(cwd, st); } catch {}
        }
      }
    }
  } catch {
    // Fault tolerance — the style gate must never crash the stop handler.
  }
}

if (!activeMode && sweepAnnouncement) {
  cleanupRegistryForAllowedStop();
  console.log(JSON.stringify({ continue: true, systemMessage: sweepAnnouncement }));
  process.exit(0);
}

if (activeMode) {
  // Block stop and force continuation
  console.log(JSON.stringify({
    continue: false,
    decision: "block",
    reason: `[QE Framework] ${activeMode.label}. Continuing work.`
  }));
} else {
  // No active mode, allow stop
  cleanupRegistryForAllowedStop();
  console.log(JSON.stringify({ continue: true }));
}

/**
 * Stable, dependency-free string hash (djb2) for the style-gate loop guard.
 * Identifies "the same blocked text" across consecutive stops without pulling in crypto.
 */
function styleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
