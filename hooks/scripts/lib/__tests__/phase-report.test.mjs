#!/usr/bin/env node
/**
 * phase-report.test.mjs
 *
 * Tests for the phaseReport() function and `phase-report` CLI command
 * (ledger.mjs Phase 4 / R007 implementation).
 *
 * All tests run in temp-cwd sandboxes; the real sivs-gate-consolidation plan
 * is never touched.
 *
 * Coverage (VERIFY_CHECKLIST d3a7ac6e):
 *   (a) measurement event recorded → measured displayed + verdict=met when numeric target satisfied
 *   (b) no measurement event → unmeasurable, verdict≠met
 *   (c) goals.json absent → graceful exit 0
 *   (d) absent Phase N / --phase abc / 0 / negative → invalid/no-data exit 0
 *   (e) malformed ROADMAP / REQUIREMENTS → row degrade, exit 0
 *   (f) DECISION_LOG **Phase**: N structured parsing (no substring mismatch, 0 decisions → graceful)
 *   (g) report file created at correct path
 *   (h) phaseNum traversal attempt (../x) → rejected, exit 0
 *
 * Run: node hooks/scripts/lib/__tests__/phase-report.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { phaseReport, createGoals, append, recordEvent } from '../ledger.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';
import { sha256 } from '../process-controller-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = join(HERE, '..', 'ledger.mjs');

const failures = [];
const cleanup = [];
/** Lightweight expect helper — identical idiom to enforced-devices.test.mjs */
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

// ── Sandbox helpers ────────────────────────────────────────────────────────

/** Create a temp plan root with .qe/planning/plans/{slug}/ structure. */
function sandbox(slug = 'test-plan') {
  const d = mkdtempSync(join(tmpdir(), 'qe-phasereport-'));
  cleanup.push(d);
  mkdirSync(join(d, '.qe', 'planning', 'plans', slug), { recursive: true });
  return { cwd: d, slug };
}

/** Write ROADMAP.md for a plan sandbox. */
function writeRoadmap(cwd, slug, content) {
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'ROADMAP.md'), content, 'utf8');
}

/** Write REQUIREMENTS.md for a plan sandbox. */
function writeRequirements(cwd, slug, content) {
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'REQUIREMENTS.md'), content, 'utf8');
}

/** Write DECISION_LOG.md for a plan sandbox. */
function writeDecisionLog(cwd, slug, content) {
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'DECISION_LOG.md'), content, 'utf8');
}

/** Read the generated report file, returning content or null if absent. */
function readReport(cwd, slug, phaseNum) {
  const relative = `.qe/planning/plans/${slug}/reports/PHASE_${phaseNum}_REPORT.md`;
  const p = join(cwd, relative);
  if (existsSync(p)) return readFileSync(p, 'utf8');
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) return null;
  try {
    return db.prepare('SELECT content FROM qe_files WHERE path=?').get(relative)?.content ?? null;
  } finally { closeSqlite(db); }
}

