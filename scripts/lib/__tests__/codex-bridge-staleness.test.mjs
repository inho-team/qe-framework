import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  detectJobStaleness,
  getLatestCodexJobStatus,
  isProcessAlive,
  reapStaleCodexJobs,
} from '../codex_bridge.mjs';

// A pid that is essentially guaranteed not to exist (above macOS/Linux pid_max).
const DEAD_PID = 999999;

test('isProcessAlive: live pid is true, dead pid is false, invalid is null', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(DEAD_PID), false);
  assert.equal(isProcessAlive(null), null);
  assert.equal(isProcessAlive(0), null);
  assert.equal(isProcessAlive(-1), null);
  assert.equal(isProcessAlive('not-a-number'), null);
});

test('detectJobStaleness: running job with a dead pid is stale', () => {
  const r = detectJobStaleness({ status: 'running', pid: DEAD_PID, logFile: null });
  assert.equal(r.stale, true);
  assert.match(r.staleReason, /not running/);
});

test('detectJobStaleness: running job with a live pid is NOT stale', () => {
  // No false positives while the worker is genuinely alive, even with no log.
  const r = detectJobStaleness({ status: 'running', pid: process.pid, logFile: null });
  assert.equal(r.stale, false);
  assert.equal(r.staleReason, null);
});

test('detectJobStaleness: non-running statuses are never stale (invariant)', () => {
  for (const status of ['completed', 'cancelled', 'failed', 'queued', 'done']) {
    const r = detectJobStaleness({ status, pid: DEAD_PID, logFile: null });
    assert.equal(r.stale, false, `status=${status} must not be stale`);
  }
});

test('detectJobStaleness: pid-less running job with a silent log is stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qe-stale-log-'));
  const logFile = join(dir, 'job.log');
  writeFileSync(logFile, 'last line\n');
  // Backdate mtime well beyond the 5-minute default threshold.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(logFile, tenMinAgo, tenMinAgo);

  const r = detectJobStaleness({ status: 'running', pid: null, logFile });
  assert.equal(r.stale, true);
  assert.match(r.staleReason, /no log activity/);
});

test('detectJobStaleness: pid-less running job with a fresh log is NOT stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qe-fresh-log-'));
  const logFile = join(dir, 'job.log');
  writeFileSync(logFile, 'just wrote\n'); // mtime = now

  const r = detectJobStaleness({ status: 'running', pid: null, logFile });
  assert.equal(r.stale, false);
});

test('detectJobStaleness: respects CODEX_STALE_LOG_SILENCE_MS override', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qe-stale-override-'));
  const logFile = join(dir, 'job.log');
  writeFileSync(logFile, 'x\n');
  const oneMinAgo = new Date(Date.now() - 60 * 1000);
  utimesSync(logFile, oneMinAgo, oneMinAgo);

  const prev = process.env.CODEX_STALE_LOG_SILENCE_MS;
  try {
    process.env.CODEX_STALE_LOG_SILENCE_MS = '30000'; // 30s — 1m-old log is now stale
    assert.equal(detectJobStaleness({ status: 'running', pid: null, logFile }).stale, true);
    process.env.CODEX_STALE_LOG_SILENCE_MS = '600000'; // 10m — 1m-old log is fresh
    assert.equal(detectJobStaleness({ status: 'running', pid: null, logFile }).stale, false);
  } finally {
    if (prev === undefined) delete process.env.CODEX_STALE_LOG_SILENCE_MS;
    else process.env.CODEX_STALE_LOG_SILENCE_MS = prev;
  }
});

test('getLatestCodexJobStatus: surfaces stale flag for a zombie running job', () => {
  // Build a fake companion state dir matching resolveCodexStateDir's layout.
  const pluginData = mkdtempSync(join(tmpdir(), 'qe-plugin-data-'));
  const cwd = '/tmp/qe-fake-workspace-xyz';
  const basename = cwd.split('/').filter(Boolean).pop();
  const slug = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  const stateDir = join(pluginData, 'state', `${slug}-${hash}`);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, 'state.json'),
    JSON.stringify({
      jobs: [
        { id: 'job-zombie', status: 'running', pid: DEAD_PID, logFile: null, updatedAt: '2026-06-27T01:00:00.000Z' },
      ],
    })
  );

  const prev = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    const r = getLatestCodexJobStatus(cwd);
    assert.equal(r.found, true);
    assert.equal(r.jobId, 'job-zombie');
    assert.equal(r.status, 'running');
    assert.equal(r.pid, DEAD_PID);
    assert.equal(r.stale, true);
    assert.match(r.staleReason, /not running/);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});

