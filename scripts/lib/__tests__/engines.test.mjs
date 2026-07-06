import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngines, vendorOf, poolOf, checkPoolDisjoint } from '../../../hooks/scripts/lib/engines.mjs';

test('loadEngines returns the registry with claude/codex/fugu', () => {
  const e = loadEngines();
  assert.equal(e.claude.vendor, 'anthropic');
  assert.equal(e.codex.vendor, 'openai');
  assert.equal(e.fugu.type, 'openai-compat');
  assert.equal(e.fugu.experimental, true);
});

test('loadEngines falls back to builtin on a missing registry path', () => {
  const e = loadEngines('/nonexistent/engines.json');
  assert.equal(e.claude.vendor, 'anthropic');
  assert.equal(e.codex.vendor, 'openai');
});

test('vendorOf / poolOf', () => {
  assert.equal(vendorOf('claude'), 'anthropic');
  assert.deepEqual(poolOf('codex'), ['openai']);
  assert.deepEqual(poolOf('unknown'), []);
});

test('checkPoolDisjoint: same engine (claude/claude) is NOT disjoint', () => {
  const r = checkPoolDisjoint('claude', 'claude');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not be independent/);
});

test('checkPoolDisjoint: implement=codex verify=claude IS disjoint', () => {
  assert.equal(checkPoolDisjoint('codex', 'claude').ok, true);
});

test('checkPoolDisjoint: implement=fugu verify=claude IS disjoint (the experimental preset)', () => {
  assert.equal(checkPoolDisjoint('fugu', 'claude').ok, true);
});

test('checkPoolDisjoint: unknown engine fails closed', () => {
  assert.equal(checkPoolDisjoint('codex', 'ghost').ok, false);
  assert.equal(checkPoolDisjoint('ghost', 'claude').ok, false);
});
