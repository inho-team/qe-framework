import { test } from 'node:test';
import assert from 'node:assert/strict';

let evaluateTransition;
try {
  ({ evaluateTransition } = await import('../process-kernel.mjs'));
} catch {
  // The first TDD run intentionally reaches the assertion below before the module exists.
}

const STATES = {
  plan: ['planned', 'active', 'blocked', 'complete'],
  goal: ['pending', 'active', 'blocked', 'failed', 'complete'],
  pse: ['plan', 'knowledge', 'spec', 'execute', 'verify', 'blocked', 'complete'],
  sivs: ['spec', 'implement', 'verify', 'supervise', 'remediate', 'blocked', 'complete'],
};

const AUTHORITIES = {
  plan: 'plan-controller',
  goal: 'goal-controller',
  pse: 'pse-controller',
  sivs: 'sivs-controller',
};

const REQUIRED = {
  plan: ['goalsVerified', 'independentVerification', 'goalAlignment'],
  goal: ['acceptance', 'implementation', 'machineVerification', 'independentVerification', 'goalAlignment'],
  pse: ['specification', 'implementation', 'machineVerification', 'independentVerification', 'goalAlignment'],
  sivs: ['specification', 'implementation', 'verification', 'supervision'],
};

function evaluate(request) {
  assert.equal(typeof evaluateTransition, 'function', 'process-kernel must export evaluateTransition');
  return evaluateTransition(request);
}

function request(layer, state, to, overrides = {}) {
  const snapshot = { state, revision: 2, ...(overrides.snapshot || {}) };
  return {
    layer,
    snapshot,
    expectedRevision: 2,
    to,
    authority: AUTHORITIES[layer],
    ...overrides,
    snapshot,
  };
}

function attestation(layer, revision = 2, overrides = {}) {
  return {
    status: 'valid',
    subject: layer,
    revision,
    proofRef: 'proof://1',
    issuedBy: 'verifier-a',
    sessionId: 'session-a',
    digest: 'sha256:abc',
    ...overrides,
  };
}

function completionAttestations(layer, revision = 2) {
  const result = Object.create(null);
  for (const key of REQUIRED[layer]) result[key] = attestation(layer, revision);
  if (layer === 'goal' || layer === 'pse') {
    result.implementation = attestation(layer, revision, { issuedBy: 'implementer', sessionId: 'implementation-session' });
    result.independentVerification = attestation(layer, revision, { issuedBy: 'verifier-a', sessionId: 'verification-session' });
    result.goalAlignment = attestation(layer, revision, { issuedBy: 'verifier-a', sessionId: 'alignment-session' });
  }
  return result;
}

function completionRequest(layer, state) {
  return request(layer, state, 'complete', {
    attestations: completionAttestations(layer),
    humanAcceptance: { required: false, status: 'not-required' },
  });
}

test('exports a total evaluateTransition API and rejects malformed base requests', () => {
  const malformed = [undefined, null, true, 1, 'x', [], {}, { layer: 'goal' }];
  for (const value of malformed) {
    const result = evaluate(value);
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'INVALID_REQUEST');
    assert.deepEqual(result.allowedNextStates, []);
    assert.equal(result.nextSnapshot, null);
    assert.ok(result.reason.trim());
  }

  for (const badRevision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.equal(evaluate(request('goal', 'pending', 'active', { snapshot: { revision: badRevision } })).code, 'INVALID_REQUEST');
  }
  assert.equal(evaluate(request('goal', 'pending', 'active', { snapshot: { attempt: -1 } })).code, 'INVALID_REQUEST');
});

