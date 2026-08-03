#!/usr/bin/env node
'use strict';

import { readFileSync, existsSync } from './lib/qe-fs.mjs';
import { join } from 'path';
import { readStdinJson, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { runTaskCompletedActions } from './lib/task-completed-actions.mjs';
import { initMetrics, recordTaskCompletion, appendTelemetry } from './lib/metrics.mjs';
import { deliverOnce } from './lib/delivery-ledger.mjs';

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
  const pending = join(cwd, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${taskId}.md`);
  const active = join(cwd, '.qe', 'checklists', 'in-progress', `VERIFY_CHECKLIST_${taskId}.md`);
  const checklistPath = existsSync(pending) ? pending : active;
  if (existsSync(checklistPath)) {
    const content = readFileSync(checklistPath, 'utf8');
    const unchecked = (content.match(/- *\[ +\]/g) || []).length;
    if (unchecked > 0) {
      // TaskCompleted consumes exit-2 feedback from stderr; stdout JSON is ignored.
      console.error(`[QE Agent Teams] Task ${taskId} has ${unchecked} unchecked verification items. Complete verification before marking done.`);
      process.exit(2);
    }
  }
}

// Append TASK_LOG row and move pending→completed. The Stop sweep owns archive.
// Idempotent — safe to retry on duplicate TaskCompleted events.
let actionSummary = null;
try {
  const delivery = deliverOnce(cwd, {
    eventType: 'TaskCompleted', payload: data, effect: 'task-bookkeeping',
    run: () => runTaskCompletedActions(cwd, {
      uuid: taskId,
      taskName: data.task_name || data.taskName,
      phase: data.phase,
      status: data.status || 'complete',
    }),
  });
  actionSummary = delivery.value || null;
  if (actionSummary?.logAppended) {
    hints.push(`Logged task ${taskId} to .qe/TASK_LOG.md.`);
  }
} catch (err) {
  // Never let bookkeeping bugs block the hook's primary purpose.
  hints.push(`task-completed bookkeeping skipped: ${err?.message || err}`);
}

// Record harness metrics as separate effects so one failure cannot replay a
// previously successful sibling effect.
const attemptRaw = data.verification_attempt ?? data.verificationAttempt ?? data.attempt;
const attempt = Number(attemptRaw);
const validAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : null;
const isPassAt1 = validAttempt === null ? null : validAttempt === 1;
try {
  deliverOnce(cwd, {
    eventType: 'TaskCompleted', payload: data, effect: 'harness-metrics',
    run: () => {
      const metricsState = readUnifiedState(cwd);
      if (!metricsState.harnessMetrics) metricsState.harnessMetrics = initMetrics();
      recordTaskCompletion(metricsState.harnessMetrics, isPassAt1);
      writeUnifiedState(cwd, metricsState);
    },
  });
} catch {
  // Never let metrics bugs block the hook's primary purpose; replay can retry.
}

try {
  deliverOnce(cwd, {
    eventType: 'TaskCompleted', payload: data, effect: 'completion-telemetry',
    run: () => appendTelemetry(cwd, {
      eventType: 'task_completed',
      sessionId: data.session_id || data.sessionId || 'unknown',
      data: { passAt1: isPassAt1, verificationAttempt: validAttempt },
    }),
  });
} catch {
  // Never let telemetry bugs block the hook's primary purpose; replay can retry.
}

if (hints.length > 0) {
  console.log(JSON.stringify({ systemMessage: `[QE] ${hints.join(' ')}` }));
}
process.exit(0);
