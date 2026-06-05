#!/usr/bin/env node
'use strict';

import { readStdinJson, getCwd, readUnifiedState, writeUnifiedState } from './lib/state.mjs';

try {
  // Read stdin JSON
  const data = readStdinJson();

  if (!data) {
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  // Extract tool failure information
  const toolName = data.tool_name || data.toolName || '';
  const errorMessage = data.error || '';
  const durationMs = data.duration_ms || data.durationMs || 0;

  // Get working directory
  const cwd = getCwd();

  // Read unified state
  const state = readUnifiedState(cwd);

  // Initialize tool failure tracking if needed
  if (!state.toolFailure) {
    state.toolFailure = {};
  }

  // Truncate error message to 200 chars
  const truncatedError = errorMessage.length > 200
    ? errorMessage.slice(0, 200)
    : errorMessage;

  // Record the latest tool failure
  state.lastToolFailure = {
    tool: toolName,
    error: truncatedError,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
    count: 1
  };

  // Track failure streak
  if (!state.toolFailureStreak) {
    state.toolFailureStreak = {
      tool: toolName,
      count: 1
    };
  } else if (state.toolFailureStreak.tool === toolName) {
    // Same tool — increment streak
    state.toolFailureStreak.count += 1;
  } else {
    // Different tool — reset streak
    state.toolFailureStreak = {
      tool: toolName,
      count: 1
    };
  }

  // Write updated state
  try {
    writeUnifiedState(cwd, state);
  } catch {}

  // Check if streak >= 3 and emit additionalContext
  const streakCount = state.toolFailureStreak.count;

  if (streakCount >= 3) {
    console.log(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: `[QE] Tool failure streak detected: ${toolName} failed ${streakCount} times consecutively`
      }
    }));
  } else {
    console.log(JSON.stringify({ continue: true }));
  }

} catch {
  // Error handling — return continue:true and exit gracefully
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