// --- staleKind (confidence tier) ---

test('detectJobStaleness: staleKind is process-dead for a dead pid (auto-reap eligible)', () => {
  assert.equal(detectJobStaleness({ status: 'running', pid: DEAD_PID }).staleKind, 'process-dead');
});

test('detectJobStaleness: staleKind is log-silent for a pid-less silent log (weak)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qe-sk-'));
  const lf = join(dir, 'j.log');
  writeFileSync(lf, 'x\n');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lf, old, old);
  assert.equal(detectJobStaleness({ status: 'running', pid: null, logFile: lf }).staleKind, 'log-silent');
});

test('detectJobStaleness: staleKind is null when not stale', () => {
  assert.equal(detectJobStaleness({ status: 'running', pid: process.pid }).staleKind, null);
  assert.equal(detectJobStaleness({ status: 'completed', pid: DEAD_PID }).staleKind, null);
});

// --- reapStaleCodexJobs ---

// Build a fake companion state dir for `cwd` and point CLAUDE_PLUGIN_DATA at it.
function withStateDir(cwd, jobs, fn) {
  const pluginData = mkdtempSync(join(tmpdir(), 'qe-reap-pd-'));
  const basename = cwd.split('/').filter(Boolean).pop();
  const slug = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  const stateDir = join(pluginData, 'state', `${slug}-${hash}`);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ jobs }));
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
}

// A throwaway companion script — exit 0 = cancel "succeeds", exit 1 = "fails".
function fakeCompanion(exitCode = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'qe-companion-'));
  const f = join(dir, 'companion.mjs');
  writeFileSync(f, `process.exit(${exitCode});`);
  return f;
}

test('reapStaleCodexJobs: no state dir → empty result', () => {
  const r = reapStaleCodexJobs(`/tmp/qe-reap-none-${process.pid}`);
  assert.deepEqual(r, { reaped: [], skipped: [], errors: [] });
});

test('reapStaleCodexJobs: process-dead job is reaped via companion', () => {
  const cwd = `/tmp/qe-reap-dead-${process.pid}`;
  withStateDir(cwd, [{ id: 'job-dead', status: 'running', pid: DEAD_PID, logFile: null, updatedAt: '2026-06-27T01:00:00Z' }], () => {
    const r = reapStaleCodexJobs(cwd, { companionScript: fakeCompanion(0) });
    assert.equal(r.reaped.length, 1);
    assert.equal(r.reaped[0].id, 'job-dead');
    assert.equal(r.errors.length, 0);
  });
});

test('reapStaleCodexJobs: log-silent job is skipped, companion never invoked', () => {
  const cwd = `/tmp/qe-reap-silent-${process.pid}`;
  const ld = mkdtempSync(join(tmpdir(), 'qe-ls-'));
  const lf = join(ld, 'j.log');
  writeFileSync(lf, 'x\n');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lf, old, old);
  withStateDir(cwd, [{ id: 'job-silent', status: 'running', pid: null, logFile: lf, updatedAt: '2026-06-27T01:00:00Z' }], () => {
    // companion would FAIL (exit 1) if invoked — errors:0 proves it was not called.
    const r = reapStaleCodexJobs(cwd, { companionScript: fakeCompanion(1) });
    assert.equal(r.reaped.length, 0);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].id, 'job-silent');
    assert.equal(r.errors.length, 0);
  });
});

test('reapStaleCodexJobs: a failed cancel is captured in errors', () => {
  const cwd = `/tmp/qe-reap-fail-${process.pid}`;
  withStateDir(cwd, [{ id: 'job-dead2', status: 'running', pid: DEAD_PID, logFile: null, updatedAt: '2026-06-27T01:00:00Z' }], () => {
    const r = reapStaleCodexJobs(cwd, { companionScript: fakeCompanion(1) });
    assert.equal(r.reaped.length, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].id, 'job-dead2');
  });
});

test('reapStaleCodexJobs: an alive running job is left completely alone', () => {
  const cwd = `/tmp/qe-reap-alive-${process.pid}`;
  withStateDir(cwd, [{ id: 'job-alive', status: 'running', pid: process.pid, logFile: null, updatedAt: '2026-06-27T01:00:00Z' }], () => {
    const r = reapStaleCodexJobs(cwd, { companionScript: fakeCompanion(1) });
    assert.equal(r.reaped.length, 0);
    assert.equal(r.skipped.length, 0);
    assert.equal(r.errors.length, 0);
  });
});
