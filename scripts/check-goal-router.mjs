#!/usr/bin/env node
// Guard for the Goal Router Core (TASK 4df5a182).
// A) pure-function fixtures  B) prompt-check baseline regression + fail-open
// C) monotonic latency bench (p95 nearest-rank 48/50, budget < 200ms added).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createGoalRoute, issueGoalMarker, pruneGoalMarkers, triageGoal } from '../hooks/scripts/lib/goal-router.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'hooks', 'scripts', 'prompt-check.mjs');
const SUBPROCESS_TIMEOUT_MS = 30_000;

let checks = 0;
let failures = 0;
const cleanups = [];
/** Runs one named check; failures are collected so every fixture still executes. */
function ok(name, fn) {
  try { fn(); checks += 1; } catch (err) { failures += 1; console.error(`FAIL ${name}: ${err.message}`); }
}
/** Creates an isolated temp dir and registers its cleanup (restores perms first). */
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => { try { chmodSync(join(dir, '.qe', 'state'), 0o755); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

// ── A. Route / triage / override fixtures (table-driven) ────────────────────
const LONG_PAD = 'lorem '.repeat(400); // > 2,000 code points

const routeCases = [
  ['command micro', '/Qgoal fix login in auth.mjs', { detected: true, source: 'command', route: 'direct', scale: 'Micro' }],
  ['command no-arg usage', '/Qgoal', { detected: false, reason: 'usage', instruction: '/Qgoal {목표}' }],
  ['command blank-arg usage', '/Qgoal    ', { detected: false, reason: 'usage', instruction: '/Qgoal {목표}' }],
  ['near-miss /Qgoals', '/Qgoals 정리', { detected: false }],
  ['near-miss /QgoalX', '/QgoalX something', { detected: false }],
  ['korean natural small', 'hooks/scripts/lib/state.mjs 수정하고 테스트 추가해줘', { detected: true, source: 'natural', route: 'direct', scale: 'Small' }],
  ['english natural micro', 'fix the typo in README.md', { detected: true, route: 'direct', scale: 'Micro' }],
  ['mixed ko-en small', 'goal-router.mjs에 verify 로직 추가해줘', { detected: true, route: 'direct', scale: 'Small' }],
  ['full by file count', 'a.mjs b.mjs c.mjs d.mjs 구현해줘', { detected: true, route: 'pipeline', scale: 'Full' }],
  ['workflow scale', '대규모 리팩터링을 구현하고 테스트와 문서와 배포 마이그레이션까지 진행해줘', { detected: true, route: 'pipeline', scale: 'Workflow', reason: 'workflow-scale' }],
  ['non-goal question', 'what does this repository actually do?', { detected: false }],
  ['verb substring (fix vs fixture)', 'fixture cleanup discussion', { detected: false }],
  ['override leading direct', '!direct a.mjs b.mjs c.mjs d.mjs 구현해줘', { detected: true, route: 'direct', reason: 'override-direct' }],
  ['override trailing full', '작은 오타 수정해줘 README.md !full', { detected: true, route: 'pipeline', reason: 'override-full' }],
  ['override conflict → direct wins', '!direct 구현해줘 x.mjs !full', { detected: true, route: 'direct', reason: 'override-direct' }],
  ['override duplicate once', '!direct !direct x.mjs 수정해줘', { detected: true, route: 'direct', reason: 'override-direct' }],
  ['override after /Qgoal', '/Qgoal !full 오타 수정 README.md', { detected: true, route: 'pipeline', reason: 'override-full' }],
];
for (const [name, message, expected] of routeCases) {
  ok(`route: ${name}`, () => {
    const result = triageGoal(message);
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, `${key}: ${result[key]} !== ${value}`);
  });
}

ok('override mid-sentence ignored + kept in goalText', () => {
  const result = triageGoal('이 문장 중간의 !full 토큰은 무시하고 x.mjs 수정해줘');
  assert.equal(result.route, 'direct');
  assert.notEqual(result.reason, 'override-full');
  assert.ok(result.goalText.includes('!full'), 'mid-sentence token must stay in goalText');
});
ok('override inside fenced block ignored', () => {
  const result = triageGoal('```\n!full\n```\nx.mjs 수정해줘');
  assert.equal(result.route, 'direct');
  assert.notEqual(result.reason, 'override-full');
});
ok('override inside inline code ignored', () => {
  const result = triageGoal('`!full` 토큰 설명이 있는 x.mjs 수정해줘');
  assert.notEqual(result.reason, 'override-full');
});
ok('override inside quote ignored', () => {
  const result = triageGoal('> !full\nx.mjs 수정해줘');
  assert.notEqual(result.reason, 'override-full');
});
ok('tail override recognized past 2000 cps', () => {
  const result = triageGoal(`x.mjs 수정해줘 ${LONG_PAD} !direct`);
  assert.equal(result.reason, 'override-direct');
});
ok('tail override blocked by unclosed main fence', () => {
  const result = triageGoal(`x.mjs 수정해줘\n\`\`\`\n${LONG_PAD}\n!direct`);
  assert.notEqual(result.reason, 'override-direct');
});
ok('tail override blocked by fence marker in tail', () => {
  const result = triageGoal(`x.mjs 수정해줘 ${LONG_PAD} \`\`\` !direct`);
  assert.notEqual(result.reason, 'override-direct');
});
ok('unclosed fence masks file mentions', () => {
  const result = triageGoal('구현해줘 a.mjs\n```\nb.mjs c.mjs d.mjs e.mjs');
  assert.equal(result.fileCount, 1);
  assert.equal(result.route, 'direct');
});
ok('particle dedup counts one file', () => {
  const result = triageGoal('goal-router.mjs를 고치고 goal-router.mjs 수정해줘');
  assert.equal(result.fileCount, 1);
});
ok('surrogate pair at cap boundary is safe', () => {
  const result = triageGoal(`수정해줘 x.mjs ${'a'.repeat(1980)}${'😀'.repeat(10)}${'b'.repeat(50)}`);
  assert.equal(typeof result.route, 'string');
});
ok('invalid input fail-opens', () => {
  assert.equal(triageGoal(null).detected, false);
  assert.equal(triageGoal(12345).detected, false);
});
ok('ambiguous goal candidate defaults to direct', () => {
  const result = triageGoal('수정 x.y');
  assert.equal(result.detected, true);
  assert.equal(result.route, 'direct');
  assert.equal(result.reason, 'ambiguous-default-direct');
});
ok('trailing override inside fence stays in goalText, not honored', () => {
  const result = triageGoal('x.mjs 수정해줘\n```\n!full');
  assert.equal(result.route, 'direct');
  assert.notEqual(result.reason, 'override-full');
  assert.ok(result.goalText.includes('!full'), 'masked trailing token must stay in goalText');
});
ok('trailing override inside quote stays in goalText, not honored', () => {
  const result = triageGoal('x.mjs 수정해줘\n> !full');
  assert.equal(result.route, 'direct');
  assert.notEqual(result.reason, 'override-full');
  assert.ok(result.goalText.includes('!full'), 'quoted trailing token must stay in goalText');
});
ok('command-shaped near-miss with verbs stays non-goal', () => {
  assert.equal(triageGoal('/Qgoals x.mjs 수정해줘').detected, false);
  assert.equal(triageGoal('/QgoalX x.mjs 수정해줘').detected, false);
});
ok('verb conjugation alone is not a goal', () => {
  assert.equal(triageGoal('구현하기').detected, false);
  assert.equal(triageGoal('수정해줘').detected, false);
});
ok('tail override blocked by unclosed inline code from main', () => {
  const msg = `implement target ${'a'.repeat(1800)} \`${'b'.repeat(300)} !direct`;
  assert.notEqual(triageGoal(msg).reason, 'override-direct');
});
ok('tail override blocked by quote line spanning the boundary', () => {
  const msg = `implement target ${'a'.repeat(1800)}\n> ${'b'.repeat(300)} !direct`;
  assert.notEqual(triageGoal(msg).reason, 'override-direct');
});
ok('tail override blocked by markdown context after boundary', () => {
  const msg = `implement target ${'a'.repeat(2100)} \`code\` !direct`;
  assert.notEqual(triageGoal(msg).reason, 'override-direct');
});
ok('corrupted entries beyond the 512 pre-cap do not throw', () => {
  const t = 1_000_000_000;
  const noisy = Array.from({ length: 600 }, (_, i) => (i % 7 === 0 ? null : { version: 1, routeId: `r${i}`, sessionId: `s${i % 3}`, route: 'direct', issuedAt: i, expiresAt: t + 1000 }));
  const kept = pruneGoalMarkers(noisy, { now: t });
  assert.ok(kept.length <= 32);
});
ok('duplicate routeIds cannot ride the fresh exemption past caps', () => {
  const t = 1_000_000_000;
  const dupes = Array.from({ length: 33 }, (_, i) => ({ version: 1, routeId: 'fresh', sessionId: 's', route: 'direct', issuedAt: i, expiresAt: t + 1000 }));
  assert.equal(pruneGoalMarkers(dupes, { now: t, freshRouteId: 'fresh' }).length, 1);
});
ok('urls and dates never count as modules', () => {
  const url = triageGoal('자세한 건 https://example.com/docs/guide/path 참고해서 x.mjs 수정해줘');
  assert.equal(url.fileCount, 1, `url counted: ${url.fileCount}`);
  assert.equal(url.route, 'direct');
  const date = triageGoal('2026/07/24 회의록 정리해서 notes.md 수정해줘');
  assert.equal(date.fileCount, 1, `date counted: ${date.fileCount}`);
});
ok('backtick module identifiers count toward scale', () => {
  const result = triageGoal('구현해줘 `alpha` `beta` `gamma` `delta`');
  assert.equal(result.fileCount, 4);
  assert.equal(result.scale, 'Full');
  assert.equal(result.route, 'pipeline');
});
ok('hint instruction stays within 512 bytes', () => {
  for (const message of ['/Qgoal 대규모 리팩터링을 구현하고 테스트와 문서와 배포 마이그레이션까지 진행해줘', '/Qgoal 😀'.padEnd(600, '가')]) {
    const route = createGoalRoute(message);
    if (route.detected) assert.ok(Buffer.byteLength(route.instruction, 'utf8') <= 512, 'instruction exceeds 512 bytes');
  }
});

// ── A2. Marker pruning / issuance (injectable now) ──────────────────────────
const NOW = 1_000_000_000;
const marker = (routeId, sessionId, issuedAt, expiresAt) => ({ version: 1, routeId, sessionId, route: 'direct', issuedAt, expiresAt });

ok('expiry boundary now >= expiresAt', () => {
  assert.equal(pruneGoalMarkers([marker('a', 's', 0, NOW)], { now: NOW }).length, 0);
  assert.equal(pruneGoalMarkers([marker('a', 's', 0, NOW + 1)], { now: NOW }).length, 1);
});
ok('session cap 8 evicts oldest, fresh exempt', () => {
  const entries = Array.from({ length: 9 }, (_, i) => marker(`r${i}`, 's', i, NOW + 1000));
  const kept = pruneGoalMarkers(entries, { now: NOW, freshRouteId: 'r8' });
  assert.equal(kept.length, 8);
  assert.ok(!kept.some((e) => e.routeId === 'r0'), 'oldest evicted');
  assert.ok(kept.some((e) => e.routeId === 'r8'), 'fresh kept');
});
ok('global cap 32 evicts oldest non-fresh', () => {
  const entries = Array.from({ length: 33 }, (_, i) => marker(`r${i}`, `s${i % 6}`, i, NOW + 1000));
  const kept = pruneGoalMarkers(entries, { now: NOW, freshRouteId: 'r32' });
  assert.equal(kept.length, 32);
  assert.ok(!kept.some((e) => e.routeId === 'r0'));
  assert.ok(kept.some((e) => e.routeId === 'r32'));
});
ok('issuedAt tie breaks by routeId', () => {
  const entries = [marker('b', 's', 5, NOW + 1000), marker('a', 's', 5, NOW + 1000)];
  const kept = pruneGoalMarkers(entries, { now: NOW });
  assert.deepEqual(kept.map((e) => e.routeId), ['a', 'b']);
});
ok('issueGoalMarker requires sessionId', () => {
  assert.equal(issueGoalMarker({ cwd: '/tmp', state: {}, route: 'direct' }), null);
});
ok('issueGoalMarker rejects malformed sessionId', () => {
  for (const bad of ['a/b', 'has space', 'x'.repeat(129), '한글세션']) {
    assert.equal(issueGoalMarker({ cwd: '/tmp', state: {}, sessionId: bad, route: 'direct' }), null, `accepted: ${bad}`);
  }
});
ok('issueGoalMarker restores state on write failure', () => {
  const blocker = join(tempDir('qe-goal-restore-'), 'not-a-dir');
  writeFileSync(blocker, 'file blocks .qe/state creation');
  const state = { goalRuntime: { version: 1, entries: [marker('keep', 's', 1, Number.MAX_SAFE_INTEGER)] } };
  assert.throws(() => issueGoalMarker({ cwd: blocker, state, sessionId: 'guard-session', route: 'direct' }));
  assert.equal(state.goalRuntime.entries.length, 1, 'in-memory mutation not restored');
  assert.equal(state.goalRuntime.entries[0].routeId, 'keep');
});
ok('issueGoalMarker persists goalRuntime entries', () => {
  const cwd = tempDir('qe-goal-marker-');
  const entry = issueGoalMarker({ cwd, state: {}, sessionId: 'guard-session', route: 'pipeline' });
  assert.ok(entry && entry.routeId && entry.expiresAt - entry.issuedAt === 10 * 60 * 1000);
  const statePath = join(cwd, '.qe', 'state', 'unified-state.json');
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(persisted.goalRuntime.entries.length, 1);
});

// ── B. prompt-check regression: baseline (git HEAD) vs current ──────────────
function runHook(hookPath, payload, home) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    cwd: ROOT,
    timeout: SUBPROCESS_TIMEOUT_MS,
    env: { PATH: process.env.PATH, HOME: home, QE_CLIENT: 'claude' },
  });
}

