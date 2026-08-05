import test from 'node:test';
import assert from 'node:assert/strict';

import { decideProcessRecovery, PROCESS_RECOVERY_DECISIONS } from '../process-recovery.mjs';

const NOW = Date.parse('2026-08-04T12:00:00.000Z');

function snapshot(overrides = {}) {
  return {
    process: { layer: 'sivs', state: 'verify', revision: 3 },
    trace: { status: 'complete', processRevision: 3, nextActions: [] },
    lane: {
      status: 'running',
      evidenceStatus: 'pass',
      processRevision: 3,
      updatedAtMs: NOW - 60_000,
      liveOwnerSessionIds: ['session-a'],
    },
    nowMs: NOW,
    staleAfterMs: 60 * 60 * 1000,
    ...overrides,
  };
}

test('exports the closed recovery decision vocabulary', () => {
  assert.deepEqual(PROCESS_RECOVERY_DECISIONS, ['resume', 'reverify', 'decision-required']);
});

test('resumes a fresh singly-owned evidence-backed process', () => {
  const decision = decideProcessRecovery(snapshot());
  assert.equal(decision.decision, 'resume');
  assert.equal(decision.code, 'SAFE_TO_RESUME');
  assert.equal(decision.resumeState, 'verify');
  assert.equal(decision.baseRevision, 3);
});

test('a stale lane that claims completion is reverified, never completed', () => {
  const decision = decideProcessRecovery(snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: ['run-verification'] },
    lane: {
      status: 'completed',
      evidenceStatus: 'degraded',
      processRevision: 3,
      updatedAtMs: NOW - 4 * 60 * 60 * 1000,
      liveOwnerSessionIds: ['session-a'],
    },
  }));
  assert.equal(decision.decision, 'reverify');
  assert.equal(decision.code, 'STALE_REVERIFY');
  assert.deepEqual(decision.nextActions, ['run-verification']);
  assert.ok(!Object.values(decision).includes('complete'));
});

test('missing passing evidence forces re-verification even when the lane is fresh', () => {
  const decision = decideProcessRecovery(snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: ['run-implementation', 'run-verification'] },
    lane: {
      status: 'running', evidenceStatus: 'degraded',
      processRevision: 3, updatedAtMs: NOW - 60_000, liveOwnerSessionIds: ['session-a'],
    },
  }));
  assert.equal(decision.decision, 'reverify');
  assert.equal(decision.code, 'EVIDENCE_REVERIFY');
});

test('conflicting live owners fail closed with a concrete action', () => {
  const decision = decideProcessRecovery(snapshot({
    lane: {
      status: 'blocked', evidenceStatus: 'pass', blockerKind: 'ownership-conflict',
      processRevision: 3, updatedAtMs: NOW - 2 * 60 * 60 * 1000, liveOwnerSessionIds: ['session-a', 'session-b'],
    },
  }));
  assert.equal(decision.decision, 'decision-required');
  assert.equal(decision.code, 'OWNERSHIP_CONFLICT');
  assert.deepEqual(decision.nextActions, ['resolve-ownership']);
});

test('invalid canonical evidence fails closed instead of guessing completion', () => {
  const decision = decideProcessRecovery(snapshot({
    trace: { status: 'invalid', processRevision: 3, nextActions: ['repair-evidence'] },
  }));
  assert.equal(decision.decision, 'decision-required');
  assert.equal(decision.code, 'INVALID_CANONICAL_EVIDENCE');
});

test('a canonical complete state is terminal and never converted into recovery completion', () => {
  const decision = decideProcessRecovery(snapshot({
    process: { layer: 'goal', state: 'complete', revision: 8 },
    trace: { status: 'complete', processRevision: 8, nextActions: [] },
    lane: { status: 'completed', evidenceStatus: 'pass', processRevision: 8, updatedAtMs: NOW, liveOwnerSessionIds: ['session-a'] },
  }));
  assert.equal(decision.decision, 'decision-required');
  assert.equal(decision.code, 'ALREADY_COMPLETE');
  assert.deepEqual(decision.nextActions, ['no-op']);
});

test('material blockers require a user decision', () => {
  const decision = decideProcessRecovery(snapshot({
    process: { layer: 'sivs', state: 'blocked', resumeState: 'verify', revision: 4 },
    trace: { status: 'complete', processRevision: 4, nextActions: [] },
    lane: {
      status: 'blocked', evidenceStatus: 'pass', blockerKind: 'human-decision',
      processRevision: 4, updatedAtMs: NOW - 60_000, liveOwnerSessionIds: ['session-a'],
    },
  }));
  assert.equal(decision.decision, 'decision-required');
  assert.equal(decision.code, 'MATERIAL_DECISION_REQUIRED');
});

test('malformed and proxy input fail closed without throwing', () => {
  assert.equal(decideProcessRecovery(null).decision, 'decision-required');
  assert.equal(decideProcessRecovery(new Proxy({}, {})).code, 'INVALID_INPUT');
  assert.equal(decideProcessRecovery(snapshot({ nowMs: Number.NaN })).code, 'INVALID_CLOCK');
});

