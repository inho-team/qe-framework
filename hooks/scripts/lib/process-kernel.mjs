/**
 * Deterministic Plan/Goal/PSE/SIVS transition eligibility kernel.
 *
 * Authentication and persistence live outside this module. Callers must inject
 * an authenticated canonical authority and apply allowed decisions with
 * compare-and-swap against decision.baseRevision.
 */

const MAX_REVISION = Number.MAX_SAFE_INTEGER;

const CONTRACT = {
  plan: {
    states: ['planned', 'active', 'blocked', 'complete'],
    authority: 'plan-controller',
    resumable: ['active'],
    completion: ['goalsVerified', 'independentVerification', 'goalAlignment'],
    edges: {
      planned: ['active'],
      active: ['blocked', 'complete'],
      blocked: [],
      complete: [],
    },
  },
  goal: {
    states: ['pending', 'active', 'blocked', 'failed', 'complete'],
    authority: 'goal-controller',
    resumable: ['active'],
    completion: ['acceptance', 'implementation', 'machineVerification', 'independentVerification', 'goalAlignment'],
    edges: {
      pending: ['active'],
      active: ['blocked', 'failed', 'complete'],
      blocked: ['failed'],
      failed: ['active'],
      complete: [],
    },
  },
  pse: {
    states: ['plan', 'knowledge', 'spec', 'execute', 'verify', 'blocked', 'complete'],
    authority: 'pse-controller',
    resumable: ['plan', 'knowledge', 'spec', 'execute', 'verify'],
    completion: ['specification', 'implementation', 'machineVerification', 'independentVerification', 'goalAlignment'],
    edges: {
      plan: ['knowledge', 'blocked'],
      knowledge: ['spec', 'blocked'],
      spec: ['execute', 'blocked'],
      execute: ['spec', 'verify', 'blocked'],
      verify: ['spec', 'execute', 'blocked', 'complete'],
      blocked: [],
      complete: [],
    },
  },
  sivs: {
    states: ['spec', 'implement', 'verify', 'supervise', 'remediate', 'blocked', 'complete'],
    authority: 'sivs-controller',
    resumable: ['spec', 'implement', 'verify', 'supervise', 'remediate'],
    completion: ['specification', 'implementation', 'verification', 'supervision'],
    edges: {
      spec: ['implement', 'blocked'],
      implement: ['verify', 'blocked'],
      verify: ['supervise', 'remediate', 'blocked'],
      supervise: ['remediate', 'blocked', 'complete'],
      remediate: ['spec', 'implement', 'verify', 'blocked'],
      blocked: [],
      complete: [],
    },
  },
};

export const PROCESS_KERNEL_CONTRACT = Object.freeze(Object.fromEntries(
  Object.entries(CONTRACT).map(([layer, value]) => [layer, Object.freeze({
    states: Object.freeze([...value.states]),
    authority: value.authority,
    resumable: Object.freeze([...value.resumable]),
    completion: Object.freeze([...value.completion]),
  })]),
));

const REASONS = {
  ALLOWED: 'The requested state transition is allowed.',
  IDEMPOTENT: 'The snapshot is already in the requested state.',
  INVALID_REQUEST: 'The transition request or snapshot shape is invalid.',
  UNKNOWN_LAYER: 'The requested process layer is unknown.',
  UNKNOWN_STATE: 'The source, target, or resume state is unknown.',
  STALE_SNAPSHOT: 'The expected revision does not match the snapshot revision.',
  AUTHORITY_DENIED: 'The trusted adapter principal is not authorized for this layer.',
  TRANSITION_DENIED: 'The requested state transition is not permitted by the contract.',
  REVISION_EXHAUSTED: 'The snapshot revision cannot be incremented safely.',
  EVIDENCE_MISSING: 'Required completion evidence is missing.',
  EVIDENCE_INVALID: 'Completion evidence is malformed or violates provenance constraints.',
  HUMAN_ACCEPTANCE_MISSING: 'The required human acceptance state or proof is invalid.',
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_REVISION;
}