// Interrupt-safe baseline artifact handling: sweep stale leftovers from crashed
// runs first, register cleanup for both normal and signal/exit paths.
const hookScriptsDir = join(ROOT, 'hooks', 'scripts');
for (const stale of readdirSync(hookScriptsDir)) {
  if (stale.startsWith('.baseline-prompt-check-')) rmSync(join(hookScriptsDir, stale), { force: true });
}
const baselinePath = join(hookScriptsDir, `.baseline-prompt-check-${process.pid}.mjs`);
const removeBaseline = () => { try { rmSync(baselinePath, { force: true }); } catch {} };
process.on('exit', removeBaseline);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { removeBaseline(); process.exit(130); });
const baselineSrc = spawnSync('git', ['show', 'HEAD:hooks/scripts/prompt-check.mjs'], { cwd: ROOT, timeout: SUBPROCESS_TIMEOUT_MS, encoding: 'utf8' });
assert.equal(baselineSrc.status, 0, 'git show baseline extraction failed');
writeFileSync(baselinePath, baselineSrc.stdout);
cleanups.push(removeBaseline);

const NON_GOAL_MESSAGES = ['hello there, quick question', 'why is the sky blue today?', 'thanks, that was helpful'];
for (const message of NON_GOAL_MESSAGES) {
  ok(`non-goal byte-identical: "${message.slice(0, 24)}"`, () => {
    const home = tempDir('qe-goal-home-');
    const cwdA = tempDir('qe-goal-base-');
    const cwdB = tempDir('qe-goal-cur-');
    const a = runHook(baselinePath, { user_message: message, cwd: cwdA }, home);
    const b = runHook(HOOK, { user_message: message, cwd: cwdB }, home);
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    assert.ok(Buffer.from(a.stdout).equals(Buffer.from(b.stdout)), `stdout diverged: ${b.stdout}`);
    const stateA = join(cwdA, '.qe', 'state', 'unified-state.json');
    const stateB = join(cwdB, '.qe', 'state', 'unified-state.json');
    assert.equal(existsSync(stateA), existsSync(stateB), 'state side-effect presence diverged');
    if (existsSync(stateB)) assert.ok(!readFileSync(stateB, 'utf8').includes('goalRuntime'), 'goalRuntime leaked on non-goal');
  });
}

