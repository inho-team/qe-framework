#!/usr/bin/env node
// Goal-gate subprocess guard (TASK a1d12fc9): zero dependencies, no shell fixtures.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { renderSkillCommand } from './lib/interaction_adapter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'hooks', 'scripts', 'pre-tool-use.mjs');
const NOW = Date.now();
let checks = 0;
let failures = 0;
const cleanups = [];

/** Runs one named check; failures are collected so every fixture still executes. */
function ok(name, fn) {
  try { fn(); checks += 1; } catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
}
/** Creates an isolated temp project root with a default (gate-off) config; registers cleanup. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'qe-goal-gate-'));
  mkdirSync(join(root, '.qe', 'state'), { recursive: true });
  writeFileSync(join(root, '.qe', 'config.json'), JSON.stringify({ hooks: { hook_profile: 'safe' }, goalRuntime: { allowDirect: false } }));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** Writes a JSON fixture at root-relative path, creating parent dirs. */
function writeJson(root, relative, value) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
/** Builds a valid same-session pipeline marker entry; overrides customize fields per case. */
function marker(sessionId, overrides = {}) {
  return { version: 1, routeId: 'fixture-route', sessionId, route: 'pipeline', issuedAt: NOW - 1_000, expiresAt: NOW + 60_000, ...overrides };
}
/** Spawns the real pre-tool-use hook against a fixture root and returns the spawnSync result. */
function invoke(root, payload, { client = 'claude' } = {}) {
  return spawnSync('node', [HOOK], {
    cwd: root,
    input: JSON.stringify({ cwd: root, client, session_id: 'fixture-session', ...payload }),
    encoding: 'utf8',
    timeout: 30_000,
  });
}
/** Asserts a Skill invocation is admitted (exit 0). */
function expectPass(root, skill = 'Qplan', extra = {}) {
  const result = invoke(root, { tool_name: 'Skill', tool_input: { skill, ...extra } });
  assert.equal(result.status, 0, `expected pass: ${result.status}; ${result.stdout}${result.stderr}`);
}
/** Asserts a direct internal PSE Skill invocation is blocked (exit 2) with the active-prefix Qgoal guidance. */
function expectBlock(root, skill = 'Qexecute', { client = 'claude', extra = {} } = {}) {
  const result = invoke(root, { tool_name: 'Skill', tool_input: { skill, ...extra } }, { client });
  const prefix = client === 'codex' ? '$' : '/';
  assert.equal(result.status, 2, `expected exit 2: ${result.status}; ${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}${result.stderr}`, new RegExp(`\\${prefix}Qgoal \\{목표\\}`));
}

