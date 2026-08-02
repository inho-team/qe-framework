import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditHookArchitecture } from '../../../../scripts/check-hook-architecture.mjs';

const ROOT = join(import.meta.dirname, '../../../..');

test('registered hooks have an evidence-backed decision and real entrypoint', () => {
  const result = auditHookArchitecture(ROOT);
  assert.deepEqual(result.failures, []);
  assert.equal(result.registered, 7);
  assert.equal(result.removed, 8);
});

test('audit covers every lifecycle entrypoint', () => {
  const inventory = JSON.parse(readFileSync(join(ROOT, 'hooks/hook-inventory.json'), 'utf8'));
  const covered = new Set([
    ...inventory.hooks.map((hook) => hook.entrypoint),
    ...inventory.unregisteredEntrypoints.map((hook) => hook.entrypoint),
    ...inventory.removedHooks.map((hook) => hook.entrypoint),
    ...inventory.removedEntrypoints.map((hook) => hook.entrypoint),
  ]);
  for (const entrypoint of [
    'hooks/scripts/session-start.mjs', 'hooks/scripts/pre-tool-use.mjs', 'hooks/scripts/pre-compact.mjs',
    'hooks/scripts/post-tool-use.mjs', 'hooks/scripts/stop-handler.mjs', 'hooks/scripts/prompt-check.mjs',
    'hooks/scripts/notification.mjs', 'hooks/scripts/teammate-idle.mjs', 'hooks/scripts/task-completed.mjs',
    'hooks/scripts/context-guard.mjs', 'hooks/scripts/context-monitor.mjs',
    'hooks/scripts/codex/pre-tool-use-codex.mjs', 'hooks/scripts/codex/lifecycle-codex.mjs',
    'hooks/scripts/lib/session-namer.mjs', 'hooks/scripts/lib/codex-poll-watcher.mjs',
    'hooks/scripts/lib/codex-result-handler.mjs', 'hooks/scripts/lib/notify.mjs'
  ]) assert.ok(covered.has(entrypoint), `missing audit coverage: ${entrypoint}`);
});

test('research principles cite independent primary sources', () => {
  const inventory = JSON.parse(readFileSync(join(ROOT, 'hooks/hook-inventory.json'), 'utf8'));
  const hosts = new Set(inventory.principles.map((item) => new URL(item.source).hostname));
  for (const host of ['code.claude.com', 'developers.openai.com', 'nodejs.org', 'docs.github.com', 'opentelemetry.io']) assert.ok(hosts.has(host));
});
