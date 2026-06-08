import { test } from 'node:test';
import assert from 'node:assert';

import {
  isCodexReachable,
  evaluateCodexReachability,
} from '../../../../scripts/lib/codex_bridge.mjs';

/** ISO timestamp `secondsAgo` in the past. @returns {string} */
function ago(secondsAgo) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

// --- pure decision logic (deterministic, env-independent) ---

test('evaluate: plugin unavailable → reachable false / plugin_missing', () => {
  const r = evaluateCodexReachability({}, {}, false);
  assert.equal(r.reachable, false);
  assert.equal(r.reason, 'plugin_missing');
  assert.equal(r.degraded, false);
});

test('evaluate: no recent error → reachable, not degraded', () => {
  const r = evaluateCodexReachability({}, {}, true);
  assert.equal(r.reachable, true);
  assert.equal(r.degraded, false);
});

test('evaluate: recent same-stage error → blocked (not degraded)', () => {
  const state = { codex_last_error: { timestamp: ago(60), type: 'timeout', stage: 'verify' } };
  const r = evaluateCodexReachability(state, { stage: 'verify' }, true);
  assert.equal(r.reachable, false);
  assert.match(r.reason, /^recent_error:timeout/);
});

test('evaluate: recent OTHER-stage error → reachable but degraded', () => {
  const state = { codex_last_error: { timestamp: ago(60), type: 'timeout', stage: 'spec' } };
  const r = evaluateCodexReachability(state, { stage: 'verify' }, true);
  assert.equal(r.reachable, true);
  assert.equal(r.degraded, true);
  assert.match(r.reason, /^recent_error_other_stage/);
});

test('evaluate: error older than 5min TTL → reachable', () => {
  const state = { codex_last_error: { timestamp: ago(600), type: 'timeout', stage: 'verify' } };
  const r = evaluateCodexReachability(state, { stage: 'verify' }, true);
  assert.equal(r.reachable, true);
});

test('evaluate: recent error with no stage info → blocked (safe default)', () => {
  const state = { codex_last_error: { timestamp: ago(60), type: 'crash' } };
  const r = evaluateCodexReachability(state, { stage: 'verify' }, true);
  assert.equal(r.reachable, false);
});

test('evaluate: unparseable timestamp → fail-closed (blocked)', () => {
  const state = { codex_last_error: { timestamp: 'not-a-date', type: 'crash', stage: 'verify' } };
  const r = evaluateCodexReachability(state, { stage: 'verify' }, true);
  assert.equal(r.reachable, false); // NaN age treated as recent (fail-closed)
});

test('evaluate: error record with empty/missing timestamp → fail-closed', () => {
  const empty = evaluateCodexReachability({ codex_last_error: { timestamp: '', type: 'crash', stage: 'verify' } }, { stage: 'verify' }, true);
  assert.equal(empty.reachable, false);
  const missing = evaluateCodexReachability({ codex_last_error: { type: 'crash', stage: 'verify' } }, { stage: 'verify' }, true);
  assert.equal(missing.reachable, false);
});

// --- public wrapper: backward-compatible shape (env-dependent reachability) ---

test('isCodexReachable: single-arg call returns {reachable, degraded}', () => {
  const r = isCodexReachable({});
  assert.equal(typeof r.reachable, 'boolean');
  assert.ok('degraded' in r);
});
