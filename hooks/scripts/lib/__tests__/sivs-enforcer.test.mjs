import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkSivsPoolDisjoint, enforceRouting } from '../sivs-enforcer.mjs';
import { buildDelegationPayload, resolveEngine } from '../../../../scripts/lib/codex_bridge.mjs';
import { buildReverseDelegationPayload, resolveReverseEngine } from '../../../../scripts/lib/claude_bridge.mjs';

test('active client owns every recognized SIVS stage', () => {
  const result = enforceRouting(
    { subagent_type: 'Etask-executor', client: 'codex' },
    { schemaVersion: 2, implement: { effort: 'high' } },
    { activeClient: 'codex' },
  );
  assert.equal(result.action, 'allow');
  assert.equal(result.reason, 'active_client_owns_stage');
  assert.equal(result.activeClient, 'codex');
});

test('explicit cross-client delegation is blocked without fallback', () => {
  const result = enforceRouting(
    { subagent_type: 'codex:rescue', prompt: '--verify' },
    {},
    { activeClient: 'claude' },
  );
  assert.equal(result.action, 'block');
  assert.equal(result.reason, 'cross_client_delegation_disabled');
  assert.notEqual(result.action, 'fallback');
});

test('an explicit client request fails closed when session ownership is unknown', () => {
  const result = enforceRouting({ subagent_type: 'codex:rescue', prompt: '--verify' }, {}, {});
  assert.equal(result.action, 'block');
  assert.equal(result.reason, 'active_client_required');
});

test('legacy routing fields fail closed', () => {
  for (const config of [
    { profile: 'claude-head' },
    { implement: { engine: 'codex' } },
    { verify: { background: true } },
  ]) {
    const result = enforceRouting({ subagent_type: 'Etask-executor' }, config, { activeClient: 'codex' });
    assert.equal(result.action, 'block');
    assert.match(result.reason, /^legacy_cross_client_config:/);
  }
});

test('compatibility resolvers stay local and bridge execution APIs are retired', () => {
  assert.deepEqual(resolveEngine('verify', {}, { activeClient: 'codex' }), {
    engine: 'codex', reason: 'active_client_owns_stage',
  });
  assert.deepEqual(resolveReverseEngine('verify', {}), {
    engine: 'codex', reason: 'active_client_owns_stage',
  });
  assert.throws(() => buildDelegationPayload('verify'), /Cross-client Codex delegation is retired/);
  assert.throws(() => buildReverseDelegationPayload('verify'), /Cross-client Claude delegation is retired/);
});

test('verification independence is role-based, not provider-pool routing', () => {
  assert.deepEqual(checkSivsPoolDisjoint({ implement: {}, verify: {} }), {
    ok: true,
    reason: 'role_separated_fresh_context',
    implement: 'active-client',
    verify: 'active-client',
  });
});

test('policy manifest disables cross-client fallback', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../core/engines.json', import.meta.url), 'utf8'));
  assert.equal(manifest.policy, 'active-client-only');
  assert.equal(manifest.crossClientFallback, false);
  assert.deepEqual(manifest.engines, {});
});
