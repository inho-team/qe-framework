import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { formatGoalReconciliation, reconcileGoalStates, reconcileHostGoal } from '../goal-adapter.mjs';
import { readSessionGoalLink } from '../session-resolver.mjs';

const SESSION_START_HOOK = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../session-start.mjs');

function fixture(t, goals) {
  const root = mkdtempSync(join(tmpdir(), 'qe-goal-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const planDir = join(root, '.qe/planning/plans/plan-a');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'goals.json'), JSON.stringify({ schema: 1, planSlug: 'plan-a', goals }));
  writeFileSync(join(planDir, 'ROADMAP.md'), '# plan');
  mkdirSync(join(root, '.qe/planning/.sessions'), { recursive: true });
  return root;
}

const objective = 'ship deterministic goal sync';

test('QE active goal requests a host create-or-resume action', () => {
  const result = reconcileGoalStates({ qeGoals: [{ id: 'G001', objective, status: 'active' }] });
  assert.equal(result.kind, 'resume-host');
  assert.deepEqual(result.actions.host, { action: 'create-or-resume', objective, qeGoalId: 'G001' });
});

test('active host goal starts the matching pending QE goal', () => {
  const result = reconcileGoalStates({
    hostGoal: { id: 'H1', objective, status: 'active' },
    qeGoals: [{ id: 'G001', objective, status: 'pending' }],
  });
  assert.equal(result.kind, 'start-qe');
  assert.deepEqual(result.actions.qe, { action: 'start', goalId: 'G001' });

  const linkedReplay = reconcileGoalStates({
    hostGoal: { id: 'H1', objective, status: 'active' },
    qeGoals: [{ id: 'G001', objective, status: 'pending' }],
    linkedGoalId: 'G001',
  });
  assert.equal(linkedReplay.kind, 'start-qe');
});

test('QE completion propagates to host but premature host completion conflicts', () => {
  const complete = reconcileGoalStates({
    hostGoal: { id: 'H1', objective, status: 'active' },
    qeGoals: [{ id: 'G001', objective, status: 'complete' }],
  });
  assert.equal(complete.actions.host.action, 'complete');

  const premature = reconcileGoalStates({
    hostGoal: { id: 'H1', objective, status: 'complete' },
    qeGoals: [{ id: 'G001', objective, status: 'active' }],
  });
  assert.equal(premature.kind, 'conflict');
  assert.equal(premature.reason, 'host_completion_precedes_qe_evidence');
});

test('resume restores the linked plan and unique active Goal', (t) => {
  const root = fixture(t, [{ id: 'G001', objective, status: 'active' }]);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const linked = reconcileHostGoal(root, {
    sessionId, planSlug: 'plan-a', hostGoal: { id: 'H1', objective, status: 'active' },
  });
  assert.equal(linked.kind, 'linked');
  assert.equal(readSessionGoalLink(root, sessionId).goalId, 'G001');

  const resumed = reconcileHostGoal(root, { sessionId, hostGoal: null });
  assert.equal(resumed.planSlug, 'plan-a');
  assert.equal(resumed.qeGoal.id, 'G001');
  assert.equal(resumed.actions.host.action, 'create-or-resume');
});

test('resume advances a stale completed link to the unique active Goal', () => {
  const result = reconcileGoalStates({
    linkedGoalId: 'G001',
    qeGoals: [
      { id: 'G001', objective: 'finished work', status: 'complete' },
      { id: 'G002', objective, status: 'active' },
    ],
  });
  assert.equal(result.kind, 'resume-host');
  assert.equal(result.qeGoal.id, 'G002');
  assert.equal(result.actions.host.qeGoalId, 'G002');
});

test('blocked QE Goal is reported instead of proposing an unsupported resume transition', () => {
  const result = reconcileGoalStates({
    hostGoal: { id: 'H1', objective, status: 'active' },
    qeGoals: [{ id: 'G001', objective, status: 'blocked' }],
  });
  assert.equal(result.kind, 'conflict');
  assert.equal(result.reason, 'blocked_qe_goal_requires_explicit_replan');
  assert.equal(result.actions.qe, null);
});

test('objective mismatch and multiple active Goals are explicit conflicts', () => {
  const mismatch = reconcileGoalStates({
    hostGoal: { objective: 'different', status: 'active' },
    qeGoals: [{ id: 'G001', objective, status: 'active' }],
  });
  assert.match(formatGoalReconciliation({ ...mismatch, planSlug: 'plan-a' }), /conflict:objective_mismatch/);

  const multiple = reconcileGoalStates({ qeGoals: [
    { id: 'G001', objective, status: 'active' },
    { id: 'G002', objective: 'other', status: 'active' },
  ] });
  assert.equal(multiple.reason, 'multiple_active_qe_goals');
});

test('SessionStart surfaces the linked active Goal from a host snapshot', (t) => {
  const root = fixture(t, [{ id: 'G001', objective, status: 'active' }]);
  const sessionId = '22222222-2222-4222-8222-222222222222';
  writeFileSync(join(root, `.qe/planning/.sessions/${sessionId}.json`), JSON.stringify({ activePlanSlug: 'plan-a' }));
  const result = spawnSync(process.execPath, [SESSION_START_HOOK], {
    cwd: process.cwd(),
    input: JSON.stringify({
      cwd: root,
      session_id: sessionId,
      source: 'startup',
      host_goal: { id: 'H2', objective, status: 'active' },
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.match(output.hookSpecificOutput.additionalContext, /\[Goal Sync\] linked plan-a:G001/);
  assert.equal(readSessionGoalLink(root, sessionId).hostGoalId, 'H2');
});