test('revision mismatch fails closed and exposes the CAS base revision', () => {
  const decision = decideProcessRecovery(snapshot({
    trace: { status: 'complete', processRevision: 2, nextActions: [] },
  }));
  assert.equal(decision.code, 'SNAPSHOT_INCOHERENT');
  assert.equal(decision.baseRevision, 3);
  assert.equal(decision.decision, 'decision-required');
});

test('ownership semantics distinguish zero, duplicates, and conflicting owners', () => {
  const noOwner = snapshot();
  noOwner.lane.liveOwnerSessionIds = [];
  assert.equal(decideProcessRecovery(noOwner).code, 'OWNER_MISSING');

  const duplicate = snapshot();
  duplicate.lane.liveOwnerSessionIds = ['session-a', 'session-a'];
  assert.equal(decideProcessRecovery(duplicate).decision, 'resume');

  const conflict = snapshot();
  conflict.lane.liveOwnerSessionIds = ['session-a', 'session-b'];
  conflict.lane.status = 'stale';
  assert.equal(decideProcessRecovery(conflict).code, 'OWNERSHIP_CONFLICT');

  const blank = snapshot();
  blank.lane.liveOwnerSessionIds = ['   '];
  assert.equal(decideProcessRecovery(blank).code, 'INVALID_OWNERSHIP');

  const padded = snapshot();
  padded.lane.liveOwnerSessionIds = [' session-a '];
  assert.equal(decideProcessRecovery(padded).code, 'INVALID_OWNERSHIP');

  const maxOwners = snapshot();
  maxOwners.lane.liveOwnerSessionIds = Array(8).fill('a'.repeat(128));
  assert.equal(decideProcessRecovery(maxOwners).decision, 'resume');

  const tooManyOwners = snapshot();
  tooManyOwners.lane.liveOwnerSessionIds = Array(9).fill('session-a');
  assert.equal(decideProcessRecovery(tooManyOwners).code, 'INVALID_OWNERSHIP');

  const ownerTooLong = snapshot();
  ownerTooLong.lane.liveOwnerSessionIds = ['a'.repeat(129)];
  assert.equal(decideProcessRecovery(ownerTooLong).code, 'INVALID_OWNERSHIP');
});

test('blocker kinds are closed and resolved blockers use none or absence', () => {
  const unknown = snapshot();
  unknown.lane.blockerKind = 'mystery';
  assert.equal(decideProcessRecovery(unknown).code, 'INVALID_BLOCKER');

  const resolved = snapshot();
  resolved.lane.blockerKind = 'none';
  assert.equal(decideProcessRecovery(resolved).decision, 'resume');
});

test('only kernel-resumable states can produce resume', () => {
  for (const [layer, state] of [['plan', 'planned'], ['goal', 'pending'], ['goal', 'failed']]) {
    const input = snapshot({
      process: { layer, state, revision: 3 },
    });
    assert.equal(decideProcessRecovery(input).code, 'INVALID_RESUME_STATE', `${layer}:${state}`);
  }

  const blockedInvalid = snapshot({
    process: { layer: 'goal', state: 'blocked', resumeState: 'complete', revision: 3 },
  });
  assert.equal(decideProcessRecovery(blockedInvalid).code, 'INVALID_PROCESS_STATE');

  const blockedMissing = snapshot({ process: { layer: 'goal', state: 'blocked', revision: 3 } });
  blockedMissing.lane.status = 'stale';
  blockedMissing.trace.status = 'incomplete';
  assert.equal(decideProcessRecovery(blockedMissing).code, 'MISSING_RESUME_STATE');

  const blockedValid = snapshot({
    process: { layer: 'goal', state: 'blocked', resumeState: 'active', revision: 3 },
    lane: { status: 'blocked', evidenceStatus: 'pass', processRevision: 3, updatedAtMs: NOW, liveOwnerSessionIds: ['session-a'], blockerKind: 'none' },
  });
  assert.equal(decideProcessRecovery(blockedValid).decision, 'resume');
  assert.equal(decideProcessRecovery(blockedValid).resumeState, 'active');
});

test('trace next actions use a closed bounded vocabulary', () => {
  const invalid = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: ['run-arbitrary-command'] },
  });
  assert.equal(decideProcessRecovery(invalid).code, 'INVALID_TRACE_ACTIONS');

  const valid = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: ['run-verification'] },
  });
  assert.equal(decideProcessRecovery(valid).decision, 'reverify');
  assert.deepEqual(decideProcessRecovery(valid).nextActions, ['run-verification']);

  const duplicate = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: ['run-verification', 'repair-evidence', 'run-verification'] },
  });
  assert.deepEqual(decideProcessRecovery(duplicate).nextActions, ['run-verification', 'repair-evidence']);

  const stale = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: ['run-verification'] },
    staleAfterMs: 1,
  });
  assert.equal(decideProcessRecovery(stale).code, 'STALE_REVERIFY');

  const maxActions = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: Array(8).fill('run-verification') },
  });
  assert.equal(decideProcessRecovery(maxActions).decision, 'reverify');

  const tooManyActions = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: Array(9).fill('run-verification') },
  });
  assert.equal(decideProcessRecovery(tooManyActions).code, 'INVALID_TRACE_ACTIONS');
});