ok('sid-present non-goal leaves no goalRuntime', () => {
  const home = tempDir('qe-goal-home-');
  const cwd = tempDir('qe-goal-sid-');
  const res = runHook(HOOK, { user_message: 'hello there, quick question', cwd, session_id: 'guard-sid-1' }, home);
  assert.equal(res.status, 0);
  const statePath = join(cwd, '.qe', 'state', 'unified-state.json');
  if (existsSync(statePath)) assert.ok(!readFileSync(statePath, 'utf8').includes('goalRuntime'), 'goalRuntime leaked');
});

ok('goal without resolvable session id keeps hint, skips marker', () => {
  const home = tempDir('qe-goal-home-');
  const cwd = tempDir('qe-goal-nosid-');
  const res = runHook(HOOK, { user_message: '/Qgoal fix login bug in auth.mjs', cwd }, home);
  assert.equal(res.status, 0);
  assert.ok(String(res.stdout).includes('[QE GOAL]'), 'goal hint missing without session id');
  const statePath = join(cwd, '.qe', 'state', 'unified-state.json');
  if (existsSync(statePath)) assert.ok(!readFileSync(statePath, 'utf8').includes('goalRuntime'), 'marker issued without session id');
});

ok('no-arg /Qgoal emits one usage hint line, no marker', () => {
  const home = tempDir('qe-goal-home-');
  const cwd = tempDir('qe-goal-usage-');
  const res = runHook(HOOK, { user_message: '/Qgoal', cwd, session_id: 'guard-sid-3' }, home);
  assert.equal(res.status, 0);
  const stdout = String(res.stdout);
  assert.ok(stdout.includes('[QE GOAL] /Qgoal {목표}'), 'usage hint missing for no-arg /Qgoal');
  assert.equal(stdout.split('[QE GOAL]').length - 1, 1, 'usage hint must appear exactly once');
  const statePath = join(cwd, '.qe', 'state', 'unified-state.json');
  if (existsSync(statePath)) assert.ok(!readFileSync(statePath, 'utf8').includes('goalRuntime'), 'marker issued for usage-only prompt');
});

