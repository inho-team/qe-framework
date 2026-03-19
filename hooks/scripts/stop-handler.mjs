#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readState, readStdinJson, getCwd } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { captureFailure } from './lib/failure-capture.mjs';
import { appendRating } from './lib/rating-capture.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);
const cfg = loadConfig(cwd);
const sessionId = data.session_id || null;

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

// --- Failure Capture ---
if (!activeMode) {
  try {
    captureFailure(cwd);
  } catch {
    // Fault tolerance — never let failure capture crash the stop handler
  }
}

// --- Satisfaction Signal (opt-in) ---
// Only prompts when satisfaction_enabled is true in .qe/config.json
// appendRating(cwd, score) is called by /Qrating skill to persist to ratings.jsonl
// Note: satisfaction prompt is injected into hook output (not stderr) so Claude surfaces it to the user.
if (!activeMode && cfg.satisfaction_enabled) {
  try {
    // Write early so the prompt is shown before the stop handler exits.
    // We output this as a hookSpecificOutput to ensure Claude Code displays it.
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: [
          '[QE Satisfaction] 이번 세션은 어떠셨나요? 만족도를 알려주세요 (1-5).',
          '1=매우 불만족 2=불만족 3=보통 4=만족 5=매우 만족.',
          '"rating 4" 라고 입력하면 .qe/learning/signals/ratings.jsonl 에 기록됩니다.',
          'opt-out: .qe/config.json 에서 "satisfaction_enabled": false 설정',
        ].join(' '),
      },
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

    sessionLog.sessions.unshift({
      date: new Date().toISOString(),
      tool_calls: toolCalls,
      commits: commits,
      duration_ms: Date.now() - sessionStart
    });

    sessionLog.sessions = sessionLog.sessions.slice(0, cfg.session_log_max);

    writeFileSync(logPath, JSON.stringify(sessionLog, null, 2), 'utf8');
  } catch {
    // Fault tolerance — ignore session log errors
  }
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