test('normalizes state vocabulary only and compares authority byte-for-byte', () => {
  const normalized = evaluate(request(' GOAL ', ' Pending ', ' ACTIVE ', { authority: 'goal-controller' }));
  assert.equal(normalized.code, 'ALLOWED');
  assert.equal(normalized.layer, 'goal');
  assert.equal(normalized.from, 'pending');
  assert.equal(normalized.to, 'active');

  assert.equal(evaluate(request('goal', 'pending', 'active', { authority: ' goal-controller ' })).code, 'AUTHORITY_DENIED');
  assert.equal(evaluate(request('goal', 'pending', 'completed')).code, 'UNKNOWN_STATE');
  assert.equal(evaluate(request('unknown', 'pending', 'active', { authority: 'goal-controller' })).code, 'UNKNOWN_LAYER');
});

test('allows every declared state-changing edge', () => {
  const edges = {
    plan: [['planned', 'active'], ['active', 'blocked'], ['active', 'complete']],
    goal: [['pending', 'active'], ['active', 'blocked'], ['active', 'failed'], ['failed', 'active'], ['active', 'complete']],
    pse: [['plan', 'knowledge'], ['knowledge', 'spec'], ['spec', 'execute'], ['execute', 'verify'], ['execute', 'spec'], ['verify', 'execute'], ['verify', 'spec'], ['verify', 'complete']],
    sivs: [['spec', 'implement'], ['implement', 'verify'], ['verify', 'supervise'], ['verify', 'remediate'], ['supervise', 'remediate'], ['remediate', 'spec'], ['remediate', 'implement'], ['remediate', 'verify'], ['supervise', 'complete']],
  };

  for (const [layer, pairs] of Object.entries(edges)) {
    for (const [from, to] of pairs) {
      const req = to === 'complete' ? completionRequest(layer, from) : request(layer, from, to);
      const result = evaluate(req);
      assert.equal(result.code, 'ALLOWED', `${layer} ${from}->${to}`);
      const expectedSnapshot = to === 'blocked'
        ? { state: to, revision: 3, resumeState: from }
        : { state: to, revision: 3 };
      assert.deepEqual(result.nextSnapshot, expectedSnapshot);
      assert.equal(result.baseRevision, 2);
    }
  }

  for (const layer of ['pse', 'sivs']) {
    for (const from of STATES[layer].filter((state) => !['blocked', 'complete'].includes(state))) {
      const result = evaluate(request(layer, from, 'blocked'));
      assert.equal(result.code, 'ALLOWED', `${layer} ${from}->blocked`);
      assert.deepEqual(result.nextSnapshot, { state: 'blocked', revision: 3, resumeState: from });
    }
  }
});

test('enforces blocked invariants before idempotence and supports explicit exits', () => {
  assert.equal(evaluate(request('goal', 'blocked', 'blocked')).code, 'INVALID_REQUEST');
  assert.equal(evaluate(request('goal', 'blocked', 'blocked', { snapshot: { resumeState: 'bogus' } })).code, 'UNKNOWN_STATE');
  assert.equal(evaluate(request('goal', 'blocked', 'blocked', { snapshot: { resumeState: 'complete' } })).code, 'TRANSITION_DENIED');
  assert.equal(evaluate(request('goal', 'active', 'active', { snapshot: { resumeState: 'bogus' } })).code, 'INVALID_REQUEST');

  const idempotent = evaluate(request('goal', 'blocked', 'blocked', { snapshot: { resumeState: 'active', attempt: 4 } }));
  assert.equal(idempotent.code, 'IDEMPOTENT');
  assert.deepEqual(idempotent.nextSnapshot, { state: 'blocked', revision: 2, resumeState: 'active', attempt: 4 });

  const resumed = evaluate(request('goal', 'blocked', 'active', { snapshot: { resumeState: 'active' } }));
  assert.equal(resumed.code, 'ALLOWED');
  assert.deepEqual(resumed.nextSnapshot, { state: 'active', revision: 3 });

  const failed = evaluate(request('goal', 'blocked', 'failed', { snapshot: { resumeState: 'active' } }));
  assert.equal(failed.code, 'ALLOWED');
  assert.deepEqual(failed.nextSnapshot, { state: 'failed', revision: 3 });
});

