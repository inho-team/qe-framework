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
const hints = [];

// Extract notification info
// Claude Code Notification hook receives: message about agent/subagent completion
const message = data.message || data.notification || '';
const messageStr = typeof message === 'string' ? message : JSON.stringify(message);

// Agent completion chaining
if (messageStr.includes('Etask-executor') || messageStr.includes('task-executor')) {
  hints.push('[CHAIN] Etask-executor completed. Run Earchive-executor in background to archive completed tasks.');
}

if (messageStr.includes('Erefresh-executor') || messageStr.includes('refresh-executor')) {
  hints.push('Analysis updated by Erefresh-executor. Proceed with user\'s request using fresh .qe/analysis/ data.');
}

if (messageStr.includes('Ecompact-executor') || messageStr.includes('compact-executor')) {
  hints.push('Context saved by Ecompact-executor. Safe to continue. Use /Qresume in next session to restore.');
}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "Notification",
      additionalContext: `[QE] ${hints.join(' | ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
