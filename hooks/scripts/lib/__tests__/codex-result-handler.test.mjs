#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkCodexResult, formatResultInstruction } from '../codex-result-handler.mjs';

const DEAD_PID = 999999;

function codexStateDir(pluginData, cwd) {
  const basename = cwd.split('/').filter(Boolean).pop();
  const slug = basename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  return join(pluginData, 'state', `${slug}-${hash}`);
}

function withPluginState(cwd, jobs, fn) {
  const pluginData = mkdtempSync(join(tmpdir(), 'qe-result-plugin-'));
  const stateDir = codexStateDir(pluginData, cwd);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ jobs }));
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prev;
    rmSync(pluginData, { recursive: true, force: true });
  }
}

test('codex-result-handler: process-dead running job maps to crashed with metadata', () => {
  const cwd = `/tmp/qe-result-dead-${process.pid}`;
  withPluginState(cwd, [
    { id: 'job-dead', status: 'running', pid: DEAD_PID, logFile: null, updatedAt: '2026-06-27T01:00:00Z' },
  ], () => {
    const result = checkCodexResult(cwd);
    assert.equal(result.status, 'crashed');
    assert.equal(result.source, 'companion');
    assert.equal(result.pid, DEAD_PID);
    assert.equal(result.jobId, 'job-dead');
    assert.equal(result.staleKind, 'process-dead');
    assert.match(result.staleReason, /not running/);
    assert.equal(result.reaped.jobId, 'job-dead');
    assert.equal(typeof result.reaped.reaped, 'boolean');
  });
});

test('codex-result-handler: alive running job remains running', () => {
  const cwd = `/tmp/qe-result-alive-${process.pid}`;
  withPluginState(cwd, [
    { id: 'job-alive', status: 'running', pid: process.pid, logFile: null, updatedAt: '2026-06-27T01:00:00Z' },
  ], () => {
    const result = checkCodexResult(cwd);
    assert.equal(result.status, 'running');
    assert.equal(result.pid, process.pid);
    assert.equal(result.stale, false);
  });
});

test('codex-result-handler: crash signal parses as crashed', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-result-signal-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, '.qe', 'agent-results'), { recursive: true });
  writeFileSync(
    join(cwd, '.qe', 'agent-results', 'codex-ready.signal'),
    JSON.stringify({
      detected: false,
      crashed: true,
      status: 'crashed',
      pid: DEAD_PID,
      elapsedSec: 1,
      message: 'process died',
      timestamp: '2026-06-27T01:00:00.000Z',
    })
  );

  const result = checkCodexResult(cwd);
  assert.equal(result.status, 'crashed');
  assert.equal(result.source, 'signal');
  assert.equal(result.pid, DEAD_PID);
  assert.equal(result.elapsedSec, 1);
  assert.match(formatResultInstruction(result), /CRASHED/);
  assert.doesNotMatch(formatResultInstruction(result), /1h passed|TIMEOUT/);
});