test('treats valid same-state requests as idempotent and complete as terminal', () => {
  for (const [layer, states] of Object.entries(STATES)) {
    for (const state of states) {
      const overrides = state === 'blocked'
        ? { snapshot: { resumeState: layer === 'plan' || layer === 'goal' ? 'active' : states[0] } }
        : {};
      const result = evaluate(request(layer, state, state, overrides));
      assert.equal(result.code, 'IDEMPOTENT', `${layer}:${state}`);
      assert.equal(result.nextSnapshot.revision, 2);
      assert.notStrictEqual(result.nextSnapshot, overrides.snapshot);
    }
    assert.equal(evaluate(request(layer, 'complete', states[0])).code, 'TRANSITION_DENIED');
  }
});

test('applies deterministic precedence for stale revision, authority, and transition', () => {
  const stale = evaluate(request('goal', 'pending', 'complete', {
    expectedRevision: 1,
    authority: 'wrong',
    attestations: {},
  }));
  assert.equal(stale.code, 'STALE_SNAPSHOT');
  assert.equal(stale.baseRevision, 2);

  const denied = evaluate(request('goal', 'pending', 'complete', { authority: 'wrong', attestations: {} }));
  assert.equal(denied.code, 'AUTHORITY_DENIED');

  const transition = evaluate(request('goal', 'pending', 'complete', { attestations: {} }));
  assert.equal(transition.code, 'TRANSITION_DENIED');
});

test('keeps revision closure at Number.MAX_SAFE_INTEGER', () => {
  const snapshot = { revision: Number.MAX_SAFE_INTEGER };
  const same = evaluate(request('goal', 'pending', 'pending', { snapshot, expectedRevision: Number.MAX_SAFE_INTEGER }));
  assert.equal(same.code, 'IDEMPOTENT');
  assert.equal(same.nextSnapshot.revision, Number.MAX_SAFE_INTEGER);

  const change = evaluate(request('goal', 'pending', 'active', { snapshot, expectedRevision: Number.MAX_SAFE_INTEGER }));
  assert.equal(change.code, 'REVISION_EXHAUSTED');
  assert.equal(change.nextSnapshot, null);
});

test('returns exact completion missing and malformed evidence decisions', () => {
  for (const layer of Object.keys(REQUIRED)) {
    const state = layer === 'plan' || layer === 'goal' ? 'active' : layer === 'pse' ? 'verify' : 'supervise';
    const absent = evaluate(request(layer, state, 'complete'));
    assert.equal(absent.code, 'EVIDENCE_MISSING');
    assert.deepEqual(absent.missingEvidence, REQUIRED[layer]);

    const malformed = evaluate(request(layer, state, 'complete', { attestations: [] }));
    assert.equal(malformed.code, 'EVIDENCE_INVALID');
    assert.deepEqual(malformed.missingEvidence, REQUIRED[layer]);

    const mixed = completionAttestations(layer);
    const invalidKey = REQUIRED[layer][0];
    const missingKey = REQUIRED[layer][1];
    mixed[invalidKey] = [];
    delete mixed[missingKey];
    const mixedResult = evaluate(request(layer, state, 'complete', { attestations: mixed }));
    assert.equal(mixedResult.code, 'EVIDENCE_INVALID');
    assert.deepEqual(mixedResult.missingEvidence, [invalidKey]);
  }
});

test('validates every attestation field and accepts null-prototype maps', () => {
  const base = completionAttestations('goal');
  const corruptions = {
    status: 'invalid',
    subject: 'plan',
    revision: 1,
    proofRef: '   ',
    issuedBy: '',
    sessionId: '\t',
    digest: ' ',
  };
  for (const [field, value] of Object.entries(corruptions)) {
    const attestations = completionAttestations('goal');
    attestations.acceptance = { ...attestations.acceptance, [field]: value };
    const result = evaluate(request('goal', 'active', 'complete', { attestations }));
    assert.equal(result.code, 'EVIDENCE_INVALID', field);
    assert.deepEqual(result.missingEvidence, ['acceptance']);
  }

  const human = Object.assign(Object.create(null), { required: false, status: 'not-required' });
  const accepted = evaluate(request('goal', 'active', 'complete', { attestations: base, humanAcceptance: human }));
  assert.equal(accepted.code, 'ALLOWED');
});

