#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';

try {
  const data = readStdinJson();
  if (!data) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  const cwd = getCwd();
  const agentName = data.agent_name || data.description || 'unknown';
  const resultStatus = data.result_status || 'completed';

  // Read unified state
  const state = readUnifiedState(cwd);

  // Initialize activeSubagents array if not present
  if (!state.activeSubagents) {
    state.activeSubagents = [];
  }

  // Find and remove the agent from activeSubagents
  const agentIndex = state.activeSubagents.findIndex(agent => agent.name === agentName);
  let duration = 0;

  if (agentIndex !== -1) {
    const agent = state.activeSubagents[agentIndex];
    const startedAt = new Date(agent.startedAt).getTime();
    duration = Date.now() - startedAt;
    state.activeSubagents.splice(agentIndex, 1);
  }

  // Initialize agentMetrics object if not present
  if (!state.agentMetrics) {
    state.agentMetrics = {};
  }

  // Update or create metrics for this agent
  const now = new Date().toISOString();
  if (state.agentMetrics[agentName]) {
    // Update existing metrics
    state.agentMetrics[agentName].lastDuration = duration;
    state.agentMetrics[agentName].lastStatus = resultStatus;
    state.agentMetrics[agentName].lastRun = now;
    state.agentMetrics[agentName].totalRuns = (state.agentMetrics[agentName].totalRuns || 1) + 1;
  } else {
    // Create new metrics
    state.agentMetrics[agentName] = {
      lastDuration: duration,
      lastStatus: resultStatus,
      lastRun: now,
      totalRuns: 1
    };
  }

  // Write unified state
  writeUnifiedState(cwd, state);

  // Return success response
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      additionalContext: `[QE] Subagent stopped: ${agentName} (${duration}ms, status: ${resultStatus})`
    }
  }));
} catch (err) {
  // Error handling: continue on failure
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

process.exit(0);