/** Spawn the CLI and return { code, stdout, stderr }. */
function runCli(cwd, extraArgs = []) {
  const slugIndex = extraArgs.indexOf('--slug');
  const slug = slugIndex >= 0 ? extraArgs[slugIndex + 1] : null;
  if (slug) {
    const db = openSqlite(cwd);
    const now = Date.now();
    try {
      for (const name of ['ROADMAP.md', 'REQUIREMENTS.md', 'DECISION_LOG.md', 'goals.json', 'ledger.jsonl']) {
        const relative = `.qe/planning/plans/${slug}/${name}`;
        const absolute = join(cwd, relative);
        if (!existsSync(absolute)) continue;
        const content = readFileSync(absolute, 'utf8');
        db.prepare(`INSERT OR REPLACE INTO qe_files
          (path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
          VALUES(?,?,'utf8',?,420,?,?,?)`)
          .run(relative, content, Buffer.byteLength(content), now, sha256(content), now);
      }
    } finally { closeSqlite(db); }
  }
  const r = spawnSync('node', [LEDGER, 'phase-report', '--cwd', cwd, ...extraArgs], {
    encoding: 'utf8',
    cwd,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Minimal valid ROADMAP fixture
const ROADMAP_FIXTURE = `# Roadmap

## Phase 1 - Test Phase

Goal: Verify the test system works end to end.

Requirements: R001, R002

### Wave 1 - Do Work
- Do the first task
`;

// Minimal valid REQUIREMENTS fixture
const REQUIREMENTS_FIXTURE = `# Requirements

## P0

- **R001** Numeric target req: Must achieve fast throughput.
  DoD: throughput ≥ 100 units per run.
- **R002** Qualitative req: Documentation must be complete.
  DoD: All sections of the manual are written and reviewed.
`;

// Minimal valid DECISION_LOG fixture (Phase 1 relevant, with deferral).
// Decision ID must use hex characters only (D-<hex8>-<n> format).
const DECISION_LOG_FIXTURE = `# DECISION LOG

## D-aabbccdd-1 — Defer R001 measurement to next sprint

- **Phase**: 1 (aabbccdd) · 관련 요구사항 R001 · VERIFY V01
- **결정**: R001의 실측을 다음 스프린트로 defer한다.
- **근거**: 환경이 준비되지 않았다.
`;

// DECISION_LOG where phase 1 and phase 10 both exist — tests boundary matching
const DECISION_LOG_BOUNDARY = `# DECISION LOG

## D-aabbccdd-1 — Phase 1 decision

- **Phase**: 1 (aabbccdd) · 관련 요구사항 R001
- **결정**: Phase 1 decision text. defer R001.

## D-aabbccdd-10 — Phase 10 decision

- **Phase**: 10 (aabbccdd) · 관련 요구사항 R002
- **결정**: Phase 10 decision text.
`;

// ---------------------------------------------------------------------------
// (a) measurement event recorded → measured displayed + verdict=met
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::Do the first task']);
  // Record a measurement event with evidence satisfying ≥ 100
  recordEvent(cwd, slug, {
    ts: new Date().toISOString(),
    event: 'measurement',
    goalId: 'G001',
    status: 'active',
    evidence: 'measured=150 reqId=R001',
    attempt: 0,
  });
  const res = phaseReport(cwd, slug, '1');
  expect(!res.error, `[a] phaseReport should not error (got ${res.error})`);
  const report = readReport(cwd, slug, '1');
  expect(report !== null, '[a] report file must be created');
  // R001 verdict should be met (150 ≥ 100) when no deferral
  expect(report && report.includes('**met**'), '[a] verdict=met when measured satisfies numeric target');
  // Measured value should appear in report
  expect(report && report.includes('150'), '[a] measured value 150 should appear in report');
  // Axis-2 table and Summary Findings must agree — a met verdict in the table
  // must not degrade to unmeasurable in the summary (self-contradiction guard)
  expect(report && report.includes('R001: met'), '[a] Summary Findings must agree with Axis-2 table (R001: met)');
  expect(report && !report.includes('R001: unmeasurable'), '[a] Summary must not contradict table with unmeasurable');
}

// (a2) measurement event with insufficient value → verdict NOT met
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::Do the first task']);
  recordEvent(cwd, slug, {
    ts: new Date().toISOString(),
    event: 'measurement',
    goalId: 'G001',
    status: 'active',
    evidence: 'measured=50 reqId=R001',
    attempt: 0,
  });
  const res = phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && !report.includes('**met**'), '[a2] verdict must NOT be met when measured < target');
}

// ---------------------------------------------------------------------------
// (b) no measurement event → unmeasurable, verdict≠met
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  // R001 has numeric DoD; without a measurement event it must be unmeasurable
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Numeric req: DoD: calls ≤ 4 per cycle.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  const res = phaseReport(cwd, slug, '1');
  expect(!res.error, `[b] phaseReport should not error`);
  const report = readReport(cwd, slug, '1');
  expect(report !== null, '[b] report file must be created even without measurements');
  expect(report && report.includes('unmeasurable'), '[b] verdict=unmeasurable when no measurement event');
  expect(report && !report.includes('**met**'), '[b] verdict must NOT be met without measurement');
}

