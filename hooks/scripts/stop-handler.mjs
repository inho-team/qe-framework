#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

const cwd = data.cwd || data.directory || process.cwd();
const stateDir = join(cwd, '.qe', 'state');

// Staleness threshold: 2 hours
const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Read a QE state file and check if it's active and not stale
 */
function readState(mode) {
  const filePath = join(stateDir, `${mode}-state.json`);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf8');
    const state = JSON.parse(raw);

    // Check staleness
    if (state.started_at) {
      const age = Date.now() - new Date(state.started_at).getTime();
      if (age > STALE_MS) return null; // Stale, ignore
    }

    if (state.active) return state;
    return null;
  } catch {
    return null;
  }
}

// Check QE modes in priority order
const modes = [
  { name: 'qrun-task', label: 'Qrun-task 작업 실행 중' },
  { name: 'qrefresh', label: 'Erefresh-executor 분석 갱신 중' },
  { name: 'qarchive', label: 'Earchive-executor 아카이브 중' },
];

let activeMode = null;
for (const mode of modes) {
  const state = readState(mode.name);
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