test('trace status and recovery actions must be coherent', () => {
  const completeWithRepair = snapshot({
    trace: { status: 'complete', processRevision: 3, nextActions: ['repair-evidence'] },
  });
  assert.equal(decideProcessRecovery(completeWithRepair).code, 'INVALID_TRACE_COHERENCE');

  const incompleteWithoutAction = snapshot({
    trace: { status: 'incomplete', processRevision: 3, nextActions: [] },
  });
  assert.equal(decideProcessRecovery(incompleteWithoutAction).code, 'INVALID_TRACE_COHERENCE');
});

test('compound failures follow the normative validation and decision order', () => {
  const validationCollision = snapshot({
    trace: { status: 'invalid', processRevision: 2, nextActions: ['repair-evidence'] },
  });
  validationCollision.lane.updatedAtMs = NOW + 1;
  assert.equal(decideProcessRecovery(validationCollision).code, 'CLOCK_SKEW');

  const invalidEvidenceWithoutOwner = snapshot({
    trace: { status: 'invalid', processRevision: 3, nextActions: ['repair-evidence'] },
  });
  invalidEvidenceWithoutOwner.lane.liveOwnerSessionIds = [];
  assert.equal(decideProcessRecovery(invalidEvidenceWithoutOwner).code, 'INVALID_CANONICAL_EVIDENCE');

  const invalidEvidenceWithMalformedOwner = snapshot({
    trace: { status: 'invalid', processRevision: 3, nextActions: ['repair-evidence'] },
  });
  invalidEvidenceWithMalformedOwner.lane.liveOwnerSessionIds = [' owner '];
  assert.equal(decideProcessRecovery(invalidEvidenceWithMalformedOwner).code, 'INVALID_OWNERSHIP');

  const invalidEvidenceWithUnknownBlocker = snapshot({
    trace: { status: 'invalid', processRevision: 3, nextActions: ['repair-evidence'] },
  });
  invalidEvidenceWithUnknownBlocker.lane.blockerKind = 'unknown';
  assert.equal(decideProcessRecovery(invalidEvidenceWithUnknownBlocker).code, 'INVALID_BLOCKER');

  const ownerAndDecisionCollision = snapshot();
  ownerAndDecisionCollision.lane.liveOwnerSessionIds = [];
  ownerAndDecisionCollision.lane.blockerKind = 'human-decision';
  assert.equal(decideProcessRecovery(ownerAndDecisionCollision).code, 'OWNER_MISSING');
});

test('staleness uses a strict threshold and rejects future clock skew', () => {
  const exact = snapshot({ staleAfterMs: 60_000 });
  assert.equal(decideProcessRecovery(exact).decision, 'resume');

  const over = snapshot({ staleAfterMs: 59_999 });
  assert.equal(decideProcessRecovery(over).code, 'STALE_REVERIFY');

  const zero = snapshot({ nowMs: 0, staleAfterMs: 0 });
  zero.lane.updatedAtMs = 0;
  assert.equal(decideProcessRecovery(zero).decision, 'resume');

  const future = snapshot();
  future.lane.updatedAtMs = NOW + 1;
  assert.equal(decideProcessRecovery(future).code, 'CLOCK_SKEW');

  const max = snapshot({ nowMs: Number.MAX_SAFE_INTEGER, staleAfterMs: Number.MAX_SAFE_INTEGER });
  max.lane.updatedAtMs = 0;
  assert.equal(decideProcessRecovery(max).decision, 'resume');

  for (const [field, value] of [
    ['nowMs', -1],
    ['nowMs', 1.5],
    ['staleAfterMs', -1],
    ['staleAfterMs', Number.POSITIVE_INFINITY],
    ['staleAfterMs', Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.equal(decideProcessRecovery(snapshot({ [field]: value })).code, 'INVALID_CLOCK', `${field}:${value}`);
  }

  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const malformedLaneTime = snapshot();
    malformedLaneTime.lane.updatedAtMs = value;
    assert.equal(decideProcessRecovery(malformedLaneTime).code, 'INVALID_CLOCK', `updatedAtMs:${value}`);
  }
});

test('nested accessors and proxies are rejected without invoking getters', () => {
  let invoked = false;
  const accessor = snapshot();
  Object.defineProperty(accessor.process, 'state', { get() { invoked = true; return 'verify'; } });
  assert.equal(decideProcessRecovery(accessor).code, 'INVALID_INPUT');
  assert.equal(invoked, false);

  const proxied = snapshot();
  proxied.trace = new Proxy(proxied.trace, { get() { invoked = true; throw new Error('trap'); } });
  assert.equal(decideProcessRecovery(proxied).code, 'INVALID_INPUT');
  assert.equal(invoked, false);
});

test('does not mutate caller-owned state', () => {
  const input = snapshot();
  const before = structuredClone(input);
  decideProcessRecovery(input);
  assert.deepEqual(input, before);
});
