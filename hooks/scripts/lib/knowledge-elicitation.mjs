const MATERIAL_DIMENSIONS = new Set([
  'scope', 'acceptance', 'irreversible', 'risk', 'constraint', 'external-integration',
]);
const NON_MATERIAL_DIMENSIONS = new Set([
  'preference', 'presentation', 'naming', 'reversible-default',
]);
const TERMINAL_STATUSES = new Set(['confirmed', 'blocked', 'split-required']);
const VALID_STATUSES = new Set([
  'draft', 'questioning', 'paused', 'awaiting-rebaseline', 'awaiting-confirmation',
  ...TERMINAL_STATUSES,
]);
const KNOWLEDGE_KINDS = new Set([
  'source-fact', 'user-decision', 'preference', 'constraint', 'assumption',
  'open-question', 'superseded',
]);

export const DEFAULT_INTAKE_POLICY = Object.freeze({
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

export class IntakeTransitionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'IntakeTransitionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new IntakeTransitionError(code, message, details);
};

function cloneJsonSafe(value, label = 'value', seen = new Set()) {
  try {
    return cloneJsonSafeUnsafe(value, label, seen);
  } catch (error) {
    if (error instanceof IntakeTransitionError) throw error;
    fail('INTAKE_NOT_JSON_SAFE', `${label} could not be safely inspected`);
  }
}

function cloneJsonSafeUnsafe(value, label, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INTAKE_NOT_JSON_SAFE', `${label} must contain finite numbers`);
    return value;
  }
  if (typeof value !== 'object') fail('INTAKE_NOT_JSON_SAFE', `${label} is not JSON-safe`);
  if (seen.has(value)) fail('INTAKE_NOT_JSON_SAFE', `${label} contains a cycle`);
  seen.add(value);
  let clone;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      fail('INTAKE_NOT_JSON_SAFE', `${label} must not be a sparse array or have extra properties`);
    }
    clone = value.map((item, index) => cloneJsonSafe(item, `${label}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('INTAKE_NOT_JSON_SAFE', `${label} must contain only plain objects`);
    }
    clone = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail('INTAKE_NOT_JSON_SAFE', `${label} has a symbol key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        fail('INTAKE_NOT_JSON_SAFE', `${label}.${key} must be an enumerable data property`);
      }
      clone[key] = cloneJsonSafe(descriptor.value, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return clone;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const project = (state) => deepFreeze(cloneJsonSafe(state, 'state'));
const detached = (value) => deepFreeze(cloneJsonSafe(value));

function statusOf(state) {
  let status;
  try { status = state?.status; } catch { fail('INTAKE_INVALID_STATE', 'State is not readable'); }
  if (!VALID_STATUSES.has(status)) fail('INTAKE_INVALID_STATE', 'State has an unknown status');
  return status;
}

function assertAction(state, allowed) {
  const status = statusOf(state);
  if (TERMINAL_STATUSES.has(status)) fail('INTAKE_TERMINAL', `Intake is terminal (${status})`);
  if (!allowed.includes(status)) {
    fail('INTAKE_INVALID_TRANSITION', `Action is not allowed from ${status}`);
  }
  return cloneJsonSafe(state, 'state');
}

function appendEvent(state, type, { questionId = null, supersedes = [], payload = {} } = {}) {
  const seq = state.history.length + 1;
  const id = nextEngineId(state, `event-${seq}`);
  state.history.push({
    seq,
    id,
    type,
    questionId,
    supersedes: cloneJsonSafe(supersedes, 'event.supersedes'),
    payload: cloneJsonSafe(payload, 'event.payload'),
  });
  return state.history.at(-1);
}

function nextEngineId(state, stem) {
  const used = new Set([
    ...(state.seenIds ?? []),
    ...state.questions.map((item) => item.id),
    ...state.knowledge.map((item) => item.id),
    ...state.history.map((item) => item.id),
  ]);
  let id = stem;
  let suffix = 1;
  while (used.has(id)) id = `${stem}-${suffix++}`;
  state.seenIds ??= [];
  state.seenIds.push(id);
  return id;
}

function terminal(state, status, reason, type, payload = {}) {
  state.status = status;
  state.reason = reason;
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  appendEvent(state, type, { payload: { reason, ...payload } });
  return project(state);
}

function policyFrom(input) {
  const supplied = input === undefined ? {} : cloneJsonSafe(input, 'policy');
  const policy = { ...DEFAULT_INTAKE_POLICY, ...supplied };
  for (const [key, hardLimit] of Object.entries(DEFAULT_INTAKE_POLICY)) {
    if (!Number.isInteger(policy[key]) || policy[key] < 1 || policy[key] > hardLimit) {
      fail('INTAKE_INVALID_POLICY', `${key} must be an integer from 1 through ${hardLimit}`);
    }
  }
  for (const key of Object.keys(policy)) {
    if (!(key in DEFAULT_INTAKE_POLICY)) fail('INTAKE_INVALID_POLICY', `Unknown policy field: ${key}`);
  }
  return policy;
}

export function classifyMateriality(question) {
  try {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return true;
    const dimension = question.dimension;
    if (MATERIAL_DIMENSIONS.has(dimension)) return true;
    if (!NON_MATERIAL_DIMENSIONS.has(dimension)) return true;
    return !(question.material === false && question.reversible === true);
  } catch {
    return true;
  }
}

function validateId(id, label) {
  if (typeof id !== 'string' || id.trim() === '') fail('INTAKE_INVALID_ID', `${label} id must be non-empty`);
}

function normalizedBaseInventory(inventory, policy, reservedIds = new Set()) {
  const copy = cloneJsonSafe(inventory, 'inventory');
  if (!Array.isArray(copy)) fail('INTAKE_INVALID_INVENTORY', 'inventory must be an array');
  if (copy.length > policy.baseLimit) fail('INTAKE_BASE_LIMIT', `Base inventory exceeds ${policy.baseLimit}`);
  const local = new Set(reservedIds);
  return copy.map((question, index) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      fail('INTAKE_INVALID_QUESTION', `inventory[${index}] must be an object`);
    }
    validateId(question.id, `inventory[${index}]`);
    if (local.has(question.id)) fail('INTAKE_DUPLICATE_ID', `Duplicate id: ${question.id}`);
    local.add(question.id);
    if (question.kind !== 'base' || question.ordinal !== index + 1 || 'parentId' in question) {
      fail('INTAKE_INVALID_QUESTION', 'Base questions require canonical contiguous ordinals and no parentId');
    }
    if (typeof question.text !== 'string' || question.text.trim() === '') {
      fail('INTAKE_INVALID_QUESTION', 'Question text must be non-empty');
    }
    return {
      id: question.id,
      text: question.text,
      dimension: question.dimension ?? null,
      material: classifyMateriality(question),
      reversible: question.reversible === true,
      kind: 'base',
      ordinal: index + 1,
      status: 'pending',
      label: '',
      answerKnowledgeId: null,
      allocationEventId: null,
      issueEventId: null,
    };
  });
}

