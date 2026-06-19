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

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);
const cfg = loadConfig(cwd);
const sessionId = data.session_id || null;

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

if (!activeMode && sweepAnnouncement) {
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
  console.log(JSON.stringify({ continue: true }));
}
