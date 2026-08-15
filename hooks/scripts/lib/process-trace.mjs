import { types as utilTypes } from 'node:util';

const HASH_RE = /^[0-9a-f]{64}$/iu;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const ACTIONS = {
  EVIDENCE_CHANGED_DURING_READ: 'retry-query',
  INVALID_INPUT: 'repair-evidence',
  GOAL_ID_MISMATCH: 'repair-evidence',
  CONTRACT_HASH_MISMATCH: 'repair-evidence',
  INVALID_TRACEABILITY: 'repair-evidence',
  ROLE_MISMATCH: 'repair-evidence',
  DUPLICATE_COMMAND_RUN: 'repair-evidence',
  DUPLICATE_VERDICT_ID: 'repair-evidence',
  UNKNOWN_VERDICT_ID: 'repair-evidence',
  SESSION_NOT_INDEPENDENT: 'run-verification',
  VERIFIER_MISMATCH: 'run-verification',
  GOAL_ALIGNMENT_MISMATCH: 'align-goal',
  MISSING_REQUIREMENT_SCENARIO_LINK: 'link-scenario',
  MISSING_IMPLEMENTATION_RUN: 'run-implementation',
  FAILED_IMPLEMENTATION_BUNDLE: 'run-implementation',
  MISSING_IMPLEMENTATION_COMMAND: 'run-implementation',
  FAILED_IMPLEMENTATION_COMMAND: 'run-implementation',
  MISSING_VERIFICATION_RUN: 'run-verification',
  FAILED_VERIFICATION_BUNDLE: 'run-verification',
  MISSING_VERIFICATION_COMMAND: 'run-verification',
  FAILED_VERIFICATION_COMMAND: 'run-verification',
  MISSING_ITEM_VERDICT: 'record-verdict',
  FAILED_ITEM_VERDICT: 'record-verdict',
  MISSING_REGRESSION_VERDICT: 'record-verdict',
  FAILED_REGRESSION_VERDICT: 'record-verdict',
  MISSING_INDEPENDENT_VERDICT: 'run-verification',
  FAILED_INDEPENDENT_VERDICT: 'run-verification',
  MISSING_GOAL_ALIGNMENT: 'align-goal',
  FAILED_GOAL_ALIGNMENT: 'align-goal',
};

const ACTION_ORDER = [
  'repair-evidence',
  'link-scenario',
  'run-implementation',
  'run-verification',
  'record-verdict',
  'align-goal',
  'retry-query',
];

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(object, key, optional = false) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) {
    if (optional) return { present: false, value: undefined };
    throw new TypeError('missing field');
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new TypeError('accessor field');
  return { present: true, value: descriptor.value };
}

function arrayValues(value, minimum, maximum) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) throw new TypeError('not an array');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype && prototype !== null) throw new TypeError('invalid array prototype');
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) {
    throw new TypeError('invalid array length');
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
    throw new TypeError('array bounds');
  }
  const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.size || keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))) {
    throw new TypeError('invalid array keys');
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('invalid array item');
    }
    result.push(descriptor.value);
  }
  return result;
}

function string(value, maximum, { nonblank = true, command = false } = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum) {
    throw new TypeError('invalid string');
  }
  if (nonblank && value.trim() === '') throw new TypeError('blank string');
  if (command && (value === '' || value.trim() !== value)) throw new TypeError('invalid command');
  return value;
}

function id(value) {
  return string(value, 64);
}

function hash(value) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) throw new TypeError('invalid hash');
  return value;
}

function captureObject(value) {
  if (!plain(value)) throw new TypeError('not a plain object');
  return value;
}

function captureGoal(raw) {
  const object = captureObject(raw);
  return {
    id: id(own(object, 'id').value),
    objective: string(own(object, 'objective').value, 512),
    acceptanceHash: hash(own(object, 'acceptanceHash').value),
  };
}