function normalizedSourceFacts(sourceFacts, reservedIds) {
  const facts = cloneJsonSafe(sourceFacts, 'sourceFacts');
  if (!Array.isArray(facts)) fail('INTAKE_INVALID_SOURCE_FACT', 'sourceFacts must be an array');
  const ids = new Set(reservedIds);
  return facts.map((fact, index) => {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
      fail('INTAKE_INVALID_SOURCE_FACT', `sourceFacts[${index}] must be an object`);
    }
    validateId(fact.id, `sourceFacts[${index}]`);
    if (ids.has(fact.id)) fail('INTAKE_DUPLICATE_ID', `Duplicate id: ${fact.id}`);
    ids.add(fact.id);
    if (!('value' in fact)) fail('INTAKE_INVALID_SOURCE_FACT', 'Source fact requires value');
    if (fact.provenance !== undefined && (!fact.provenance || typeof fact.provenance !== 'object'
      || Array.isArray(fact.provenance))) {
      fail('INTAKE_INVALID_SOURCE_FACT', 'Source fact provenance must be an object');
    }
    return {
      id: fact.id,
      kind: 'source-fact',
      value: fact.value,
      provenance: fact.provenance ?? {},
      conflictsWith: [],
      supersedes: [],
    };
  });
}

export function createIntake(options = {}) {
  const copy = cloneJsonSafe(options, 'options');
  const policy = policyFrom(copy.policy);
  const inventoryInput = copy.inventory ?? copy.questions ?? [];
  const inventory = normalizedBaseInventory(inventoryInput, policy);
  const questionIds = new Set(inventory.map((question) => question.id));
  const knowledge = normalizedSourceFacts(copy.sourceFacts ?? [], questionIds);
  const state = {
    schema: 1,
    status: inventory.length === 0 ? 'awaiting-confirmation' : 'questioning',
    reason: null,
    policy,
    baseTotal: inventory.length,
    questions: inventory,
    knowledge,
    synthesis: null,
    counters: {
      issuedVersions: 0,
      followUpAllocations: 0,
      rebaselines: 0,
      synthesisCorrections: 0,
      answerCorrections: 0,
      resumeCycles: 0,
    },
    seenQuestionIds: [...questionIds],
    seenIds: [...questionIds, ...knowledge.map((item) => item.id)],
    history: [],
    earliestUnresolvedLabel: null,
  };
  for (const question of state.questions) question.label = formatQuestionLabel(question, state);
  appendEvent(state, 'intake-created', { payload: { baseTotal: state.baseTotal, sourceFactCount: knowledge.length } });
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  return project(state);
}

