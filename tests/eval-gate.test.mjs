import test from 'node:test';
import assert from 'node:assert/strict';
import { failedStrictCases } from '../tools/eval-gate.mjs';

const content = { name: 'content', scored: true, passed: true };
const scope = { name: 'scope', scored: true, passed: true };
const pass = { score: 1, graders: [content, scope] };
const partial = { score: 0.83, graders: [content, { ...scope, passed: false }] };
const report = (name, runs) => ({
  cases: [{
    name, runsPerCase: 3,
    graders: [{ name: 'content' }, { name: 'scope' }], arms: { with: runs },
  }],
});

test('an interview case needs two fully passing runs out of three', () => {
  const name = 'gate-interview-handoff';
  assert.deepEqual(failedStrictCases(report(name, [pass, partial, partial])), [`${name} (1/3)`]);
  assert.deepEqual(failedStrictCases(report(name, [pass, pass, partial])), []);
  assert.deepEqual(failedStrictCases(report(name, [pass]), 1), []);
  const missing = { ...pass, graders: [content] };
  const skipped = { ...pass, graders: [content, { ...scope, scored: false }] };
  assert.deepEqual(failedStrictCases(report(name, [pass, missing, skipped])), [`${name} (1/3)`]);
});

test('listed path cases are judged per run like interview cases', () => {
  for (const name of [
    'gate-handoff-subagent-plan',
    'gate-plan-asks-execution-mode', 'gate-review-fix-needs-consent', 'gate-review-fix-delegated',
    'gate-approach-alternatives',
  ]) {
    assert.deepEqual(failedStrictCases(report(name, [pass, partial, partial])), [`${name} (1/3)`]);
    assert.deepEqual(failedStrictCases(report(name, [pass, pass, partial])), []);
  }
});

test('other gate cases keep the harness threshold', () => {
  assert.deepEqual(failedStrictCases(report('gate-flaky-no-retry', [partial, partial, partial])), []);
});
