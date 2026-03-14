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