function captureAcceptance(raw) {
  const object = captureObject(raw);
  const schema = own(object, 'schema').value;
  const goalId = id(own(object, 'goalId').value);
  const requirementsRaw = arrayValues(own(object, 'requirements').value, 1, 3);
  const scenariosRaw = arrayValues(own(object, 'scenarios').value, 1, 2);
  const regressionRaw = captureObject(own(object, 'regression').value);
  if (![1, 2].includes(schema)) throw new TypeError('invalid schema');
  let outcomeId = null;
  if (schema === 2) {
    const goalShape = captureObject(own(object, 'goalShape').value);
    const outcomes = arrayValues(own(goalShape, 'outcomes').value, 1, 1);
    const outcome = captureObject(outcomes[0]);
    outcomeId = id(own(outcome, 'id').value);
    if (!/^O[0-9]{3}$/.test(outcomeId)) throw new TypeError('invalid outcome id');
  }

  const requirements = requirementsRaw.map((entry) => {
    const item = captureObject(entry);
    if (schema === 2 && own(item, 'outcomeId').value !== outcomeId) throw new TypeError('invalid requirement outcome');
    return {
      id: id(own(item, 'id').value),
      criterion: string(own(item, 'criterion').value, 512),
      command: string(own(item, 'command').value, 512, { command: true }),
    };
  });
  const scenarios = scenariosRaw.map((entry) => {
    const item = captureObject(entry);
    if (schema === 2 && own(item, 'outcomeId').value !== outcomeId) throw new TypeError('invalid scenario outcome');
    const kind = own(item, 'kind').value;
    if (kind !== 'user-journey') throw new TypeError('invalid scenario kind');
    return {
      id: id(own(item, 'id').value),
      kind,
      scenario: string(own(item, 'scenario').value, 512),
      expected: string(own(item, 'expected').value, 512),
      command: string(own(item, 'command').value, 512, { command: true }),
    };
  });
  const regression = {
    scope: string(own(regressionRaw, 'scope').value, 512),
    command: string(own(regressionRaw, 'command').value, 512, { command: true }),
  };
  if (schema === 2 && own(regressionRaw, 'outcomeId').value !== outcomeId) throw new TypeError('invalid regression outcome');
  if (new Set(requirements.map((item) => item.id)).size !== requirements.length) {
    throw new TypeError('duplicate requirement id');
  }
  if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length) {
    throw new TypeError('duplicate scenario id');
  }

  const traceProperty = own(object, 'traceability', true);
  let traceability = null;
  if (traceProperty.present) traceability = captureRelations(traceProperty.value);
  return { schema, goalId, outcomeId, requirements, scenarios, regression, traceability };
}

function captureRelations(raw) {
  return arrayValues(raw, 0, 3).map((entry) => {
    const object = captureObject(entry);
    return {
      requirementId: id(own(object, 'requirementId').value),
      scenarioIds: arrayValues(own(object, 'scenarioIds').value, 0, 2).map(id),
    };
  });
}

function classifyRelations(acceptance) {
  if (acceptance.traceability === null) return { ok: true };
  const requirementIds = new Set(acceptance.requirements.map((item) => item.id));
  const scenarioIds = new Set(acceptance.scenarios.map((item) => item.id));
  const seenRequirements = new Set();
  for (const relation of acceptance.traceability) {
    if (!requirementIds.has(relation.requirementId) || seenRequirements.has(relation.requirementId)) {
      return { ok: false, code: 'INVALID_TRACEABILITY' };
    }
    seenRequirements.add(relation.requirementId);
    const seenScenarios = new Set();
    for (const scenarioId of relation.scenarioIds) {
      if (!scenarioIds.has(scenarioId) || seenScenarios.has(scenarioId)) {
        return { ok: false, code: 'INVALID_TRACEABILITY' };
      }
      seenScenarios.add(scenarioId);
    }
  }
  return { ok: true };
}

