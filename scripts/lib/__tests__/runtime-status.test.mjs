import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as runtime from '../runtime-status.mjs';
import * as codex from '../codex_bridge.mjs';

test('neutral runtime and compatibility bridge expose identical status helpers', () => {
  assert.equal(codex.isProcessAlive, runtime.isProcessAlive);
  assert.equal(codex.getLatestCodexJobStatus, runtime.getLatestDurableJobStatus);
  assert.equal(codex.detectJobStaleness, runtime.detectJobStaleness);
  assert.equal(codex.isCodexRuntimeLossMessage, runtime.isRuntimeLossMessage);
});

test('build admission and session resolver have no Codex adapter dependency', () => {
  const buildSource = readFileSync(
    new URL('../../../hooks/scripts/lib/build-admission.mjs', import.meta.url),
    'utf8',
  );
  const sessionSource = readFileSync(
    new URL('../../../hooks/scripts/lib/session-resolver.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(buildSource, /codex_bridge\.mjs/);
  assert.doesNotMatch(sessionSource, /codex_bridge\.mjs/);
  assert.match(buildSource, /process-liveness\.mjs/);
  assert.match(sessionSource, /job-status\.mjs/);
});

test('process liveness and absent durable job state are deterministic', () => {
  assert.equal(runtime.isProcessAlive(process.pid), true);
  assert.equal(runtime.isProcessAlive(0), null);
  assert.equal(runtime.isProcessAlive('1'), null);
  const unusedWorkspace = mkdtempSync(join(tmpdir(), 'qe-runtime-status-'));
  assert.deepEqual(runtime.getLatestDurableJobStatus(unusedWorkspace), { found: false });
});

test('runtime loss and stale-job projections preserve compatibility semantics', () => {
  assert.equal(runtime.isRuntimeLossMessage({ error: { message: 'thread not found' } }), true);
  assert.equal(runtime.isRuntimeLossMessage({ message: 'ordinary failure' }), false);
  assert.deepEqual(runtime.detectJobStaleness({ status: 'complete' }), {
    stale: false,
    staleReason: null,
    staleKind: null,
  });
});