ok('pipeline goal message emits hint and persists marker', () => {
  const home = tempDir('qe-goal-home-');
  const cwd = tempDir('qe-goal-hit-');
  const res = runHook(HOOK, { user_message: '/Qgoal a.mjs b.mjs c.mjs d.mjs 구현해줘', cwd, session_id: 'guard-sid-2' }, home);
  assert.equal(res.status, 0);
  assert.ok(String(res.stdout).includes('[QE GOAL]'), 'goal hint missing');
  const persisted = JSON.parse(readFileSync(join(cwd, '.qe', 'state', 'unified-state.json'), 'utf8'));
  assert.equal(persisted.goalRuntime.entries.length, 1);
});

ok('unwritable .qe/state keeps pipeline marker issuance fail-open', () => {
  const home = tempDir('qe-goal-home-');
  const cwdA = tempDir('qe-goal-robase-');
  const cwdB = tempDir('qe-goal-rocur-');
  for (const cwd of [cwdA, cwdB]) { mkdirSync(join(cwd, '.qe', 'state'), { recursive: true }); chmodSync(join(cwd, '.qe', 'state'), 0o555); }
  const a = runHook(HOOK, { user_message: '/Qgoal a.mjs b.mjs c.mjs d.mjs 구현해줘', cwd: cwdA, session_id: 's' }, home);
  const b = runHook(HOOK, { user_message: '/Qgoal a.mjs b.mjs c.mjs d.mjs 구현해줘', cwd: cwdB, session_id: 's' }, home);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.ok(!String(b.stderr).trim(), `unexpected hook error: ${b.stderr}`);
});

