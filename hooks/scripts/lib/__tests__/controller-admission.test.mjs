import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as admission from '../controller-admission.mjs';
import * as processController from '../process-controller.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

function fixture() {
  return mkdtempSync(join(tmpdir(), 'qe-controller-admission-'));
}

function exactKeys(value, keys) {
  return Object.keys(value).join('|') === keys.join('|');
}

function plainResolveInput(overrides = {}) {
  return {
    executionMode: overrides.executionMode ?? 'solo',
    longRunning: overrides.longRunning ?? false,
    highRisk: overrides.highRisk ?? false,
    ...overrides,
  };
}

function plainAdmissionInput(overrides = {}) {
  return {
    cwd: overrides.cwd ?? fixture(),
    layer: overrides.layer ?? 'goal',
    authority: overrides.authority ?? 'goal-controller',
    ...plainResolveInput(overrides),
    ...overrides,
  };
}

test('resolveControllerAdmission rejects hostile exact-record violations with INVALID_INPUT', () => {
  assert.equal(typeof admission.resolveControllerAdmission, 'function');

  const proxy = new Proxy({
    executionMode: 'solo',
    longRunning: false,
    highRisk: false,
  }, {
    ownKeys() { throw new Error('proxy'); },
  });

  const accessor = {
    get executionMode() { throw new Error('getter'); },
    longRunning: false,
    highRisk: false,
  };

  for (const input of [
    proxy,
    accessor,
    { ...plainResolveInput(), unexpected: true },
    { ...plainResolveInput({ executionMode: 'automatic' }) },
    { ...plainResolveInput({ longRunning: 'yes' }) },
  ]) {
    const result = admission.resolveControllerAdmission(input);
    assert.deepEqual(result, { schema: 1, admitted: false, code: 'INVALID_INPUT', reason: 'invalid-input' });
    assert.equal(Object.isFrozen(result), true);
  }

  const root = fixture();
  try {
    const base = {
      cwd: root,
      layer: 'goal',
      authority: 'goal-controller',
      executionMode: 'solo',
      longRunning: false,
      highRisk: false,
    };
    const factoryProxy = new Proxy(base, { ownKeys() { throw new Error('proxy'); } });
    const factoryAccessor = { ...base };
    Object.defineProperty(factoryAccessor, 'authority', { enumerable: true, get() { throw new Error('getter'); } });
    const factoryHidden = { ...base };
    Object.defineProperty(factoryHidden, 'hidden', { enumerable: false, value: true });
    for (const input of [factoryProxy, factoryAccessor, factoryHidden,
      { ...base, unexpected: true }, { ...base, highRisk: 'yes' }]) {
      const result = processController.createEligibleProcessController(input);
      assert.deepEqual(result, { schema: 1, admitted: false, code: 'INVALID_INPUT',
        reason: 'invalid-input', controller: null });
      assert.equal(Object.isFrozen(result), true);
      assert.equal(existsSync(join(root, '.qe', 'qe.db')), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveControllerAdmission returns exact admitted and ordinary decisions', () => {
  const eligibleCases = [
    {
      input: plainResolveInput({ executionMode: 'durable' }),
      reason: 'durable-execution',
    },
    {
      input: plainResolveInput({ executionMode: 'solo', longRunning: true }),
      reason: 'long-running',
    },
    {
      input: plainResolveInput({ executionMode: 'solo', highRisk: true }),
      reason: 'high-risk',
    },
  ];

  for (const { input, reason } of eligibleCases) {
    const result = admission.resolveControllerAdmission(input);
    assert.deepEqual(result, { schema: 1, admitted: true, code: 'ADMITTED', reason });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(exactKeys(result, ['schema', 'admitted', 'code', 'reason']), true);
  }
  assert.deepEqual(admission.resolveControllerAdmission({
    highRisk: false,
    executionMode: 'durable',
    longRunning: false,
  }), { schema: 1, admitted: true, code: 'ADMITTED', reason: 'durable-execution' });
});

test('resolveControllerAdmission returns AMBIGUOUS_ELIGIBILITY when multiple signals are true', () => {
  assert.deepEqual(
    admission.resolveControllerAdmission(plainResolveInput({
      executionMode: 'durable',
      longRunning: true,
      highRisk: true,
    })),
    { schema: 1, admitted: false, code: 'AMBIGUOUS_ELIGIBILITY', reason: 'ambiguous-eligibility' },
  );
});

test('resolveControllerAdmission returns NOT_REQUIRED for ordinary execution modes', () => {
  for (const executionMode of ['solo', 'subagent', 'wave', 'isolated']) {
    assert.deepEqual(
      admission.resolveControllerAdmission(plainResolveInput({ executionMode })),
      { schema: 1, admitted: false, code: 'NOT_REQUIRED', reason: 'not-required' },
      executionMode,
    );
  }
});

test('createEligibleProcessController returns the exact five-key wrapper and null controller on denial', () => {
  assert.equal(typeof processController.createEligibleProcessController, 'function');
  assert.equal(processController.createEligibleProcessController, admission.createEligibleProcessController);
  const root = fixture();
  try {
    const denied = processController.createEligibleProcessController(plainAdmissionInput({
      cwd: root,
      executionMode: 'solo',
    }));
    assert.equal(exactKeys(denied, ['schema', 'admitted', 'code', 'reason', 'controller']), true);
    assert.equal(Object.isFrozen(denied), true);
    assert.equal(denied.controller, null);
    assert.deepEqual(
      { schema: denied.schema, admitted: denied.admitted, code: denied.code, reason: denied.reason },
      { schema: 1, admitted: false, code: 'NOT_REQUIRED', reason: 'not-required' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('denial stays storage-free while an admitted initialize stores exactly one process', () => {
  const deniedRoot = fixture();
  try {
    const denied = processController.createEligibleProcessController(plainAdmissionInput({
      cwd: deniedRoot,
      executionMode: 'solo',
    }));
    assert.equal(denied.controller, null);
    assert.equal(existsSync(join(deniedRoot, '.qe', 'qe.db')), false);
  } finally {
    rmSync(deniedRoot, { recursive: true, force: true });
  }

  const admittedRoot = fixture();
  try {
    const admitted = processController.createEligibleProcessController({
      highRisk: false,
      authority: 'goal-controller',
      executionMode: 'durable',
      layer: 'goal',
      longRunning: false,
      cwd: admittedRoot,
    });
    assert.equal(admitted.admitted, true);
    assert.equal(admitted.controller?.initialize({ processId: 'goal-1', requestId: 'init-1' }).code, 'INITIALIZED');
    const db = openSqlite(admittedRoot);
    try {
      const row = db.prepare('SELECT COUNT(*) AS count FROM process_controller_state').get();
      assert.equal(row.count, 1);
    } finally {
      closeSqlite(db);
    }
    assert.equal(existsSync(join(admittedRoot, '.qe', 'qe.db')), true);
  } finally {
    rmSync(admittedRoot, { recursive: true, force: true });
  }
});
