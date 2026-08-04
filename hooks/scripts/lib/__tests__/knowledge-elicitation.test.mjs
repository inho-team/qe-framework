import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_INTAKE_POLICY,
  IntakeTransitionError,
  answerQuestion,
  classifyMateriality,
  confirmIntake,
  correctAnswer,
  correctSynthesis,
  createIntake,
  formatQuestionLabel,
  issueNextBatch,
  pauseIntake,
  rebaselineIntake,
  requestRebaseline,
  resumeIntake,
  skipQuestion,
  stopIntake,
  synthesizeIntake,
} from '../knowledge-elicitation.mjs';

const base = (ordinal, overrides = {}) => ({
  id: `q${ordinal}`,
  text: `Question ${ordinal}`,
  dimension: 'scope',
  material: true,
  reversible: false,
  kind: 'base',
  ordinal,
  ...overrides,
});

const nonMaterial = (ordinal, overrides = {}) => base(ordinal, {
  dimension: 'preference', material: false, reversible: true, ...overrides,
});

const issueOne = (state) => {
  const issued = issueNextBatch(state);
  assert.equal(issued.questions.length, 1);
  return issued;
};

const expectCode = (code, fn) => assert.throws(fn, (error) => {
  assert.ok(error instanceof IntakeTransitionError);
  assert.equal(error.code, code);
  return true;
});

test('R001 exposes exact immutable policy and stable labels', () => {
  assert.deepEqual(DEFAULT_INTAKE_POLICY, {
    baseLimit: 30,
    followUpPerParentLimit: 3,
    followUpAllocationLimit: 12,
    issuedVersionLimit: 42,
    batchSize: 3,
    rebaselineLimit: 1,
    synthesisCorrectionLimit: 2,
    answerCorrectionLimit: 6,
    resumeLimit: 10,
  });
  assert.ok(Object.isFrozen(DEFAULT_INTAKE_POLICY));
  const state = createIntake({ inventory: Array.from({ length: 30 }, (_, index) => base(index + 1)) });
  assert.equal(createIntake({ inventory: Array.from({ length: 29 }, (_, index) => base(index + 1)) }).baseTotal, 29);
  assert.equal(formatQuestionLabel(state.questions[16], state), '[17/30]');
  assert.equal(createIntake({ inventory: [] }).status, 'awaiting-confirmation');
  expectCode('INTAKE_BASE_LIMIT', () => createIntake({
    inventory: Array.from({ length: 31 }, (_, index) => base(index + 1)),
  }));
});

test('R003 materiality is fail-closed and explicit reversible non-material only', () => {
  for (const dimension of ['scope', 'acceptance', 'irreversible', 'risk', 'constraint', 'external-integration']) {
    assert.equal(classifyMateriality({ dimension, material: false, reversible: true }), true);
  }
  for (const dimension of [undefined, null, '', 'novel', {}, 7]) {
    assert.equal(classifyMateriality({ dimension, material: false, reversible: true }), true);
  }
  for (const dimension of ['preference', 'presentation', 'naming', 'reversible-default']) {
    assert.equal(classifyMateriality({ dimension, material: false, reversible: true }), false);
    assert.equal(classifyMateriality({ dimension, material: false, reversible: false }), true);
    assert.equal(classifyMateriality({ dimension, material: true, reversible: true }), true);
  }
});

test('R001 batch issuance is follow-up first, capped at three, charged once, and redelivery is read-only', () => {
  let state = createIntake({ inventory: [base(1), base(2), base(3), base(4)] });
  const first = issueNextBatch(state);
  assert.deepEqual(first.questions.map((q) => q.id), ['q1', 'q2', 'q3']);
  assert.equal(first.state.counters.issuedVersions, 3);
  const bytes = JSON.stringify(first.state);
  const redelivery = issueNextBatch(first.state);
  assert.deepEqual(redelivery.questions.map((q) => q.id), ['q1', 'q2', 'q3']);
  assert.equal(JSON.stringify(redelivery.state), bytes);
  assert.notEqual(redelivery.state, first.state);
  assert.notEqual(redelivery.questions[0], first.questions[0]);

  state = answerQuestion(first.state, 'q1', { value: 'a', followUps: [
    { id: 'f1', text: 'F1', dimension: 'scope', material: true, reversible: false },
  ] });
  state = answerQuestion(state, 'q2', { value: 'b' });
  state = answerQuestion(state, 'q3', { value: 'c' });
  const next = issueNextBatch(state);
  assert.deepEqual(next.questions.map((q) => q.id), ['f1', 'q4']);
  assert.equal(next.questions[0].label, '[1-1/1]');
});

