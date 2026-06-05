#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readStdinJson, getCwd } from './lib/state.mjs';
import { ensureSessionDirs, shortenSid } from './lib/session-resolver.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const cwd = getCwd(data);

// Read compaction settings from sivs-config.json
let compactionStrategy = 'auto';
try {
  const sivsPath = join(cwd, '.qe', 'sivs-config.json');
  if (existsSync(sivsPath)) {
    const sivsConfig = JSON.parse(readFileSync(sivsPath, 'utf8'));
    // Check any stage for compaction settings (use first found)
    for (const stage of ['spec', 'implement', 'verify', 'supervise']) {
      if (sivsConfig[stage]?.compaction?.strategy) {
        compactionStrategy = sivsConfig[stage].compaction.strategy;
        break;
      }
    }
  }
} catch {}

// Resolve the per-session context directory so the trigger file lands next
// to this terminal's snapshot/decisions, not in a shared flat path the next
// session-start would migrate away.
const sid = shortenSid(data.session_id || data.sessionId);
let contextDir;
try {
  contextDir = ensureSessionDirs(cwd, sid).contextDir;
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

const triggerPath = join(contextDir, 'compact-trigger.json');
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
  trigger.compaction_strategy = compactionStrategy;
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

const compactionHint = compactionStrategy === 'server'
  ? ' | [QE] Server-side compaction enabled'
  : '';

console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: `[QE] Compaction detected. Call Ecompact-executor to save current context under .qe/context/sessions/{sid}/. ${stateSummary} | ${postCompactRules}${compactionHint}`
  }
}));