// ---------------------------------------------------------------------------
// (c) goals.json absent → graceful exit 0
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  // Do NOT create goals.json
  const r = runCli(cwd, ['--slug', slug, '--phase', '1']);
  expect(r.code === 0, `[c] CLI must exit 0 even without goals.json (got ${r.code})`);
  const report = readReport(cwd, slug, '1');
  expect(report !== null, '[c] report must still be generated without goals.json');
  expect(report && report.includes('UNVERIFIED') || (report && report.includes('not found')),
    '[c] report should note missing goals.json');
}

// ---------------------------------------------------------------------------
// (d) absent Phase N / --phase abc / 0 / negative → exit 0 with graceful message
// ---------------------------------------------------------------------------

// Phase not in ROADMAP → no error, exit 0
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE); // only has Phase 1
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', '99']);
  expect(r.code === 0, `[d:absent] phase absent from ROADMAP must exit 0 (got ${r.code})`);
  // Report is generated but says not found
  const report = readReport(cwd, slug, '99');
  expect(report !== null, '[d:absent] report must be created even for absent phase');
  expect(report && report.includes('not found'), '[d:absent] report must note phase not found in ROADMAP');
}

// --phase abc → invalid, exit 0
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', 'abc']);
  expect(r.code === 0, `[d:abc] non-numeric phase must exit 0 (got ${r.code})`);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  expect(parsed && parsed.error && /invalid phase/i.test(parsed.error),
    `[d:abc] must return invalid phase error (got ${r.stdout.slice(0, 100)})`);
}

// --phase 0 → format-valid but no data (phase 0 degrades gracefully)
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', '0']);
  expect(r.code === 0, `[d:0] phase 0 must exit 0 (got ${r.code})`);
}

// --phase -1 → invalid (minus sign makes it non-^\d+$), exit 0
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', '-1']);
  expect(r.code === 0, `[d:-1] negative phase must exit 0 (got ${r.code})`);
  // Note: parseArgs treats '-1' as a flag name. We rely on phaseReport receiving
  // undefined/null and the ^\d+$ check failing gracefully.
  // Either an invalid-phase error or a report is acceptable — the key is exit 0.
}

// --phase 1.5 → invalid (decimal not ^\d+$), exit 0
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', '1.5']);
  expect(r.code === 0, `[d:1.5] decimal phase must exit 0 (got ${r.code})`);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  expect(parsed && parsed.error && /invalid phase/i.test(parsed.error),
    `[d:1.5] must return invalid phase error (got ${r.stdout.slice(0, 100)})`);
}

// ---------------------------------------------------------------------------
// (e) malformed ROADMAP / REQUIREMENTS → row degrade, exit 0
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox();
  // Malformed ROADMAP: no phase heading at all
  writeRoadmap(cwd, slug, 'This is not a valid roadmap\nno headings here\n');
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', '1']);
  expect(r.code === 0, `[e:roadmap] malformed ROADMAP must exit 0 (got ${r.code})`);
  const report = readReport(cwd, slug, '1');
  expect(report !== null, '[e:roadmap] report must still be generated with malformed ROADMAP');
}

{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  // Malformed REQUIREMENTS: no bullet format at all
  writeRequirements(cwd, slug, 'This has no requirements bullets.\n');
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  const r = runCli(cwd, ['--slug', slug, '--phase', '1']);
  expect(r.code === 0, `[e:reqs] malformed REQUIREMENTS must exit 0 (got ${r.code})`);
  // Report should still exist and list requirements as "no data"
  const report = readReport(cwd, slug, '1');
  expect(report !== null, '[e:reqs] report must be generated even with unparsed REQUIREMENTS');
  expect(report && report.includes('no data'), '[e:reqs] unparsed reqs degrade to "no data" row');
}