export function validateTraceabilityDefinition(rawAcceptance) {
  try {
    const acceptance = captureObject(rawAcceptance);
    const traceProperty = own(acceptance, 'traceability', true);
    if (!traceProperty.present) return { ok: true };
    const requirements = arrayValues(own(acceptance, 'requirements').value, 1, 3).map((raw) => {
      const item = captureObject(raw);
      return { id: id(own(item, 'id').value) };
    });
    const scenarios = arrayValues(own(acceptance, 'scenarios').value, 1, 2).map((raw) => {
      const item = captureObject(raw);
      return { id: id(own(item, 'id').value) };
    });
    if (new Set(requirements.map((item) => item.id)).size !== requirements.length) {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length) {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    const traceability = captureRelations(traceProperty.value);
    return classifyRelations({ requirements, scenarios, traceability });
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}

function captureRun(raw, expectedRole, commands) {
  if (raw === undefined) return null;
  const object = captureObject(raw);
  const schema = own(object, 'schema').value;
  const goalId = id(own(object, 'goalId').value);
  const role = own(object, 'role').value;
  const sessionId = string(own(object, 'sessionId').value, 36);
  let verifier = null;
  if (expectedRole === 'verification') verifier = string(own(object, 'verifier').value, 128);
  const contractHash = hash(own(object, 'contractHash').value);
  const passed = own(object, 'passed').value;
  const runValues = arrayValues(own(object, 'runs').value, 0, 6);
  if (schema !== 1 || (role !== 'implementation' && role !== 'verification')) {
    if (schema !== 1) throw new TypeError('invalid run schema');
  }
  if (!UUID_RE.test(sessionId) || typeof passed !== 'boolean') throw new TypeError('invalid run');
  const runs = runValues.map((rawItem) => {
    const item = captureObject(rawItem);
    const command = string(own(item, 'command').value, 512, { command: true });
    const itemPassed = own(item, 'passed').value;
    const exitCode = own(item, 'exitCode').value;
    const outputHash = hash(own(item, 'outputHash').value);
    if (typeof itemPassed !== 'boolean') throw new TypeError('invalid run pass');
    if (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255)) {
      throw new TypeError('invalid exit code');
    }
    return { command, passed: itemPassed, exitCode, outputHash };
  });
  if (passed) {
    for (const item of runs) {
      if (!commands.has(item.command) && (!item.passed || item.exitCode !== 0)) {
        throw new TypeError('failed unmatched command');
      }
    }
  }
  return { schema, goalId, role, sessionId, verifier, contractHash, passed, runs };
}

function captureVerdict(raw) {
  const object = captureObject(raw);
  return {
    id: id(own(object, 'id').value),
    outcome: string(own(object, 'outcome').value, 32, { nonblank: false }),
    evidence: string(own(object, 'evidence').value, 2048, { nonblank: false }),
  };
}

function captureGlobalVerdict(raw, type) {
  const object = captureObject(raw);
  if (type === 'regression') {
    return {
      outcome: string(own(object, 'outcome').value, 32, { nonblank: false }),
      evidence: string(own(object, 'evidence').value, 2048, { nonblank: false }),
    };
  }
  if (type === 'independent') {
    return {
      verifier: string(own(object, 'verifier').value, 128, { nonblank: false }),
      mode: string(own(object, 'mode').value, 32, { nonblank: false }),
      outcome: string(own(object, 'outcome').value, 32, { nonblank: false }),
      evidence: string(own(object, 'evidence').value, 2048, { nonblank: false }),
    };
  }
  return {
    objective: string(own(object, 'objective').value, 512, { nonblank: false }),
    outcomeId: own(object, 'outcomeId', true).present
      ? string(own(object, 'outcomeId').value, 64, { nonblank: false }) : null,
    verifier: string(own(object, 'verifier').value, 128, { nonblank: false }),
    outcome: string(own(object, 'outcome').value, 32, { nonblank: false }),
    evidence: string(own(object, 'evidence').value, 2048, { nonblank: false }),
  };
}

function captureCompletion(raw) {
  if (raw === undefined) return null;
  const object = captureObject(raw);
  const schema = own(object, 'schema').value;
  const goalId = id(own(object, 'goalId').value);
  if (schema !== 1) throw new TypeError('invalid completion schema');
  const requirements = arrayValues(own(object, 'requirements').value, 0, 3).map(captureVerdict);
  const scenarios = arrayValues(own(object, 'scenarios').value, 0, 2).map(captureVerdict);
  const regressionProperty = own(object, 'regression', true);
  const independentProperty = own(object, 'independentVerification', true);
  const alignmentProperty = own(object, 'goalAlignment', true);
  return {
    schema,
    goalId,
    requirements,
    scenarios,
    regression: regressionProperty.present
      ? captureGlobalVerdict(regressionProperty.value, 'regression')
      : null,
    independentVerification: independentProperty.present
      ? captureGlobalVerdict(independentProperty.value, 'independent')
      : null,
    goalAlignment: alignmentProperty.present
      ? captureGlobalVerdict(alignmentProperty.value, 'alignment')
      : null,
  };
}

function runStatus(status, run = null, verifier = null) {
  return {
    status,
    outputHash: status === 'pass' ? run.outputHash : null,
    sessionId: status === 'pass' ? run.sessionId : null,
    verifier: status === 'pass' ? verifier : null,
  };
}

function verdictStatus(status) {
  return { status, evidencePresent: status === 'pass' };
}

function invalidReport(code, kind = 'trace', idValue = '$global') {
  return {
    schema: 1,
    authority: 'structural-only',
    authoritative: false,
    goalId: null,
    contractHash: null,
    status: 'invalid',
    traceComplete: false,
    summary: { totalItems: 0, linkedItems: 0, gapCount: 1 },
    items: [],
    regression: {
      implementation: runStatus('not-evaluated'),
      verification: runStatus('not-evaluated'),
      verdict: verdictStatus('not-evaluated'),
      gaps: [],
    },
    independentVerification: { status: 'not-evaluated', verifier: null, evidencePresent: false },
    goalAlignment: {
      status: 'not-evaluated',
      verifier: null,
      evidencePresent: false,
      objectiveMatches: false,
    },
    gaps: [{ code, kind, id: idValue, detail: code }],
    nextActions: [ACTIONS[code]],
  };
}

export function createInvalidProcessTrace(code) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, code)) return invalidReport('INVALID_INPUT');
  return invalidReport(code);
}

