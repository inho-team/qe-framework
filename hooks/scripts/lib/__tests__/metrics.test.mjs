import test from 'node:test';
import assert from 'node:assert/strict';

import { initMetrics, recordDelegationRequest, recordTaskCompletion, getMetricsSummary } from '../metrics.mjs';

test('metrics: records delegation requests by agent and selected model', () => {
  const metrics = initMetrics();

  recordDelegationRequest(metrics, {
    agentName: 'Etask-executor',
    model: 'sonnet',
    action: 'inject',
  });
  recordDelegationRequest(metrics, {
    agentName: 'Etask-executor',
    model: 'sonnet',
    action: 'allow',
  });

  assert.equal(metrics.delegationRequests, 2);
  assert.deepEqual(metrics.delegationByAgent, { 'Etask-executor': 2 });
  assert.deepEqual(metrics.delegationByModel, { sonnet: 2 });
  assert.equal(metrics.delegationAutoInjections, 1);
});

test('metrics: excludes an unknown verification attempt from Pass@1', () => {
  const metrics = initMetrics();
  metrics.tasksTotal = 1;

  recordTaskCompletion(metrics, null);

  assert.equal(metrics.tasksCompleted, 1);
  assert.equal(metrics.tasksPassAt1, 0);
  assert.equal(metrics.tasksPassAt1Observed, 0);
  assert.match(getMetricsSummary(metrics), /Pass@1: unknown/);
});