// ---------------------------------------------------------------------------
// (f) DECISION_LOG **Phase**: N structured parsing
//     — Phase 1 decisions must NOT match Phase 10 (boundary safety)
//     — zero decisions → "no relevant decisions"
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox();
  const roadmap10 = `# Roadmap\n\n## Phase 1 - Phase One\n\nGoal: Phase one goal.\n\nRequirements: R001\n\n## Phase 10 - Phase Ten\n\nGoal: Phase ten goal.\n\nRequirements: R002\n`;
  writeRoadmap(cwd, slug, roadmap10);
  writeRequirements(cwd, slug, `# Requirements\n- **R001** req1: DoD: x.\n- **R002** req2: DoD: y.\n`);
  writeDecisionLog(cwd, slug, DECISION_LOG_BOUNDARY);
  createGoals(cwd, slug, ['Phase one task::do it']);

  // Phase 1 report: must see D-aabbccdd-1 but NOT the Phase 10 decision
  const res1 = phaseReport(cwd, slug, '1');
  expect(!res1.error, `[f:boundary] phase 1 report must not error`);
  expect(res1.decisionsCount === 1, `[f:boundary] phase 1 must find exactly 1 decision (got ${res1.decisionsCount})`);
  const report1 = readReport(cwd, slug, '1');
  expect(report1 && report1.includes('D-aabbccdd-1'), '[f:boundary] phase 1 report must include phase-1 decision');
  expect(report1 && !report1.includes('Phase 10 decision'), '[f:boundary] phase 1 report must NOT include phase-10 decision');

  // Phase 10 report: must see D-aabbccdd-10 but NOT the Phase 1 decision
  const res10 = phaseReport(cwd, slug, '10');
  expect(res10.decisionsCount === 1, `[f:boundary] phase 10 must find exactly 1 decision (got ${res10.decisionsCount})`);
  const report10 = readReport(cwd, slug, '10');
  expect(report10 && !report10.includes('D-aabbccdd-1 — Phase 1'), '[f:boundary] phase 10 report must NOT bleed phase-1 decision');
}

// zero decisions → "no relevant decisions" graceful
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n\n(no decisions yet)\n');
  createGoals(cwd, slug, ['Do work::first task']);
  const res = phaseReport(cwd, slug, '1');
  expect(!res.error, `[f:zero] zero decisions must not error`);
  expect(res.decisionsCount === 0, `[f:zero] decisionsCount must be 0 (got ${res.decisionsCount})`);
  const report = readReport(cwd, slug, '1');
  expect(report && report.includes('No relevant decisions'), '[f:zero] report must say "No relevant decisions"');
}

// ---------------------------------------------------------------------------
// (g) report file created at correct path
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox('my-plan');
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE.replace('## Phase 1 -', '## Phase 7 -').replace('Phase 1', 'Phase 7'));
  writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  const res = phaseReport(cwd, slug, '7');
  expect(!res.error, `[g] report for phase 7 must not error`);
  const expectedPath = join(cwd, '.qe', 'planning', 'plans', slug, 'reports', 'PHASE_7_REPORT.md');
  expect(existsSync(expectedPath), `[g] report must exist at ${expectedPath}`);
  expect(res.reportFile === expectedPath, `[g] reportFile path must match (got ${res.reportFile})`);
}

