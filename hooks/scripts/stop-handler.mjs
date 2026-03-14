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

// Check QE modes in priority order
const modes = [
  { name: 'qrun-task', label: 'Qrun-task 작업 실행 중' },
  { name: 'qrefresh', label: 'Erefresh-executor 분석 갱신 중' },
  { name: 'qarchive', label: 'Earchive-executor 아카이브 중' },
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

if (activeMode) {
  // Block stop and force continuation
  console.log(JSON.stringify({
    continue: false,
    decision: "block",
    reason: `[QE Framework] ${activeMode.label}. 작업을 계속합니다.`
  }));
} else {
  // No active mode, allow stop
  console.log(JSON.stringify({ continue: true }));
}