test('returns exact implicated keys for relational attestation failures', () => {
  const sameSession = completionAttestations('goal');
  sameSession.implementation.sessionId = sameSession.independentVerification.sessionId;
  assert.deepEqual(
    evaluate(request('goal', 'active', 'complete', { attestations: sameSession })).missingEvidence,
    ['implementation', 'independentVerification'],
  );

  const issuerMismatch = completionAttestations('goal');
  issuerMismatch.goalAlignment.issuedBy = 'another-verifier';
  assert.deepEqual(
    evaluate(request('goal', 'active', 'complete', { attestations: issuerMismatch })).missingEvidence,
    ['independentVerification', 'goalAlignment'],
  );

  const both = completionAttestations('pse');
  both.implementation.sessionId = both.independentVerification.sessionId;
  both.goalAlignment.issuedBy = 'another-verifier';
  assert.deepEqual(
    evaluate(request('pse', 'verify', 'complete', { attestations: both })).missingEvidence,
    ['implementation', 'independentVerification', 'goalAlignment'],
  );
});

test('enforces the human acceptance truth table only for state-changing completion', () => {
  const attestations = completionAttestations('goal');
  const cases = [
    [undefined, 'HUMAN_ACCEPTANCE_MISSING'],
    [null, 'HUMAN_ACCEPTANCE_MISSING'],
    [{ required: true, status: 'not-required' }, 'HUMAN_ACCEPTANCE_MISSING'],
    [{ required: true, status: 'passed', proofRef: ' ' }, 'HUMAN_ACCEPTANCE_MISSING'],
    [{ required: true, status: 'passed', proofRef: 'approval://1' }, 'ALLOWED'],
    [{ required: false, status: 'not-required' }, 'ALLOWED'],
    [{ required: false, status: 'passed' }, 'HUMAN_ACCEPTANCE_MISSING'],
    [{ required: false, status: 'passed', proofRef: 'approval://1' }, 'ALLOWED'],
  ];
  for (const [humanAcceptance, code] of cases) {
    const result = evaluate(request('goal', 'active', 'complete', { attestations, humanAcceptance }));
    assert.equal(result.code, code);
    if (code === 'HUMAN_ACCEPTANCE_MISSING') assert.deepEqual(result.missingEvidence, []);
  }

  assert.equal(evaluate(request('goal', 'complete', 'complete', { attestations: [], humanAcceptance: null })).code, 'IDEMPOTENT');
  assert.equal(evaluate(request('goal', 'pending', 'active', { attestations: [], humanAcceptance: null })).code, 'ALLOWED');
});

test('returns deterministic allowedNextStates arrays', () => {
  assert.deepEqual(evaluate(request('goal', 'active', 'completed')).allowedNextStates, ['active', 'blocked', 'failed', 'complete']);
  assert.deepEqual(evaluate(request('goal', 'blocked', 'failed', { snapshot: { resumeState: 'active' } })).allowedNextStates, ['active', 'blocked', 'failed']);
  assert.deepEqual(evaluate(request('plan', 'blocked', 'active', { snapshot: { resumeState: 'active' } })).allowedNextStates, ['active', 'blocked']);
  assert.deepEqual(evaluate(request('pse', 'blocked', 'verify', { snapshot: { resumeState: 'verify' } })).allowedNextStates, ['verify', 'blocked']);
  assert.deepEqual(evaluate(request('sivs', 'complete', 'complete')).allowedNextStates, ['complete']);
  assert.deepEqual(evaluate(request('goal', 'blocked', 'blocked', { snapshot: { resumeState: 'bogus' } })).allowedNextStates, []);
});

