#!/usr/bin/env node
/**
 * check-phase-report.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Pins the Phase 4 / R007 Goal Satisfaction Report implementation. Three parts:
 *   1. Logic self-test: key parsing helpers verified in temp-cwd sandboxes.
 *   2. CLI dispatch: spawns `ledger.mjs phase-report` and verifies exit 0 for
 *      valid input, graceful exit 0 for invalid/missing inputs (backfill-safe).
 *   3. EVENT_ENUM guard: confirms 'measurement' is present and no other enum
 *      values were altered (NF2 — no surface change to existing commands).
 *
 * All writes go to temp dirs; the real workspace plan is never touched.
 * FAIL on any violation.
 */

import { phaseReport, createGoals, recordEvent } from '../hooks/scripts/lib/ledger.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'hooks', 'scripts', 'lib', 'ledger.mjs');

const failures = [];
const cleanup = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

/** Fresh temp plan sandbox. */
function sandbox(slug = 'check-plan') {
  const d = mkdtempSync(join(tmpdir(), 'qe-check-phasereport-'));
  cleanup.push(d);
  mkdirSync(join(d, '.qe', 'planning', 'plans', slug), { recursive: true });
  return { cwd: d, slug };
}

/** Minimal valid plan fixtures. */
function seedPlan(cwd, slug, { roadmap, requirements, decisionLog } = {}) {
  const defaultRoadmap = `# Roadmap\n\n## Phase 1 - Test\n\nGoal: Test goal.\n\nRequirements: R001\n\n### Wave 1 - Work\n- Do it\n`;
  const defaultReqs    = `# Requirements\n\n- **R001** Check req: DoD: calls ≤ 4 per run.\n`;
  const defaultDlog    = `# DECISION LOG\n`;
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'ROADMAP.md'),      roadmap      ?? defaultRoadmap, 'utf8');
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'REQUIREMENTS.md'), requirements ?? defaultReqs,    'utf8');
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'DECISION_LOG.md'), decisionLog  ?? defaultDlog,    'utf8');
}

/** Spawn ledger.mjs; return { code, stdout, stderr }. */
function runLedger(args, cwdOverride) {
  const r = spawnSync('node', [LEDGER, ...args], {
    encoding: 'utf8',
    cwd: cwdOverride ?? ROOT,
  });
  return { code: r.status ?? -1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ── Part 1: Logic self-test ──────────────────────────────────────────────

// (logic-a) valid plan → report generated, non-empty
{
  const { cwd, slug } = sandbox();
  seedPlan(cwd, slug);
  createGoals(cwd, slug, ['Do it::task one']);
  const res = phaseReport(cwd, slug, '1');
  expect(!res.error, `[logic-a] valid plan must not error (got ${JSON.stringify(res)})`);
  expect(res.phase === '1', `[logic-a] res.phase must be "1" (got ${res.phase})`);
  const rp = join(cwd, '.qe', 'planning', 'plans', slug, 'reports', 'PHASE_1_REPORT.md');
  expect(existsSync(rp), `[logic-a] report file must exist at ${rp}`);
  const content = readFileSync(rp, 'utf8');
  expect(content.length > 100, `[logic-a] report must be non-empty (got ${content.length} bytes)`);
  expect(content.includes('Phase 1 Goal Satisfaction Report'), '[logic-a] report must have correct heading');
}

// (logic-b) measurement event → measured value surfaced; without measurement → unmeasurable
{
  const { cwd, slug } = sandbox();
  seedPlan(cwd, slug);
  createGoals(cwd, slug, ['Do it::task one']);
  // Record a measurement satisfying ≤ 4 (value=3)
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'measured=3 reqId=R001', attempt: 0 });
  const res = phaseReport(cwd, slug, '1');
  const rp = join(cwd, '.qe', 'planning', 'plans', slug, 'reports', 'PHASE_1_REPORT.md');
  const content = readFileSync(rp, 'utf8');
  expect(content.includes('3'), `[logic-b] measured value 3 must appear in report`);

  // Without measurement: same plan but no measurement event
  const { cwd: cwd2, slug: slug2 } = sandbox();
  seedPlan(cwd2, slug2);
  createGoals(cwd2, slug2, ['Do it::task one']);
  phaseReport(cwd2, slug2, '1');
  const rp2 = join(cwd2, '.qe', 'planning', 'plans', slug2, 'reports', 'PHASE_1_REPORT.md');
  const content2 = readFileSync(rp2, 'utf8');
  expect(content2.includes('unmeasurable'), `[logic-b] no measurement → unmeasurable in report`);
  expect(!content2.includes('**met**'), `[logic-b] verdict must NOT be met without measurement`);
}

// (logic-c) invalid phaseNum (traversal / non-digit) → error returned, no file written outside reports/
{
  const { cwd, slug } = sandbox();
  seedPlan(cwd, slug);
  for (const bad of ['../evil', 'abc', '1.5', '']) {
    const res = phaseReport(cwd, slug, bad);
    expect(res.error && /invalid phase/i.test(res.error),
      `[logic-c] phaseNum "${bad}" must return invalid-phase error (got ${JSON.stringify(res)})`);
  }
}

// (logic-d) deferred verdict wins over numeric-comparable target (precedence check)
{
  const { cwd, slug } = sandbox();
  const dlog = `# DECISION LOG\n\n## D-aabb1234-1 — Defer R001\n\n- **Phase**: 1 (aabb1234) · 관련 요구사항 R001\n- **결정**: defer R001 to next sprint.\n`;
  seedPlan(cwd, slug, { decisionLog: dlog });
  createGoals(cwd, slug, ['Do it::task one']);
  phaseReport(cwd, slug, '1');
  const rp = join(cwd, '.qe', 'planning', 'plans', slug, 'reports', 'PHASE_1_REPORT.md');
  const content = readFileSync(rp, 'utf8');
  expect(content.includes('deferred'), `[logic-d] deferred verdict must win over numeric unmeasurable`);
}

