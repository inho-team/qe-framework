#!/usr/bin/env node

/**
 * task-completed.test.mjs
 *
 * Covers the auto-archive gap fix: ensures the task-completed action
 * helpers append a TASK_LOG row, move pending→completed file pairs, and
 * write the archive flag only when thresholds are met — idempotently.
 *
 * Run with: node --test hooks/scripts/lib/__tests__/task-completed.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runTaskCompletedActions,
  appendTaskLogRow,
  movePendingToCompleted,
  maybeFlagArchive,
  countCompletedTasks,
  ARCHIVE_THRESHOLD,
} from '../task-completed-actions.mjs';

/**
 * Build a minimal `.qe/` layout inside a fresh temp directory so each test
 * case runs in isolation. Returns the project root path; caller uses
 * `t.after` to clean up.
 */
function mkproject() {
  const root = mkdtempSync(join(tmpdir(), 'qe-task-completed-'));
  mkdirSync(join(root, '.qe', 'tasks', 'pending'), { recursive: true });
  mkdirSync(join(root, '.qe', 'tasks', 'in-progress'), { recursive: true });
  mkdirSync(join(root, '.qe', 'tasks', 'completed'), { recursive: true });
  mkdirSync(join(root, '.qe', 'checklists', 'pending'), { recursive: true });
  mkdirSync(join(root, '.qe', 'checklists', 'in-progress'), { recursive: true });
  mkdirSync(join(root, '.qe', 'checklists', 'completed'), { recursive: true });
  return root;
}

/**
 * Seed a TASK_REQUEST / VERIFY_CHECKLIST pair in the pending directories.
 * Mirrors the layout produced by /Qgenerate-spec.
 */
