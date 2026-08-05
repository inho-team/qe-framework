import { types as utilTypes } from 'node:util';
import { PROCESS_KERNEL_CONTRACT } from './process-kernel.mjs';

const DECISIONS = Object.freeze(['resume', 'reverify', 'decision-required']);
const LANE_STATES = new Set(['pending', 'running', 'blocked', 'completed', 'stale', 'abandoned']);
const EVIDENCE_STATES = new Set(['pass', 'fail', 'degraded', 'unsupported']);
const TRACE_STATES = new Set(['complete', 'incomplete', 'invalid']);
const MATERIAL_BLOCKERS = new Set(['human-decision', 'ownership-conflict', 'irreversible-choice', 'scope-conflict']);
const BLOCKER_KINDS = new Set(['none', ...MATERIAL_BLOCKERS]);
const TRACE_ACTIONS = new Set([
  'repair-evidence', 'link-scenario', 'run-implementation', 'run-verification',
  'record-verdict', 'align-goal', 'retry-query',
]);

function plain(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !utilTypes.isProxy(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function ownData(object, key, optional = false) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return optional ? { ok: true, value: undefined } : { ok: false };
  if (!Object.hasOwn(descriptor, 'value')) return { ok: false };
  return { ok: true, value: descriptor.value };
}

function capture(object, required, optional = []) {
  if (!plain(object)) return null;
  const result = {};
  for (const key of required) {
    const field = ownData(object, key);
    if (!field.ok) return null;
    result[key] = field.value;
  }
  for (const key of optional) {
    const field = ownData(object, key, true);
    if (!field.ok) return null;
    result[key] = field.value;
  }
  return result;
}

function captureStringArray(value, { maxItems, maxLength }) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maxItems) return null;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const item = descriptor.value;
    if (!text(item) || item !== item.trim() || item.length > maxLength) return null;
    output.push(item);
  }
  return output;
}

function result(decision, code, reason, overrides = {}) {
  return {
    decision,
    code,
    reason,
    baseRevision: overrides.baseRevision ?? null,
    resumeState: overrides.resumeState ?? null,
    nextActions: [...(overrides.nextActions || [])],
  };
}

function decisionRequired(code, reason, nextActions = ['inspect-state'], baseRevision = null) {
  return result('decision-required', code, reason, { nextActions, baseRevision });
}

/**
 * Select a safe recovery action from canonical process, trace, and lane snapshots.
 * This function never mutates state and never returns `complete`: recovery cannot
 * manufacture completion authority from runtime observations.
 */