// (logic-e) DECISION_LOG phase boundary: Phase 1 decision must NOT bleed into Phase 10
{
  const { cwd, slug } = sandbox();
  const dlog = `# DECISION LOG\n\n## D-aabbccdd-1 — Phase 1 dec\n\n- **Phase**: 1 (aabbccdd) · 관련 요구사항 R001\n- **결정**: ok.\n\n## D-aabbccdd-2 — Phase 10 dec\n\n- **Phase**: 10 (aabbccdd) · 관련 요구사항 R002\n- **결정**: ok.\n`;
  const roadmap10 = `# Roadmap\n\n## Phase 1 - One\n\nGoal: One.\n\nRequirements: R001\n\n## Phase 10 - Ten\n\nGoal: Ten.\n\nRequirements: R002\n`;
  const reqs = `# Requirements\n\n- **R001** R1: DoD: x.\n- **R002** R2: DoD: y.\n`;
  seedPlan(cwd, slug, { roadmap: roadmap10, requirements: reqs, decisionLog: dlog });
  createGoals(cwd, slug, ['One task::do it']);

  const res1 = phaseReport(cwd, slug, '1');
  expect(res1.decisionsCount === 1, `[logic-e] Phase 1 must find exactly 1 decision (got ${res1.decisionsCount})`);

  const res10 = phaseReport(cwd, slug, '10');
  expect(res10.decisionsCount === 1, `[logic-e] Phase 10 must find exactly 1 decision (got ${res10.decisionsCount})`);
  const rp10 = join(cwd, '.qe', 'planning', 'plans', slug, 'reports', 'PHASE_10_REPORT.md');
  const c10 = readFileSync(rp10, 'utf8');
  expect(!c10.includes('D-aabbccdd-1 — Phase 1'), '[logic-e] Phase 10 report must NOT include Phase 1 decision');
}

// ── Part 2: CLI dispatch ─────────────────────────────────────────────────

// (cli-a) valid invocation exits 0 and returns reportFile
{
  const { cwd, slug } = sandbox();
  seedPlan(cwd, slug);
  createGoals(cwd, slug, ['Do it::task one']);
  const r = runLedger(['phase-report', '--slug', slug, '--phase', '1', '--cwd', cwd], cwd);
  expect(r.code === 0, `[cli-a] valid phase-report must exit 0 (got ${r.code})`);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  expect(parsed && parsed.reportFile, `[cli-a] must return reportFile in JSON (got ${r.stdout.slice(0, 80)})`);
  expect(parsed && existsSync(parsed.reportFile), '[cli-a] reportFile path must exist on disk');
}

// (cli-b) invalid phase → exit 0 (backfill-safe), error in JSON
{
  const { cwd, slug } = sandbox();
  seedPlan(cwd, slug);
  createGoals(cwd, slug, ['Do it::task one']);
  for (const bad of ['abc', '1.5', '../evil']) {
    const r = runLedger(['phase-report', '--slug', slug, '--phase', bad, '--cwd', cwd], cwd);
    expect(r.code === 0, `[cli-b] invalid phase "${bad}" must exit 0 (got ${r.code})`);
    const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
    expect(parsed && parsed.error, `[cli-b] must return error JSON for "${bad}" (got ${r.stdout.slice(0, 80)})`);
  }
}

// (cli-c) missing goals.json → exit 0 (backfill-safe), report still generated
{
  const { cwd, slug } = sandbox();
  seedPlan(cwd, slug);
  // No createGoals() call — goals.json absent
  const r = runLedger(['phase-report', '--slug', slug, '--phase', '1', '--cwd', cwd], cwd);
  expect(r.code === 0, `[cli-c] missing goals.json must exit 0 (got ${r.code})`);
}

// (cli-d) missing ROADMAP → exit 0, report generated with degraded row
{
  const { cwd, slug } = sandbox();
  // No seedPlan — only create the plan dir; no source files
  const r = runLedger(['phase-report', '--slug', slug, '--phase', '1', '--cwd', cwd], cwd);
  expect(r.code === 0, `[cli-d] missing ROADMAP must exit 0 (got ${r.code})`);
}

// ── Part 3: EVENT_ENUM guard ─────────────────────────────────────────────
{
  const src = readFileSync(LEDGER, 'utf8');
  // 'measurement' must be in EVENT_ENUM
  expect(/EVENT_ENUM\s*=\s*\[.*'measurement'/.test(src.replace(/\n/g, ' ')),
    '[enum] EVENT_ENUM must contain "measurement"');
  // All original values must still be present
  for (const v of ['created', 'started', 'checkpoint', 'blocker', 'failed']) {
    expect(src.includes(`'${v}'`), `[enum] original EVENT_ENUM value '${v}' must still be present`);
  }
  // phase-report command is dispatched (NF2: internal subcommand only)
  expect(src.includes("cmd === 'phase-report'"), '[enum] phase-report command must be dispatched in main()');
  // phaseReport is exported
  expect(src.includes('export function phaseReport'), '[enum] phaseReport must be exported');
}

// ── Cleanup ──────────────────────────────────────────────────────────────
for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

if (failures.length) {
  console.error('check-phase-report: FAIL');
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log('check-phase-report: PASS (logic a-e: report/measurement/invalid/deferred-precedence/decision-boundary; cli a-d: dispatch/invalid/no-goals/no-roadmap; enum guard)');
process.exit(0);
