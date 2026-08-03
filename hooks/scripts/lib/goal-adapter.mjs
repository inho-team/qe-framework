/** Host-native Goal ↔ QE Plan Goal reconciliation without owning host storage. */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync } from './qe-fs.mjs';
import { resolveActivePlanSlug } from './plan-resolver.mjs';
import { readSessionGoalLink, writeSessionGoalLink } from './session-resolver.mjs';

function normalized(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function objectiveHash(objective) {
  return createHash('sha256').update(normalized(objective)).digest('hex');
}

function hostStatus(value) {
  const status = String(value || 'active').toLowerCase();
  if (['complete', 'completed', 'achieved'].includes(status)) return 'complete';
  if (status === 'blocked') return 'blocked';
  return 'active';
}

function hostSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: normalized(raw.id || raw.goal_id || raw.goalId || raw.thread_id || raw.threadId),
    objective: normalized(raw.objective || raw.title || raw.goal),
    status: hostStatus(raw.status),
  };
}

function sameObjective(host, goal) {
  return Boolean(host?.objective && goal?.objective && normalized(host.objective) === normalized(goal.objective));
}

/** Pure deterministic state mapper used by both adapters and tests. */
export function reconcileGoalStates({ hostGoal, qeGoals = [], linkedGoalId = '' } = {}) {
  const host = hostSnapshot(hostGoal);
  const goals = Array.isArray(qeGoals) ? qeGoals : [];
  const active = goals.filter((goal) => goal?.status === 'active');
  if (active.length > 1) {
    return { kind: 'conflict', reason: 'multiple_active_qe_goals', host, qeGoal: null, actions: { host: null, qe: null } };
  }

  const linked = linkedGoalId ? goals.find((goal) => goal?.id === linkedGoalId) : null;
  const objectiveMatch = host?.objective ? goals.find((goal) => sameObjective(host, goal)) : null;
  // A link records the last aligned Goal, not permanent ownership. Once that
  // Goal completes, the Plan's unique active Goal must win on resume. When a
  // host snapshot is present, its objective is the strongest usable identity.
  const qeGoal = host
    ? objectiveMatch || active[0] || linked || null
    : active[0] || (linked && ['active', 'blocked'].includes(linked.status) ? linked : null);

  if (!host) {
    if (!qeGoal) return { kind: 'unlinked', reason: 'no_host_or_qe_goal', host: null, qeGoal: null, actions: { host: null, qe: null } };
    if (!['active', 'blocked'].includes(qeGoal.status)) {
      return { kind: 'unlinked', reason: 'no_resumable_qe_goal', host: null, qeGoal, actions: { host: null, qe: null } };
    }
    return {
      kind: 'resume-host', reason: 'qe_goal_requires_host_goal', host: null, qeGoal,
      actions: { host: { action: 'create-or-resume', objective: qeGoal.objective, qeGoalId: qeGoal.id }, qe: null },
    };
  }

  if (!qeGoal) {
    return { kind: 'conflict', reason: 'host_goal_has_no_qe_match', host, qeGoal: null, actions: { host: null, qe: null } };
  }

  if (host.objective && !sameObjective(host, qeGoal)) {
    return { kind: 'conflict', reason: 'objective_mismatch', host, qeGoal, actions: { host: null, qe: null } };
  }

  if (host.status === 'active' && qeGoal.status === 'pending') {
    const blocked = goals.find((goal) => goal?.status === 'blocked');
    const firstPending = goals.find((goal) => goal?.status === 'pending');
    if (blocked || firstPending?.id !== qeGoal.id) {
      return {
        kind: 'conflict', reason: blocked ? 'blocked_qe_goal_prevents_start' : 'qe_goal_order_prevents_start', host, qeGoal,
        actions: { host: null, qe: null },
      };
    }
    return {
      kind: 'start-qe', reason: 'host_goal_matches_next_pending_qe_goal', host, qeGoal,
      actions: { host: null, qe: { action: 'start', goalId: qeGoal.id } },
    };
  }

  if (host.status === qeGoal.status || (host.status === 'active' && qeGoal.status === 'active')) {
    return { kind: 'linked', reason: 'states_match', host, qeGoal, actions: { host: null, qe: null } };
  }
  if (host.status === 'active' && qeGoal.status === 'complete') {
    return {
      kind: 'sync-host', reason: 'qe_completion_is_authoritative', host, qeGoal,
      actions: { host: { action: 'complete', qeGoalId: qeGoal.id }, qe: null },
    };
  }
  if (host.status === 'active' && qeGoal.status === 'blocked') {
    return {
      kind: 'conflict', reason: 'blocked_qe_goal_requires_explicit_replan', host, qeGoal,
      actions: { host: null, qe: null },
    };
  }
  if (host.status === 'blocked' && qeGoal.status === 'active') {
    return {
      kind: 'sync-qe', reason: 'host_blocked_active_qe_goal', host, qeGoal,
      actions: { host: null, qe: { action: 'block', goalId: qeGoal.id } },
    };
  }
  if (host.status === 'complete' && qeGoal.status !== 'complete') {
    return {
      kind: 'conflict', reason: 'host_completion_precedes_qe_evidence', host, qeGoal,
      actions: { host: null, qe: null },
    };
  }
  return { kind: 'conflict', reason: 'unsupported_state_transition', host, qeGoal, actions: { host: null, qe: null } };
}

function readGoals(cwd, slug) {
  if (!slug) return [];
  const path = join(cwd, '.qe', 'planning', 'plans', slug, 'goals.json');
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed?.goals) ? parsed.goals : [];
  } catch {
    return [];
  }
}

/** Resolve plan/session state, reconcile, and persist only the link metadata. */
export function reconcileHostGoal(cwd, { sessionId = null, planSlug = '', hostGoal = null, persist = true } = {}) {
  const priorLink = readSessionGoalLink(cwd, sessionId);
  const resolvedPlan = planSlug || priorLink?.planSlug || resolveActivePlanSlug(cwd, sessionId);
  const result = reconcileGoalStates({
    hostGoal,
    qeGoals: readGoals(cwd, resolvedPlan),
    linkedGoalId: priorLink?.goalId || '',
  });
  const goal = result.qeGoal;
  if (persist && resolvedPlan && goal && result.kind !== 'conflict') {
    writeSessionGoalLink(cwd, {
      planSlug: resolvedPlan,
      goalId: goal.id,
      hostGoalId: result.host?.id || priorLink?.hostGoalId || '',
      objectiveHash: objectiveHash(goal.objective),
    }, sessionId);
  }
  return { ...result, planSlug: resolvedPlan || '' };
}

export function formatGoalReconciliation(result) {
  if (!result || result.kind === 'unlinked') return '';
  const goal = result.qeGoal?.id ? ` ${result.planSlug || '-'}:${result.qeGoal.id}` : '';
  if (result.kind === 'conflict') return `[Goal Sync] conflict:${result.reason}${goal}`;
  const hostAction = result.actions?.host?.action ? ` host:${result.actions.host.action}` : '';
  const qeAction = result.actions?.qe?.action ? ` qe:${result.actions.qe.action}` : '';
  return `[Goal Sync] ${result.kind}${goal}${hostAction}${qeAction}`;
}
