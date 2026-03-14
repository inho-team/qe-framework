#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
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

// Ensure .qe/context/ directory exists
const contextDir = join(cwd, '.qe', 'context');
if (!existsSync(contextDir)) {
  try {
    mkdirSync(contextDir, { recursive: true });
  } catch {
    // If we can't create the directory, just pass through
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }
}

// Write a compact-trigger file so Ecompact-executor knows to save
const triggerPath = join(cwd, '.qe', 'context', 'compact-trigger.json');
try {
  writeFileSync(triggerPath, JSON.stringify({
    triggered_at: new Date().toISOString(),
    session_id: data.session_id || data.sessionId || 'unknown',
    reason: 'pre-compact'
  }, null, 2));
} catch {
  // Silent failure
}

// Inject reminder to save context
console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: "[QE] Compaction 감지. Ecompact-executor를 호출하여 .qe/context/에 현재 맥락을 저장하세요."
  }
}));