ok('corrupted unified-state.json stays fail-open', () => {
  const home = tempDir('qe-goal-home-');
  const cwdA = tempDir('qe-goal-cbase-');
  const cwdB = tempDir('qe-goal-ccur-');
  for (const cwd of [cwdA, cwdB]) { mkdirSync(join(cwd, '.qe', 'state'), { recursive: true }); writeFileSync(join(cwd, '.qe', 'state', 'unified-state.json'), 'NOT-JSON{{{'); }
  const a = runHook(baselinePath, { user_message: 'hello there, quick question', cwd: cwdA }, home);
  const b = runHook(HOOK, { user_message: 'hello there, quick question', cwd: cwdB }, home);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.ok(Buffer.from(a.stdout).equals(Buffer.from(b.stdout)));
});

ok('injected goal-router failure stays fail-open', () => {
  const home = tempDir('qe-goal-home-');
  const mirror = tempDir('qe-goal-mirror-');
  cpSync(join(ROOT, 'hooks', 'scripts'), join(mirror, 'hooks', 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'lib'), join(mirror, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(mirror, 'hooks', 'scripts', 'lib', 'goal-router.mjs'), "throw new Error('injected goal-router failure');\n");
  const mirrorHook = join(mirror, 'hooks', 'scripts', 'prompt-check.mjs');
  const goalCwd = tempDir('qe-goal-inj-');
  const goal = runHook(mirrorHook, { user_message: '/Qgoal fix login bug in auth.mjs', cwd: goalCwd, session_id: 's' }, home);
  assert.equal(goal.status, 0, 'hook must survive router import failure');
  assert.ok(!String(goal.stdout).includes('[QE GOAL]'), 'no goal hint when router is broken');
  const cwdA = tempDir('qe-goal-injbase-');
  const cwdB = tempDir('qe-goal-injcur-');
  const a = runHook(HOOK, { user_message: 'hello there, quick question', cwd: cwdA }, home);
  const b = runHook(mirrorHook, { user_message: 'hello there, quick question', cwd: cwdB }, home);
  assert.equal(b.status, 0);
  assert.ok(Buffer.from(a.stdout).equals(Buffer.from(b.stdout)), 'non-goal path diverged with broken router');
});

// ── C. Latency bench: warm-up 5, 50 samples, p95 = sorted[47] ───────────────
const p95 = (samples) => [...samples].sort((x, y) => x - y)[47];
/** Warm-up then 50 timed spawns of the hook; returns the nearest-rank p95 sample. */
function bench(hookPath, payload, home) {
  for (let i = 0; i < 5; i += 1) runHook(hookPath, payload, home);
  const samples = [];
  for (let i = 0; i < 50; i += 1) {
    const t0 = performance.now();
    runHook(hookPath, payload, home);
    samples.push(performance.now() - t0);
  }
  return p95(samples);
}

const benchHome = tempDir('qe-goal-home-');
const benchCwd = tempDir('qe-goal-bench-');
const BENCH_PAYLOADS = [
  ['short prompt', { user_message: 'hello there, quick question', cwd: benchCwd }],
  ['100KB prompt', { user_message: 'word '.repeat(20000), cwd: benchCwd }],
];
for (const [label, payload] of BENCH_PAYLOADS) {
  ok(`bench p95 added < 200ms (${label})`, () => {
    const base = bench(baselinePath, payload, benchHome);
    const cur = bench(HOOK, payload, benchHome);
    const added = cur - base;
    console.log(`[bench] ${label}: baseline p95=${base.toFixed(1)}ms current p95=${cur.toFixed(1)}ms added=${added.toFixed(1)}ms (n=50, warm-up 5, nearest-rank 48th)`);
    assert.ok(added < 200, `added p95 ${added.toFixed(1)}ms >= 200ms`);
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────
for (const fn of cleanups.reverse()) { try { fn(); } catch {} }
console.log(`check-goal-router: ${checks} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
