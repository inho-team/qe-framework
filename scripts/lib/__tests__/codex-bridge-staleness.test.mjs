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
    assert.equal(r.stale, true);
    assert.match(r.staleReason, /not running/);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
  }
});