export function formatQuestionLabel(question, stateOrTotal) {
  if (!question || typeof question !== 'object') fail('INTAKE_INVALID_QUESTION', 'Question is required');
  if (question.kind === 'base') {
    const total = typeof stateOrTotal === 'number'
      ? stateOrTotal
      : stateOrTotal?.baseTotal ?? question.baseTotal ?? question.total;
    if (!Number.isInteger(total) || total < 1) fail('INTAKE_INVALID_QUESTION', 'Base total must be positive');
    return `[${question.ordinal}/${total}]`;
  }
  if (question.kind === 'followup') {
    const state = stateOrTotal;
    const parent = state?.questions?.find((item) => item.id === question.parentId);
    const parentOrdinal = parent?.kind === 'base' ? parent.ordinal : question.parentOrdinal;
    if (!Number.isInteger(parentOrdinal) || parentOrdinal < 1) {
      fail('INTAKE_INVALID_QUESTION', 'Follow-up parent must be a base question');
    }
    const active = state?.questions?.filter((item) => item.kind === 'followup'
      && item.parentId === question.parentId && ['pending', 'issued'].includes(item.status)) ?? [];
    const total = question.setTotal ?? question.total ?? active.length;
    if (!Number.isInteger(total) || total < 1) fail('INTAKE_INVALID_QUESTION', 'Follow-up total must be positive');
    return `[${parentOrdinal}-${question.ordinal}/${total}]`;
  }
  fail('INTAKE_INVALID_QUESTION', 'Unknown question kind');
}

function earliestUnresolvedLabel(state) {
  const unresolved = state.questions.filter((question) => ['pending', 'issued'].includes(question.status));
  unresolved.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'followup' ? -1 : 1;
    if (a.kind === 'base') return a.ordinal - b.ordinal;
    const ap = state.questions.find((q) => q.id === a.parentId)?.ordinal ?? 0;
    const bp = state.questions.find((q) => q.id === b.parentId)?.ordinal ?? 0;
    return ap - bp || a.ordinal - b.ordinal;
  });
  return unresolved[0]?.label ?? null;
}

function orderedPending(state) {
  return state.questions.filter((q) => q.status === 'pending').sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'followup' ? -1 : 1;
    if (a.kind === 'base') return a.ordinal - b.ordinal;
    const ap = state.questions.find((q) => q.id === a.parentId)?.ordinal ?? 0;
    const bp = state.questions.find((q) => q.id === b.parentId)?.ordinal ?? 0;
    return ap - bp || a.ordinal - b.ordinal;
  });
}

