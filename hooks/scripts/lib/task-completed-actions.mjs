#!/usr/bin/env node
'use strict';

/**
 * task-completed-actions.mjs
 *
 * Side-effect helpers invoked by `task-completed.mjs` when a task finishes.
 * Extracted into a library so the behavior is unit-testable without spawning
 * the hook as a subprocess.
 *
 * Responsibilities (closes the stale-pending drift gap):
 *  1. Append a row to `.qe/TASK_LOG.md` for the finished UUID (idempotent).
 *  2. Move `TASK_REQUEST_{uuid}.md` and `VERIFY_CHECKLIST_{uuid}.md`
 *     from `pending/` to `completed/` (idempotent).
 *  3. When completed/ count >= ARCHIVE_THRESHOLD, write
 *     `.qe/state/archive-needed.flag` so a future session can dispatch
 *     `Earchive-executor` without blocking the hook.
 *
 * All functions are safe to call with missing inputs; they return a summary
 * object describing what happened so the caller and tests can assert.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';

export const ARCHIVE_THRESHOLD = 10;

const TASK_LOG_HEADER = [
  '# Task Log',
  '',
  '| UUID | Task | Status | Phase |',
  '|------|------|--------|-------|',
].join('\n');

/**
 * Ensure a directory exists. Missing parents are created. Never throws for
 * benign EEXIST races.
 */
function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — recursive:true already handles EEXIST
  }
}

/**
 * Extract a human-readable task name from a `TASK_REQUEST_{uuid}.md` file.
 * The generator template writes the title on the first header line as
 * `# TASK_REQUEST_<uuid>.md — <title>`. Falls back to `null` if the file
 * does not exist or the line is unparseable.
 */
