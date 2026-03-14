#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteJson, getCwd } from './lib/state.mjs';

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

const cwd = getCwd(data);
const toolName = data.tool_name || data.toolName || '';
const isError = data.tool_response?.includes?.('error') ||
                data.tool_response?.includes?.('Error') ||
                data.tool_response?.includes?.('FAILED') ||
                (data.exit_code !== undefined && data.exit_code !== 0);

const hints = [];

// Track tool errors
const errorFile = join(cwd, '.qe', 'state', 'tool-errors.json');

if (isError) {
  let errorState = { errors: [], window_start: Date.now() };

  if (existsSync(errorFile)) {
    try {
      errorState = JSON.parse(readFileSync(errorFile, 'utf8'));
    } catch {}
  }

  // Reset window if older than 60 seconds
  if (Date.now() - errorState.window_start > 90000) {
    errorState = { errors: [], window_start: Date.now() };
  }

  errorState.errors.push({
    tool: toolName,
    timestamp: Date.now(),
    preview: String(data.tool_response || '').slice(0, 200)
  });

  try {
    atomicWriteJson(errorFile, errorState);
  } catch {}

  const consecutiveCount = errorState.errors.filter(e => e.tool === toolName).length;

  if (consecutiveCount >= 5) {
    hints.push(`${toolName} tool failed 5+ times. Try a different approach or ask the user.`);
  } else if (consecutiveCount >= 3) {
    hints.push(`${toolName} tool failed ${consecutiveCount} times consecutively. Analyze the root cause.`);
  }
} else {
  // Success - clear error tracking for this tool
  if (existsSync(errorFile)) {
    try {
      const errorState = JSON.parse(readFileSync(errorFile, 'utf8'));
      errorState.errors = errorState.errors.filter(e => e.tool !== toolName);
      atomicWriteJson(errorFile, errorState);
    } catch {}
  }
}

// Track tool call count for context estimation
const statsFile = join(cwd, '.qe', 'state', 'session-stats.json');
let stats = { tool_calls: 0, session_start: Date.now() };

if (existsSync(statsFile)) {
  try {
    stats = JSON.parse(readFileSync(statsFile, 'utf8'));
  } catch {}
}

stats.tool_calls = (stats.tool_calls || 0) + 1;
stats.last_tool = toolName;
stats.last_call = Date.now();

try {
  atomicWriteJson(statsFile, stats);
} catch {}

// Profile collection trigger every 50 tool calls
try {
  if (stats.tool_calls > 0 && stats.tool_calls % 20 === 0) {
    let safeToCollect = true;
    if (existsSync(errorFile)) {
      try {
        const errState = JSON.parse(readFileSync(errorFile, 'utf8'));
        const hasRecentErrors = Array.isArray(errState.errors) &&
          errState.errors.length > 0 &&
          (Date.now() - (errState.window_start || 0)) <= 90000;
        if (hasRecentErrors) safeToCollect = false;
      } catch {}
    }
    if (safeToCollect) {
      hints.push('Run Eprofile-collector in background to update command patterns.');
    }
  }
} catch {}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `[QE] ${hints.join(' ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
