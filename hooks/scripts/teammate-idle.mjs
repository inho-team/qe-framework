#!/usr/bin/env node
'use strict';

import { readStdinJson } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const teammateName = data.teammate_name || 'unknown';
const tasksSummary = data.tasks_completed || 0;

// Check if teammate has unclaimed tasks remaining
const hints = [];
if (data.pending_tasks && data.pending_tasks > 0) {
  hints.push(`Teammate ${teammateName} idle with ${data.pending_tasks} pending tasks. Claim next task or report completion.`);
}

if (hints.length > 0) {
  // Exit code 2 = send feedback and keep teammate working
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      additionalContext: `[QE Agent Teams] ${hints.join(' ')}`
    }
  }));
  process.exit(2);
} else {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