test('R001 follow-up active/allocation limits and generated ordinals are exact', () => {
  let state = issueOne(createIntake({ inventory: [base(1)] })).state;
  state = answerQuestion(state, 'q1', { value: 'a', followUps: [1, 2, 3].map((n) => ({
    id: `f${n}`, text: `F${n}`, dimension: 'scope', material: true, reversible: false,
  })) });
  assert.deepEqual(state.questions.filter((q) => q.kind === 'followup').map((q) => q.ordinal), [1, 2, 3]);
  assert.equal(state.counters.followUpAllocations, 3);

  let below = issueOne(createIntake({ inventory: [base(1)] })).state;
  below = answerQuestion(below, 'q1', { value: 'a', followUps: [1, 2].map((n) => ({
    id: `below${n}`, text: 'x', dimension: 'risk',
  })) });
  assert.equal(below.questions.filter((q) => q.kind === 'followup' && q.status === 'pending').length, 2);

  let fresh = issueOne(createIntake({ inventory: [base(1)] })).state;
  expectCode('INTAKE_FOLLOWUP_PARENT_LIMIT', () => answerQuestion(fresh, 'q1', {
    value: 'a', followUps: [1, 2, 3, 4].map((n) => ({ id: `x${n}`, text: 'x', dimension: 'risk' })),
  }));

  const inventory = Array.from({ length: 5 }, (_, i) => base(i + 1));
  fresh = createIntake({ inventory });
  let batch = issueNextBatch(fresh); fresh = batch.state;
  for (const id of ['q1', 'q2', 'q3']) fresh = answerQuestion(fresh, id, { value: id, followUps: [1, 2, 3].map((n) => ({ id: `${id}f${n}`, text: 'x', dimension: 'risk' })) });
  batch = issueNextBatch(fresh); fresh = batch.state;
  for (const q of batch.questions) fresh = answerQuestion(fresh, q.id, { value: q.id });
  batch = issueNextBatch(fresh); fresh = batch.state;
  for (const q of batch.questions) fresh = answerQuestion(fresh, q.id, { value: q.id });
  batch = issueNextBatch(fresh); fresh = batch.state;
  for (const q of batch.questions) fresh = answerQuestion(fresh, q.id, { value: q.id });
  batch = issueNextBatch(fresh); fresh = batch.state;
  fresh = answerQuestion(fresh, 'q4', { value: 'q4', followUps: [1, 2, 3].map((n) => ({ id: `q4f${n}`, text: 'x', dimension: 'risk' })) });
  fresh = answerQuestion(fresh, 'q5', { value: 'q5' });
  assert.equal(fresh.counters.followUpAllocations, 12);
  // q5 is already answered; correcting it is the only path that can request another set.
  expectCode('INTAKE_FOLLOWUP_ALLOCATION_LIMIT', () => correctAnswer(fresh, 'q5', {
    value: 'new', followUps: [{ id: 'overflow', text: 'x', dimension: 'risk' }],
  }));
});

test('R001 unique issuance survives invalidation and attempted 43 splits', () => {
  const policy = { ...DEFAULT_INTAKE_POLICY, issuedVersionLimit: 2, batchSize: 1 };
  let state = createIntake({ inventory: [base(1), base(2)], policy });
  let batch = issueNextBatch(state); state = batch.state;
  state = answerQuestion(state, 'q1', { value: 'a', followUps: [{ id: 'f1', text: 'f', dimension: 'risk' }] });
  batch = issueNextBatch(state); state = batch.state;
  assert.equal(state.counters.issuedVersions, 2);
  state = correctAnswer(state, 'q1', { value: 'b', followUps: [{ id: 'f2', text: 'f2', dimension: 'risk' }] });
  assert.equal(state.counters.issuedVersions, 2);
  assert.equal(state.questions.find((q) => q.id === 'f1').status, 'invalidated');
  state = issueNextBatch(state).state;
  assert.equal(state.status, 'split-required');
  assert.equal(state.counters.issuedVersions, 2);
});