export function decideProcessRecovery(input) {
  try {
    const root = capture(input, ['process', 'trace', 'lane', 'nowMs', 'staleAfterMs']);
    if (!root) {
      return decisionRequired('INVALID_INPUT', 'Recovery input must contain plain process, trace, and lane snapshots.');
    }

    const process = capture(root.process, ['layer', 'state', 'revision'], ['resumeState']);
    const trace = capture(root.trace, ['status', 'processRevision'], ['nextActions']);
    const lane = capture(root.lane,
      ['status', 'evidenceStatus', 'processRevision', 'updatedAtMs', 'liveOwnerSessionIds'],
      ['blockerKind']);
    if (!process || !trace || !lane) {
      return decisionRequired('INVALID_INPUT', 'Recovery records must use own data properties without proxies or accessors.');
    }

    const contract = text(process.layer) ? PROCESS_KERNEL_CONTRACT[process.layer] : null;
    if (!contract || !text(process.state) || !contract.states.includes(process.state)
      || !Number.isSafeInteger(process.revision) || process.revision < 0) {
      return decisionRequired('INVALID_PROCESS_STATE', 'Canonical process state is missing or malformed.', ['repair-state']);
    }
    if (process.resumeState !== undefined
      && (!text(process.resumeState) || !contract.resumable.includes(process.resumeState))) {
      return decisionRequired('INVALID_PROCESS_STATE', 'Canonical resume state is invalid for the process layer.', ['repair-state'], process.revision);
    }
    if (process.state !== 'blocked' && process.resumeState !== undefined) {
      return decisionRequired('INVALID_PROCESS_STATE', 'Only a blocked process may carry a resume state.', ['repair-state'], process.revision);
    }
    if (process.state === 'blocked' && process.resumeState === undefined) {
      return decisionRequired('MISSING_RESUME_STATE', 'Blocked process state has no canonical resume state.', ['repair-state'], process.revision);
    }
    if (!['blocked', 'complete'].includes(process.state) && !contract.resumable.includes(process.state)) {
      return decisionRequired('INVALID_RESUME_STATE', 'The current process state is not recoverable by resume.', ['restart-transition'], process.revision);
    }
    if (!TRACE_STATES.has(trace.status) || !LANE_STATES.has(lane.status) || !EVIDENCE_STATES.has(lane.evidenceStatus)) {
      return decisionRequired('INVALID_RECOVERY_STATE', 'Trace or lane status is outside the recovery contract.', ['repair-state'], process.revision);
    }
    const capturedTraceActions = trace.nextActions === undefined
      ? []
      : captureStringArray(trace.nextActions, { maxItems: 8, maxLength: 64 });
    if (!capturedTraceActions || capturedTraceActions.some(action => !TRACE_ACTIONS.has(action))) {
      return decisionRequired('INVALID_TRACE_ACTIONS', 'Trace next actions are outside the recovery contract.', ['repair-state'], process.revision);
    }
    const traceActions = [...new Set(capturedTraceActions)];
    if ((trace.status === 'complete' && traceActions.length > 0)
      || (trace.status === 'incomplete' && traceActions.length === 0)) {
      return decisionRequired(
        'INVALID_TRACE_COHERENCE',
        'Trace status and next actions describe contradictory evidence state.',
        ['repair-evidence'],
        process.revision,
      );
    }

    const { nowMs, staleAfterMs } = root;
    if (!Number.isSafeInteger(nowMs) || nowMs < 0
      || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0
      || !Number.isSafeInteger(lane.updatedAtMs) || lane.updatedAtMs < 0) {
      return decisionRequired('INVALID_CLOCK', 'Recovery clock inputs are invalid.', ['repair-state'], process.revision);
    }
    if (lane.updatedAtMs > nowMs) {
      return decisionRequired('CLOCK_SKEW', 'Lane update time is in the future.', ['repair-state'], process.revision);
    }
    const age = BigInt(nowMs) - BigInt(lane.updatedAtMs);
    const stale = lane.status === 'stale' || age > BigInt(staleAfterMs);

    if (!Number.isSafeInteger(trace.processRevision) || !Number.isSafeInteger(lane.processRevision)
      || trace.processRevision !== process.revision || lane.processRevision !== process.revision) {
      return result('decision-required', 'SNAPSHOT_INCOHERENT',
        'Process, trace, and lane snapshots do not share one canonical revision.', {
          baseRevision: process.revision,
          nextActions: ['retry-query'],
        });
    }

    const capturedOwners = captureStringArray(lane.liveOwnerSessionIds, { maxItems: 8, maxLength: 128 });
    if (!capturedOwners) {
      return decisionRequired('INVALID_OWNERSHIP', 'Lane ownership data is malformed.', ['repair-state'], process.revision);
    }
    if (lane.blockerKind !== undefined && !BLOCKER_KINDS.has(lane.blockerKind)) {
      return decisionRequired('INVALID_BLOCKER', 'Lane blocker kind is outside the recovery contract.', ['repair-state'], process.revision);
    }
    const owners = [...new Set(capturedOwners)];

    if (trace.status === 'invalid') {
      return decisionRequired(
        'INVALID_CANONICAL_EVIDENCE',
        'Canonical evidence is invalid and cannot authorize recovery.',
        traceActions.length > 0 ? traceActions : ['repair-evidence'],
        process.revision,
      );
    }

    if (owners.length > 1 || lane.blockerKind === 'ownership-conflict') {
      return decisionRequired(
        'OWNERSHIP_CONFLICT',
        'Multiple live owners claim the same process lane.',
        ['resolve-ownership'],
        process.revision,
      );
    }
    if (owners.length === 0) {
      return decisionRequired('OWNER_MISSING', 'No live owner can safely resume the process lane.', ['claim-ownership'], process.revision);
    }

    if (MATERIAL_BLOCKERS.has(lane.blockerKind)) {
      return decisionRequired('MATERIAL_DECISION_REQUIRED', 'The lane is blocked on a material decision.', ['request-decision'], process.revision);
    }

    if (process.state === 'complete') {
      return decisionRequired(
        trace.status === 'complete' ? 'ALREADY_COMPLETE' : 'COMPLETION_EVIDENCE_MISMATCH',
        trace.status === 'complete'
          ? 'The canonical process is already complete; no recovery transition is valid.'
          : 'Process state claims completion without a complete canonical evidence trace.',
        trace.status === 'complete' ? ['no-op'] : ['repair-state', 'run-verification'],
        process.revision,
      );
    }

    const needsVerification = stale
      || lane.status === 'completed'
      || lane.status === 'abandoned'
      || lane.evidenceStatus !== 'pass'
      || trace.status !== 'complete';
    if (needsVerification) {
      return result('reverify', stale ? 'STALE_REVERIFY' : 'EVIDENCE_REVERIFY',
        stale
          ? 'Stale runtime state cannot claim completion; canonical evidence must be reverified.'
          : 'Runtime progress is not backed by complete passing evidence.', {
          resumeState: text(process.resumeState) ? process.resumeState : process.state,
          baseRevision: process.revision,
          nextActions: traceActions.length > 0 ? traceActions : ['run-verification'],
        });
    }

    return result('resume', 'SAFE_TO_RESUME', 'The canonical state is current, singly owned, and evidence-backed.', {
      baseRevision: process.revision,
      resumeState: text(process.resumeState) ? process.resumeState : process.state,
      nextActions: ['resume-process'],
    });
  } catch {
    return decisionRequired('INVALID_INPUT', 'Recovery input could not be inspected safely.');
  }
}

export const PROCESS_RECOVERY_DECISIONS = DECISIONS;