function normalizeState(value) {
  return value.trim().replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function nonblank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function baseDecision(code, context = {}, overrides = {}) {
  return {
    allowed: overrides.allowed === true,
    code,
    reason: REASONS[code],
    layer: context.layer ?? null,
    from: context.from ?? null,
    to: context.to ?? null,
    baseRevision: context.baseRevision ?? null,
    allowedNextStates: [...(overrides.allowedNextStates || [])],
    missingEvidence: [...(overrides.missingEvidence || [])],
    nextSnapshot: overrides.nextSnapshot ? { ...overrides.nextSnapshot } : null,
  };
}

function canonicalSnapshot(snapshotData, state, resumeState) {
  const next = { state, revision: snapshotData.revision };
  if (resumeState !== undefined) next.resumeState = resumeState;
  if (snapshotData.hasAttempt) next.attempt = snapshotData.attempt;
  return next;
}

function structuralTargets(contract, from, resumeState) {
  const targets = new Set([from]);
  if (from === 'blocked') {
    if (resumeState !== undefined) targets.add(resumeState);
    for (const target of contract.edges.blocked) targets.add(target);
  } else {
    for (const target of contract.edges[from]) targets.add(target);
  }
  return contract.states.filter((state) => targets.has(state));
}

function validBlockedResume(contract, resumeState) {
  return contract.resumable.includes(resumeState);
}

function captureAttestation(value, layer, revision) {
  try {
    if (!isPlainObject(value)) return { valid: false, value: null };
    const fields = ['status', 'subject', 'revision', 'proofRef', 'issuedBy', 'sessionId', 'digest'];
    if (fields.some((field) => !hasOwn(value, field))) {
      return { valid: false, value: null };
    }
    const captured = {
      status: value.status,
      subject: value.subject,
      revision: value.revision,
      proofRef: value.proofRef,
      issuedBy: value.issuedBy,
      sessionId: value.sessionId,
      digest: value.digest,
    };
    return {
      valid: captured.status === 'valid'
        && captured.subject === layer
        && captured.revision === revision
        && nonblank(captured.proofRef)
        && nonblank(captured.issuedBy)
        && nonblank(captured.sessionId)
        && nonblank(captured.digest),
      value: captured,
    };
  } catch {
    return { valid: false, value: null };
  }
}

function validateAttestations(attestations, layer, revision, required) {
  try {
    if (attestations === undefined) {
      return { code: 'EVIDENCE_MISSING', keys: [...required] };
    }
    if (!isPlainObject(attestations)) {
      return { code: 'EVIDENCE_INVALID', keys: [...required] };
    }

    const captured = new Map();
    const invalid = [];
    const missing = [];
    for (const key of required) {
      if (!hasOwn(attestations, key)) {
        missing.push(key);
        continue;
      }
      let entry;
      try {
        entry = attestations[key];
      } catch {
        invalid.push(key);
        continue;
      }
      const result = captureAttestation(entry, layer, revision);
      if (!result.valid) invalid.push(key);
      else captured.set(key, result.value);
    }
    if (invalid.length > 0) return { code: 'EVIDENCE_INVALID', keys: invalid };
    if (missing.length > 0) return { code: 'EVIDENCE_MISSING', keys: missing };

    if (layer === 'goal' || layer === 'pse') {
      const implementation = captured.get('implementation');
      const verification = captured.get('independentVerification');
      const alignment = captured.get('goalAlignment');
      const sameSession = implementation.sessionId === verification.sessionId;
      const issuerMismatch = alignment.issuedBy !== verification.issuedBy;
      if (sameSession || issuerMismatch) {
        const implicated = new Set();
        if (sameSession) {
          implicated.add('implementation');
          implicated.add('independentVerification');
        }
        if (issuerMismatch) {
          implicated.add('independentVerification');
          implicated.add('goalAlignment');
        }
        return {
          code: 'EVIDENCE_INVALID',
          keys: required.filter((key) => implicated.has(key)),
        };
      }
    }

    return null;
  } catch {
    return { code: 'EVIDENCE_INVALID', keys: [...required] };
  }
}

function validHumanAcceptance(value) {
  try {
    if (!isPlainObject(value)) return false;
    if (!hasOwn(value, 'required') || !hasOwn(value, 'status')) return false;
    const required = value.required;
    const status = value.status;
    if (typeof required !== 'boolean') return false;
    if (required) {
      return status === 'passed'
        && hasOwn(value, 'proofRef')
        && nonblank(value.proofRef);
    }
    if (status === 'not-required') return true;
    return status === 'passed'
      && hasOwn(value, 'proofRef')
      && nonblank(value.proofRef);
  } catch {
    return false;
  }
}

/**
 * Evaluate one immutable transition request.
 * @param {*} request Transition request supplied by a trusted adapter.
 * @returns {object} Deterministic eligibility decision.
 */
export function evaluateTransition(request) {
  const context = { layer: null, from: null, to: null, baseRevision: null };

  try {
    if (!isObject(request)) {
      return baseDecision('INVALID_REQUEST', context);
    }

    const snapshot = request.snapshot;
    if (!isObject(snapshot)) return baseDecision('INVALID_REQUEST', context);

    const layerValue = request.layer;
    const stateValue = snapshot.state;
    const toValue = request.to;
    const authority = request.authority;
    const revision = snapshot.revision;
    const expectedRevision = request.expectedRevision;
    const hasAttempt = hasOwn(snapshot, 'attempt');
    const attempt = hasAttempt ? snapshot.attempt : undefined;
    const hasResumeState = hasOwn(snapshot, 'resumeState');
    const resumeValue = hasResumeState ? snapshot.resumeState : undefined;

    if (typeof layerValue !== 'string'
      || typeof stateValue !== 'string'
      || typeof toValue !== 'string'
      || typeof authority !== 'string'
      || !isRevision(revision)
      || !isRevision(expectedRevision)
      || (hasAttempt && (!Number.isSafeInteger(attempt) || attempt < 0))) {
      if (isRevision(revision)) context.baseRevision = revision;
      return baseDecision('INVALID_REQUEST', context);
    }

    const snapshotData = { revision, hasAttempt, attempt };
    context.layer = normalizeState(layerValue);
    context.from = normalizeState(stateValue);
    context.to = normalizeState(toValue);
    context.baseRevision = revision;

    if (!hasOwn(CONTRACT, context.layer)) return baseDecision('UNKNOWN_LAYER', context);
    const contract = CONTRACT[context.layer];
    if (!contract.states.includes(context.from)) return baseDecision('UNKNOWN_STATE', context);

    if (!contract.states.includes(context.to)) {
      let allowedNextStates = [];
      if (context.from !== 'blocked' && !hasResumeState) {
        allowedNextStates = structuralTargets(contract, context.from);
      } else if (context.from === 'blocked' && typeof resumeValue === 'string') {
        const resume = normalizeState(resumeValue);
        if (validBlockedResume(contract, resume)) {
          allowedNextStates = structuralTargets(contract, context.from, resume);
        }
      }
      return baseDecision('UNKNOWN_STATE', context, { allowedNextStates });
    }

    let resumeState;
    if (context.from !== 'blocked') {
      if (hasResumeState) return baseDecision('INVALID_REQUEST', context);
    } else {
      if (!hasResumeState || typeof resumeValue !== 'string') {
        return baseDecision('INVALID_REQUEST', context);
      }
      resumeState = normalizeState(resumeValue);
      if (!contract.states.includes(resumeState)) return baseDecision('UNKNOWN_STATE', context);
      if (!validBlockedResume(contract, resumeState)) return baseDecision('TRANSITION_DENIED', context);
    }

    const allowedNextStates = structuralTargets(contract, context.from, resumeState);

    if (expectedRevision !== revision) {
      return baseDecision('STALE_SNAPSHOT', context, { allowedNextStates });
    }
    if (authority !== contract.authority) {
      return baseDecision('AUTHORITY_DENIED', context, { allowedNextStates });
    }
    if (!allowedNextStates.includes(context.to)) {
      return baseDecision('TRANSITION_DENIED', context, { allowedNextStates });
    }

    if (context.to === context.from) {
      return baseDecision('IDEMPOTENT', context, {
        allowed: true,
        allowedNextStates,
        nextSnapshot: canonicalSnapshot(snapshotData, context.from, resumeState),
      });
    }

    if (revision === MAX_REVISION) {
      return baseDecision('REVISION_EXHAUSTED', context, { allowedNextStates });
    }

    if (context.to === 'complete') {
      let attestations;
      try {
        attestations = hasOwn(request, 'attestations') ? request.attestations : undefined;
      } catch {
        return baseDecision('EVIDENCE_INVALID', context, {
          allowedNextStates,
          missingEvidence: contract.completion,
        });
      }
      const evidence = validateAttestations(
        attestations,
        context.layer,
        revision,
        contract.completion,
      );
      if (evidence) {
        return baseDecision(evidence.code, context, {
          allowedNextStates,
          missingEvidence: evidence.keys,
        });
      }
      let humanAcceptance;
      try {
        if (!hasOwn(request, 'humanAcceptance')) {
          return baseDecision('HUMAN_ACCEPTANCE_MISSING', context, { allowedNextStates });
        }
        humanAcceptance = request.humanAcceptance;
      } catch {
        return baseDecision('HUMAN_ACCEPTANCE_MISSING', context, { allowedNextStates });
      }
      if (!validHumanAcceptance(humanAcceptance)) {
        return baseDecision('HUMAN_ACCEPTANCE_MISSING', context, { allowedNextStates });
      }
    }

    const nextSnapshot = canonicalSnapshot(snapshotData, context.to);
    nextSnapshot.revision += 1;
    if (context.to === 'blocked') nextSnapshot.resumeState = context.from;

    return baseDecision('ALLOWED', context, {
      allowed: true,
      allowedNextStates,
      nextSnapshot,
    });
  } catch {
    return baseDecision('INVALID_REQUEST', context);
  }
}
