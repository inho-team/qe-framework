import test from 'node:test';
import assert from 'node:assert/strict';
import { failedInterviews } from '../tools/eval-gate.mjs';

test('an interview case needs two fully passing runs out of three', () => {
  const content = { name: 'content', scored: true, passed: true };
  const scope = { name: 'scope', scored: true, passed: true };
  const pass = { score: 1, graders: [content, scope] };
  const partial = { score: 0.83, graders: [content, { ...scope, passed: false }] };
  const report = (runs) => ({
    cases: [{
      name: 'gate-interview-handoff', runsPerCase: 3,
      graders: [{ name: 'content' }, { name: 'scope' }], arms: { with: runs },
    }],
  });
  assert.deepEqual(failedInterviews(report([pass, partial, partial])), ['gate-interview-handoff (1/3)']);
  assert.deepEqual(failedInterviews(report([pass, pass, partial])), []);
  assert.deepEqual(failedInterviews(report([pass]), 1), []);
  const missing = { ...pass, graders: [content] };
  const skipped = { ...pass, graders: [content, { ...scope, scored: false }] };
  assert.deepEqual(failedInterviews(report([pass, missing, skipped])), ['gate-interview-handoff (1/3)']);
});