function rolePreflight(implementation, verification) {
  if (implementation && implementation.role !== 'implementation') {
    return ['ROLE_MISMATCH', 'trace', '$implementation'];
  }
  if (verification && verification.role !== 'verification') {
    return ['ROLE_MISMATCH', 'trace', '$verification'];
  }
  for (const [run, idValue] of [[implementation, '$implementation'], [verification, '$verification']]) {
    if (!run) continue;
    const seen = new Set();
    for (const item of run.runs) {
      if (seen.has(item.command)) return ['DUPLICATE_COMMAND_RUN', 'trace', idValue];
      seen.add(item.command);
    }
  }
  return null;
}

function completionPreflight(completion, acceptance) {
  if (!completion) return null;
  const collections = [
    [completion.requirements, new Set(acceptance.requirements.map((item) => item.id))],
    [completion.scenarios, new Set(acceptance.scenarios.map((item) => item.id))],
  ];
  for (const [verdicts] of collections) {
    const seen = new Set();
    for (const verdict of verdicts) {
      if (seen.has(verdict.id)) return ['DUPLICATE_VERDICT_ID', 'trace', '$completion'];
      seen.add(verdict.id);
    }
  }
  for (const [verdicts, accepted] of collections) {
    for (const verdict of verdicts) {
      if (!accepted.has(verdict.id)) return ['UNKNOWN_VERDICT_ID', 'trace', '$completion'];
    }
  }
  return null;
}

function linkedRun(bundle, command, role) {
  const prefix = role === 'implementation' ? 'IMPLEMENTATION' : 'VERIFICATION';
  if (!bundle) return [runStatus('missing'), `MISSING_${prefix}_RUN`];
  if (!bundle.passed) return [runStatus('failed'), `FAILED_${prefix}_BUNDLE`];
  const run = bundle.runs.find((entry) => entry.command === command);
  if (!run) return [runStatus('missing'), `MISSING_${prefix}_COMMAND`];
  if (!run.passed || run.exitCode !== 0) return [runStatus('failed'), `FAILED_${prefix}_COMMAND`];
  return [runStatus('pass', { ...run, sessionId: bundle.sessionId }, bundle.verifier), null];
}

function linkedVerdict(completion, collection, itemId) {
  if (!completion) return [verdictStatus('missing'), 'MISSING_ITEM_VERDICT'];
  const verdict = completion[collection].find((entry) => entry.id === itemId);
  if (!verdict) return [verdictStatus('missing'), 'MISSING_ITEM_VERDICT'];
  if (verdict.outcome !== 'pass' || verdict.evidence.trim() === '') {
    return [verdictStatus('failed'), 'FAILED_ITEM_VERDICT'];
  }
  return [verdictStatus('pass'), null];
}

function addGap(reportGaps, itemGaps, code, kind, itemId) {
  if (!code) return;
  const key = `${code}\u0000${kind}\u0000${itemId}`;
  if (!reportGaps.some((gap) => gap._key === key)) {
    reportGaps.push({ code, kind, id: itemId, detail: code, _key: key });
  }
  if (itemGaps && !itemGaps.includes(code)) itemGaps.push(code);
}

function globalVerdict(component, missingCode, failedCode, semanticPass) {
  if (!component) return [{ status: 'missing', verifier: null, evidencePresent: false }, missingCode];
  if (!semanticPass(component)) {
    return [{ status: 'failed', verifier: null, evidencePresent: false }, failedCode];
  }
  return [{ status: 'pass', verifier: component.verifier ?? null, evidencePresent: true }, null];
}