test('R001 hard issued-version boundary reaches 41 and 42 without early termination', () => {
  let state = createIntake({ inventory: Array.from({ length: 30 }, (_, index) => base(index + 1)) });
  let saw41 = false;
  while (state.counters.issuedVersions < 42) {
    const batch = issueNextBatch(state);
    state = batch.state;
    for (const question of batch.questions) {
      const remaining = 42 - state.counters.issuedVersions;
      saw41 ||= state.counters.issuedVersions === 41;
      const followUps = question.kind === 'base' && question.ordinal <= 4
        ? [1, 2, 3].map((n) => ({ id: `hard-${question.id}-${n}`, text: 'hard', dimension: 'risk' }))
        : [];
      state = answerQuestion(state, question.id, { value: remaining, followUps });
    }
  }
  assert.equal(state.counters.issuedVersions, 42);
  assert.equal(state.counters.followUpAllocations, 12);
  // Batch size 3 means the counter normally jumps 39 -> 42; a lowered batch proves the -1 boundary separately.
  let oneByOne = createIntake({ inventory: Array.from({ length: 30 }, (_, index) => base(index + 1)), policy: {
    ...DEFAULT_INTAKE_POLICY, batchSize: 1,
  } });
  while (oneByOne.counters.issuedVersions < 41) {
    const batch = issueNextBatch(oneByOne); oneByOne = batch.state;
    const question = batch.questions[0];
    oneByOne = answerQuestion(oneByOne, question.id, {
      value: question.id,
      followUps: question.kind === 'base' && question.ordinal <= 4
        ? [1, 2, 3].map((n) => ({ id: `single-${question.id}-${n}`, text: 'hard', dimension: 'risk' })) : [],
    });
  }
  assert.equal(oneByOne.counters.issuedVersions, 41);
  assert.equal(saw41, false);
});

test('R002 answers, explicit non-material skips, material blocks, and source conflicts are typed', () => {
  const source = { id: 'src1', value: { version: 1 }, provenance: { uri: 'memo' } };
  let state = createIntake({ inventory: [base(1), nonMaterial(2)], sourceFacts: [source] });
  let batch = issueNextBatch(state); state = batch.state;
  state = answerQuestion(state, 'q1', {
    value: { choice: 'yes' }, kind: 'user-decision', provenance: { actor: 'user' }, conflictsWith: ['src1'],
  });
  const answer = state.knowledge.find((item) => item.provenance?.questionId === 'q1');
  assert.equal(answer.kind, 'user-decision');
  assert.deepEqual(answer.conflictsWith, ['src1']);
  assert.ok(state.knowledge.some((item) => item.id === 'src1' && item.kind === 'source-fact'));
  state = skipQuestion(state, 'q2', { reason: 'default' });
  assert.equal(state.status, 'questioning');
  assert.ok(state.knowledge.some((item) => item.kind === 'assumption' && item.provenance.questionId === 'q2'));

  batch = issueNextBatch(createIntake({ inventory: [base(1)] }));
  state = skipQuestion(batch.state, 'q1', { reason: 'unknown' });
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, 'MATERIAL_QUESTION_SKIPPED');

  batch = issueNextBatch(createIntake({ inventory: [base(1)] }));
  expectCode('INTAKE_UNKNOWN_SOURCE_CONFLICT', () => answerQuestion(batch.state, 'q1', {
    value: 'x', conflictsWith: ['missing'],
  }));
});

test('R002 correction preserves values, per-predecessor causal events, and blocks seventh correction', () => {
  let state = issueOne(createIntake({ inventory: [base(1)] })).state;
  state = answerQuestion(state, 'q1', { value: 'v0', followUps: [1, 2].map((n) => ({
    id: `f${n}`, text: 'old', dimension: 'risk',
  })) });
  for (let n = 1; n <= 6; n += 1) {
    state = correctAnswer(state, 'q1', {
      value: `v${n}`,
      followUps: n === 1 ? [{ id: 'replacement', text: 'new', dimension: 'risk' }] : [],
    });
  }
  assert.equal(state.counters.answerCorrections, 6);
  assert.ok(state.knowledge.filter((item) => item.kind === 'superseded').some((item) => item.value === 'v0'));
  const invalidations = state.history.filter((event) => event.type === 'followup-invalidated');
  assert.equal(invalidations.length, 3); // f1, f2, then replacement on the next set correction
  assert.ok(invalidations.every((event) => event.supersedes.length === 1));
  const blocked = correctAnswer(state, 'q1', { value: 'v7' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'ANSWER_CORRECTION_LIMIT');
});

test('R002 pause/resume exact limit and stop preserve earliest unresolved label', () => {
  let state = issueOne(createIntake({ inventory: [base(1)] })).state;
  for (let n = 0; n < 10; n += 1) {
    state = pauseIntake(state);
    assert.equal(state.status, 'paused');
    state = resumeIntake(state);
    assert.equal(state.status, 'questioning');
  }
  assert.equal(state.counters.resumeCycles, 10);
  const blocked = pauseIntake(state);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'PAUSE_RESUME_LIMIT');
  assert.equal(blocked.earliestUnresolvedLabel, '[1/1]');

  state = stopIntake(issueOne(createIntake({ inventory: [base(1)] })).state);
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, 'BLOCKED_BY_USER');
  assert.equal(state.history.at(-1).type, 'intake-stopped');
});