// ---------------------------------------------------------------------------
// (h) phaseNum traversal attempt (../x) → rejected, exit 0
// ---------------------------------------------------------------------------
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  createGoals(cwd, slug, ['Do work::first task']);

  // Direct API: phaseReport must return error, NOT write to traversal path
  const res = phaseReport(cwd, slug, '../evil');
  expect(res.error && /invalid phase/i.test(res.error),
    `[h:api] traversal "../evil" must return invalid-phase error (got ${JSON.stringify(res)})`);
  // Confirm no file was written outside the expected reports dir
  const evilPath = join(cwd, '.qe', 'planning', 'plans', slug, '..', 'evil', 'reports', 'PHASE_..%2Fevil_REPORT.md');
  // The file that would exist at a traversal path:
  const traversalReport = join(cwd, '.qe', 'planning', 'plans', 'evil', 'reports', 'PHASE_..%2Fevil_REPORT.md');
  expect(!existsSync(traversalReport), '[h] no file must be written at traversal path');

  // CLI: exit 0, no traversal write
  const r = runCli(cwd, ['--slug', slug, '--phase', '../evil']);
  expect(r.code === 0, `[h:cli] CLI must exit 0 on traversal attempt (got ${r.code})`);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  expect(parsed && parsed.error && /invalid phase/i.test(parsed.error),
    `[h:cli] CLI must return invalid phase error (got ${r.stdout.slice(0, 120)})`);
}

// Additional: verdict=deferred wins over numeric-comparable target (precedence check)
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  // R001 has numeric DoD; a deferral decision covers it; verdict must be deferred not unmeasurable
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Numeric req: DoD: calls ≤ 4 per cycle.\n- **R002** Qualitative: DoD: docs complete.\n`);
  // Decision ID must use hex chars (D-<hex8>-<n>). 'aabb1234' is all hex.
  writeDecisionLog(cwd, slug, `# DECISION LOG\n\n## D-aabb1234-1 — Defer R001\n\n- **Phase**: 1 (aabb1234) · 관련 요구사항 R001\n- **결정**: defer R001 to next sprint.\n`);
  createGoals(cwd, slug, ['Do work::first task']);
  const res = phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  // R001 must be deferred (not unmeasurable) even though numeric target exists and no measurement
  expect(report && report.includes('deferred'), '[precedence] deferred verdict must win over unmeasurable for R001');
}

// ---------------------------------------------------------------------------
// Verify-gate regression fixes (F2–F7)
// ---------------------------------------------------------------------------

// (F2) malformed measured tokens must NOT partially parse into a number
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Numeric req: DoD: throughput ≥ 10 units.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  for (const bad of ['measured=42abc R001', 'measured=1e3 R001', 'xmeasured=99 R001']) {
    recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: bad, attempt: 0 });
  }
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && !report.includes('**met**'), '[F2] malformed measured tokens must not produce met');
  expect(report && report.includes('unmeasurable'), '[F2] malformed measured tokens degrade to unmeasurable');
}

// (F3) decimal sub-phase must not bleed into whole-phase matching
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, `# Roadmap\n\n## Phase 1 - Whole\n\nGoal: whole phase goal.\n\nRequirements: R001\n\n## Phase 1.1 - Decimal\n\nGoal: decimal gap phase.\n\nRequirements: R002\n`);
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Whole req: DoD: docs done.\n- **R002** Decimal req: DoD: gap closed.\n`);
  writeDecisionLog(cwd, slug, `# DECISION LOG\n\n## D-aabb0001-1 — decimal-phase decision defer R002\n\n- **Phase**: 1.1 (aabb0001) · 관련 요구사항 R002\n- **결정**: defer R002.\n`);
  writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'goals.json'), JSON.stringify({
    planSlug: slug, schema: 1, createdAt: new Date().toISOString(), goals: [
      { id: 'G001', title: 'whole', objective: 'whole', status: 'pending', attempts: 0, phase: 'Phase 1 - Whole', wave: 'W1' },
      { id: 'G002', title: 'decimal', objective: 'decimal', status: 'pending', attempts: 0, phase: 'Phase 1.1 - Decimal', wave: 'W1' },
    ],
  }), 'utf8');
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && report.includes('whole phase goal'), '[F3] phase 1 goal text must come from Phase 1 block');
  expect(report && !report.includes('decimal gap phase'), '[F3] Phase 1.1 ROADMAP block must not bleed into Phase 1');
  expect(report && report.includes('G001') && !report.includes('G002'), '[F3] Phase 1.1 goals must be excluded from Phase 1 report');
  expect(report && !report.includes('D-aabb0001-1'), '[F3] Phase 1.1 decisions must not attach to Phase 1');
}

