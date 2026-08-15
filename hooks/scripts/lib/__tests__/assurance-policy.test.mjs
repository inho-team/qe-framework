import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSURANCE_MODE, detectHighImpactRisks, resolveAssurancePolicy } from '../assurance-policy.mjs';
import { triageGoal } from '../goal-router.mjs';

test('only active-prefix Qplan and Qgoal entries activate Full SIVS', () => {
  for (const input of [
    '$Qplan redesign the runtime',
    '/Qplan redesign the runtime',
    '$Qgoal fix README.md',
    '/Qgoal fix README.md',
  ]) {
    const policy = resolveAssurancePolicy(input);
    assert.equal(policy.mode, ASSURANCE_MODE.FULL_SIVS, input);
    assert.equal(policy.safetyKernel, true);
    assert.equal(policy.responseStyle, true);
  }
});

test('ordinary requests stay native regardless of size, wording, or risk terms', () => {
  for (const input of [
    'fix the typo in README.md',
    'a.mjs b.mjs c.mjs d.mjs 구현하고 테스트와 문서와 배포까지 진행해줘',
    'Implement a database migration touching migration.js safely.',
    'Qplan과 Qgoal의 차이를 설명해줘',
    '작은 오타 수정해줘 README.md !full',
  ]) {
    const policy = resolveAssurancePolicy(input);
    assert.equal(policy.mode, ASSURANCE_MODE.NATIVE, input);
    assert.equal(policy.safetyKernel, true);
    assert.equal(policy.responseStyle, true);
  }
});

test('explicit Qplan and Qgoal always select the Plan pipeline and cannot be downgraded', () => {
  for (const input of [
    '/Qplan redesign the runtime',
    '$Qplan !direct redesign the runtime',
    '/Qgoal fix login in auth.mjs',
    '$Qgoal !direct fix README.md',
    '/Qgoal a.mjs b.mjs c.mjs d.mjs 구현해줘',
  ]) {
    const route = triageGoal(input);
    assert.equal(route.route, 'pipeline', input);
    assert.equal(route.reason, 'explicit-full-sivs', input);
  }
});

test('natural-language goals stay on the native path even when historically full-scale', () => {
  for (const input of [
    'a.mjs b.mjs c.mjs d.mjs 구현해줘',
    '대규모 리팩터링을 구현하고 테스트와 문서와 배포 마이그레이션까지 진행해줘',
    '작은 오타 수정해줘 README.md !full',
  ]) {
    const route = triageGoal(input);
    assert.equal(route.detected, true, input);
    assert.equal(route.route, 'direct', input);
    assert.equal(route.reason, 'native-default', input);
  }
});

test('high-impact wording stays native but carries an explicit Qplan recommendation', () => {
  const route = triageGoal('Implement a database migration and authorization fix in migration.js safely');
  assert.equal(route.route, 'direct');
  assert.equal(route.reason, 'native-default');
  assert.deepEqual(route.riskCategories, ['authorization', 'data-migration']);
  assert.match(route.instruction, /Recommend explicit \$Qplan or \/Qplan/);
  assert.match(route.instruction, /does not activate it/);
});

test('risk detection is deterministic and ignores empty input', () => {
  assert.deepEqual(detectHighImpactRisks('결제 API 삭제와 보안 암호화'), ['payment', 'destructive-data-change', 'security']);
  assert.deepEqual(detectHighImpactRisks(''), []);
  assert.deepEqual(detectHighImpactRisks(null), []);
});
