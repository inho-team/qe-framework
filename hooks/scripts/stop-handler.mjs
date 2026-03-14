#!/usr/bin/env node
'use strict';

import { readState, readStdinJson, getCwd } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);
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
    const maxReinforcements = state.max_reinforcements || 20;
    const reinforcements = state.reinforcement_count || 0;

    if (reinforcements >= maxReinforcements) {
      // Max reached, allow stop
      activeMode = null;
    }
    break;
  }
}

// --- Session Log Recording ---
if (!activeMode) {
  try {
    const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('fs');
    const { join } = await import('path');

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
      const { execSync } = await import('child_process');
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

    // Keep only last 20 sessions
    sessionLog.sessions = sessionLog.sessions.slice(0, 20);

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
