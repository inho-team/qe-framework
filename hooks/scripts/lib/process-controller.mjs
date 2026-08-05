import { PROCESS_KERNEL_CONTRACT, evaluateTransition } from './process-kernel.mjs';
import { canonicalJson, createProcessControllerStore, sha256 } from './process-controller-store.mjs';

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

export function createProcessController({ cwd, layer, authority, faultInjector } = {}) {
  const contract = PROCESS_KERNEL_CONTRACT[layer];
  if (!contract) return null;
  const store = typeof cwd === 'string' ? createProcessControllerStore(cwd, { faultInjector }) : null;
  if (!store) {
    const unavailable = () => rejected('STORE_UNAVAILABLE', false);
    return { initialize: unavailable, transition: unavailable, read: unavailable, audit: () => [], close() {} };
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

  return {
    initialize,
    transition,
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
