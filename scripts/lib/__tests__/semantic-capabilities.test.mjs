import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  discoverSemanticCapabilities,
  selectSemanticCapability,
  transitionSemanticHealth,
} from '../semantic-capabilities.mjs';

const DOCTOR = resolve('scripts/qe-doctor.mjs');

test('discovers LSP and AST executables through the common capability model', () => {
  const found = new Map([
    ['demo-lsp', '/tools/demo-lsp'],
    ['demo-ast', '/tools/demo-ast'],
  ]);
  const report = discoverSemanticCapabilities({
    candidates: [
      { id: 'demo-lsp', kind: 'lsp', commands: ['demo-lsp'] },
      { id: 'demo-ast', kind: 'ast', commands: ['demo-ast'] },
    ],
    resolver: (command) => found.get(command) || null,
  });

  assert.deepEqual(report.summary, { total: 2, available: 2, unavailable: 0 });
  assert.equal(report.capabilities[0].kind, 'lsp');
  assert.equal(report.capabilities[1].kind, 'ast');
  assert.equal(report.capabilities.every((item) => item.usable), true);
  assert.equal(report.fallback, null);
});

test('health policy degrades once, becomes unhealthy twice, and recovers on success', () => {
  const [available] = discoverSemanticCapabilities({
    candidates: [{ id: 'demo-lsp', kind: 'lsp', commands: ['demo-lsp'] }],
    resolver: () => '/tools/demo-lsp',
  }).capabilities;

  const degraded = transitionSemanticHealth(available, { ok: false, reason: 'timeout' });
  assert.equal(degraded.health.state, 'degraded');
  assert.equal(degraded.usable, true);

  const unhealthy = transitionSemanticHealth(degraded, { ok: false, reason: 'second timeout' });
  assert.equal(unhealthy.health.state, 'unhealthy');
  assert.equal(unhealthy.usable, false);

  const recovered = transitionSemanticHealth(unhealthy, { ok: true });
  assert.equal(recovered.health.state, 'healthy');
  assert.equal(recovered.health.consecutiveFailures, 0);
  assert.equal(recovered.usable, true);
});

test('unavailable semantic tools produce an explicit text fallback', () => {
  const report = discoverSemanticCapabilities({
    candidates: [{ id: 'missing-ast', kind: 'ast', commands: ['missing-ast'] }],
    resolver: () => null,
  });
  const selection = selectSemanticCapability(report, { kind: 'ast' });
  assert.equal(report.capabilities[0].availability, 'unavailable');
  assert.equal(selection.selected, null);
  assert.equal(selection.fallback.kind, 'text');
  assert.match(selection.fallback.reason, /continue with bounded text search/i);
});

test('doctor exits successfully and reports fallback when PATH has no semantic tools', () => {
  const result = spawnSync(process.execPath, [DOCTOR, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.available, 0);
  assert.equal(report.fallback.kind, 'text');
  assert.match(report.fallback.reason, /No usable semantic capability/);
});

test('selection falls back per capability kind even when another kind is available', () => {
  const report = discoverSemanticCapabilities({
    candidates: [
      { id: 'demo-lsp', kind: 'lsp', commands: ['demo-lsp'] },
      { id: 'missing-ast', kind: 'ast', commands: ['missing-ast'] },
    ],
    resolver: (command) => command === 'demo-lsp' ? '/tools/demo-lsp' : null,
  });
  assert.equal(selectSemanticCapability(report, { kind: 'lsp' }).selected.id, 'demo-lsp');
  assert.equal(selectSemanticCapability(report, { kind: 'ast' }).fallback.kind, 'text');
});

