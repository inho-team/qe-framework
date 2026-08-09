import { PROCESS_KERNEL_CONTRACT, evaluateTransition } from './process-kernel.mjs';
import { canonicalJson, createProcessControllerStore, sha256 } from './process-controller-store.mjs';
import { comparePseArtifactGenerations, identifyPseArtifactPair,
  projectPseImmutableGeneration } from './pse-artifact-identity.mjs';
import { types } from 'node:util';

const INITIAL_STATE = Object.freeze({ plan: 'planned', goal: 'pending', pse: 'plan', sivs: 'spec' });
const PROCESS_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function plainDataObject(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
      && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
  } catch { return false; }
}

function jsonClone(value, depth = 0) {
  if (depth > 12) throw new Error('depth');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('number');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => jsonClone(item, depth + 1));
  if (!plainDataObject(value)) throw new Error('object');
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = jsonClone(value[key], depth + 1);
  return out;
}

function exactEnvelope(value, required, optional = []) {
  try {
    if (!plainDataObject(value)) return null;
    const keys = Object.keys(value);
    const permitted = new Set([...required, ...optional]);
    if (!required.every(key => keys.includes(key)) || keys.some(key => !permitted.has(key))) return null;
    const cloned = jsonClone(value);
    if (Buffer.byteLength(canonicalJson(cloned)) > 64 * 1024) return null;
    return cloned;
  } catch { return null; }
}

function validIdentifier(processId, requestId) {
  return typeof processId === 'string' && PROCESS_ID.test(processId)
    && typeof requestId === 'string' && Buffer.byteLength(requestId) >= 1
    && Buffer.byteLength(requestId) <= 128 && requestId.trim() !== '';
}

function rejected(code, audited = false) {
  return { ok: false, allowed: false, code, audited };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function exactDescriptorValues(value, keys) {
  try {
    if (!plainDataObject(value) || types.isProxy?.(value)) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some((key, index) => key !== keys[index])) return null;
    const out = {};
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      out[key] = descriptor.value;
    }
    return out;
  } catch { return null; }
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;

function captureBytes(value) {
  try {
    if (types.isProxy?.(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) return null;
    const byteLength = byteLengthGetter.call(value);
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 1024 * 1024) return null;
    return Uint8Array.prototype.slice.call(value);
  } catch { return null; }
}

const GUARDED_KEYS = ['processId', 'requestId', 'to', 'expectedRevision', 'receipt',
  'taskPath', 'taskBytes', 'checklistPath', 'checklistBytes', 'resume', 'attestations', 'humanAcceptance'];

function guardedEnvelope(request) {
  const values = exactDescriptorValues(request, GUARDED_KEYS);
  if (!values || !validIdentifier(values.processId, values.requestId)
    || typeof values.to !== 'string' || !Number.isSafeInteger(values.expectedRevision) || values.expectedRevision < 0
    || typeof values.receipt !== 'string' || !/^[0-9a-f]{64}$/.test(values.receipt)
    || typeof values.taskPath !== 'string' || typeof values.checklistPath !== 'string') return null;
  const taskBytes = captureBytes(values.taskBytes);
  const checklistBytes = captureBytes(values.checklistBytes);
  if (!taskBytes || !checklistBytes || taskBytes.length + checklistBytes.length > 2 * 1024 * 1024) return null;
  const receiptSha256 = sha256(values.receipt);
  const taskSha256 = sha256(taskBytes); const checklistSha256 = sha256(checklistBytes);
  const projection = exactEnvelope({
    processId: values.processId, requestId: values.requestId, to: values.to,
    expectedRevision: values.expectedRevision, receiptSha256,
    taskPath: values.taskPath, taskByteLength: taskBytes.length, taskSha256,
    checklistPath: values.checklistPath, checklistByteLength: checklistBytes.length, checklistSha256,
    resume: values.resume, attestations: values.attestations, humanAcceptance: values.humanAcceptance,
  }, ['processId', 'requestId', 'to', 'expectedRevision', 'receiptSha256', 'taskPath', 'taskByteLength',
    'taskSha256', 'checklistPath', 'checklistByteLength', 'checklistSha256', 'resume', 'attestations', 'humanAcceptance']);
  if (!projection) return null;
  return { ...values, taskBytes, checklistBytes, receiptSha256, projection };
}