test('R002 re-baseline accepts once, decline blocks, repeat and overflow split', () => {
  let state = issueOne(createIntake({ inventory: [base(1)] })).state;
  state = answerQuestion(state, 'q1', { value: 'done' });
  state = requestRebaseline(state);
  assert.equal(state.status, 'awaiting-rebaseline');
  state = rebaselineIntake(state, { decision: 'accept', inventory: [base(1, { id: 'q2' })] });
  assert.equal(state.status, 'questioning');
  assert.equal(state.counters.rebaselines, 1);
  assert.equal(state.counters.issuedVersions, 1);
  state = requestRebaseline(state);
  assert.equal(state.status, 'split-required');

  let declined = requestRebaseline(issueOne(createIntake({ inventory: [base(1)] })).state);
  declined = rebaselineIntake(declined, { decision: 'decline' });
  assert.equal(declined.status, 'blocked');
  assert.equal(declined.reason, 'REBASELINE_DECLINED');

  const policy = { ...DEFAULT_INTAKE_POLICY, issuedVersionLimit: 2, batchSize: 1 };
  let overflow = issueOne(createIntake({ inventory: [base(1)], policy })).state;
  overflow = answerQuestion(overflow, 'q1', { value: 'done' });
  overflow = requestRebaseline(overflow);
  overflow = rebaselineIntake(overflow, { decision: 'accept', inventory: [base(1, { id: 'n1' }), base(2, { id: 'n2' })] });
  assert.equal(overflow.status, 'split-required');
});

test('R002 synthesis correction is bounded, material changes use remaining rebaseline, and confirmation is terminal', () => {
  let state = issueOne(createIntake({ inventory: [base(1)] })).state;
  state = answerQuestion(state, 'q1', { value: 'done' });
  state = synthesizeIntake(state, { summary: { decision: 'done' } });
  assert.equal(state.status, 'awaiting-confirmation');
  state = correctSynthesis(state, { synthesis: { decision: 'better' } });
  state = correctSynthesis(state, { synthesis: { decision: 'best' } });
  assert.equal(state.counters.synthesisCorrections, 2);
  state = correctSynthesis(state, { synthesis: { decision: 'too many' } });
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, 'SYNTHESIS_CORRECTION_LIMIT');

  let material = issueOne(createIntake({ inventory: [base(1)] })).state;
  material = answerQuestion(material, 'q1', { value: 'done' });
  material = synthesizeIntake(material, { summary: 'draft' });
  material = correctSynthesis(material, { synthesis: 'changed', materialChange: true });
  assert.equal(material.status, 'awaiting-rebaseline');

  let confirmed = issueOne(createIntake({ inventory: [base(1)] })).state;
  confirmed = answerQuestion(confirmed, 'q1', { value: 'done' });
  confirmed = synthesizeIntake(confirmed, { summary: 'ok' });
  confirmed = confirmIntake(confirmed);
  assert.equal(confirmed.status, 'confirmed');
  expectCode('INTAKE_TERMINAL', () => stopIntake(confirmed));
});