// (F4) evidence markdown injection must not forge table rows/sections
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Numeric req: DoD: throughput ≥ 100 units.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  recordEvent(cwd, slug, {
    ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active',
    evidence: 'note | R999 | fake | numeric | 999 | **met** |\n## 6. Injected Section', attempt: 0,
  });
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && !report.includes('## 6. Injected Section'), '[F4] newline in evidence must not inject a heading');
  expect(report && !/^\| R999 /m.test(report), '[F4] pipes in evidence must not forge a table row');
}

// (F5) ASCII <= / >= comparators must not mis-parse as strict equality
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Latency req: DoD: latency <= 5 ms.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R001 measured=4', attempt: 0 });
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && report.includes('numeric (<=5'), `[F5] <= must parse as <= not = (report: ${report && report.match(/numeric \([^)]*\)/)?.[0]})`);
  expect(report && report.includes('**met**'), '[F5] measured 4 must satisfy <=5 (was false-unknown under = mis-parse)');
}

// (F6) CLI with no slug and no active plan → graceful exit 0 for phase-report
{
  const d = mkdtempSync(join(tmpdir(), 'qe-phasereport-noslug-'));
  cleanup.push(d);
  const r = runCli(d, ['--phase', '1']);
  expect(r.code === 0, `[F6] phase-report with no slug/active plan must exit 0 (got ${r.code})`);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  expect(parsed && /no valid --slug/i.test(parsed.error || ''), '[F6] error object must explain missing slug');
}

// (F7) API-level slug validation + boundary-safe reqId matching
{
  const { cwd } = sandbox();
  const res = phaseReport(cwd, '../evil', '1');
  expect(res && res.error && /invalid slug/i.test(res.error), '[F7] traversal slug must be rejected at the API level');

  // R1 must not match evidence naming R12
  const { cwd: cwd2, slug: slug2 } = sandbox();
  writeRoadmap(cwd2, slug2, `# Roadmap\n\n## Phase 1 - T\n\nGoal: g.\n\nRequirements: R1\n`);
  writeRequirements(cwd2, slug2, `# Requirements\n- **R1** Short-id req: DoD: count ≥ 5.\n`);
  writeDecisionLog(cwd2, slug2, '# DECISION LOG\n');
  createGoals(cwd2, slug2, ['Do work::first task']);
  recordEvent(cwd2, slug2, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R12 measured=9', attempt: 0 });
  phaseReport(cwd2, slug2, '1');
  const report2 = readReport(cwd2, slug2, '1');
  expect(report2 && !report2.includes('**met**'), '[F7] evidence tagged R12 must not satisfy requirement R1');
}

// (F12) lone CR (old-Mac line ending) must not survive mdCell into the report
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Numeric req: DoD: throughput ≥ 100 units.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  recordEvent(cwd, slug, {
    ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active',
    evidence: 'R001 measured=999\r## CR-FORGED HEADING\rrest', attempt: 0,
  });
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && !report.includes('\r'), '[F12] lone CR must be neutralized in rendered cells');
  expect(report && !/^## CR-FORGED HEADING/m.test(report), '[F12] CR must not inject a heading');
}

// (F13) target-side unit needs a trailing boundary; units are case-sensitive
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, `# Roadmap\n\n## Phase 1 - T\n\nGoal: g.\n\nRequirements: R001, R002\n`);
  // R001: "200ms" — 'm' must NOT parse as the mega multiplier (nor 200 as unitless)
  // R002: control — a clean M-suffixed target still works case-sensitively
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Latency req: DoD: latency <= 200ms under load.\n- **R002** Volume req: DoD: throughput ≥ 2M events.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  // An M-suffixed measurement that would falsely satisfy "<= 200000000" if 'ms' mis-parsed
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R001 measured=150M', attempt: 0 });
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R002 measured=3M', attempt: 0 });
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && !report.includes('numeric (<=200000000'), '[F13] "200ms" must not parse m as mega multiplier');
  expect(report && /\| R001 \|.*unmeasurable/.test(report), '[F13] ms-suffixed DoD must be unmeasurable');
  expect(report && /\| R002 \|.*met/.test(report), '[F13] clean M-suffixed target must still compare (3M ≥ 2M = met)');
}