export function issueNextBatch(input) {
  const state = assertAction(input, ['questioning']);
  const alreadyIssued = state.questions.filter((question) => question.status === 'issued');
  if (alreadyIssued.length > 0) {
    return deepFreeze({ state: project(state), questions: detached(alreadyIssued) });
  }
  const selected = orderedPending(state).slice(0, state.policy.batchSize);
  if (selected.length === 0) return deepFreeze({ state: project(state), questions: detached([]) });
  if (state.counters.issuedVersions + selected.length > state.policy.issuedVersionLimit) {
    const split = terminal(state, 'split-required', 'ISSUED_VERSION_LIMIT', 'intake-split');
    return deepFreeze({ state: split, questions: detached([]) });
  }
  for (const selectedQuestion of selected) {
    const question = state.questions.find((item) => item.id === selectedQuestion.id);
    question.status = 'issued';
    state.counters.issuedVersions += 1;
    const event = appendEvent(state, 'question-issued', {
      questionId: question.id,
      supersedes: question.allocationEventId ? [question.allocationEventId] : [],
      payload: { label: question.label, issuedVersions: state.counters.issuedVersions },
    });
    question.issueEventId = event.id;
  }
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  const output = project(state);
  return deepFreeze({
    state: output,
    questions: detached(selected.map((selectedQuestion) => output.questions.find(
      (question) => question.id === selectedQuestion.id,
    ))),
  });
}

function findIssued(state, questionId) {
  if (typeof questionId !== 'string') fail('INTAKE_INVALID_ID', 'questionId must be a string');
  const question = state.questions.find((item) => item.id === questionId);
  if (!question) fail('INTAKE_UNKNOWN_QUESTION', `Unknown question: ${questionId}`);
  if (question.status !== 'issued') fail('INTAKE_QUESTION_NOT_ISSUED', `Question is not issued: ${questionId}`);
  return question;
}

function normalizeFollowUps(state, parent, followUps) {
  const definitions = cloneJsonSafe(followUps ?? [], 'followUps');
  if (!Array.isArray(definitions)) fail('INTAKE_INVALID_QUESTION', 'followUps must be an array');
  if (definitions.length > state.policy.followUpPerParentLimit) {
    fail('INTAKE_FOLLOWUP_PARENT_LIMIT', 'Follow-up set exceeds active per-parent limit');
  }
  if (definitions.length > 0 && parent.kind !== 'base') {
    fail('INTAKE_INVALID_QUESTION', 'Follow-ups may only be allocated to a base question');
  }
  if (state.counters.followUpAllocations + definitions.length > state.policy.followUpAllocationLimit) {
    fail('INTAKE_FOLLOWUP_ALLOCATION_LIMIT', 'Follow-up allocation limit exceeded');
  }
  const seen = new Set(state.seenIds);
  const normalized = definitions.map((definition, index) => {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      fail('INTAKE_INVALID_QUESTION', 'Follow-up must be an object');
    }
    validateId(definition.id, 'followUp');
    if (seen.has(definition.id)) fail('INTAKE_DUPLICATE_ID', `Duplicate id: ${definition.id}`);
    seen.add(definition.id);
    if (typeof definition.text !== 'string' || definition.text.trim() === '') {
      fail('INTAKE_INVALID_QUESTION', 'Follow-up text must be non-empty');
    }
    if ('kind' in definition && definition.kind !== 'followup') fail('INTAKE_INVALID_QUESTION', 'Invalid follow-up kind');
    if ('parentId' in definition && definition.parentId !== parent.id) fail('INTAKE_INVALID_QUESTION', 'Invalid follow-up parentId');
    if ('ordinal' in definition && definition.ordinal !== index + 1) fail('INTAKE_INVALID_QUESTION', 'Invalid follow-up ordinal');
    return {
      id: definition.id,
      text: definition.text,
      dimension: definition.dimension ?? null,
      material: classifyMateriality(definition),
      reversible: definition.reversible === true,
      kind: 'followup',
      parentId: parent.id,
      ordinal: index + 1,
      setTotal: definitions.length,
      status: 'pending',
      label: '',
      answerKnowledgeId: null,
      allocationEventId: null,
      issueEventId: null,
    };
  });
  return normalized;
}

function allocateFollowUps(state, parent, definitions, supersedes = []) {
  const followUps = normalizeFollowUps(state, parent, definitions);
  for (const followUp of followUps) {
    state.counters.followUpAllocations += 1;
    state.seenQuestionIds.push(followUp.id);
    state.seenIds.push(followUp.id);
    state.questions.push(followUp);
    followUp.label = formatQuestionLabel(followUp, state);
    const event = appendEvent(state, 'followup-allocated', {
      questionId: followUp.id,
      supersedes,
      payload: { parentId: parent.id, label: followUp.label, allocation: state.counters.followUpAllocations },
    });
    followUp.allocationEventId = event.id;
  }
}

