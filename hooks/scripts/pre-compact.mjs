#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readStdinJson, getCwd } from './lib/state.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);

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

// Collect modified files via git diff
let modifiedFiles = [];
try {
  const diffOutput = execSync('git diff --name-only 2>/dev/null', { cwd, timeout: 3000, encoding: 'utf8' });
  modifiedFiles = diffOutput.trim().split('\n').filter(Boolean);
} catch {}

// Collect in-progress tasks
const inProgressDir = join(cwd, '.qe', 'tasks', 'in-progress');
let activeTasks = [];
if (existsSync(inProgressDir)) {
  try {
    activeTasks = readdirSync(inProgressDir)
      .filter(f => f.startsWith('TASK_REQUEST_') && f.endsWith('.md'))
      .map(f => f.replace('TASK_REQUEST_', '').replace('.md', ''));
  } catch {}
}

// Count unchecked items in in-progress checklists
const checklistDir = join(cwd, '.qe', 'checklists', 'in-progress');
let uncheckedCount = 0;
if (existsSync(checklistDir)) {
  try {
    for (const f of readdirSync(checklistDir).filter(f => f.endsWith('.md'))) {
      const content = readFileSync(join(checklistDir, f), 'utf8');
      uncheckedCount += (content.match(/- \[ \]/g) || []).length;
    }
  } catch {}
}

// Update trigger with full state info
try {
  const trigger = JSON.parse(readFileSync(triggerPath, 'utf8'));
  trigger.modified_files = modifiedFiles.slice(0, 20);
  trigger.active_task_uuids = activeTasks;
  trigger.unchecked_items_count = uncheckedCount;
  writeFileSync(triggerPath, JSON.stringify(trigger, null, 2));
} catch {}

// POST-COMPACT RULES: include current route info only (no full route table)
let currentRouteInfo = '';
try {
  const intentRoutePath = join(cwd, '.qe', 'state', 'intent-route.json');
  if (existsSync(intentRoutePath)) {
    const routeData = JSON.parse(readFileSync(intentRoutePath, 'utf8'));
    if (routeData.routed_to && routeData.intent) {
      currentRouteInfo = ` | Current route: ${routeData.routed_to} (intent: ${routeData.intent})`;
    }
  }
} catch {
  // Fault tolerance — ignore read errors
}

const postCompactRules = `[POST-COMPACT RULES] Intent routing is auto-classified by UserPromptSubmit hook.${currentRouteInfo}`;

const modifiedSummary = modifiedFiles.length > 0
  ? `${modifiedFiles.length} (${modifiedFiles.slice(0, 5).join(', ')}${modifiedFiles.length > 5 ? '...' : ''})`
  : '0';
const stateSummary = `Modified files: ${modifiedSummary} | Active tasks: ${activeTasks.join(', ') || 'none'} | Unchecked items: ${uncheckedCount}`;

console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: `[QE] Compaction detected. Call Ecompact-executor to save current context to .qe/context/. ${stateSummary} | ${postCompactRules}`
  }
}));
