#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';

let data;
try {
  data = readStdinJson();
  if (!data) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd();

try {
  // Extract agent name and type
  const agentName = data.agent_name || data.description || 'unknown';
  const agentType = data.agent_type || data.subagent_type || 'general';

  // Read unified state
  const state = readUnifiedState(cwd);

  // Ensure activeSubagents array exists
  if (!state.activeSubagents) {
    state.activeSubagents = [];
  }

  // Add subagent entry
  state.activeSubagents.push({
    name: agentName,
    type: agentType,
    startedAt: new Date().toISOString()
  });

  // Write unified state
  writeUnifiedState(cwd, state);

  // Output success response
  const additionalContext = `[QE] Subagent started: ${agentName} (type: ${agentType})`;
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext
    }
  }));
} catch (err) {
  // Error handling - return continue: true to not block
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