function validateConflicts(state, conflictsWith) {
  const conflicts = cloneJsonSafe(conflictsWith ?? [], 'conflictsWith');
  if (!Array.isArray(conflicts) || conflicts.some((id) => typeof id !== 'string')) {
    fail('INTAKE_INVALID_KNOWLEDGE', 'conflictsWith must be an array of IDs');
  }
  if (new Set(conflicts).size !== conflicts.length) fail('INTAKE_INVALID_KNOWLEDGE', 'Duplicate conflict IDs');
  const sources = new Set(state.knowledge.filter((item) => item.kind === 'source-fact').map((item) => item.id));
  if (conflicts.some((id) => !sources.has(id))) {
    fail('INTAKE_UNKNOWN_SOURCE_CONFLICT', 'conflictsWith may reference existing source facts only');
  }
  return conflicts;
}

function knowledgeKind(kind) {
  const selected = kind ?? 'user-decision';
  if (!KNOWLEDGE_KINDS.has(selected) || ['source-fact', 'superseded'].includes(selected)) {
    fail('INTAKE_INVALID_KNOWLEDGE', `Invalid answer knowledge kind: ${selected}`);
  }
  return selected;
}

function provenanceObject(provenance) {
  const value = provenance ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INTAKE_INVALID_KNOWLEDGE', 'provenance must be an object');
  }
  return value;
}

export function answerQuestion(input, questionId, response) {
  const state = assertAction(input, ['questioning']);
  const question = findIssued(state, questionId);
  const payload = cloneJsonSafe(response, 'response');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('value' in payload)) {
    fail('INTAKE_INVALID_ANSWER', 'Answer response requires value');
  }
  const followUps = normalizeFollowUps(state, question, payload.followUps ?? []);
  const conflictsWith = validateConflicts(state, payload.conflictsWith);
  const provenance = provenanceObject(payload.provenance);
  question.status = 'answered';
  const answerEvent = appendEvent(state, 'question-answered', {
    questionId,
    supersedes: question.issueEventId ? [question.issueEventId] : [],
    payload: { value: payload.value },
  });
  const item = {
    id: nextEngineId(state, `knowledge-${answerEvent.seq}`),
    kind: knowledgeKind(payload.kind),
    value: payload.value,
    provenance: { ...provenance, questionId, eventId: answerEvent.id },
    conflictsWith,
    supersedes: [],
  };
  state.knowledge.push(item);
  question.answerKnowledgeId = item.id;
  allocateFollowUps(state, question, followUps);
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  return project(state);
}

export function skipQuestion(input, questionId, options = {}) {
  const state = assertAction(input, ['questioning']);
  const question = findIssued(state, questionId);
  const payload = cloneJsonSafe(options, 'skip');
  if (question.material || !question.reversible) {
    question.status = 'skipped';
    appendEvent(state, 'material-question-skipped', {
      questionId,
      supersedes: question.issueEventId ? [question.issueEventId] : [],
      payload,
    });
    return terminal(state, 'blocked', 'MATERIAL_QUESTION_SKIPPED', 'intake-blocked', { questionId });
  }
  question.status = 'skipped';
  const event = appendEvent(state, 'question-skipped', {
    questionId,
    supersedes: question.issueEventId ? [question.issueEventId] : [],
    payload,
  });
  const item = {
    id: nextEngineId(state, `knowledge-${event.seq}`),
    kind: 'assumption',
    value: { reason: payload.reason ?? null },
    provenance: { questionId, eventId: event.id },
    conflictsWith: [],
    supersedes: [],
  };
  state.knowledge.push(item);
  question.answerKnowledgeId = item.id;
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  return project(state);
}

function invalidateActiveFollowUps(state, parentId) {
  const invalidatedEvents = [];
  for (const followUp of state.questions.filter((item) => item.kind === 'followup'
    && item.parentId === parentId && ['pending', 'issued'].includes(item.status))) {
    followUp.status = 'invalidated';
    const predecessor = followUp.issueEventId ?? followUp.allocationEventId;
    const event = appendEvent(state, 'followup-invalidated', {
      questionId: followUp.id,
      supersedes: predecessor ? [predecessor] : [],
      payload: { parentId, oldLabel: followUp.label },
    });
    invalidatedEvents.push(event.id);
  }
  return invalidatedEvents;
}

