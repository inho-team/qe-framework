import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSURANCE_MODE,
  EXECUTION_MODE,
  resolveExecutionAssurance,
} from '../assurance-policy.mjs';

test('assurance and execution modes form an independent cross-product', () => {
  for (const executionMode of Object.values(EXECUTION_MODE)) {
    const ordinary = resolveExecutionAssurance({ message: '대규모 인증 시스템을 설계해줘', executionMode });
    const planned = resolveExecutionAssurance({ message: '$Qplan 대규모 인증 시스템 설계', executionMode });

    assert.equal(ordinary.assuranceMode, ASSURANCE_MODE.NATIVE, executionMode);
    assert.equal(planned.assuranceMode, ASSURANCE_MODE.FULL_SIVS, executionMode);
    assert.equal(ordinary.executionMode, executionMode);
    assert.equal(planned.executionMode, executionMode);
    assert.equal(ordinary.safetyKernel, true);
    assert.equal(planned.responseStyle, true);
  }
});

test('controller reuse depends on runtime need rather than assurance mode', () => {
  const fullSolo = resolveExecutionAssurance({ message: '/Qgoal fix login', executionMode: EXECUTION_MODE.SOLO });
  assert.equal(fullSolo.assuranceMode, ASSURANCE_MODE.FULL_SIVS);
  assert.equal(fullSolo.controllerRequired, false);

  const nativeDurable = resolveExecutionAssurance({ message: 'nightly migration을 실행해줘', executionMode: EXECUTION_MODE.DURABLE });
  assert.equal(nativeDurable.assuranceMode, ASSURANCE_MODE.NATIVE);
  assert.equal(nativeDurable.controllerRequired, true);
  assert.equal(nativeDurable.controllerReason, 'durable-execution');

  const nativeLong = resolveExecutionAssurance({ message: '작업을 실행해줘', longRunning: true });
  assert.equal(nativeLong.controllerRequired, true);
  assert.equal(nativeLong.controllerReason, 'long-running');

  const nativeRisk = resolveExecutionAssurance({ message: '작업을 실행해줘', highRisk: true });
  assert.equal(nativeRisk.controllerRequired, true);
  assert.equal(nativeRisk.controllerReason, 'high-risk');
});

test('non-durable execution does not inherit controller overhead', () => {
  for (const executionMode of [EXECUTION_MODE.SOLO, EXECUTION_MODE.SUBAGENT, EXECUTION_MODE.WAVE, EXECUTION_MODE.ISOLATED]) {
    const policy = resolveExecutionAssurance({ message: 'ordinary task', executionMode });
    assert.equal(policy.controllerRequired, false, executionMode);
    assert.equal(policy.controllerReason, 'not-required', executionMode);
  }
});

test('invalid execution policy input fails closed', () => {
  assert.throws(() => resolveExecutionAssurance({ executionMode: 'automatic' }), /unknown execution mode/);
  assert.throws(() => resolveExecutionAssurance({ longRunning: 'yes' }), /must be booleans/);
});
