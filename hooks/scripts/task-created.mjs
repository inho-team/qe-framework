#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { initMetrics } from './lib/metrics-collector.mjs';
import { appendTelemetry } from './lib/telemetry.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd();

try {
  const state = readUnifiedState(cwd);

  // Initialize harness metrics if not present
  if (!state.harnessMetrics) {
    state.harnessMetrics = initMetrics();
  }

  // Increment total task count
  state.harnessMetrics.tasksTotal += 1;

  writeUnifiedState(cwd, state);

  // Record telemetry event
  appendTelemetry(cwd, {
    eventType: 'task_created',
    sessionId: data.session_id || data.sessionId || 'unknown',
    data: { tasksTotal: state.harnessMetrics.tasksTotal }
  });
} catch {
  // Fault tolerance — never crash the task-created hook
}

console.log(JSON.stringify({ continue: true }));