export function correctAnswer(input, questionId, correction) {
  const state = assertAction(input, ['questioning']);
  const question = state.questions.find((item) => item.id === questionId);
  if (!question) fail('INTAKE_UNKNOWN_QUESTION', `Unknown question: ${questionId}`);
  if (question.status !== 'answered' || !question.answerKnowledgeId) {
    fail('INTAKE_INVALID_CORRECTION', 'Only an answered question can be corrected');
  }
  const payload = cloneJsonSafe(correction, 'correction');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('value' in payload)) {
    fail('INTAKE_INVALID_ANSWER', 'Correction requires value');
  }
  // Validate every failure-prone replacement before changing the working clone.
  normalizeFollowUps(state, question, payload.followUps ?? []);
  const conflictsWith = validateConflicts(state, payload.conflictsWith);
  knowledgeKind(payload.kind);
  const provenance = provenanceObject(payload.provenance);
  if (state.counters.answerCorrections >= state.policy.answerCorrectionLimit) {
    return terminal(state, 'blocked', 'ANSWER_CORRECTION_LIMIT', 'intake-blocked', { questionId });
  }
  const supersededKnowledge = state.knowledge.find((item) => item.id === question.answerKnowledgeId);
  if (!supersededKnowledge) fail('INTAKE_INVALID_STATE', 'Answer knowledge is missing');
  supersededKnowledge.kind = 'superseded';
  const invalidationEvents = invalidateActiveFollowUps(state, questionId);
  state.counters.answerCorrections += 1;
  const event = appendEvent(state, 'answer-corrected', {
    questionId,
    supersedes: [supersededKnowledge.provenance.eventId].filter(Boolean),
    payload: { value: payload.value, correction: state.counters.answerCorrections },
  });
  const item = {
    id: nextEngineId(state, `knowledge-${event.seq}`),
    kind: knowledgeKind(payload.kind),
    value: payload.value,
    provenance: { ...provenance, questionId, eventId: event.id },
    conflictsWith,
    supersedes: [supersededKnowledge.id],
  };
  state.knowledge.push(item);
  question.answerKnowledgeId = item.id;
  allocateFollowUps(state, question, payload.followUps ?? [], invalidationEvents);
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  return project(state);
}

export function pauseIntake(input) {
  const state = assertAction(input, ['questioning']);
  if (state.counters.resumeCycles >= state.policy.resumeLimit) {
    return terminal(state, 'blocked', 'PAUSE_RESUME_LIMIT', 'intake-blocked');
  }
  state.status = 'paused';
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  appendEvent(state, 'intake-paused', { payload: { earliestUnresolvedLabel: state.earliestUnresolvedLabel } });
  return project(state);
}

export function resumeIntake(input) {
  const state = assertAction(input, ['paused']);
  state.counters.resumeCycles += 1;
  state.status = 'questioning';
  appendEvent(state, 'intake-resumed', { payload: { cycle: state.counters.resumeCycles } });
  return project(state);
}

export function stopIntake(input) {
  const state = assertAction(input, ['questioning', 'paused', 'awaiting-rebaseline', 'awaiting-confirmation']);
  return terminal(state, 'blocked', 'BLOCKED_BY_USER', 'intake-stopped');
}

export function requestRebaseline(input) {
  const state = assertAction(input, ['questioning']);
  if (state.counters.rebaselines >= state.policy.rebaselineLimit) {
    return terminal(state, 'split-required', 'REBASELINE_LIMIT', 'intake-split');
  }
  state.status = 'awaiting-rebaseline';
  appendEvent(state, 'rebaseline-requested', { payload: { priorBaseTotal: state.baseTotal } });
  return project(state);
}

