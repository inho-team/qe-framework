#!/usr/bin/env node
/**
 * check-loop-guard.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Pins the SIVS loop-safety limits (Phase 3 / R005, R006). Three parts:
 *   1. loop-guard.mjs logic self-test in temp-cwd sandboxes (cases a–i).
 *   2. Compatibility integration: spawn the REAL pre-tool-use.mjs and prove
 *      REMEDIATION filenames are telemetry-only, while ordinary writes remain
 *      non-wedging. Transactional Runtime Controller tests own authorization.
 *   3. Wiring assertion: pre-tool-use.mjs does not restore filename authority;
 *      gate protocols still carry the compatibility depth directive.
 * All in temp dirs; the real workspace state is untouched. FAIL on any violation.
 */

import {
  recordAndCheck, checkLimits, resetLoop, sweepStale, resolveDepthLimit,
  DEFAULT_DEPTH_LIMIT, REMEDIATION_LIMIT,
} from '../hooks/scripts/lib/loop-guard.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRE = join(ROOT, 'hooks/scripts/pre-tool-use.mjs');

const failures = [];
const cleanup = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

/** Fresh temp cwd with a .qe/state dir; registered for cleanup. */
function sandbox() {
  const d = mkdtempSync(join(tmpdir(), 'qe-loopguard-'));
  cleanup.push(d);
  mkdirSync(join(d, '.qe', 'state'), { recursive: true });
  return d;
}
/** Write a unified-state.json for the sandbox (pre-population). */
function seedState(cwd, obj) {
  writeFileSync(join(cwd, '.qe', 'state', 'unified-state.json'), JSON.stringify(obj), 'utf8');
}

// (a) absent → fresh allow
{
  const d = sandbox();
  const v = recordAndCheck(d, 'uuid-a', 'reentry', 'verify');
  expect(!v.blocked && v.count === 1, `[a] fresh first reentry allowed (got ${JSON.stringify(v)})`);
}

// (b) reentry 5 allowed / 6 blocked
{
  const d = sandbox();
  let last;
  for (let i = 1; i <= 5; i++) last = recordAndCheck(d, 'uuid-b', 'reentry', 's');
  expect(!last.blocked && last.count === 5, `[b] reentry 5 must be allowed (got ${JSON.stringify(last)})`);
  const sixth = recordAndCheck(d, 'uuid-b', 'reentry', 's');
  expect(sixth.blocked && sixth.count === 6, `[b] reentry 6 must be blocked (got ${JSON.stringify(sixth)})`);
}

// (c) remediation round 3 allowed / 4 blocked
{
  const d = sandbox();
  let last;
  for (let i = 1; i <= 3; i++) last = recordAndCheck(d, 'uuid-c', 'remediation');
  expect(!last.blocked && last.count === 3, `[c] round 3 allowed (got ${JSON.stringify(last)})`);
  const fourth = recordAndCheck(d, 'uuid-c', 'remediation');
  expect(fourth.blocked && fourth.count === 4, `[c] round 4 blocked (got ${JSON.stringify(fourth)})`);
}

// (d) loop-scoped corrupt → blocked; whole-file unparseable → fresh (non-wedging)
{
  const d = sandbox();
  seedState(d, { sivs_loops: { 'uuid-d': { reentry: 'NOT_A_NUMBER', remediation_rounds: 0 } } });
  const v = recordAndCheck(d, 'uuid-d', 'remediation');
  expect(v.blocked && v.kind === 'corrupt', `[d] malformed entry must fail-closed (got ${JSON.stringify(v)})`);

  const d2 = sandbox();
  writeFileSync(join(d2, '.qe', 'state', 'unified-state.json'), 'not json{ broken', 'utf8');
  const v2 = recordAndCheck(d2, 'uuid-d2', 'remediation');
  expect(!v2.blocked && v2.count === 1, `[d] whole-file unparseable → fresh, not wedged (got ${JSON.stringify(v2)})`);
}

// (e) env override 0/-1/abc → default 5 (never disable, never instant-block)
{
  const saved = process.env.QE_SIVS_DEPTH_LIMIT;
  for (const bad of ['0', '-1', 'abc', '2.5']) {
    process.env.QE_SIVS_DEPTH_LIMIT = bad;
    expect(resolveDepthLimit() === DEFAULT_DEPTH_LIMIT, `[e] "${bad}" must fall back to ${DEFAULT_DEPTH_LIMIT}`);
  }
  process.env.QE_SIVS_DEPTH_LIMIT = '7';
  expect(resolveDepthLimit() === 7, '[e] valid positive int honored');
  if (saved === undefined) delete process.env.QE_SIVS_DEPTH_LIMIT; else process.env.QE_SIVS_DEPTH_LIMIT = saved;
}

// (f) atomicity — each recordAndCheck increments by exactly 1
{
  const d = sandbox();
  const a = recordAndCheck(d, 'uuid-f', 'reentry', 's');
  const b = recordAndCheck(d, 'uuid-f', 'reentry', 's');
  expect(a.count === 1 && b.count === 2, `[f] single-call increments by 1 (got ${a.count},${b.count})`);
}

