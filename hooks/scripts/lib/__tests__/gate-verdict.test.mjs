import { test } from 'node:test';
import assert from 'node:assert';

import { aggregateGateVerdict } from '../gate-verdict.mjs';

test('gate-verdict: any FAIL → FAIL (even with passes)', () => {
  assert.equal(aggregateGateVerdict(['PASS', 'PASS', 'FAIL']).verdict, 'FAIL');
  assert.equal(aggregateGateVerdict(['FAIL', 'WARN', 'WARN']).verdict, 'FAIL');
});

test('gate-verdict: 2+ WARN → WARN', () => {
  assert.equal(aggregateGateVerdict(['WARN', 'WARN', 'PASS']).verdict, 'WARN');
});

test('gate-verdict: exactly 1 WARN, rest PASS → PASS', () => {
  assert.equal(aggregateGateVerdict(['WARN', 'PASS', 'PASS']).verdict, 'PASS');
});

test('gate-verdict: all PASS → PASS', () => {
  assert.equal(aggregateGateVerdict(['PASS', 'PASS', 'PASS']).verdict, 'PASS');
});

test('gate-verdict: empty input → WARN (nothing ran cannot certify)', () => {
  assert.equal(aggregateGateVerdict([]).verdict, 'WARN');
  assert.equal(aggregateGateVerdict().verdict, 'WARN');
});

test('gate-verdict: unrecognized verdict → treated as WARN (never silent PASS)', () => {
  assert.equal(aggregateGateVerdict(['PASS', 'banana']).verdict, 'PASS'); // 1 WARN, rest PASS
  assert.equal(aggregateGateVerdict(['banana', 'banana']).verdict, 'WARN'); // 2 WARN
});

test('gate-verdict: accepts {verdict} objects and is case-insensitive', () => {
  const r = aggregateGateVerdict([{ verdict: 'pass' }, { verdict: 'Fail' }]);
  assert.equal(r.verdict, 'FAIL');
});

test('gate-verdict: returns counts breakdown', () => {
  const r = aggregateGateVerdict(['PASS', 'WARN', 'FAIL']);
  assert.deepEqual(r.counts, { PASS: 1, WARN: 1, FAIL: 1 });
});