export function rebaselineIntake(input, options) {
  const state = assertAction(input, ['awaiting-rebaseline']);
  const supplied = cloneJsonSafe(options, 'rebaseline');
  const payload = Array.isArray(supplied)
    ? { decision: 'accept', inventory: supplied }
    : supplied;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('INTAKE_INVALID_REBASELINE', 'Rebaseline options are required');
  }
  const decision = payload.decision ?? (payload.accept === true ? 'accept' : payload.accept === false ? 'decline' : undefined);
  if (decision === 'decline') {
    return terminal(state, 'blocked', 'REBASELINE_DECLINED', 'rebaseline-declined');
  }
  if (decision !== 'accept') fail('INTAKE_INVALID_REBASELINE', 'decision must be accept or decline');
  if (state.counters.rebaselines >= state.policy.rebaselineLimit) {
    return terminal(state, 'split-required', 'REBASELINE_LIMIT', 'intake-split');
  }
  let inventory;
  try {
    inventory = normalizedBaseInventory(payload.inventory ?? [], state.policy, new Set(state.seenIds));
  } catch (error) {
    if (error instanceof IntakeTransitionError && error.code === 'INTAKE_BASE_LIMIT') {
      return terminal(state, 'split-required', 'REBASELINE_BASE_LIMIT', 'intake-split');
    }
    throw error;
  }
  if (state.counters.issuedVersions + inventory.length > state.policy.issuedVersionLimit) {
    return terminal(state, 'split-required', 'REBASELINE_POTENTIAL_LIMIT', 'intake-split');
  }
  const oldTotal = state.baseTotal;
  for (const question of state.questions.filter((item) => ['pending', 'issued'].includes(item.status))) {
    question.status = 'invalidated';
    appendEvent(state, 'question-invalidated', {
      questionId: question.id,
      supersedes: [question.issueEventId ?? question.allocationEventId].filter(Boolean),
      payload: { oldLabel: question.label, reason: 'rebaseline' },
    });
  }
  state.counters.rebaselines += 1;
  state.baseTotal = inventory.length;
  for (const question of inventory) {
    state.seenQuestionIds.push(question.id);
    state.seenIds.push(question.id);
    state.questions.push(question);
    question.label = formatQuestionLabel(question, state);
  }
  state.status = inventory.length === 0 ? 'awaiting-confirmation' : 'questioning';
  appendEvent(state, 'rebaseline-accepted', {
    payload: { oldTotal, newTotal: inventory.length, rebaseline: state.counters.rebaselines },
  });
  state.earliestUnresolvedLabel = earliestUnresolvedLabel(state);
  return project(state);
}

export function synthesizeIntake(input, options = {}) {
  const state = assertAction(input, ['questioning']);
  const payload = cloneJsonSafe(options, 'synthesis');
  const materialUnresolved = state.questions.some((question) => question.material
    && ['pending', 'issued'].includes(question.status));
  if (materialUnresolved) fail('INTAKE_MATERIAL_UNRESOLVED', 'Material questions remain unresolved');
  state.synthesis = payload && typeof payload === 'object' && !Array.isArray(payload) && 'summary' in payload
    ? payload.summary
    : payload;
  state.status = 'awaiting-confirmation';
  appendEvent(state, 'intake-synthesized', { payload: { synthesis: state.synthesis } });
  return project(state);
}

export function correctSynthesis(input, options) {
  const state = assertAction(input, ['awaiting-confirmation']);
  const payload = cloneJsonSafe(options, 'synthesisCorrection');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || (!('synthesis' in payload) && !('summary' in payload))) {
    fail('INTAKE_INVALID_SYNTHESIS', 'Synthesis correction requires synthesis');
  }
  if (state.counters.synthesisCorrections >= state.policy.synthesisCorrectionLimit) {
    return terminal(state, 'blocked', 'SYNTHESIS_CORRECTION_LIMIT', 'intake-blocked');
  }
  state.counters.synthesisCorrections += 1;
  const previous = state.synthesis;
  state.synthesis = 'synthesis' in payload ? payload.synthesis : payload.summary;
  appendEvent(state, 'synthesis-corrected', {
    payload: { previous, synthesis: state.synthesis, correction: state.counters.synthesisCorrections },
  });
  if (payload.materialChange === true) {
    if (state.counters.rebaselines >= state.policy.rebaselineLimit) {
      return terminal(state, 'split-required', 'REBASELINE_LIMIT', 'intake-split');
    }
    state.status = 'awaiting-rebaseline';
    appendEvent(state, 'rebaseline-requested', { payload: { reason: 'material-synthesis-change' } });
  }
  return project(state);
}

export function confirmIntake(input) {
  const state = assertAction(input, ['awaiting-confirmation']);
  state.status = 'confirmed';
  state.reason = 'CONFIRMED';
  appendEvent(state, 'intake-confirmed');
  return project(state);
}