ok('direct internal PSE call blocks with Claude prefix', () => expectBlock(fixtureRoot()));
ok('Qplan is the public controller and passes without a goal marker', () => expectPass(fixtureRoot(), 'Qplan'));
ok('qe-framework namespace exact-match blocks internal stage', () => expectBlock(fixtureRoot(), 'qe-framework:Qexecute'));
ok('normalization variants (space/case/doubled prefix) still block', () => {
  for (const skill of ['qe-framework:qe-framework:Qexecute', 'Qgenerate-spec']) {
    const result = invoke(fixtureRoot(), { tool_name: 'Skill', tool_input: { skill } });
    assert.equal(result.status, 2, `bypass variant not blocked: [${skill}] status=${result.status}`);
  }
});
ok('Qcommit skill-entry-hook bypass survives PSE-gate normalization', () => {
  const root = fixtureRoot();
  const result = invoke(root, { tool_name: 'Skill', tool_input: { skill: 'qe-framework:Qcommit' } });
  assert.equal(result.status, 0, 'Qcommit must pass (non-PSE)');
  const state = JSON.parse(readFileSync(join(root, '.qe', 'state', 'unified-state.json'), 'utf8'));
  assert.equal(state.skill_bypass?.skill, 'Qcommit', 'skill_bypass not armed for Qcommit');
});
ok('valid same-session pipeline marker passes', () => {
  const root = fixtureRoot();
  writeJson(root, '.qe/state/unified-state.json', { goalRuntime: { version: 1, entries: [marker('fixture-session')] } });
  expectPass(root, 'Qgenerate-spec');
});
ok('latest valid same-session entry passes despite older entry', () => {
  const root = fixtureRoot();
  writeJson(root, '.qe/state/unified-state.json', { goalRuntime: { version: 1, entries: [marker('fixture-session', { issuedAt: NOW - 2_000 }), marker('fixture-session', { issuedAt: NOW - 500 })] } });
  expectPass(root, 'Qexecute');
});
for (const [name, runtime] of [
  ['expired marker', { version: 1, entries: [marker('fixture-session', { expiresAt: NOW })] }],
  ['other-session marker', { version: 1, entries: [marker('other-session')] }],
  ['malformed marker', { version: 1, entries: [{ version: 1, sessionId: 'fixture-session', route: 'pipeline', issuedAt: 'bad', expiresAt: NOW + 1_000 }] }],
  ['wrong route marker', { version: 1, entries: [marker('fixture-session', { route: 'direct' })] }],
  ['wrong version marker', { version: 2, entries: [marker('fixture-session')] }],
]) {
  ok(`${name} blocks`, () => {
    const root = fixtureRoot();
    writeJson(root, '.qe/state/unified-state.json', { goalRuntime: runtime });
    expectBlock(root, 'Qexecute');
  });
}
ok('expired marker plus existing UUID artifact passes', () => {
  const root = fixtureRoot();
  writeJson(root, '.qe/state/unified-state.json', { goalRuntime: { version: 1, entries: [marker('fixture-session', { expiresAt: NOW - 1 })] } });
  mkdirSync(join(root, '.qe', 'tasks', 'in-progress'), { recursive: true });
  writeFileSync(join(root, '.qe', 'tasks', 'in-progress', 'TASK_REQUEST_deadbeef.md'), 'task');
  expectPass(root, 'Qexecute', { args: 'deadbeef' });
});
ok('UUID any-match passes and longer hex run does not', () => {
  const root = fixtureRoot();
  mkdirSync(join(root, '.qe', 'tasks', 'pending'), { recursive: true });
  writeFileSync(join(root, '.qe', 'tasks', 'pending', 'TASK_REQUEST_deadbeef.md'), 'task');
  expectPass(root, 'Qexecute', { args: 'not-a-match deadbeef' });
  expectBlock(root, 'Qexecute', { extra: { args: 'xdeadbeef0' } });
});
ok('expired marker without UUID blocks', () => {
  const root = fixtureRoot();
  writeJson(root, '.qe/state/unified-state.json', { goalRuntime: { version: 1, entries: [marker('fixture-session', { expiresAt: NOW - 1 })] } });
  expectBlock(root, 'Qexecute');
});
ok('fresh strictly-enabled utopia passes and expired does not', () => {
  const root = fixtureRoot();
  writeJson(root, '.qe/state/utopia-state.json', { enabled: true, activatedAt: new Date(NOW - 1_000).toISOString() });
  expectPass(root, 'Qplan');
  const expired = fixtureRoot();
  writeJson(expired, '.qe/state/utopia-state.json', { enabled: true, activatedAt: new Date(NOW - 24 * 60 * 60 * 1000 - 1).toISOString() });
  expectBlock(expired, 'Qexecute');
});
ok('allowDirect accepts only boolean true', () => {
  const pass = fixtureRoot();
  writeJson(pass, '.qe/config.json', { goalRuntime: { allowDirect: true } });
  expectPass(pass);
  for (const value of ['true', 1, {}, false]) {
    const root = fixtureRoot();
    writeJson(root, '.qe/config.json', { goalRuntime: { allowDirect: value } });
    expectBlock(root, 'Qexecute');
  }
});
ok('non-PSE Skill output remains byte-identical to baseline fixture', () => {
  const result = invoke(fixtureRoot(), { tool_name: 'Skill', tool_input: { skill: 'Qversion' } });
  assert.equal(result.status, 0);
  const baseline = result.stdout;
  assert.equal(invoke(fixtureRoot(), { tool_name: 'Skill', tool_input: { skill: 'Qversion' } }).stdout, baseline);
  // Determinism alone cannot prove non-interference (a leaked gate hint would
  // appear in both runs). Assert no gate artifact reaches the non-PSE path.
  assert.doesNotMatch(baseline + result.stderr, /\[QE:BLOCK\]|Qgoal \{목표\}/, 'gate artifact leaked into non-PSE Skill output');
});
ok('non-Skill tool output remains byte-identical to baseline fixture', () => {
  const result = invoke(fixtureRoot(), { tool_name: 'Grep', tool_input: { pattern: 'Qplan' } });
  assert.equal(result.status, 0);
  const baseline = result.stdout;
  assert.equal(invoke(fixtureRoot(), { tool_name: 'Grep', tool_input: { pattern: 'Qplan' } }).stdout, baseline);
  assert.doesNotMatch(baseline + result.stderr, /\[QE:BLOCK\]|Qgoal \{목표\}/, 'gate artifact leaked into non-Skill tool output');
});
ok('Claude and Codex prefix rendering have policy parity', () => {
  assert.equal(renderSkillCommand('Qgoal', '{목표}', { client: 'claude' }).slice(1), renderSkillCommand('Qgoal', '{목표}', { client: 'codex' }).slice(1));
  expectPass(fixtureRoot(), 'Qplan');
});
ok('p95 < 100ms after five warm-ups', () => {
  const root = fixtureRoot();
  for (let index = 0; index < 5; index += 1) expectBlock(root, 'Qexecute');
  const samples = [];
  for (let index = 0; index < 50; index += 1) {
    const started = performance.now();
    expectBlock(root, 'Qexecute');
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[47]; // nearest-rank ceil(50 * .95) = 48th
  assert.ok(p95 < 100, `p95=${p95.toFixed(2)}ms >= 100ms`);
  console.log(`  p95=${p95.toFixed(2)}ms`);
});
ok('p95 < 100ms with a large hex-rich args string (UUID fan-out cap)', () => {
  const root = fixtureRoot();
  // ~10k distinct 8-hex tokens — the worst-case "user pasted a spec/log" arg on
  // the marker-less block path. The MAX_UUID_CANDIDATES cap must keep this bounded.
  const bigArgs = Array.from({ length: 10_000 }, (_, i) => i.toString(16).padStart(8, '0')).join(' ');
  const payload = { tool_name: 'Skill', tool_input: { skill: 'Qexecute', args: bigArgs } };
  for (let index = 0; index < 5; index += 1) invoke(root, payload);
  const samples = [];
  for (let index = 0; index < 50; index += 1) {
    const started = performance.now();
    const result = invoke(root, payload);
    samples.push(performance.now() - started);
    assert.equal(result.status, 2, 'large-args direct PSE call must still block');
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[47];
  assert.ok(p95 < 100, `large-args p95=${p95.toFixed(2)}ms >= 100ms`);
  console.log(`  large-args p95=${p95.toFixed(2)}ms`);
});

for (const cleanup of cleanups) cleanup();
if (failures) {
  console.error(`check-goal-gate: FAIL — ${failures}/${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`check-goal-gate: PASS — ${checks} checks`);