test('does not mutate or alias frozen nested input and returns fresh deterministic values', () => {
  const input = completionRequest('goal', 'active');
  input.snapshot.attempt = 3;
  input.snapshot.ignored = Object.freeze({ nested: Object.freeze(['x']) });
  for (const value of Object.values(input.attestations)) Object.freeze(value);
  Object.freeze(input.attestations);
  Object.freeze(input.humanAcceptance);
  Object.freeze(input.snapshot);
  Object.freeze(input);

  const first = evaluate(input);
  const second = evaluate(input);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.allowedNextStates, second.allowedNextStates);
  assert.notStrictEqual(first.missingEvidence, second.missingEvidence);
  assert.deepEqual(first.nextSnapshot, { state: 'complete', revision: 3, attempt: 3 });

  first.allowedNextStates.push('tampered');
  assert.ok(!second.allowedNextStates.includes('tampered'));
});

test('captures accessor-backed snapshot fields once and never constructs an unsafe revision', () => {
  let revisionReads = 0;
  const snapshot = { state: 'pending' };
  Object.defineProperty(snapshot, 'revision', {
    enumerable: true,
    get() {
      revisionReads += 1;
      return revisionReads === 1 ? 2 : Number.MAX_SAFE_INTEGER;
    },
  });
  Object.freeze(snapshot);

  const result = evaluate({
    layer: 'goal',
    snapshot,
    expectedRevision: 2,
    to: 'active',
    authority: 'goal-controller',
  });
  assert.equal(result.code, 'ALLOWED');
  assert.equal(result.baseRevision, 2);
  assert.equal(result.nextSnapshot.revision, 3);
  assert.equal(revisionReads, 1);
  assert.ok(Number.isSafeInteger(result.nextSnapshot.revision));
});

test('contains hostile completion accessors within their validation stage', () => {
  const throwingEvidence = completionAttestations('goal');
  Object.defineProperty(throwingEvidence, 'acceptance', {
    enumerable: true,
    get() { throw new Error('hostile evidence getter'); },
  });
  const evidenceResult = evaluate(request('goal', 'active', 'complete', {
    attestations: throwingEvidence,
    humanAcceptance: { required: false, status: 'not-required' },
  }));
  assert.equal(evidenceResult.code, 'EVIDENCE_INVALID');
  assert.deepEqual(evidenceResult.missingEvidence, ['acceptance']);
  assert.deepEqual(evidenceResult.allowedNextStates, ['active', 'blocked', 'failed', 'complete']);

  const hostileRoot = new Proxy({}, {
    getPrototypeOf() { throw new Error('hostile evidence proxy'); },
  });
  const rootResult = evaluate(request('goal', 'active', 'complete', { attestations: hostileRoot }));
  assert.equal(rootResult.code, 'EVIDENCE_INVALID');
  assert.deepEqual(rootResult.missingEvidence, REQUIRED.goal);

  const hostileHuman = {};
  Object.defineProperty(hostileHuman, 'required', {
    enumerable: true,
    get() { throw new Error('hostile human getter'); },
  });
  const humanResult = evaluate(request('goal', 'active', 'complete', {
    attestations: completionAttestations('goal'),
    humanAcceptance: hostileHuman,
  }));
  assert.equal(humanResult.code, 'HUMAN_ACCEPTANCE_MISSING');
  assert.deepEqual(humanResult.allowedNextStates, ['active', 'blocked', 'failed', 'complete']);
});

test('locks plain-object provenance boundaries', () => {
  const nullPrototypeEntry = Object.assign(Object.create(null), attestation('goal'));
  const attestations = completionAttestations('goal');
  attestations.acceptance = nullPrototypeEntry;
  assert.equal(evaluate(request('goal', 'active', 'complete', {
    attestations,
    humanAcceptance: { required: false, status: 'not-required' },
  })).code, 'ALLOWED');

  const inherited = Object.create({ acceptance: attestation('goal') });
  const inheritedResult = evaluate(request('goal', 'active', 'complete', { attestations: inherited }));
  assert.equal(inheritedResult.code, 'EVIDENCE_INVALID');
  assert.deepEqual(inheritedResult.missingEvidence, REQUIRED.goal);
});

