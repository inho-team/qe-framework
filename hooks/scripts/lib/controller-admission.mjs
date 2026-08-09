import { types } from 'node:util';

import { EXECUTION_MODE, resolveExecutionAssurance } from './assurance-policy.mjs';
import { createProcessController } from './process-controller.mjs';

const SCHEMA = 1;
const RESOLVE_KEYS = ['executionMode', 'longRunning', 'highRisk'];
const FACTORY_KEYS = ['cwd', 'layer', 'authority', ...RESOLVE_KEYS];
const ELIGIBLE_REASONS = Object.freeze({
  durable: 'durable-execution',
  longRunning: 'long-running',
  highRisk: 'high-risk',
});

const EXECUTION_MODE_SET = new Set(Object.values(EXECUTION_MODE));

function plainDataRecord(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || types.isProxy?.(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
      && Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
  } catch {
    return false;
  }
}

function exactRecord(value, keys) {
  try {
    if (!plainDataRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length) return null;
    const expected = new Set(keys);
    if (ownKeys.some(key => typeof key !== 'string' || !expected.has(key))) return null;
    const out = {};
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      out[key] = descriptor.value;
    }
    return out;
  } catch {
    return null;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function invalidInput() {
  return deepFreeze({ schema: SCHEMA, admitted: false, code: 'INVALID_INPUT', reason: 'invalid-input' });
}

function ambiguousEligibility() {
  return deepFreeze({ schema: SCHEMA, admitted: false, code: 'AMBIGUOUS_ELIGIBILITY', reason: 'ambiguous-eligibility' });
}

function notRequired() {
  return deepFreeze({ schema: SCHEMA, admitted: false, code: 'NOT_REQUIRED', reason: 'not-required' });
}

function admitted(reason) {
  return deepFreeze({ schema: SCHEMA, admitted: true, code: 'ADMITTED', reason });
}

function validateResolveInput(input) {
  const record = exactRecord(input, RESOLVE_KEYS);
  if (!record) return null;
  if (!EXECUTION_MODE_SET.has(record.executionMode)
    || typeof record.longRunning !== 'boolean' || typeof record.highRisk !== 'boolean') {
    return null;
  }
  return record;
}

function validateFactoryInput(input) {
  const record = exactRecord(input, FACTORY_KEYS);
  if (!record) return null;
  if (typeof record.cwd !== 'string' || record.cwd.trim() === ''
    || typeof record.layer !== 'string' || record.layer.trim() === ''
    || typeof record.authority !== 'string' || record.authority.trim() === '') {
    return null;
  }
  const resolveInput = validateResolveInput({
    executionMode: record.executionMode,
    longRunning: record.longRunning,
    highRisk: record.highRisk,
  });
  if (!resolveInput) return null;
  return { ...record, resolveInput };
}

function eligibleReasons({ executionMode, longRunning, highRisk }) {
  const reasons = [];
  if (executionMode === EXECUTION_MODE.DURABLE) reasons.push(ELIGIBLE_REASONS.durable);
  if (longRunning) reasons.push(ELIGIBLE_REASONS.longRunning);
  if (highRisk) reasons.push(ELIGIBLE_REASONS.highRisk);
  return reasons;
}

export function resolveControllerAdmission(input = {}) {
  const record = validateResolveInput(input);
  if (!record) return invalidInput();

  try {
    const assurance = resolveExecutionAssurance({
      message: '',
      executionMode: record.executionMode,
      longRunning: record.longRunning,
      highRisk: record.highRisk,
    });
    const reasons = eligibleReasons(record);
    if (!assurance.controllerRequired) return notRequired();
    if (reasons.length !== 1) return ambiguousEligibility();
    return admitted(reasons[0]);
  } catch {
    return invalidInput();
  }
}

export function createEligibleProcessController(input = {}) {
  const record = validateFactoryInput(input);
  if (!record) {
    const decision = invalidInput();
    return Object.freeze({ ...decision, controller: null });
  }

  const decision = resolveControllerAdmission(record.resolveInput);
  if (!decision.admitted) {
    return Object.freeze({ ...decision, controller: null });
  }

  const controller = createProcessController({
    cwd: record.cwd,
    layer: record.layer,
    authority: record.authority,
  });
  if (!controller) {
    return Object.freeze({ ...invalidInput(), controller: null });
  }

  return Object.freeze({
    schema: SCHEMA,
    admitted: true,
    code: decision.code,
    reason: decision.reason,
    controller,
  });
}
