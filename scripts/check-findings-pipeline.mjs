#!/usr/bin/env node
/**
 * check-findings-pipeline.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Pins the Verify→Supervise findings pipeline invariant (Phase 2 / R002 / G011):
 * a WARN/finding downgraded at one gate cannot silently vanish — at pipeline end
 * every finding folds to exactly one terminal (resolved/waived/escalated) with a
 * recorded reason; an id still 'open' is a vanished/forgotten finding.
 *
 * Two parts (mirrors check-utopia-guard's classifier + integration split):
 *   1. Self-test the fold/invariant logic against 5 fixtures in a temp dir —
 *      (a) legit waived → ok, (b) vanished/open → violation, (c) clean marker →
 *      clean, (d) corrupt → corrupt, (e) absent artifact → absent (NOT clean).
 *      A logic regression here FAILS the guard (exit 1).
 *   2. Scan {cwd}/.qe/agent-results/verify-findings-*.jsonl real streams; grace-
 *      skip when none exist; fold + check each; a real invariant violation is the
 *      regression signal (exit 1). Legitimate closures never false-positive.
 */

import {
  appendFinding, markClean, readFindings, foldFindings, checkInvariant, findingsPath,
} from '../hooks/scripts/lib/findings-ledger.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const cleanup = [];

/** Create a throwaway temp-dir cwd for a fixture; registered for cleanup. */
function sandbox() {
  const d = mkdtempSync(join(tmpdir(), 'qe-findings-'));
  cleanup.push(d);
  return d;
}

// ── Part 1: fold/invariant self-test across 5 fixtures ──────────────────────

// (a) legit waived (rationale + waived_by present) → invariant OK
{
  const d = sandbox(), uuid = 'aaa';
  appendFinding(d, uuid, { id: 'F1', gate: 'G2', severity: 'MEDIUM', status: 'open', file: 'x.mjs', ts: 1 });
  appendFinding(d, uuid, { id: 'F1', gate: 'G3', severity: 'MEDIUM', status: 'waived', file: 'x.mjs', ts: 2, rationale: 'false positive', waived_by: 'reviewer' });
  const { events, state } = readFindings(d, uuid);
  expect(state === 'findings', `[a] state should be findings (got ${state})`);
  const folded = foldFindings(events);
  expect(folded.get('F1').status === 'waived', '[a] F1 should fold to waived');
  expect(checkInvariant(folded).ok, '[a] legit waived must satisfy invariant');
}

// (b) vanished WARN — opened but never terminated → invariant VIOLATION
{
  const d = sandbox(), uuid = 'bbb';
  appendFinding(d, uuid, { id: 'F2', gate: 'G2', severity: 'HIGH', status: 'open', file: 'y.mjs', ts: 1 });
  // (no downstream terminal event — the WARN silently vanished)
  const folded = foldFindings(readFindings(d, uuid).events);
  const inv = checkInvariant(folded);
  expect(folded.get('F2').status === 'open', '[b] F2 should fold to open');
  expect(!inv.ok && inv.violations.some(v => v.id === 'F2'), '[b] vanished/open finding must violate invariant');
}

// (b2) waived WITHOUT rationale → silent drop → VIOLATION
{
  const d = sandbox(), uuid = 'bb2';
  appendFinding(d, uuid, { id: 'F9', gate: 'G3', severity: 'HIGH', status: 'waived', file: 'z.mjs', ts: 1 }); // no rationale
  const inv = checkInvariant(foldFindings(readFindings(d, uuid).events));
  expect(!inv.ok && inv.violations.some(v => v.id === 'F9'), '[b2] waived w/o rationale must violate');
}

// (b3) terminal-precedence — lower gate escalated must NOT be masked by later waive
{
  const d = sandbox(), uuid = 'bb3';
  appendFinding(d, uuid, { id: 'F7', gate: 'G3', severity: 'CRITICAL', status: 'escalated', file: 'a.mjs', ts: 1 });
  appendFinding(d, uuid, { id: 'F7', gate: 'G5', severity: 'CRITICAL', status: 'waived', file: 'a.mjs', ts: 2, rationale: 'r', waived_by: 'w' });
  const folded = foldFindings(readFindings(d, uuid).events);
  expect(folded.get('F7').status === 'escalated', '[b3] escalated must outrank a later waive (no masking)');
  expect(folded.get('F7').owner_gate === 'G3', '[b3] owner_gate = the escalating gate');
}

// (c) empty clean (affirmative marker, zero findings) → clean, NOT skip
{
  const d = sandbox(), uuid = 'ccc';
  markClean(d, uuid, 'G3');
  const { state } = readFindings(d, uuid);
  expect(state === 'clean', `[c] explicit clean marker → clean (got ${state})`);
}

// (d) corrupt/malformed content → corrupt (grace-skip class)
{
  const d = sandbox(), uuid = 'ddd';
  mkdirSync(join(d, '.qe', 'agent-results'), { recursive: true });
  writeFileSync(findingsPath(d, uuid), 'not json{\n{also bad\n', 'utf8');
  const { state } = readFindings(d, uuid);
  expect(state === 'corrupt', `[d] malformed content → corrupt (got ${state})`);
}

// (e) absent artifact (crash-before-write) → absent, NOT clean
{
  const d = sandbox(), uuid = 'eee';
  const { state, clean } = readFindings(d, uuid);
  expect(state === 'absent' && clean === false, `[e] absent artifact must be absent & NOT clean (got ${state}, clean=${clean})`);
}

// ── Part 2: scan real streams under cwd (grace-skip when none) ───────────────

const realDir = join(process.cwd(), '.qe', 'agent-results');
let scanned = 0;
const realViolations = [];
if (existsSync(realDir)) {
  for (const f of readdirSync(realDir)) {
    const m = /^verify-findings-(.+)\.jsonl$/.exec(f);
    if (!m) continue;
    scanned++;
    const uuid = m[1];
    const { state, events } = readFindings(process.cwd(), uuid);
    if (state !== 'findings') continue; // absent/clean/corrupt handled elsewhere / grace
    const inv = checkInvariant(foldFindings(events));
    if (!inv.ok) realViolations.push({ uuid, violations: inv.violations });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

if (failures.length) {
  console.error('check-findings-pipeline: FAIL (fold/invariant logic regression)');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
if (realViolations.length) {
  console.error('check-findings-pipeline: FAIL (real stream invariant violation — a finding vanished)');
  for (const rv of realViolations) {
    for (const v of rv.violations) console.error(`  ✗ ${rv.uuid}: ${v.id} — ${v.reason}`);
  }
  process.exit(1);
}
const scanNote = scanned > 0 ? `${scanned} real stream(s) clean` : 'no real streams under cwd (grace-skip)';
console.log(`check-findings-pipeline: PASS (5 fixtures: waived/vanished/precedence/clean/corrupt/absent; ${scanNote})`);
process.exit(0);