const PSE_GOAL_MAPPING = Object.freeze({
  'pending>pending': ['pending', 'pending', 'IDEMPOTENT'],
  'pending>active': ['pending', 'active', 'ALLOWED'],
  'active>active': ['active', 'active', 'IDEMPOTENT'],
  'active>held': ['active', 'blocked', 'ALLOWED'],
  'held>held': ['blocked', 'blocked', 'IDEMPOTENT'],
  'held>active': ['blocked', 'active', 'ALLOWED'],
  'active>completed': ['active', 'complete', 'ALLOWED'],
  'completed>completed': ['complete', 'complete', 'IDEMPOTENT'],
});

export function createProcessController({ cwd, layer, authority, faultInjector, now } = {}) {
  const contract = PROCESS_KERNEL_CONTRACT[layer];
  if (!contract) return null;
  const store = typeof cwd === 'string' ? createProcessControllerStore(cwd, { faultInjector, now }) : null;
  if (!store) {
    const unavailable = () => rejected('STORE_UNAVAILABLE', false);
    return { initialize: unavailable, transition: unavailable, preparePseTransition: unavailable,
      guardedPseTransition: unavailable, bindPseTask: unavailable,
      transitionPseStage: unavailable, bindSivsTask: unavailable,
      recordSivsVerification: unavailable, recordSivsSupervision: unavailable,
      transitionSivsStage: unavailable, remediateSivsStage: unavailable,
      processMetrics: unavailable, read: unavailable, audit: () => [], close() {} };
  }
  const controllerIdentity = sha256(canonicalJson({ layer, authority }));
  const authorityValid = Boolean(contract && authority === contract.authority);

  function globalReject(code, envelope, operationHint) {
    const processId = envelope && typeof envelope.processId === 'string' && PROCESS_ID.test(envelope.processId)
      ? envelope.processId : null;
    const result = store.appendControllerRejection(code, {
      processIdDigest: processId ? sha256(processId) : null,
      operationHint,
    });
    return rejected(result.code, result.audited);
  }

  function input(operation, envelope, request) {
    return {
      processId: envelope.processId,
      requestId: envelope.requestId,
      layer,
      controllerIdentity,
      operation,
      requestDigest: sha256(canonicalJson({ controllerIdentity, operation, request })),
      request,
      initialSnapshot: { state: INITIAL_STATE[layer], revision: 0 },
    };
  }

  function initialize(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)) {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'initialize');
    }
    const operationInput = input('initialize', envelope, envelope);
    if (!authorityValid) {
      operationInput.forceCode = 'AUTHORITY_DENIED';
      operationInput.missingCode = 'AUTHORITY_DENIED';
      return store.apply(operationInput, () => ({ allowed: false, code: 'AUTHORITY_DENIED' }));
    }
    return store.apply(operationInput, () => null);
  }

  function transition(request) {
    const envelope = exactEnvelope(
      request,
      ['processId', 'requestId', 'to', 'expectedRevision'],
      ['attestations', 'humanAcceptance'],
    );
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.to !== 'string' || !Number.isSafeInteger(envelope.expectedRevision)
      || envelope.expectedRevision < 0) {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'transition');
    }
    const operationInput = input('transition', envelope, envelope);
    if (!authorityValid) {
      operationInput.forceCode = 'AUTHORITY_DENIED';
      operationInput.missingCode = 'AUTHORITY_DENIED';
    }
    return store.apply(operationInput, snapshot => {
      if (!authorityValid) return { allowed: false, code: 'AUTHORITY_DENIED' };
      if (layer === 'sivs' && envelope.to === 'complete') {
        return { allowed: false, code: 'SIVS_COMPLETION_ADAPTER_REQUIRED' };
      }
      return evaluateTransition({
        layer,
        snapshot,
        to: envelope.to,
        expectedRevision: envelope.expectedRevision,
        authority,
        ...(Object.hasOwn(envelope, 'attestations') ? { attestations: envelope.attestations } : {}),
        ...(Object.hasOwn(envelope, 'humanAcceptance') ? { humanAcceptance: envelope.humanAcceptance } : {}),
      });
    });
  }

  function preparePseTransition(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'taskPath', 'checklistPath']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.taskPath !== 'string' || typeof envelope.checklistPath !== 'string') {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'prepare-pse-transition');
    }
    if (layer !== 'goal') return globalReject('PSE_LAYER_UNSUPPORTED', envelope, 'prepare-pse-transition');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'prepare-pse-transition');
    const operationInput = input('prepare-pse-transition', envelope, envelope);
    return deepFreeze(store.preparePse({ ...operationInput,
      taskPath: envelope.taskPath, checklistPath: envelope.checklistPath }, identifyPseArtifactPair));
  }

  function guardedPseTransition(request) {
    const envelope = guardedEnvelope(request);
    if (!envelope) return globalReject('INVALID_CONTROLLER_REQUEST', null, 'guarded-pse-transition');
    if (layer !== 'goal') return globalReject('PSE_LAYER_UNSUPPORTED', envelope, 'guarded-pse-transition');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'guarded-pse-transition');
    const requestDigest = sha256(canonicalJson(['qe-guarded-pse-request-v1', controllerIdentity,
      'guarded-pse-transition', envelope.processId, envelope.requestId, envelope.receiptSha256, envelope.projection]));
    const operationInput = {
      processId: envelope.processId, requestId: envelope.requestId, layer, controllerIdentity,
      operation: 'guarded-pse-transition', requestDigest, request: envelope.projection,
      receipt: envelope.receipt, taskPath: envelope.taskPath, taskBytes: envelope.taskBytes,
      checklistPath: envelope.checklistPath, checklistBytes: envelope.checklistBytes,
    };
    const result = store.applyPse(operationInput, (snapshot, before) => {
      const compared = comparePseArtifactGenerations({
        before,
        after: { taskPath: envelope.taskPath, taskBytes: envelope.taskBytes,
          checklistPath: envelope.checklistPath, checklistBytes: envelope.checklistBytes },
        resume: envelope.resume,
      });
      if (!compared.ok) return { allowed: false, code: compared.code };
      const consistency = compared.consistency;
      const mapping = PSE_GOAL_MAPPING[`${consistency.beforeClass}>${consistency.afterClass}`];
      if (!mapping || snapshot.state !== mapping[0] || envelope.to !== mapping[1]) {
        return { allowed: false, code: 'PSE_CONTROLLER_MISMATCH' };
      }
      const decision = evaluateTransition({
        layer: 'goal', snapshot, to: envelope.to, expectedRevision: envelope.expectedRevision,
        authority,
        ...(envelope.attestations === null ? {} : { attestations: envelope.attestations }),
        ...(envelope.humanAcceptance === null ? {} : { humanAcceptance: envelope.humanAcceptance }),
      });
      if (!decision.allowed || decision.code !== mapping[2]) return { allowed: false, code: decision.code };
      return { allowed: true, code: 'PSE_TRANSITION_COMMITTED', nextSnapshot: decision.nextSnapshot,
        consistency: { ...consistency, taskChecks: [...consistency.taskChecks],
          checklistChecks: [...consistency.checklistChecks], authoritative: true } };
    });
    return deepFreeze(result);
  }

  function bindPseTask(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'taskPath', 'checklistPath']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.taskPath !== 'string' || typeof envelope.checklistPath !== 'string') {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'bind-pse-task');
    }
    if (layer !== 'pse') return globalReject('PSE_LAYER_UNSUPPORTED', envelope, 'bind-pse-task');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'bind-pse-task');
    const requestDigest = sha256(canonicalJson(['qe-pse-task-bind-request-v1', controllerIdentity,
      'bind-pse-task', envelope.processId, envelope.requestId, envelope.taskPath, envelope.checklistPath]));
    return deepFreeze(store.bindPse({ processId: envelope.processId, requestId: envelope.requestId,
      layer, controllerIdentity, requestDigest, taskPath: envelope.taskPath,
      checklistPath: envelope.checklistPath }, projectPseImmutableGeneration));
  }

  function transitionPseStage(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'action', 'binding',
      'expectedRevision', 'taskPath', 'checklistPath']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || !['forward', 'block', 'resume'].includes(envelope.action)
      || typeof envelope.binding !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.binding)
      || !Number.isSafeInteger(envelope.expectedRevision) || envelope.expectedRevision < 0
      || typeof envelope.taskPath !== 'string' || typeof envelope.checklistPath !== 'string') {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'pse-stage-transition');
    }
    if (layer !== 'pse') return globalReject('PSE_LAYER_UNSUPPORTED', envelope, 'pse-stage-transition');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'pse-stage-transition');
    const result = store.applyPseStage({ ...envelope, layer, controllerIdentity,
      operation: 'pse-stage-transition' }, { identify: identifyPseArtifactPair,
      project: projectPseImmutableGeneration, decide(snapshot) {
        if (envelope.expectedRevision !== snapshot.revision) {
          return { allowed: false, code: 'STALE_SNAPSHOT' };
        }
        const state = snapshot.state;
        let to;
        if (envelope.action === 'forward') {
          to = ({ plan: 'knowledge', knowledge: 'spec', spec: 'execute', execute: 'verify' })[state];
          if (state === 'verify') return { allowed: false, code: 'PSE_STAGE_COMPLETION_UNSUPPORTED' };
          if (!to) return { allowed: false, code: 'PSE_STAGE_ACTION_DENIED' };
        } else if (envelope.action === 'block') {
          if (!['plan', 'knowledge', 'spec', 'execute', 'verify'].includes(state)) {
            return { allowed: false, code: 'PSE_STAGE_ACTION_DENIED' };
          }
          to = 'blocked';
        } else {
          if (state !== 'blocked') return { allowed: false, code: 'PSE_STAGE_ACTION_DENIED' };
          to = snapshot.resumeState;
        }
        const decision = evaluateTransition({ layer: 'pse', snapshot, to,
          expectedRevision: envelope.expectedRevision, authority });
        if (!decision.allowed) return decision;
        const nextSnapshot = envelope.action === 'block'
          ? { ...decision.nextSnapshot, resumeState: state }
          : decision.nextSnapshot;
        return { ...decision, code: 'PSE_STAGE_TRANSITION_COMMITTED', nextSnapshot, action: envelope.action, to };
      } });
    return deepFreeze(result);
  }

  const sivsHelpers = { identify: identifyPseArtifactPair, project: projectPseImmutableGeneration,
    complete(snapshot, attestations, humanAcceptance) {
      return evaluateTransition({ layer: 'sivs', snapshot, to: 'complete',
        expectedRevision: snapshot.revision, authority, attestations, humanAcceptance });
    } };

  function bindSivsTask(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'pseProcessId', 'pseBinding',
      'planSlug', 'goalId', 'taskPath', 'checklistPath']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.pseProcessId !== 'string' || !PROCESS_ID.test(envelope.pseProcessId)
      || typeof envelope.pseBinding !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.pseBinding)
      || !['planSlug', 'goalId', 'taskPath', 'checklistPath'].every(key => typeof envelope[key] === 'string' && envelope[key].trim())) {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'bind-sivs-task');
    }
    if (layer !== 'sivs') return globalReject('SIVS_LAYER_UNSUPPORTED', envelope, 'bind-sivs-task');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'bind-sivs-task');
    const requestDigest = sha256(canonicalJson(['qe-sivs-task-bind-request-v1', controllerIdentity,
      'bind-sivs-task', envelope.processId, envelope.requestId, envelope.pseProcessId,
      sha256(envelope.pseBinding), envelope.planSlug, envelope.goalId,
      envelope.taskPath, envelope.checklistPath]));
    return deepFreeze(store.bindSivs({ ...envelope, layer, controllerIdentity,
      operation: 'bind-sivs-task', requestDigest }, sivsHelpers));
  }

  function recordSivsVerification(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'binding', 'assertion']);
    const a = envelope?.assertion;
    const keys = ['schema', 'uuid', 'planSlug', 'goalId', 'goalAttempt', 'acceptanceHash',
      'implementationRunId', 'verificationRunId', 'verdict', 'reviewer', 'sessionId', 'findingsDigest'];
    if (a && (!Number.isSafeInteger(a.goalAttempt) || a.goalAttempt <= 0
      || typeof a.reviewer !== 'string' || a.reviewer !== a.reviewer.trim() || !a.reviewer
      || Buffer.byteLength(a.reviewer) > 128 || a.reviewer.includes('\0'))) {
      return globalReject('SIVS_VERIFICATION_ASSERTION_MISMATCH', envelope, 'record-sivs-verification');
    }
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.binding !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.binding)
      || !a || Object.keys(a).sort().join('|') !== keys.sort().join('|') || a.schema !== 1
      || !Number.isSafeInteger(a.goalAttempt) || a.goalAttempt <= 0 || !['PASS', 'FAIL'].includes(a.verdict)
      || typeof a.reviewer !== 'string' || a.reviewer !== a.reviewer.trim()
      || !a.reviewer || Buffer.byteLength(a.reviewer) > 128 || a.reviewer.includes('\0')
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.sessionId)
      || !['acceptanceHash', 'implementationRunId', 'verificationRunId', 'findingsDigest']
        .every(key => /^[0-9a-f]{64}$/.test(String(a[key] || '')))) {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'record-sivs-verification');
    }
    if (layer !== 'sivs') return globalReject('SIVS_LAYER_UNSUPPORTED', envelope, 'record-sivs-verification');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'record-sivs-verification');
    const requestDigest = sha256(canonicalJson(['qe-sivs-verification-request-v1', controllerIdentity,
      envelope.processId, envelope.requestId, sha256(envelope.binding), a]));
    return deepFreeze(store.recordSivsVerification({ ...envelope, layer, controllerIdentity,
      operation: 'record-sivs-verification', requestDigest }, sivsHelpers));
  }

  function recordSivsSupervision(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'binding', 'assertion']);
    const a = envelope?.assertion;
    const keys = ['schema', 'uuid', 'planSlug', 'goalId', 'goalAttempt', 'acceptanceHash',
      'verificationProofDigest', 'verdict', 'supervisor', 'sessionId', 'riskDigest'];
    if (a && (!Number.isSafeInteger(a.goalAttempt) || a.goalAttempt <= 0)) {
      return globalReject('SIVS_SUPERVISION_ASSERTION_MISMATCH', envelope, 'record-sivs-supervision');
    }
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.binding !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.binding)
      || !a || Object.keys(a).sort().join('|') !== keys.sort().join('|') || a.schema !== 1
      || !Number.isSafeInteger(a.goalAttempt) || a.goalAttempt <= 0
      || !['PASS', 'WARN', 'FAIL'].includes(a.verdict)
      || !['acceptanceHash', 'verificationProofDigest', 'riskDigest']
        .every(key => /^[0-9a-f]{64}$/.test(String(a[key] || '')))) {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'record-sivs-supervision');
    }
    if (layer !== 'sivs') return globalReject('SIVS_LAYER_UNSUPPORTED', envelope, 'record-sivs-supervision');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'record-sivs-supervision');
    const requestDigest = sha256(canonicalJson(['qe-sivs-supervision-request-v1', controllerIdentity,
      envelope.processId, envelope.requestId, sha256(envelope.binding), a]));
    return deepFreeze(store.recordSivsSupervision({ ...envelope, layer, controllerIdentity,
      operation: 'record-sivs-supervision', requestDigest }, sivsHelpers));
  }

  function transitionSivsStage(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'action', 'binding',
      'expectedRevision', 'taskPath', 'checklistPath']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || !['forward', 'remediate', 'block', 'resume'].includes(envelope.action)
      || typeof envelope.binding !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.binding)
      || !Number.isSafeInteger(envelope.expectedRevision) || envelope.expectedRevision < 0
      || typeof envelope.taskPath !== 'string' || typeof envelope.checklistPath !== 'string') {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'sivs-stage-transition');
    }
    if (layer !== 'sivs') return globalReject('SIVS_LAYER_UNSUPPORTED', envelope, 'sivs-stage-transition');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'sivs-stage-transition');
    return deepFreeze(store.applySivsStage({ ...envelope, layer, controllerIdentity,
      operation: 'sivs-stage-transition' }, sivsHelpers));
  }

  function remediateSivsStage(request) {
    const envelope = exactEnvelope(request, ['processId', 'requestId', 'binding',
      'expectedRevision', 'taskPath', 'checklistPath'], ['route']);
    if (!envelope || !validIdentifier(envelope.processId, envelope.requestId)
      || typeof envelope.binding !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.binding)
      || !Number.isSafeInteger(envelope.expectedRevision) || envelope.expectedRevision < 0
      || typeof envelope.taskPath !== 'string' || typeof envelope.checklistPath !== 'string') {
      return globalReject('INVALID_CONTROLLER_REQUEST', envelope, 'sivs-remediation');
    }
    if (layer !== 'sivs') return globalReject('SIVS_LAYER_UNSUPPORTED', envelope, 'sivs-remediation');
    if (!authorityValid) return globalReject('AUTHORITY_DENIED', envelope, 'sivs-remediation');
    if (Object.hasOwn(envelope, 'route')) {
      return globalReject('SIVS_REMEDIATION_ROUTE_INVALID', envelope, 'sivs-remediation');
    }
    return deepFreeze(store.applySivsRemediation({ ...envelope, layer, controllerIdentity,
      operation: 'sivs-remediation' }, sivsHelpers));
  }

  return {
    initialize,
    transition,
    preparePseTransition,
    guardedPseTransition,
    bindPseTask,
    transitionPseStage,
    bindSivsTask,
    recordSivsVerification,
    recordSivsSupervision,
    transitionSivsStage,
    remediateSivsStage,
    processMetrics() { return deepFreeze(store.processMetrics()); },
    read(processId) {
      if (typeof processId !== 'string' || !PROCESS_ID.test(processId)) {
        return globalReject('INVALID_CONTROLLER_REQUEST', null, 'read');
      }
      return store.read(processId);
    },
    audit(processId) { return store.audit(processId); },
    close() { store.close(); },
  };
}

export { createEligibleProcessController } from './controller-admission.mjs';