// (F18) isolation guard: one comparator token + extra bare numbers → unmeasurable
{
  const { cwd, slug } = sandbox();
  writeRoadmap(cwd, slug, `# Roadmap\n\n## Phase 1 - T\n\nGoal: g.\n\nRequirements: R001, R002, R003\n`);
  // R001: comparator token + extra bare number ("over 10 runs") → ambiguous → unmeasurable
  // R002: digits embedded in an identifier (V13) must NOT count as an extra number → met
  // R003: decimal number is one number, not two → met
  writeRequirements(cwd, slug, `# Requirements\n- **R001** Ambiguous: DoD: calls ≤ 4 per cycle over 10 runs.\n- **R002** Identifier: DoD: per V13 checks, count ≥ 5 events.\n- **R003** Decimal: DoD: ratio ≥ 1.5 achieved.\n`);
  writeDecisionLog(cwd, slug, '# DECISION LOG\n');
  createGoals(cwd, slug, ['Do work::first task']);
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R001 measured=3', attempt: 0 });
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R002 measured=9', attempt: 0 });
  recordEvent(cwd, slug, { ts: new Date().toISOString(), event: 'measurement', goalId: 'G001', status: 'active', evidence: 'R003 measured=2', attempt: 0 });
  phaseReport(cwd, slug, '1');
  const report = readReport(cwd, slug, '1');
  expect(report && /\| R001 \|.*unmeasurable/.test(report), '[F18] extra bare number must force unmeasurable (no target smuggling)');
  expect(report && !/\| R001 \|.*met/.test(report), '[F18] ambiguous multi-number DoD must never reach met');
  expect(report && /\| R002 \|.*met/.test(report), '[F18] identifier-embedded digits (V13) must not count as extra numbers');
  expect(report && /\| R003 \|.*met/.test(report), '[F18] a decimal is one number (1.5 must not count as two)');
}

// (F15) goals.json schema drift (valid JSON, wrong shape) → row degrade, report
// still generated, API never throws
{
  for (const drift of ['{}', '{"goals":"not-an-array"}', '{"goals":[null,42,{"phase":"Phase 1 - T"}]}']) {
    const { cwd, slug } = sandbox();
    writeRoadmap(cwd, slug, ROADMAP_FIXTURE);
    writeRequirements(cwd, slug, REQUIREMENTS_FIXTURE);
    writeDecisionLog(cwd, slug, '# DECISION LOG\n');
    writeFileSync(join(cwd, '.qe', 'planning', 'plans', slug, 'goals.json'), drift, 'utf8');
    let res = null, threw = false;
    try { res = phaseReport(cwd, slug, '1'); } catch { threw = true; }
    expect(!threw, `[F15] phaseReport must not throw on schema-drift goals.json (${drift.slice(0, 30)})`);
    expect(res && !res.error, `[F15] schema drift must degrade, not error (${drift.slice(0, 30)} → ${res && res.error})`);
    const report = readReport(cwd, slug, '1');
    expect(report !== null, `[F15] report must still be generated on schema drift (${drift.slice(0, 30)})`);
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

if (failures.length) {
  console.error('phase-report.test: FAIL');
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log('phase-report.test: PASS (a measurement/met, b unmeasurable, c no-goals.json, d invalid-phase/absent/0/-1/1.5, e malformed-degrade, f decision-boundary/zero, g report-path, h traversal-rejected, precedence, F2-F7 verify-gate regressions)');
process.exit(0);