test('rejects completion fields inherited through Object.prototype', () => {
  const attestationFields = attestation('goal');
  try {
    for (const [key, value] of Object.entries(attestationFields)) {
      Object.defineProperty(Object.prototype, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
    const attestations = completionAttestations('goal');
    attestations.acceptance = {};
    const result = evaluate(request('goal', 'active', 'complete', {
      attestations,
      humanAcceptance: { required: false, status: 'not-required' },
    }));
    assert.equal(result.code, 'EVIDENCE_INVALID');
    assert.deepEqual(result.missingEvidence, ['acceptance']);
  } finally {
    for (const key of Object.keys(attestationFields)) delete Object.prototype[key];
  }

  try {
    Object.defineProperties(Object.prototype, {
      required: { value: false, configurable: true, writable: true },
      status: { value: 'passed', configurable: true, writable: true },
      proofRef: { value: 'approval://polluted', configurable: true, writable: true },
    });
    const result = evaluate(request('goal', 'active', 'complete', {
      attestations: completionAttestations('goal'),
      humanAcceptance: {},
    }));
    assert.equal(result.code, 'HUMAN_ACCEPTANCE_MISSING');
  } finally {
    delete Object.prototype.required;
    delete Object.prototype.status;
    delete Object.prototype.proofRef;
  }
});

test('classifies prototype-colliding layer names as UNKNOWN_LAYER', () => {
  for (const layer of ['__proto__', 'constructor', 'toString']) {
    const result = evaluate({
      layer,
      snapshot: { state: 'pending', revision: 0 },
      expectedRevision: 0,
      to: 'active',
      authority: 'goal-controller',
    });
    assert.equal(result.code, 'UNKNOWN_LAYER', layer);
    assert.deepEqual(result.allowedNextStates, []);
  }
});

test('exhaustively denies every undeclared state pair', () => {
  const stateChanging = {
    plan: new Set(['planned>active', 'active>blocked', 'active>complete', 'blocked>active']),
    goal: new Set(['pending>active', 'active>blocked', 'active>failed', 'active>complete', 'blocked>active', 'blocked>failed', 'failed>active']),
    pse: new Set(['plan>knowledge', 'knowledge>spec', 'spec>execute', 'execute>spec', 'execute>verify', 'verify>spec', 'verify>execute', 'verify>complete']),
    sivs: new Set(['spec>implement', 'implement>verify', 'verify>supervise', 'verify>remediate', 'supervise>remediate', 'supervise>complete', 'remediate>spec', 'remediate>implement', 'remediate>verify']),
  };
  for (const layer of ['pse', 'sivs']) {
    for (const from of STATES[layer].filter((state) => !['blocked', 'complete'].includes(state))) {
      stateChanging[layer].add(`${from}>blocked`);
    }
  }

  for (const [layer, states] of Object.entries(STATES)) {
    const resumeState = layer === 'plan' || layer === 'goal' ? 'active' : states[0];
    for (const from of states) {
      for (const to of states) {
        const key = `${from}>${to}`;
        const allowed = from === to || stateChanging[layer].has(key)
          || (from === 'blocked' && to === resumeState);
        const overrides = from === 'blocked' ? { snapshot: { resumeState } } : {};
        if (to === 'complete' && allowed && from !== to) {
          Object.assign(overrides, {
            attestations: completionAttestations(layer),
            humanAcceptance: { required: false, status: 'not-required' },
          });
        }
        const result = evaluate(request(layer, from, to, overrides));
        assert.equal(result.allowed, allowed, `${layer} ${key}`);
        if (!allowed) assert.equal(result.code, 'TRANSITION_DENIED', `${layer} ${key}`);
      }
    }
  }
});
