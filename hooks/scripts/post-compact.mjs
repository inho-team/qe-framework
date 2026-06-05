#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);

try {
  const state = readUnifiedState(cwd);

  // Record last compaction timestamp
  state.lastCompaction = {
    timestamp: new Date().toISOString(),
    session_id: data.session_id || data.sessionId || 'unknown'
  };

  // Track compaction metrics if available
  if (!state.compactionMetrics) {
    state.compactionMetrics = { totalCompactions: 0 };
  }
  state.compactionMetrics.totalCompactions += 1;
  state.compactionMetrics.lastAt = state.lastCompaction.timestamp;

  writeUnifiedState(cwd, state);
} catch {
  // Fault tolerance — never crash the post-compact hook
}

console.log(JSON.stringify({ continue: true }));
