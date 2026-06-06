#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { appendTelemetry } from './lib/telemetry.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);

try {
  const state = readUnifiedState(cwd);

  state.lastStopFailure = {
    timestamp: new Date().toISOString(),
    error: data.error || 'unknown',
    stackTrace: data.stack_trace || data.stackTrace || null
  };

  writeUnifiedState(cwd, state);

  appendTelemetry(cwd, {
    eventType: 'stop_failure',
    sessionId: data.session_id || data.sessionId || 'unknown',
    data: { error: state.lastStopFailure.error }
  });
} catch {
  // Fault tolerance — never crash the stop-failure hook
}

console.log(JSON.stringify({ continue: true }));
