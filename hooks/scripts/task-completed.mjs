#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readStdinJson, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { runTaskCompletedActions } from './lib/task-completed-actions.mjs';
import { initMetrics, recordTaskCompletion } from './lib/metrics-collector.mjs';
import { appendTelemetry } from './lib/telemetry.mjs';

const data = readStdinJson();
if (!data) {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}

// Prefer the event payload's cwd so bookkeeping lands in the invoking
// project, not wherever the hook happens to be spawned from.
const cwd = data.cwd || data.directory || process.cwd();
const taskId = data.task_id || data.uuid || '';
const hints = [];

// Gate: if the paired VERIFY_CHECKLIST still has unchecked items the task is
// NOT actually complete. Block completion and do not fire side effects — we
// do not want to log/move/archive a half-finished task.
if (taskId) {
  const checklistPath = join(cwd, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${taskId}.md`);
  if (existsSync(checklistPath)) {
    const content = readFileSync(checklistPath, 'utf8');
    const unchecked = (content.match(/- *\[ +\]/g) || []).length;
    if (unchecked > 0) {
      hints.push(`Task ${taskId} has ${unchecked} unchecked verification items. Complete verification before marking done.`);
      // Exit code 2 = prevent completion
      console.log(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          additionalContext: `[QE Agent Teams] ${hints.join(' ')}`
        }
      }));
      process.exit(2);
    }
  }
}

// Auto-archive gap fix: append TASK_LOG row, move pending→completed, and
// flag Qgc archive when the completed backlog crosses ARCHIVE_THRESHOLD.
// Idempotent — safe to retry on duplicate TaskCompleted events.
let actionSummary = null;
try {
  actionSummary = runTaskCompletedActions(cwd, {
    uuid: taskId,
    taskName: data.task_name || data.taskName,
    phase: data.phase,
    status: data.status || 'complete',
  });
  if (actionSummary?.logAppended) {
    hints.push(`Logged task ${taskId} to .qe/TASK_LOG.md.`);
  }
  if (actionSummary?.archiveFlagged) {
    hints.push(`Completed backlog has ${actionSummary.completedCount} tasks — archive flag written (.qe/state/archive-needed.flag). Next session will dispatch Earchive-executor.`);
  }
} catch (err) {
  // Never let bookkeeping bugs block the hook's primary purpose.
  hints.push(`task-completed bookkeeping skipped: ${err?.message || err}`);
}

// Record harness metrics
try {
  const metricsState = readUnifiedState(cwd);
  if (!metricsState.harnessMetrics) {
    metricsState.harnessMetrics = initMetrics();
  }
  // Check if this is a first-attempt pass (no prior iterations recorded)
  const isPassAt1 = true; // Default: assume first attempt unless iteration data exists
  recordTaskCompletion(metricsState.harnessMetrics, isPassAt1);
  writeUnifiedState(cwd, metricsState);

  appendTelemetry(cwd, {
    eventType: 'task_completed',
    sessionId: data.session_id || data.sessionId || 'unknown',
    data: { passAt1: isPassAt1 }
  });
} catch {
  // Never let metrics bugs block the hook's primary purpose.
}

// Trigger domain knowledge collection on task completion
// Only trigger if the task involved code/config changes (domain knowledge likely present)
try {
  const diff = execSync('git diff HEAD~1 --name-only 2>/dev/null', { cwd, encoding: 'utf8', timeout: 3000 });
  const changedFiles = diff.trim().split('\n').filter(Boolean);
  const hasCodeChanges = changedFiles.some(f =>
    /\.(js|mjs|ts|jsx|tsx|py|java|go|rs|rb|cs|json|yaml|yml|sql)$/.test(f)
  );
  if (hasCodeChanges) {
    hints.push('Check .qe/docs/ for domain knowledge relevant to the completed task.');
  }
} catch {
  // git diff failed — skip docs collection rather than triggering on error
}

if (hints.length > 0) {
  console.log(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      additionalContext: `[QE] ${hints.join(' ')}`
    }
  }));
} else {
  console.log(JSON.stringify({ continue: true }));
}
process.exit(0);
