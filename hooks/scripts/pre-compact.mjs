#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// Scan for active tasks and include in trigger
const tasksDir = join(cwd, '.qe', 'tasks', 'pending');
const activeTasks = [];

if (existsSync(tasksDir)) {
  try {
    const files = readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      activeTasks.push(file.replace('.md', ''));
    }
  } catch {}
}

// Update trigger with task info
if (activeTasks.length > 0) {
  try {
    const trigger = JSON.parse(readFileSync(triggerPath, 'utf8'));
    trigger.active_tasks = activeTasks;
    writeFileSync(triggerPath, JSON.stringify(trigger, null, 2));
  } catch {}
}

// Inject reminder to save context
const taskInfo = activeTasks.length > 0 ? ` ${activeTasks.length} active task(s) need preservation.` : '';

// POST-COMPACT RULES: load from centralized config
let intentRouting = 'Intent routing: (config not found)';
let agentTiers = 'Agent tiers: (config not found)';
try {
  const routesConfig = JSON.parse(readFileSync(join(__dirname, 'lib', 'intent-routes.json'), 'utf8'));
  const routeEntries = Object.entries(routesConfig.routes).map(([k, v]) => `${k}→${v}`).join(', ');
  intentRouting = `Intent routing: ${routeEntries}`;
  const tierEntries = Object.entries(routesConfig.agent_tiers).map(([k, v]) => `${k.replace('_', '(')}${')'}=${v.join('/')}`).join(', ');
  agentTiers = `Agent tiers: ${tierEntries}`;
} catch {
  // Fallback: use minimal routing info
}

// Check current routing state
let currentRoute = '';
try {
  const intentRoutePath = join(cwd, '.qe', 'state', 'intent-route.json');
  if (existsSync(intentRoutePath)) {
    const routeData = JSON.parse(readFileSync(intentRoutePath, 'utf8'));
    if (routeData.routed_to && routeData.intent) {
      currentRoute = ` | Current route: ${routeData.routed_to} (intent: ${routeData.intent})`;
    }
  }
} catch {
  // Fault tolerance — ignore read errors
}

const postCompactRules = `[POST-COMPACT RULES] ${intentRouting} | ${agentTiers}${currentRoute}`;

console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: `[QE] Compaction detected. Call Ecompact-executor to save current context to .qe/context/.${taskInfo} | ${postCompactRules}`
  }
}));
