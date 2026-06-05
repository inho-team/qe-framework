#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';

try {
  const data = readStdinJson();
  if (!data) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  const cwd = getCwd(data);

  // Read and update unified-state
  try {
    const unifiedState = readUnifiedState(cwd);

    // Record session ended timestamp
    unifiedState.sessionEndedAt = new Date().toISOString();

    // Clean up any residual activeSubagents
    if (unifiedState.activeSubagents && Array.isArray(unifiedState.activeSubagents)) {
      if (unifiedState.activeSubagents.length > 0) {
        unifiedState.activeSubagents = [];
      }
    }

    writeUnifiedState(cwd, unifiedState);
  } catch {
    // Fault tolerance — ignore unified-state errors
  }

  // Update current-session.json with endedAt timestamp
  try {
    const sessionPath = join(cwd, '.qe', 'state', 'current-session.json');
    if (existsSync(sessionPath)) {
      const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
      session.endedAt = new Date().toISOString();
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
    }
  } catch {
    // Fault tolerance — ignore current-session errors
  }

  // Silent handler — just continue
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
} catch {
  // Outer fallback — never let session-end crash
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