function collapsed(value) {
  return value.trim().replace(/\s+/gu, ' ');
}

export function buildProcessTrace(rawInput) {
  try {
    const input = captureObject(rawInput);
    const goal = captureGoal(own(input, 'goal').value);
    const assertedHashProperty = own(input, 'acceptanceHash', true);
    const assertedHash = assertedHashProperty.present ? hash(assertedHashProperty.value) : null;
    const acceptance = captureAcceptance(own(input, 'acceptance').value);
    const commands = new Set([
      ...acceptance.requirements.map((item) => item.command),
      ...acceptance.scenarios.map((item) => item.command),
      acceptance.regression.command,
    ]);
    const implementationProperty = own(input, 'implementationRun', true);
    const verificationProperty = own(input, 'verificationRun', true);
    const completionProperty = own(input, 'completion', true);
    const implementation = implementationProperty.present
      ? captureRun(implementationProperty.value, 'implementation', commands)
      : null;
    const verification = verificationProperty.present
      ? captureRun(verificationProperty.value, 'verification', commands)
      : null;
    const completion = completionProperty.present ? captureCompletion(completionProperty.value) : null;

    for (const record of [acceptance, implementation, verification, completion]) {
      if (record && record.goalId !== goal.id) return invalidReport('GOAL_ID_MISMATCH');
    }
    if (assertedHash !== goal.acceptanceHash
      || (implementation && implementation.contractHash !== assertedHash)
      || (verification && verification.contractHash !== assertedHash)) {
      return invalidReport('CONTRACT_HASH_MISMATCH');
    }
    const relationClassification = classifyRelations(acceptance);
    if (!relationClassification.ok) return invalidReport(relationClassification.code);
    const roleFailure = rolePreflight(implementation, verification);
    if (roleFailure) return invalidReport(...roleFailure);
    const completionFailure = completionPreflight(completion, acceptance);
    if (completionFailure) return invalidReport(...completionFailure);
    if (implementation && verification && implementation.sessionId === verification.sessionId) {
      return invalidReport('SESSION_NOT_INDEPENDENT');
    }

    const independent = completion?.independentVerification ?? null;
    const independentPass = independent
      && independent.verifier.trim() !== ''
      && independent.mode === 'machine-reexecution'
      && independent.outcome === 'pass'
      && independent.evidence.trim() !== '';
    if (independentPass && verification && independent.verifier !== verification.verifier) {
      return invalidReport('VERIFIER_MISMATCH');
    }
    const alignment = completion?.goalAlignment ?? null;
    const alignmentPass = alignment
      && alignment.objective.trim() !== ''
      && alignment.verifier.trim() !== ''
      && alignment.outcome === 'pass'
      && alignment.evidence.trim() !== '';
    if (alignmentPass && (
      collapsed(alignment.objective) !== collapsed(goal.objective)
      || (independentPass && alignment.verifier !== independent.verifier)
      || (acceptance.outcomeId && alignment.outcomeId !== acceptance.outcomeId)
    )) {
      return invalidReport('GOAL_ALIGNMENT_MISMATCH');
    }

    const requirementLinks = new Map(acceptance.requirements.map((item) => [item.id, new Set()]));
    const scenarioLinks = new Map(acceptance.scenarios.map((item) => [item.id, new Set()]));
    for (const relation of acceptance.traceability ?? []) {
      for (const scenarioId of relation.scenarioIds) {
        requirementLinks.get(relation.requirementId).add(scenarioId);
        scenarioLinks.get(scenarioId).add(relation.requirementId);
      }
    }

    const gaps = [];
    const items = [];
    const makeItem = (source, kind) => {
      const itemGaps = [];
      const linkedIds = kind === 'requirement'
        ? acceptance.scenarios.filter((item) => requirementLinks.get(source.id).has(item.id)).map((item) => item.id)
        : acceptance.requirements.filter((item) => scenarioLinks.get(source.id).has(item.id)).map((item) => item.id);
      const relationStatus = linkedIds.length > 0 ? 'pass' : 'missing';
      if (relationStatus === 'missing') {
        addGap(gaps, itemGaps, 'MISSING_REQUIREMENT_SCENARIO_LINK', kind, source.id);
      }
      const [implementationStatus, implementationGap] = linkedRun(implementation, source.command, 'implementation');
      addGap(gaps, itemGaps, implementationGap, kind, source.id);
      const [verificationStatus, verificationGap] = linkedRun(verification, source.command, 'verification');
      addGap(gaps, itemGaps, verificationGap, kind, source.id);
      const [verdict, verdictGap] = linkedVerdict(
        completion,
        kind === 'requirement' ? 'requirements' : 'scenarios',
        source.id,
      );
      addGap(gaps, itemGaps, verdictGap, kind, source.id);
      return {
        kind,
        id: source.id,
        label: kind === 'requirement' ? source.criterion : source.scenario,
        command: source.command,
        relation: { status: relationStatus },
        scenarioIds: kind === 'requirement' ? linkedIds : [],
        requirementIds: kind === 'scenario' ? linkedIds : [],
        implementation: implementationStatus,
        verification: verificationStatus,
        verdict,
        gaps: itemGaps,
      };
    };
    for (const requirement of acceptance.requirements) items.push(makeItem(requirement, 'requirement'));
    for (const scenario of acceptance.scenarios) items.push(makeItem(scenario, 'scenario'));

    const regressionGaps = [];
    const [regressionImplementation, regressionImplementationGap] = linkedRun(
      implementation,
      acceptance.regression.command,
      'implementation',
    );
    addGap(gaps, regressionGaps, regressionImplementationGap, 'regression', '$regression');
    const [regressionVerification, regressionVerificationGap] = linkedRun(
      verification,
      acceptance.regression.command,
      'verification',
    );
    addGap(gaps, regressionGaps, regressionVerificationGap, 'regression', '$regression');
    let regressionVerdict;
    let regressionVerdictGap;
    if (!completion?.regression) {
      regressionVerdict = verdictStatus('missing');
      regressionVerdictGap = 'MISSING_REGRESSION_VERDICT';
    } else if (completion.regression.outcome !== 'pass' || completion.regression.evidence.trim() === '') {
      regressionVerdict = verdictStatus('failed');
      regressionVerdictGap = 'FAILED_REGRESSION_VERDICT';
    } else {
      regressionVerdict = verdictStatus('pass');
    }
    addGap(gaps, regressionGaps, regressionVerdictGap, 'regression', '$regression');

    const [independentStatusBase, independentGap] = globalVerdict(
      independent,
      'MISSING_INDEPENDENT_VERDICT',
      'FAILED_INDEPENDENT_VERDICT',
      (value) => value.verifier.trim() !== ''
        && value.mode === 'machine-reexecution'
        && value.outcome === 'pass'
        && value.evidence.trim() !== '',
    );
    addGap(gaps, null, independentGap, 'trace', '$global');
    const independentVerification = independentStatusBase;

    const [alignmentStatusBase, alignmentGap] = globalVerdict(
      alignment,
      'MISSING_GOAL_ALIGNMENT',
      'FAILED_GOAL_ALIGNMENT',
      (value) => value.objective.trim() !== ''
        && value.verifier.trim() !== ''
        && value.outcome === 'pass'
        && value.evidence.trim() !== '',
    );
    addGap(gaps, null, alignmentGap, 'trace', '$global');
    const goalAlignment = {
      ...alignmentStatusBase,
      objectiveMatches: alignmentStatusBase.status === 'pass',
    };

    const cleanGaps = gaps.map(({ _key, ...gap }) => gap);
    const linkedItems = items.filter((item) => item.relation.status === 'pass'
      && item.implementation.status === 'pass'
      && item.verification.status === 'pass'
      && item.verdict.status === 'pass').length;
    const nextActions = ACTION_ORDER.filter((action) => cleanGaps.some((gap) => ACTIONS[gap.code] === action));
    return {
      schema: 1,
      authority: 'structural-only',
      authoritative: false,
      goalId: goal.id,
      contractHash: assertedHash,
      status: cleanGaps.length === 0 ? 'complete' : 'incomplete',
      traceComplete: cleanGaps.length === 0,
      summary: { totalItems: items.length, linkedItems, gapCount: cleanGaps.length },
      items,
      regression: {
        implementation: regressionImplementation,
        verification: regressionVerification,
        verdict: regressionVerdict,
        gaps: regressionGaps,
      },
      independentVerification,
      goalAlignment,
      gaps: cleanGaps,
      nextActions,
    };
  } catch {
    return invalidReport('INVALID_INPUT');
  }
}
