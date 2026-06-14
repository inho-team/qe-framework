#!/usr/bin/env node

/**
 * safety-hooks.test.mjs
 * Test suite for retry-counter.mjs, iteration-tracker.mjs, context-meter.mjs
 * Run with: node --test hooks/scripts/lib/__tests__/safety-hooks.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { recordFailure, getCount, resetCounter } from '../retry-counter.mjs';
import { recordIteration, getState, resetSession } from '../iteration-tracker.mjs';
import {
  estimateUsageRatio,
  estimateUsage,
  recordBlock,
  getBlockCount,
  resetBlocks,
  writeCachedRatio,
  writeCachedLimit,
  readCachedLimit,
  readConfiguredLimit,
  deriveContextLimit,
  modelIdToLimit,
} from '../context-meter.mjs';

// ============================================================================
// retry-counter tests
// ============================================================================

test('retry-counter: happy path — recordFailure 4 times → count = 4', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sig = 'cmd:build';
  recordFailure(sig, dir);
  recordFailure(sig, dir);
  recordFailure(sig, dir);
  recordFailure(sig, dir);
  assert.strictEqual(getCount(sig, dir), 4);
});

test('retry-counter: threshold — 5th recordFailure → count = 5', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sig = 'cmd:test';
  for (let i = 0; i < 5; i++) recordFailure(sig, dir);
  assert.strictEqual(getCount(sig, dir), 5);
});

test('retry-counter: window expiry — windowStart > 1h ago resets count to 1', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sig = 'cmd:lint';
  // Record 3 failures
  recordFailure(sig, dir);
  recordFailure(sig, dir);
  recordFailure(sig, dir);
  assert.strictEqual(getCount(sig, dir), 3);

  // Manually set windowStart to > 1 hour ago
  const countersFile = path.join(dir, 'retry-counters.json');
  const data = JSON.parse(fs.readFileSync(countersFile, 'utf8'));
  data[sig].windowStart = Math.floor(Date.now() / 1000) - 3700; // 3700s > 3600s
  fs.writeFileSync(countersFile, JSON.stringify(data, null, 2), 'utf8');

  // Next recordFailure should reset to 1
  const result = recordFailure(sig, dir);
  assert.strictEqual(result.count, 1);
  assert.strictEqual(getCount(sig, dir), 1);
});

test('retry-counter: different signatures do not interfere', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sigA = 'cmd:build';
  const sigB = 'cmd:deploy';
  recordFailure(sigA, dir);
  recordFailure(sigA, dir);
  recordFailure(sigB, dir);

  assert.strictEqual(getCount(sigA, dir), 2);
  assert.strictEqual(getCount(sigB, dir), 1);
});

test('retry-counter: resetCounter clears the entry', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sig = 'cmd:format';
  recordFailure(sig, dir);
  recordFailure(sig, dir);
  assert.strictEqual(getCount(sig, dir), 2);

  resetCounter(sig, dir);
  assert.strictEqual(getCount(sig, dir), 0);
});

// ============================================================================
// iteration-tracker tests
// ============================================================================

test('iteration-tracker: recordIteration increments count and updates lastActivity', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sessionId = 'session-abc';
  const before = Math.floor(Date.now() / 1000);

  const r1 = recordIteration(sessionId, dir);
  assert.strictEqual(r1.count, 1);
  assert.ok(r1.lastActivity >= before);

  const r2 = recordIteration(sessionId, dir);
  assert.strictEqual(r2.count, 2);
  assert.ok(r2.lastActivity >= before);
});

test('iteration-tracker: multiple sessions do not collide', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const s1 = 'session-1';
  const s2 = 'session-2';
  recordIteration(s1, dir);
  recordIteration(s1, dir);
  recordIteration(s1, dir);
  recordIteration(s2, dir);

  assert.strictEqual(getState(s1, dir).count, 3);
  assert.strictEqual(getState(s2, dir).count, 1);
});

test('iteration-tracker: getState returns null for unknown session', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = getState('nonexistent-session', dir);
  assert.strictEqual(result, null);
});

test('iteration-tracker: resetSession clears the entry', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sessionId = 'session-xyz';
  recordIteration(sessionId, dir);
  recordIteration(sessionId, dir);
  assert.strictEqual(getState(sessionId, dir).count, 2);

  resetSession(sessionId, dir);
  assert.strictEqual(getState(sessionId, dir), null);
});

// ============================================================================
// context-meter tests
// ============================================================================

test('context-meter: estimateUsageRatio with non-existent transcript path → 0', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const ratio = estimateUsageRatio(path.join(dir, 'no-such-file.jsonl'));
  assert.strictEqual(ratio, 0);
});

test('context-meter: picks most recent usage entry from tail, not the first', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'transcript.jsonl');
  const old = { type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: 10000 } } };
  const mid = { type: 'user' };
  const recent = { type: 'assistant', message: { usage: { input_tokens: 5, cache_read_input_tokens: 150000, cache_creation_input_tokens: 500 } } };
  fs.writeFileSync(file, [JSON.stringify(old), JSON.stringify(mid), JSON.stringify(recent)].join('\n') + '\n');

  const ratio = estimateUsageRatio(file, 200000);
  assert.strictEqual(ratio, (5 + 150000 + 500) / 200000);
});

test('context-meter: append-only growth past the window does NOT pin ratio at 1.0', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'transcript.jsonl');
  // Simulate a long session: 50 old turns (no usage) plus a small final usage block.
  const bigLine = JSON.stringify({ type: 'system', content: 'x'.repeat(20000) });
  const finalTurn = JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, cache_read_input_tokens: 20000 } } });
  const payload = Array(50).fill(bigLine).join('\n') + '\n' + finalTurn + '\n';
  fs.writeFileSync(file, payload);

  const ratio = estimateUsageRatio(file, 200000);
  assert.ok(ratio < 0.2, `expected ratio from live usage (~0.1), got ${ratio}`);
});

test('context-meter: skips malformed first line from byte-boundary cut', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'transcript.jsonl');
  // First entry is syntactically broken JSON (simulates a mid-line cut);
  // the second is a valid usage block.
  const broken = '{"type":"assist'; // intentionally truncated
  const valid = JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1000, cache_read_input_tokens: 40000 } } });
  fs.writeFileSync(file, broken + '\n' + valid + '\n');

  const ratio = estimateUsageRatio(file, 200000);
  assert.strictEqual(ratio, 41000 / 200000);
});

test('context-meter: returns 0 when tail contains no usage entries', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'system' }) + '\n' + JSON.stringify({ type: 'user' }) + '\n');

  const ratio = estimateUsageRatio(file, 200000);
  assert.strictEqual(ratio, 0);
});

test('context-meter: recordBlock increments and persists across calls', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sessionId = 'ctx-session';
  const c1 = recordBlock(sessionId, dir);
  assert.strictEqual(c1, 1);

  const c2 = recordBlock(sessionId, dir);
  assert.strictEqual(c2, 2);

  const c3 = recordBlock(sessionId, dir);
  assert.strictEqual(c3, 3);
});

test('context-meter: getBlockCount reflects current state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sessionId = 'ctx-session-2';
  assert.strictEqual(getBlockCount(sessionId, dir), 0);

  recordBlock(sessionId, dir);
  recordBlock(sessionId, dir);
  assert.strictEqual(getBlockCount(sessionId, dir), 2);
});

test('context-meter: resetBlocks clears the entry', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sessionId = 'ctx-session-3';
  recordBlock(sessionId, dir);
  recordBlock(sessionId, dir);
  assert.strictEqual(getBlockCount(sessionId, dir), 2);

  resetBlocks(sessionId, dir);
  assert.strictEqual(getBlockCount(sessionId, dir), 0);
});

// ============================================================================
// context-meter: model-aware window limit (200k vs 1M) tests
// ============================================================================

test('deriveContextLimit: 20% at ~200k input → 1M tier', () => {
  // The exact field shape Claude Code passes to the statusline on a 1M model.
  assert.strictEqual(deriveContextLimit({ used_percentage: 20, total_input_tokens: 200000 }), 1000000);
});

test('deriveContextLimit: 32% at 40k input → 200k tier', () => {
  assert.strictEqual(deriveContextLimit({ used_percentage: 32, total_input_tokens: 40000 }), 200000);
});

test('deriveContextLimit: snap survives integer-percent rounding at low fill', () => {
  // 1M model at ~0.6% reports used_percentage=1 → raw ≈ 600k, still > 400k split.
  assert.strictEqual(deriveContextLimit({ used_percentage: 1, total_input_tokens: 6000 }), 1000000);
  // 200k model at ~0.6% reports used_percentage=1 → raw ≈ 120k, stays < 400k split.
  assert.strictEqual(deriveContextLimit({ used_percentage: 1, total_input_tokens: 1200 }), 200000);
});

test('deriveContextLimit: returns null when underivable', () => {
  assert.strictEqual(deriveContextLimit({ used_percentage: 0, total_input_tokens: 100 }), null);
  assert.strictEqual(deriveContextLimit({ used_percentage: 20 }), null);
  assert.strictEqual(deriveContextLimit(null), null);
});

test('readCachedLimit: round-trips the persisted limit', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  writeCachedRatio(dir, 20, 1000000);
  assert.strictEqual(readCachedLimit(dir), 1000000);
});

test('readCachedLimit: null when no limit field was written', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  writeCachedRatio(dir, 20); // legacy 2-arg call — no limit persisted
  assert.strictEqual(readCachedLimit(dir), null);
});

test('writeCachedRatio: a later limit-less redraw does NOT clobber a persisted limit', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // 1) a redraw back-solves and persists the 1M tier
  writeCachedRatio(dir, 20, 1000000);
  assert.strictEqual(readCachedLimit(dir), 1000000);
  // 2) a later redraw frame can't re-derive (total_input_tokens absent →
  //    deriveContextLimit → null → limit arg omitted). The TTL-exempt limit
  //    must survive the full-file overwrite, or the sub-200k blind spot reopens.
  writeCachedRatio(dir, 18);
  assert.strictEqual(readCachedLimit(dir), 1000000);
});

test('readConfiguredLimit: reads hooks.context_window_limit from .qe/config.json', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, '.qe'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.qe', 'config.json'),
    JSON.stringify({ hooks: { context_window_limit: 1000000 } }),
    'utf8',
  );
  assert.strictEqual(readConfiguredLimit(dir), 1000000);
});

test('readConfiguredLimit: QE_CONTEXT_LIMIT env overrides config', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prev = process.env.QE_CONTEXT_LIMIT;
  t.after(() => { if (prev === undefined) delete process.env.QE_CONTEXT_LIMIT; else process.env.QE_CONTEXT_LIMIT = prev; });

  fs.mkdirSync(path.join(dir, '.qe'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.qe', 'config.json'),
    JSON.stringify({ hooks: { context_window_limit: 200000 } }),
    'utf8',
  );
  process.env.QE_CONTEXT_LIMIT = '1000000';
  assert.strictEqual(readConfiguredLimit(dir), 1000000);
});

test('readConfiguredLimit: null when neither env nor config sets a limit', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prev = process.env.QE_CONTEXT_LIMIT;
  delete process.env.QE_CONTEXT_LIMIT;
  t.after(() => { if (prev !== undefined) process.env.QE_CONTEXT_LIMIT = prev; });

  assert.strictEqual(readConfiguredLimit(dir), null);
});

test('regression: no-statusline 1M run at 150k tokens is scored against 1M via config', (t) => {
  // The exact failure this whole change targets: HUD off → cache never written →
  // transcript model id stripped to "claude-opus-4-8" → would resolve to 200k →
  // 150k/200k = 0.75 false WARNING. With the config override it's 150k/1M = 0.15.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 150000 } },
  }) + '\n', 'utf8');

  const u = estimateUsage(transcript, { modelId: 'claude-opus-4-8', modelLimit: 1000000 });
  assert.strictEqual(u.limit, 1000000);
  assert.ok(u.ratio < 0.2, `expected ~0.15, got ${u.ratio}`);
  // and without the override it would have been the false 0.75
  const naive = estimateUsage(transcript, { modelId: 'claude-opus-4-8' });
  assert.strictEqual(naive.limit, 200000);
  assert.strictEqual(naive.ratio, 0.75);
});

test('regression: 168k tokens on a 1M model is NOT mis-read as 84%', (t) => {
  // Reproduces the HUD-20%-vs-warning-84% split: a 1M-context run sitting at
  // ~168k tokens. Without the true limit, estimateUsageRatio divides by the
  // 200k default (168k/200k = 0.84 → false CRITICAL). With the cached 1M limit
  // it reads the true ~17% occupancy that the HUD shows.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'transcript.jsonl');
  // model id has the [1m] marker stripped, exactly as Claude Code delivers it.
  const turn = JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 68000, cache_read_input_tokens: 100000 } },
  });
  fs.writeFileSync(file, turn + '\n');

  // Buggy path: id alone (marker stripped) + tokens < 200k → divides by 200k.
  const naive = estimateUsageRatio(file, { modelId: 'claude-opus-4-8' });
  assert.strictEqual(naive, 168000 / 200000); // 0.84 — the false reading

  // Fixed path: the statusline-cached true limit overrides the denominator.
  const corrected = estimateUsageRatio(file, { modelId: 'claude-opus-4-8', modelLimit: 1000000 });
  assert.strictEqual(corrected, 168000 / 1000000); // 0.168 — matches the HUD
  assert.ok(corrected < 0.7, 'corrected ratio must be below the WARNING threshold');
});

test('modelIdToLimit: [1m] marker → 1M, plain id → 200k default', () => {
  assert.strictEqual(modelIdToLimit('claude-opus-4-8[1m]'), 1000000);
  assert.strictEqual(modelIdToLimit('claude-opus-4-8'), 200000);
  assert.strictEqual(modelIdToLimit(null), 200000);
});

test('regression: a model-id hint must NOT bypass the >200k observed-token upgrade', (t) => {
  // Bug ①: resolveLimit used to `return modelIdToLimit(hintModelId)` early,
  // so a bare 1M id (marker stripped) resolved to 200k and the >200k safety
  // net never ran. A 1M run at 226k then mis-read as 100% instead of ~23%.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'transcript.jsonl');
  const turn = JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 26387, cache_read_input_tokens: 200000 } },
  });
  fs.writeFileSync(file, turn + '\n'); // 226387 tokens total

  // Even WITH a (stripped) id hint, 226k > 200k base must upgrade to 1M.
  const u = estimateUsage(file, { modelId: 'claude-opus-4-8' });
  assert.strictEqual(u.limit, 1000000);
  assert.strictEqual(u.tokens, 226387);
  assert.ok(u.ratio < 0.3, `expected ~0.23, got ${u.ratio}`);
});

test('QE_CONTEXT_LIMIT env override is honored even when a model-id hint is present', (t) => {
  // Bug ①: the early hintModelId return also shadowed the env override.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prev = process.env.QE_CONTEXT_LIMIT;
  process.env.QE_CONTEXT_LIMIT = '1000000';
  t.after(() => { if (prev === undefined) delete process.env.QE_CONTEXT_LIMIT; else process.env.QE_CONTEXT_LIMIT = prev; });

  const file = path.join(dir, 'transcript.jsonl');
  const turn = JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 150000 } }, // 150k, below 200k
  });
  fs.writeFileSync(file, turn + '\n');

  // 150k is in the sub-200k blind spot; only the env override can rescue it.
  const u = estimateUsage(file, { modelId: 'claude-opus-4-8' });
  assert.strictEqual(u.limit, 1000000);
  assert.strictEqual(u.ratio, 150000 / 1000000);
});

test('writeCachedLimit: persists the limit and survives without a ratio (sticky)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // No statusline ever ran — write the deterministically detected 1M tier.
  writeCachedLimit(dir, 1000000);
  assert.strictEqual(readCachedLimit(dir), 1000000);

  // A later fresh ratio write must not clobber the sticky limit, and a sticky
  // limit write must not invent a ratio (readCachedLimit-only, TTL-exempt).
  writeCachedRatio(dir, 5, 1000000);
  assert.strictEqual(readCachedLimit(dir), 1000000);
});