// (g) resetLoop → 0; sweepStale drops old updated_at but preserves recent at-limit
{
  const d = sandbox();
  recordAndCheck(d, 'uuid-g', 'remediation');
  resetLoop(d, 'uuid-g');
  expect(checkLimits(d, 'uuid-g').remediation.count === 0, '[g] resetLoop clears the counter');

  const d2 = sandbox();
  const old = Date.now() - (48 * 60 * 60 * 1000); // 48h ago
  seedState(d2, { sivs_loops: {
    'stale': { reentry: 5, remediation_rounds: 3, stages: [], first_seen: old, updated_at: old },
    'active-at-limit': { reentry: 5, remediation_rounds: 3, stages: [], first_seen: old, updated_at: Date.now() },
  } });
  const swept = sweepStale(d2);
  const after = JSON.parse(readFileSync(join(d2, '.qe', 'state', 'unified-state.json'), 'utf8')).sivs_loops;
  expect(swept === 1 && !after['stale'], '[g] sweep drops idle entry');
  expect(!!after['active-at-limit'], '[g] sweep MUST preserve recently-active at-limit run (no runaway reopen)');
}

// (h) reentry and remediation are independent axes
{
  const d = sandbox();
  recordAndCheck(d, 'uuid-h', 'reentry', 's');
  recordAndCheck(d, 'uuid-h', 'reentry', 's');
  const cl = checkLimits(d, 'uuid-h');
  expect(cl.reentry.count === 2 && cl.remediation.count === 0, `[h] axes independent (got r${cl.reentry.count}/m${cl.remediation.count})`);
}

// (i) full-UUID keying — distinct UUIDs are independent (no 8-char slug collision)
{
  const d = sandbox();
  const u1 = 'c0127487-full-uuid-aaaa';
  const u2 = 'c0127487-full-uuid-bbbb'; // same 8-char prefix, different full UUID
  for (let i = 0; i < 4; i++) recordAndCheck(d, u1, 'remediation');
  const v2 = recordAndCheck(d, u2, 'remediation');
  expect(v2.count === 1 && !v2.blocked, '[i] same 8-char prefix must NOT collide under full-UUID keys');
}

// (k) array container must not defeat the cap (typeof [] === 'object' guard hole)
{
  const d = sandbox();
  seedState(d, { sivs_loops: [] }); // corrupt container shape
  for (let i = 1; i <= 4; i++) recordAndCheck(d, 'uuid-k', 'remediation');
  const v = recordAndCheck(d, 'uuid-k', 'remediation');
  expect(v.count >= 4 && v.blocked, `[k] array sivs_loops container must not reset the cap (got ${JSON.stringify(v)})`);
}

// --- Integration: real pre-tool-use.mjs hook ---
/** Run the real PreToolUse hook with a payload; return {code, stderr}. */
function runPre(cwd, payload) {
  const r = spawnSync('node', [PRE], { input: JSON.stringify({ cwd, ...payload }), encoding: 'utf8', cwd });
  return { code: r.status, stderr: r.stderr || '' };
}
/** Build a Write payload for REMEDIATION_REQUEST_{uuid}_{n}.md under the sandbox. */
function remWrite(cwd, uuid, n) {
  const fp = join(cwd, '.qe', 'tasks', 'in-progress', `REMEDIATION_REQUEST_${uuid}_${n}.md`);
  return { tool_name: 'Write', tool_input: { file_path: fp, content: '# remediation' } };
}

// A REMEDIATION filename is compatibility-only and never grants hook authority.
{
  const d = sandbox();
  seedState(d, { sivs_loops: { 'uuid-int': { reentry: 0, remediation_rounds: 3, stages: [], first_seen: Date.now(), updated_at: Date.now() } } });
  const r = runPre(d, remWrite(d, 'uuid-int', 4));
  expect(r.code !== 2 || !/remediation limit reached/i.test(r.stderr), `[int] filename-only round 4 must not authorize a loop block (exit ${r.code})`);
}
// A within-cap filename is equally non-authoritative.
{
  const d = sandbox();
  seedState(d, { sivs_loops: { 'uuid-int2': { reentry: 0, remediation_rounds: 2, stages: [], first_seen: Date.now(), updated_at: Date.now() } } });
  const r = runPre(d, remWrite(d, 'uuid-int2', 3));
  expect(r.code !== 2, `[int] round 3 REMEDIATION write must be allowed (exit ${r.code})`);
}
// (j) a NON-REMEDIATION Write is never loop-blocked, even at limit (non-wedging)
{
  const d = sandbox();
  seedState(d, { sivs_loops: { 'uuid-int3': { reentry: 0, remediation_rounds: 9, stages: [], first_seen: Date.now(), updated_at: Date.now() } } });
  const r = runPre(d, { tool_name: 'Write', tool_input: { file_path: join(d, 'src/normal.js'), content: 'x' } });
  expect(r.code !== 2 || !/remediation limit/i.test(r.stderr), `[j] normal Write must not be loop-blocked (exit ${r.code})`);
}

// --- Wiring assertion ---
{
  const pre = readFileSync(PRE, 'utf8');
  expect(/Remediation filenames and loop-guard counters are compatibility-only telemetry/.test(pre)
    && !/recordAndCheck\(cwd, remUuid, 'remediation'\)/.test(pre),
    '[wiring] pre-tool-use.mjs must keep REMEDIATION filenames non-authoritative');
  for (const p of ['skills/Qcritical-review/reference/verify-gate-protocol.md', 'skills/Qcritical-review/reference/supervise-gate-protocol.md']) {
    const txt = readFileSync(join(ROOT, p), 'utf8');
    expect(/recordAndCheck\(cwd, uuid, 'reentry'/.test(txt), `[wiring] ${p} must carry the reentry depth directive`);
  }
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

if (failures.length) {
  console.error('check-loop-guard: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-loop-guard: PASS (logic a-k, compatibility-only hook passthrough, wiring; depth=${DEFAULT_DEPTH_LIMIT} remediation=${REMEDIATION_LIMIT})`);
process.exit(0);