export function extractTaskNameFromRequest(requestPath) {
  if (!existsSync(requestPath)) return null;
  try {
    const first = readFileSync(requestPath, 'utf8').split('\n', 1)[0] || '';
    // Accept either em-dash or regular hyphen as the separator.
    const m = first.match(/^#\s+TASK_REQUEST_[^\s]+\s*[—\-]\s*(.+?)\s*$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a UUID already has a row in TASK_LOG.md. Used for
 * idempotency so re-delivering a TaskCompleted event cannot duplicate rows.
 */
export function taskLogHasUuid(logPath, uuid) {
  if (!uuid || !existsSync(logPath)) return false;
  try {
    const content = readFileSync(logPath, 'utf8');
    // Match "| <uuid> |" inside a table row; bare substring would also work
    // but the pipe bounds prevent false positives from prose mentions.
    return content.includes(`| ${uuid} |`);
  } catch {
    return false;
  }
}

/**
 * Append a completion row to `.qe/TASK_LOG.md`. Idempotent: re-entry with
 * the same uuid is a no-op. Creates the file with a header if missing.
 *
 * @returns {{appended: boolean, reason?: string}}
 */
export function appendTaskLogRow(cwd, { uuid, taskName, phase, status }) {
  if (!uuid) return { appended: false, reason: 'no-uuid' };

  const logPath = join(cwd, '.qe', 'TASK_LOG.md');

  if (taskLogHasUuid(logPath, uuid)) {
    return { appended: false, reason: 'already-logged' };
  }

  // Default display values so partial payloads still produce a valid row.
  const safeName = (taskName || '(unnamed task)').replace(/\|/g, '\\|');
  const safePhase = (phase || 'Auto-logged').replace(/\|/g, '\\|');
  // Default to '✅ complete' for the standard completion path (including
  // when the caller omits `status`). Any other explicit status (e.g.
  // 'failed', 'cancelled') is recorded verbatim so non-success events are
  // still auditable.
  const normalized = status || 'complete';
  const statusIcon = normalized === 'complete' || normalized === 'completed'
    ? '✅ complete'
    : normalized;

  const row = `| ${uuid} | ${safeName} | ${statusIcon} | ${safePhase} |`;

  let existing = '';
  if (existsSync(logPath)) {
    existing = readFileSync(logPath, 'utf8');
    // Preserve trailing newline behavior; ensure exactly one before append.
    if (!existing.endsWith('\n')) existing += '\n';
  } else {
    ensureDir(join(cwd, '.qe'));
    existing = TASK_LOG_HEADER + '\n';
  }

  writeFileSync(logPath, existing + row + '\n', 'utf8');
  return { appended: true };
}

/**
 * Move a single file if it exists. Idempotent — if the source is absent,
 * returns `{ moved: false, reason: 'missing' }`. Creates the destination
 * directory as needed.
 */
function moveIfExists(srcPath, destPath) {
  if (!existsSync(srcPath)) return { moved: false, reason: 'missing' };
  ensureDir(join(destPath, '..'));
  renameSync(srcPath, destPath);
  return { moved: true };
}

/**
 * Move TASK_REQUEST_{uuid}.md and VERIFY_CHECKLIST_{uuid}.md out of
 * `pending/` or `in-progress/` into `completed/`. Idempotent per file.
 *
 * @returns {{taskMoved: boolean, checklistMoved: boolean}}
 */
export function movePendingToCompleted(cwd, uuid) {
  if (!uuid) return { taskMoved: false, checklistMoved: false };

  const taskPending = join(cwd, '.qe', 'tasks', 'pending', `TASK_REQUEST_${uuid}.md`);
  const taskActive = join(cwd, '.qe', 'tasks', 'in-progress', `TASK_REQUEST_${uuid}.md`);
  const taskDst = join(cwd, '.qe', 'tasks', 'completed', `TASK_REQUEST_${uuid}.md`);
  const listPending = join(cwd, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${uuid}.md`);
  const listActive = join(cwd, '.qe', 'checklists', 'in-progress', `VERIFY_CHECKLIST_${uuid}.md`);
  const listDst = join(cwd, '.qe', 'checklists', 'completed', `VERIFY_CHECKLIST_${uuid}.md`);

  const taskResult = moveIfExists(existsSync(taskPending) ? taskPending : taskActive, taskDst);
  const listResult = moveIfExists(existsSync(listPending) ? listPending : listActive, listDst);

  return {
    taskMoved: taskResult.moved,
    checklistMoved: listResult.moved,
  };
}

/**
 * Count `TASK_REQUEST_*.md` files in `.qe/tasks/completed/`. Non-matching
 * entries are ignored so stray notes never trip the archive threshold.
 */
export function countCompletedTasks(cwd) {
  const dir = join(cwd, '.qe', 'tasks', 'completed');
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) =>
      /^TASK_REQUEST_.*\.md$/.test(name)
    ).length;
  } catch {
    return 0;
  }
}

/**
 * When the completed-task backlog crosses ARCHIVE_THRESHOLD, drop a flag
 * file that SessionStart can pick up to trigger Earchive-executor. Writing
 * a flag (instead of invoking archive inline) keeps the hook fast.
 *
 * @returns {{flagged: boolean, count: number}}
 */
export function maybeFlagArchive(cwd) {
  const count = countCompletedTasks(cwd);
  if (count < ARCHIVE_THRESHOLD) return { flagged: false, count };

  const stateDir = join(cwd, '.qe', 'state');
  ensureDir(stateDir);
  const flagPath = join(stateDir, 'archive-needed.flag');
  const payload = JSON.stringify(
    {
      created_at: new Date().toISOString(),
      completed_count: count,
      threshold: ARCHIVE_THRESHOLD,
      reason: 'task-completed-hook',
    },
    null,
    2
  );
  writeFileSync(flagPath, payload + '\n', 'utf8');
  return { flagged: true, count };
}

/**
 * Top-level orchestrator used by `task-completed.mjs`. Runs all three
 * side effects in order, tolerating missing inputs.
 *
 * @param {string} cwd  Project root.
 * @param {object} event Normalized event from the hook payload.
 *   { uuid, taskName?, phase?, status? }
 * @returns {object} Summary suitable for logging/testing.
 */
export function runTaskCompletedActions(cwd, event) {
  const uuid = event?.uuid || '';
  if (!uuid) {
    return {
      uuid: '',
      logAppended: false,
      taskMoved: false,
      checklistMoved: false,
      archiveFlagged: false,
      completedCount: 0,
    };
  }

  // Backfill task name from the active request before the move.
  let taskName = event.taskName;
  if (!taskName) {
    const pending = join(cwd, '.qe', 'tasks', 'pending', `TASK_REQUEST_${uuid}.md`);
    const active = join(cwd, '.qe', 'tasks', 'in-progress', `TASK_REQUEST_${uuid}.md`);
    taskName = extractTaskNameFromRequest(existsSync(pending) ? pending : active);
  }

  const log = appendTaskLogRow(cwd, {
    uuid,
    taskName,
    phase: event.phase,
    status: event.status || 'complete',
  });

  const moved = movePendingToCompleted(cwd, uuid);
  const archive = maybeFlagArchive(cwd);

  return {
    uuid,
    logAppended: log.appended,
    logReason: log.reason,
    taskMoved: moved.taskMoved,
    checklistMoved: moved.checklistMoved,
    archiveFlagged: archive.flagged,
    completedCount: archive.count,
  };
}
