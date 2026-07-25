#!/usr/bin/env node

/**
 * SIVS auto-fallback: when a Codex-delegated stage crashes/fails/times out and
 * the existing single Codex retry is exhausted, Claude auto-takes over the same
 * stage without prompting the user. `QE_SIVS_AUTOFALLBACK=off` restores the
 * legacy manual-prompt behavior. `.qe/sivs-config.json` routing is never changed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  formatResultInstruction,
  isAutoFallbackEnabled,
  resolveCodexFallback,
} from '../codex-result-handler.mjs';
import { captureAbnormalWorkerExit, recordAutoFallback } from '../failure-capture.mjs';

/**
 * Run `fn` against a throwaway workspace dir and always clean it up.
 * @param {(cwd: string) => any} fn
 * @returns {any} the return value of `fn`
 */
function withTmp(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-autofallback-'));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Read the parsed `.qe/state/agent-errors.json` array for a workspace.
 * @param {string} cwd
 * @returns {object[]} entries, or [] when the log does not exist
 */
function readErrors(cwd) {
  const p = join(cwd, '.qe', 'state', 'agent-errors.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

// --- isAutoFallbackEnabled ------------------------------------------------

test('autofallback is enabled by default (env unset)', () => {
  assert.equal(isAutoFallbackEnabled({}), true);
});

test('QE_SIVS_AUTOFALLBACK=off disables autofallback', () => {
  assert.equal(isAutoFallbackEnabled({ QE_SIVS_AUTOFALLBACK: 'off' }), false);
  assert.equal(isAutoFallbackEnabled({ QE_SIVS_AUTOFALLBACK: 'OFF' }), false);
  assert.equal(isAutoFallbackEnabled({ QE_SIVS_AUTOFALLBACK: '0' }), false);
  assert.equal(isAutoFallbackEnabled({ QE_SIVS_AUTOFALLBACK: 'false' }), false);
});

test('any other value keeps autofallback on', () => {
  assert.equal(isAutoFallbackEnabled({ QE_SIVS_AUTOFALLBACK: 'on' }), true);
  assert.equal(isAutoFallbackEnabled({ QE_SIVS_AUTOFALLBACK: '1' }), true);
});

// --- formatResultInstruction branching ------------------------------------

for (const status of ['crashed', 'failed', 'timeout']) {
  test(`autofallback ON: ${status} returns non-blocking auto-recover instruction`, () => {
    const result = { status, source: 'companion', error: 'boom', phase: 'implement' };
    const msg = formatResultInstruction(result, { autoFallback: true, stage: 'implement' });
    // Non-blocking: never routes to a user question.
    assert.doesNotMatch(msg, /Ask user/i);
    assert.doesNotMatch(msg, /AskUserQuestion/);
    // Greppable post-hoc notice with stage + reason.
    assert.match(msg, /auto-recovered with Claude/);
    assert.match(msg, new RegExp(`stage implement: Codex ${status} -> auto-recovered with Claude`));
    // Routing preservation reminder present.
    assert.match(msg, /sivs-config\.json/);
  });

  test(`autofallback OFF: ${status} preserves manual instruction`, () => {
    const result = { status, source: 'companion', error: 'boom', phase: 'implement' };
    const msg = formatResultInstruction(result, { autoFallback: false });
    assert.doesNotMatch(msg, /auto-recovered with Claude/);
  });
}

test('crashed auto-recover message stays crashed-only (no TIMEOUT bleed)', () => {
  const result = { status: 'crashed', source: 'signal', error: 'process died' };
  const msg = formatResultInstruction(result, { autoFallback: true, stage: 'verify' });
  assert.match(msg, /CRASHED/);
  assert.doesNotMatch(msg, /TIMEOUT|1h passed/);
});

// --- resolveCodexFallback records to agent-errors.json --------------------

test('resolveCodexFallback records a fallback entry with full schema (ON)', () => {
  withTmp((cwd) => {
    const result = { status: 'crashed', source: 'companion', jobId: 'job-x', pid: 4242 };
    const out = resolveCodexFallback(cwd, result, {
      autoFallback: true,
      stage: 'implement',
      taskUuid: 'uuid-1',
    });
    assert.equal(out.autoFallback, true);
    assert.equal(out.isFailure, true);
    assert.equal(out.recorded.recorded, true);

    const errors = readErrors(cwd);
    const entry = errors.find((e) => e.kind === 'auto-fallback');
    assert.ok(entry, 'auto-fallback entry appended');
    assert.equal(entry.stage, 'implement');
    assert.equal(entry.taskUuid, 'uuid-1');
    assert.equal(entry.reason, 'crashed');
    assert.equal(entry.fallbackEngine, 'claude');
    assert.equal(entry.jobId, 'job-x');
    assert.equal(entry.pid, 4242);
    assert.ok(typeof entry.timestamp === 'string' && entry.timestamp.length > 0);
  });
});

test('resolveCodexFallback records nothing when OFF', () => {
  withTmp((cwd) => {
    const result = { status: 'failed', source: 'companion' };
    const out = resolveCodexFallback(cwd, result, { autoFallback: false, stage: 'spec' });
    assert.equal(out.autoFallback, false);
    assert.equal(out.recorded, null);
    assert.equal(readErrors(cwd).length, 0);
  });
});

test('resolveCodexFallback records nothing for a completed result', () => {
  withTmp((cwd) => {
    const out = resolveCodexFallback(cwd, { status: 'completed', source: 'signal' }, {
      autoFallback: true,
    });
    assert.equal(out.isFailure, false);
    assert.equal(out.recorded, null);
  });
});

test('reason is normalized to the crashed/failed/timeout enum', () => {
  withTmp((cwd) => {
    for (const status of ['crashed', 'failed', 'timeout']) {
      recordAutoFallback(cwd, { stage: 's', taskUuid: 'u', reason: status });
    }
    const reasons = readErrors(cwd).map((e) => e.reason);
    assert.deepEqual(reasons, ['crashed', 'failed', 'timeout']);
  });
});

test('recording failure never throws (best-effort)', () => {
  // A path that cannot be created (a file where a dir is expected) must not throw.
  const res = recordAutoFallback('/dev/null/nope', { stage: 's', reason: 'crashed' });
  assert.equal(res.recorded, false);
});

// --- retry reuse + no double-retry ----------------------------------------

const CRASH = { crashed: true, status: 'crashed' };

test('crashed -> single retry -> exhaustion drives Claude fallback', () => {
  withTmp((cwd) => {
    const id = { taskUuid: 'u1', workerId: 'w1', itemId: 'i1' };
    // First crash: existing single Codex retry allowed.
    const first = captureAbnormalWorkerExit(cwd, CRASH, id);
    assert.equal(first.captured, true);
    assert.equal(first.retryCount, 0);
    assert.equal(first.shouldRetry, true);

    // Retry also crashes: cap reached, no further Codex retry.
    const second = captureAbnormalWorkerExit(cwd, CRASH, id);
    assert.equal(second.retryCount, 1);
    assert.equal(second.shouldRetry, false);

    // Now Claude auto-takes over — recorded, but NOT as a retry-counted entry.
    recordAutoFallback(cwd, { ...id, stage: 'implement', reason: 'crashed' });

    const retryEntries = readErrors(cwd).filter(
      (e) => e.kind === 'abnormal-worker-exit' &&
        e.taskUuid === 'u1' && e.workerId === 'w1' && e.itemId === 'i1'
    );
    // Single-retry cap: exactly 2 abnormal-exit entries (attempt + 1 retry).
    assert.equal(retryEntries.length, 2);
  });
});

test('auto-fallback path adds no new retry counter for the same identity', () => {
  withTmp((cwd) => {
    const id = { taskUuid: 'u2', workerId: 'w2', itemId: 'i2' };
    captureAbnormalWorkerExit(cwd, CRASH, id); // retryCount 0
    captureAbnormalWorkerExit(cwd, CRASH, id); // retryCount 1 (exhausted)

    // Multiple fallback recordings must not inflate the Codex retry count.
    recordAutoFallback(cwd, { ...id, stage: 'implement', reason: 'crashed' });
    recordAutoFallback(cwd, { ...id, stage: 'implement', reason: 'crashed' });

    const next = captureAbnormalWorkerExit(cwd, CRASH, id);
    // Retry count reflects only abnormal-worker-exit entries, unaffected by
    // the two auto-fallback rows in between.
    assert.equal(next.retryCount, 2);
  });
});