test('R002 full action/status legality uses uniform stable codes', () => {
  const draftLike = { schema: 1, status: 'draft' };
  expectCode('INTAKE_INVALID_TRANSITION', () => pauseIntake(draftLike));
  let questioning = issueOne(createIntake({ inventory: [base(1)] })).state;
  expectCode('INTAKE_INVALID_TRANSITION', () => resumeIntake(questioning));
  const paused = pauseIntake(questioning);
  for (const fn of [issueNextBatch, (s) => answerQuestion(s, 'q1', { value: 'x' }), synthesizeIntake, requestRebaseline]) {
    expectCode('INTAKE_INVALID_TRANSITION', () => fn(paused));
  }
  const awaitingRebaseline = requestRebaseline(questioning);
  expectCode('INTAKE_INVALID_TRANSITION', () => confirmIntake(awaitingRebaseline));
  questioning = answerQuestion(questioning, 'q1', { value: 'x' });
  const awaitingConfirmation = synthesizeIntake(questioning, { summary: 'x' });
  expectCode('INTAKE_INVALID_TRANSITION', () => pauseIntake(awaitingConfirmation));
  for (const status of ['confirmed', 'blocked', 'split-required']) {
    const terminal = { ...awaitingConfirmation, status };
    for (const fn of [issueNextBatch, pauseIntake, resumeIntake, requestRebaseline, confirmIntake]) {
      expectCode('INTAKE_TERMINAL', () => fn(terminal));
    }
  }
});

test('R003 validation rejects malformed/colliding/non-JSON-safe data without mutation or aliasing', () => {
  const inventory = [base(1, { text: 'owned' })];
  const sourceFacts = [{ id: 'src', value: { nested: ['owned'] }, provenance: {} }];
  const input = { inventory, sourceFacts };
  const before = structuredClone(input);
  const state = createIntake(input);
  assert.deepEqual(input, before);
  inventory[0].text = 'mutated'; sourceFacts[0].value.nested[0] = 'mutated';
  assert.equal(state.questions[0].text, 'owned');
  assert.equal(state.knowledge[0].value.nested[0], 'owned');

  expectCode('INTAKE_DUPLICATE_ID', () => createIntake({ inventory: [base(1), base(2, { id: 'q1' })] }));
  expectCode('INTAKE_DUPLICATE_ID', () => createIntake({ inventory: [base(1)], sourceFacts: [{ id: 'q1', value: 1 }] }));
  expectCode('INTAKE_INVALID_QUESTION', () => createIntake({ inventory: [base(2)] }));
  expectCode('INTAKE_INVALID_QUESTION', () => createIntake({ inventory: [base(1, { parentId: 'x' })] }));
  expectCode('INTAKE_NOT_JSON_SAFE', () => createIntake({ inventory: [base(1, { text: undefined })] }));
  const cyclic = {}; cyclic.self = cyclic;
  expectCode('INTAKE_NOT_JSON_SAFE', () => createIntake({ inventory: [base(1)], sourceFacts: [{ id: 's', value: cyclic }] }));

  const issued = issueOne(createIntake({ inventory: [base(1)] })).state;
  const stateBytes = JSON.stringify(issued);
  const payload = { value: { nested: ['x'] } };
  const answered = answerQuestion(issued, 'q1', payload);
  assert.equal(JSON.stringify(issued), stateBytes);
  payload.value.nested[0] = 'changed';
  assert.equal(answered.knowledge.at(-1).value.nested[0], 'x');
  const pending = createIntake({ inventory: [base(1)] });
  const pendingBytes = JSON.stringify(pending);
  const rejectedPayload = { value: { nested: ['kept'] } };
  expectCode('INTAKE_QUESTION_NOT_ISSUED', () => answerQuestion(pending, 'q1', rejectedPayload));
  assert.equal(JSON.stringify(pending), pendingBytes);
  assert.deepEqual(rejectedPayload, { value: { nested: ['kept'] } });

  const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  expectCode('INTAKE_NOT_JSON_SAFE', () => createIntake(hostile));
});

test('R003 all states, events and knowledge remain JSON-safe detached projections', () => {
  let state = issueOne(createIntake({ inventory: [base(1)] })).state;
  state = answerQuestion(state, 'q1', { value: 'a' });
  state = correctAnswer(state, 'q1', { value: 'b' });
  const roundTrip = JSON.parse(JSON.stringify(state));
  assert.deepEqual(roundTrip, state);
  assert.ok(state.history.every((event, index) => event.seq === index + 1
    && typeof event.id === 'string' && Array.isArray(event.supersedes) && 'payload' in event));
  assert.ok(state.knowledge.every((item) => typeof item.id === 'string'
    && Array.isArray(item.conflictsWith) && Array.isArray(item.supersedes) && item.provenance));
});

test('architecture isolation: implementation has no I/O, persistence, network, or host imports', () => {
  const source = fs.readFileSync(new URL('../knowledge-elicitation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]node:(?:fs|http|https|net|child_process)|fetch\s*\(|claude|codex|store|sqlite/i);
  assert.doesNotMatch(source, /TODO|FIXME|placeholder/i);
});
