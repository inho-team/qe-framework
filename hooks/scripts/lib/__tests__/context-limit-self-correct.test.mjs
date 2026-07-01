import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readDetectedLimit, writeDetectedLimit, normalizeModelId } from '../context-meter.mjs';
import { checkContextPressure } from '../../context-monitor.mjs';

// These tests assert id-based limit resolution (200k guess vs deterministic 1M
// upgrade). A real QE session exports QE_CONTEXT_LIMIT, which resolveLimit honours
// (step 2) and would mask the 200k baseline — clear it per test, restore after.
let _savedQcl;
beforeEach(() => { _savedQcl = process.env.QE_CONTEXT_LIMIT; delete process.env.QE_CONTEXT_LIMIT; });
afterEach(() => { if (_savedQcl !== undefined) process.env.QE_CONTEXT_LIMIT = _savedQcl; });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-ctx-'));
  mkdirSync(join(dir, '.qe', 'state'), { recursive: true });
  return dir;
}

function writeTranscript(dir, tokens, model = 'claude-opus-4-8') {
  const p = join(dir, 'transcript.jsonl');
  const entry = {
    message: {
      model,
      usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  };
  writeFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
  return p;
}

function writeConfig(dir, hooks) {
  writeFileSync(join(dir, '.qe', 'config.json'), JSON.stringify({ hooks }, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// #2 — durable, model-keyed detected-limit store
// ---------------------------------------------------------------------------

test('writeDetectedLimit / readDetectedLimit: round-trips model-keyed', () => {
  const dir = tmpProject();
  try {
    assert.equal(readDetectedLimit(dir, 'claude-opus-4-8'), null, 'absent before write');
    writeDetectedLimit(dir, 'claude-opus-4-8', 1000000);
    assert.equal(readDetectedLimit(dir, 'claude-opus-4-8'), 1000000, 'reads back the detected tier');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDetectedLimit: keyed — a different model does not inherit the limit', () => {
  const dir = tmpProject();
  try {
    writeDetectedLimit(dir, 'claude-opus-4-8', 1000000);
    assert.equal(readDetectedLimit(dir, 'claude-sonnet-4-6'), null, 'no cross-model leak');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeDetectedLimit: rejects unusable model ids (synthetic / empty / null)', () => {
  const dir = tmpProject();
  try {
    writeDetectedLimit(dir, '<synthetic>', 1000000);
    writeDetectedLimit(dir, '', 1000000);
    writeDetectedLimit(dir, null, 1000000);
    assert.ok(!existsSync(join(dir, '.qe', 'config.json')), 'no config written for unusable ids');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeDetectedLimit: merge-preserves existing config + is a no-op when unchanged', () => {
  const dir = tmpProject();
  try {
    writeConfig(dir, { hook_profile: 'safe', sweep_auto: false });
    writeDetectedLimit(dir, 'claude-opus-4-8', 1000000);
    const cfg = JSON.parse(readFileSync(join(dir, '.qe', 'config.json'), 'utf8'));
    assert.equal(cfg.hooks.hook_profile, 'safe', 'existing key preserved');
    assert.equal(cfg.hooks.sweep_auto, false, 'existing key preserved');
    assert.equal(cfg.hooks.context_window_limits['claude-opus-4-8'], 1000000, 'limit merged in');

    // No-op when unchanged: file content stays byte-identical.
    const before = readFileSync(join(dir, '.qe', 'config.json'), 'utf8');
    writeDetectedLimit(dir, 'claude-opus-4-8', 1000000);
    const after = readFileSync(join(dir, '.qe', 'config.json'), 'utf8');
    assert.equal(before, after, 'unchanged write is a no-op');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #2b — marker-insensitive keys (the [1m] mismatch class)
// ---------------------------------------------------------------------------

test('normalizeModelId: strips [1m] / -1m / 1m markers, passes others through', () => {
  assert.equal(normalizeModelId('claude-opus-4-8[1m]'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('claude-opus-4-8-1m'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('claude-opus-4-8'), 'claude-opus-4-8', 'no marker — unchanged');
  assert.equal(normalizeModelId('claude-sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(normalizeModelId(null), null, 'non-strings pass through');
});

test('readDetectedLimit: a [1m]-marked config key resolves the stripped lookup', () => {
  const dir = tmpProject();
  try {
    // Human copies the env-visible id (with [1m]) into config; hooks look up the
    // stripped form. Pre-fix this silently missed → 1M run over-warned forever.
    writeConfig(dir, { context_window_limits: { 'claude-opus-4-8[1m]': 1000000 } });
    assert.equal(readDetectedLimit(dir, 'claude-opus-4-8'), 1000000, 'marker-insensitive match');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeDetectedLimit: collapses a marker-variant key into the canonical stripped key', () => {
  const dir = tmpProject();
  try {
    writeConfig(dir, { context_window_limits: { 'claude-opus-4-8[1m]': 1000000 } });
    writeDetectedLimit(dir, 'claude-opus-4-8', 1000000);
    const cfg = JSON.parse(readFileSync(join(dir, '.qe', 'config.json'), 'utf8'));
    const keys = Object.keys(cfg.hooks.context_window_limits);
    assert.deepEqual(keys, ['claude-opus-4-8'], 'variant pruned, single canonical key');
    assert.equal(cfg.hooks.context_window_limits['claude-opus-4-8'], 1000000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkContextPressure: [1m]-marked config key → 130k scores NONE (the real-world bug)', () => {
  const dir = tmpProject();
  try {
    writeConfig(dir, { context_window_limits: { 'claude-opus-4-8[1m]': 1000000 } });
    const transcriptPath = writeTranscript(dir, 130000, 'claude-opus-4-8');
    const res = checkContextPressure(dir, { tool_calls: 0 }, {}, {
      transcriptPath,
      modelId: 'claude-opus-4-8',
    });
    assert.equal(res.severity, 'none', 'marked key now verifies the 1M tier → no false alarm below 140k');
    assert.equal(res.message, null, 'no estimate warning');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #1 — never hard-stop on a guessed (unverified) denominator
// ---------------------------------------------------------------------------

test('checkContextPressure: unverified 200k-guess at 90% → downgraded to WARNING, no MANDATORY', () => {
  const dir = tmpProject();
  try {
    // 180k tokens, [1m]-stripped model id, no cache/config → limit guessed 200k → 90%.
    const transcriptPath = writeTranscript(dir, 180000, 'claude-opus-4-8');
    const res = checkContextPressure(dir, { tool_calls: 0 }, {}, {
      transcriptPath,
      modelId: 'claude-opus-4-8',
    });
    assert.equal(res.severity, 'warning', 'CRITICAL downgraded to WARNING on a guess');
    assert.ok(res.message, 'still surfaces a soft note');
    assert.ok(/estimated/i.test(res.message), 'message flags the estimate');
    assert.ok(!/MANDATORY/.test(res.message), 'no mandatory stop on an unverified limit');
    assert.ok(/No forced compaction/i.test(res.message), 'explicitly not forcing compaction');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkContextPressure: detected 1M tier → 130k tokens scores NONE (no false alarm)', () => {
  const dir = tmpProject();
  try {
    writeConfig(dir, { context_window_limits: { 'claude-opus-4-8': 1000000 } });
    const transcriptPath = writeTranscript(dir, 130000, 'claude-opus-4-8');
    const res = checkContextPressure(dir, { tool_calls: 0 }, {}, {
      transcriptPath,
      modelId: 'claude-opus-4-8',
    });
    assert.equal(res.severity, 'none', '130k stays below the CONTEXT_BUDGET warning threshold');
    assert.equal(res.message, null, 'no directive emitted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkContextPressure: deterministic >200k reading verifies + persists durable 1M', () => {
  const dir = tmpProject();
  try {
    // 220k tokens > 200k base → resolveLimit upgrades to 1M deterministically.
    const transcriptPath = writeTranscript(dir, 220000, 'claude-opus-4-8');
    const res = checkContextPressure(dir, { tool_calls: 0 }, {}, {
      transcriptPath,
      modelId: 'claude-opus-4-8',
    });
    // 220k proves the 1M tier; ratio policy scores it as 22%, below warning.
    assert.equal(res.severity, 'none', '22% of a proven 1M window is calm');
    // And the detection was persisted durably for next session / cold start.
    assert.equal(readDetectedLimit(dir, 'claude-opus-4-8'), 1000000, 'durably remembered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