function seedPendingPair(root, uuid, title = 'Sample task') {
  writeFileSync(
    join(root, '.qe', 'tasks', 'pending', `TASK_REQUEST_${uuid}.md`),
    `# TASK_REQUEST_${uuid}.md — ${title}\n\nbody\n`,
    'utf8'
  );
  writeFileSync(
    join(root, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${uuid}.md`),
    `# VERIFY_CHECKLIST_${uuid}.md\n\n- [x] verified\n`,
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// Case 1: fresh uuid — appends log row and moves both files.
// ---------------------------------------------------------------------------

test('task-completed: fresh uuid appends TASK_LOG row and moves both files', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const uuid = 'abc12345';
  seedPendingPair(root, uuid, 'Fix the drift gap');

  const summary = runTaskCompletedActions(root, {
    uuid,
    phase: 'Phase 3.2',
    status: 'complete',
  });

  assert.equal(summary.logAppended, true, 'log row should be appended');
  assert.equal(summary.taskMoved, true, 'TASK_REQUEST should move');
  assert.equal(summary.checklistMoved, true, 'VERIFY_CHECKLIST should move');

  // TASK_LOG content check — row must carry the extracted title + phase.
  const logContent = readFileSync(join(root, '.qe', 'TASK_LOG.md'), 'utf8');
  assert.match(logContent, /\| UUID \| Task \| Status \| Phase \|/);
  assert.match(logContent, new RegExp(`\\| ${uuid} \\|`));
  assert.match(logContent, /Fix the drift gap/);
  assert.match(logContent, /Phase 3\.2/);

  // Files physically moved — pending empty, completed populated.
  assert.equal(
    existsSync(join(root, '.qe', 'tasks', 'pending', `TASK_REQUEST_${uuid}.md`)),
    false
  );
  assert.equal(
    existsSync(join(root, '.qe', 'tasks', 'completed', `TASK_REQUEST_${uuid}.md`)),
    true
  );
  assert.equal(
    existsSync(join(root, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${uuid}.md`)),
    false
  );
  assert.equal(
    existsSync(join(root, '.qe', 'checklists', 'completed', `VERIFY_CHECKLIST_${uuid}.md`)),
    true
  );
});

// ---------------------------------------------------------------------------
// Case 2: already-logged uuid — second invocation is a no-op (idempotent).
// ---------------------------------------------------------------------------

test('task-completed: re-invocation with same uuid is idempotent', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const uuid = 'dup99999';
  seedPendingPair(root, uuid, 'Already logged');

  const first = runTaskCompletedActions(root, { uuid, status: 'complete' });
  assert.equal(first.logAppended, true);
  assert.equal(first.taskMoved, true);

  // Seed the pending copy again to simulate any replay path — the log
  // entry should still refuse to duplicate even if the files reappear.
  seedPendingPair(root, uuid, 'Already logged');

  const second = runTaskCompletedActions(root, { uuid, status: 'complete' });
  assert.equal(second.logAppended, false, 'second call must not duplicate log row');
  assert.equal(second.logReason, 'already-logged');
  // Files re-seeded, so the move still runs — that is expected and safe.
  assert.equal(second.taskMoved, true);

  const logContent = readFileSync(join(root, '.qe', 'TASK_LOG.md'), 'utf8');
  const rowCount = (logContent.match(new RegExp(`\\| ${uuid} \\|`, 'g')) || []).length;
  assert.equal(rowCount, 1, 'only one row per uuid');
});

test('task-completed: moves an active task pair to completed', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const uuid = 'active001';
  writeFileSync(join(root, '.qe', 'tasks', 'in-progress', `TASK_REQUEST_${uuid}.md`), `# TASK_REQUEST_${uuid}.md — Active task\n`, 'utf8');
  writeFileSync(join(root, '.qe', 'checklists', 'in-progress', `VERIFY_CHECKLIST_${uuid}.md`), '# verify\n\n- [x] done\n', 'utf8');

  const summary = runTaskCompletedActions(root, { uuid, status: 'complete' });

  assert.equal(summary.taskMoved, true);
  assert.equal(summary.checklistMoved, true);
  assert.equal(existsSync(join(root, '.qe', 'tasks', 'completed', `TASK_REQUEST_${uuid}.md`)), true);
  assert.equal(existsSync(join(root, '.qe', 'checklists', 'completed', `VERIFY_CHECKLIST_${uuid}.md`)), true);
});

// ---------------------------------------------------------------------------
// Case 3: unknown uuid — no crash, no side effects beyond a log placeholder.
// ---------------------------------------------------------------------------

test('task-completed: unknown uuid does not crash and does not move phantom files', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const uuid = 'ghost000';

  const summary = runTaskCompletedActions(root, { uuid, status: 'complete' });

  // No pending pair exists — nothing to move.
  assert.equal(summary.taskMoved, false);
  assert.equal(summary.checklistMoved, false);

  // Log row *is* still written so the audit trail reflects the event —
  // callers can inspect `logAppended` to decide whether to warn.
  assert.equal(summary.logAppended, true);
  const logContent = readFileSync(join(root, '.qe', 'TASK_LOG.md'), 'utf8');
  assert.match(logContent, new RegExp(`\\| ${uuid} \\|`));
  assert.match(logContent, /\(unnamed task\)/);

  // Empty uuid payload is the truly defensive case — must be a silent no-op.
  const empty = runTaskCompletedActions(root, { uuid: '' });
  assert.equal(empty.logAppended, false);
  assert.equal(empty.taskMoved, false);
  assert.equal(empty.archiveFlagged, false);
});

// ---------------------------------------------------------------------------
// Archive-threshold guards — flag file only appears at / above the boundary.
// ---------------------------------------------------------------------------

test('task-completed: archive flag not written below threshold', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Seed THRESHOLD - 1 completed markers.
  for (let i = 0; i < ARCHIVE_THRESHOLD - 1; i++) {
    writeFileSync(
      join(root, '.qe', 'tasks', 'completed', `TASK_REQUEST_seed${i}.md`),
      '# seed\n',
      'utf8'
    );
  }

  const flagPath = join(root, '.qe', 'state', 'archive-needed.flag');
  const result = maybeFlagArchive(root);

  assert.equal(result.flagged, false);
  assert.equal(result.count, ARCHIVE_THRESHOLD - 1);
  assert.equal(existsSync(flagPath), false);
});

test('task-completed: archive flag written at threshold', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (let i = 0; i < ARCHIVE_THRESHOLD; i++) {
    writeFileSync(
      join(root, '.qe', 'tasks', 'completed', `TASK_REQUEST_seed${i}.md`),
      '# seed\n',
      'utf8'
    );
  }
  assert.equal(countCompletedTasks(root), ARCHIVE_THRESHOLD);

  const result = maybeFlagArchive(root);
  assert.equal(result.flagged, true);
  assert.equal(result.count, ARCHIVE_THRESHOLD);

  const flagPath = join(root, '.qe', 'state', 'archive-needed.flag');
  assert.equal(existsSync(flagPath), true);
  const payload = JSON.parse(readFileSync(flagPath, 'utf8'));
  assert.equal(payload.completed_count, ARCHIVE_THRESHOLD);
  assert.equal(payload.threshold, ARCHIVE_THRESHOLD);
  assert.equal(payload.reason, 'task-completed-hook');
});

// ---------------------------------------------------------------------------
// Direct helper checks — guard against regressions in the building blocks.
// ---------------------------------------------------------------------------

test('appendTaskLogRow: creates TASK_LOG with header when missing', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const res = appendTaskLogRow(root, {
    uuid: 'newfile1',
    taskName: 'Bootstrap log',
    phase: 'Phase 0',
  });
  assert.equal(res.appended, true);

  const content = readFileSync(join(root, '.qe', 'TASK_LOG.md'), 'utf8');
  assert.match(content, /^# Task Log/);
  assert.match(content, /\| newfile1 \| Bootstrap log \| ✅ complete \| Phase 0 \|/);
});

test('movePendingToCompleted: missing pair returns false flags (no throw)', (t) => {
  const root = mkproject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const res = movePendingToCompleted(root, 'missing1');
  assert.equal(res.taskMoved, false);
  assert.equal(res.checklistMoved, false);
});
