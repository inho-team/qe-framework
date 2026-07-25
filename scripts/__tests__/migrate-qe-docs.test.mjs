#!/usr/bin/env node
/**
 * migrate-qe-docs.test.mjs — Phase 4 / G026–G033.
 *
 * Verifies the legacy-document migration tool: dry-run-default (no writes without
 * --apply), pre-apply backup, idempotency, frontmatter synthesis (including the
 * NO-H1 legacy case), target-scope/exclusion, post-apply convention lint, and
 * consumer/archive regression safety.
 *
 * Fixtures are built in an OS temp directory so the real repo `.qe` is never
 * touched. The convention lint (G031) runs the real `check-doc-conventions.mjs`
 * as a subprocess against the fixture root.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  TARGET_DIRS,
  deriveMigrationUuid,
  inferKind,
  renderFrontmatter,
  migrateContent,
  planMigration,
  applyPlan,
  runMigration,
  resolveWithin,
} from '../migrate-qe-docs.mjs';
import { extractDocFrontmatter } from '../lib/doc-frontmatter.mjs';
import { scanDocs } from '../lib/doc-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT_SCRIPT = join(HERE, '..', 'check-doc-conventions.mjs');

/** Write a file and its parent dirs under root. */
function put(root, rel, content) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

/** Recursively hash the directory tree into a comparable snapshot map. */
function snapshot(root) {
  const out = {};
  const walk = (dir, base) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out[rel] = readFileSync(full, 'utf8');
    }
  };
  if (existsSync(root)) walk(root, '');
  return out;
}

/** Build a fixture `.qe` tree mirroring the real scan roots plus docs/gc. */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'qe-migrate-'));
  // H1-first legacy task + paired checklist.
  put(root, '.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md',
    '# TASK_REQUEST_5b7591e7.md — Hardening\n\n## 무엇을 원하는가?\n\nBody one.\n');
  put(root, '.qe/checklists/in-progress/VERIFY_CHECKLIST_5b7591e7.md',
    '# VERIFY_CHECKLIST_5b7591e7.md — 검증\n\n## 검증 기준\n\n- [ ] Yes/No\n');
  // NO-H1 legacy task (first line is not an H1).
  put(root, '.qe/tasks/in-progress/TASK_REQUEST_923a69eb.md',
    '## 무엇을 원하는가?\n\nTriage body without a title.\n');
  // Non-lifecycle legacy artifacts.
  put(root, '.qe/security-reports/SECURITY_REPORT_20260712_223940.md',
    '# Security Report\n\nFindings: none.\n');
  put(root, '.qe/handoffs/sessions/abc123/HANDOFF_20260725_0117.md',
    '# Handoff\n\nResume marker: CONTINUE-HERE.\n');
  put(root, '.qe/gc/GC_REPORT.md', '# GC Report\n\nSweep log.\n');
  put(root, '.qe/docs/README.md', '# Docs README\n\nGuide.\n');
  // Already-migrated doc (must be skipped, not double-inserted).
  put(root, '.qe/tasks/pending/TASK_REQUEST_fbbb8aef.md',
    '# TASK_REQUEST_fbbb8aef.md — Migration\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: fbbb8aef\nplan: p\nphase: "x"\ncreated: "2026-07-25"\nstatus: pending\nlinks: []\n-->\n\n## body\n');
  // Excluded: nested dot-segment (a nested .qe below a scan root).
  put(root, '.qe/checklists/pending/.qe/learning/CONTEXT.md', '# Context\n\nnested.\n');
  // Excluded: an archived doc under .qe/.archive must never be migrated.
  put(root, '.qe/.archive/old/TASK_REQUEST_deadbeef.md', '## archived legacy\n\nkeep as-is.\n');
  // Out of scope: analysis is auto-derived, must be ignored.
  put(root, '.qe/analysis/summary.md', '## analysis\n\nignore.\n');
  return root;
}

let fixtures = [];
/** Build a fresh fixture root and register it for cleanup after the run. */
function fixture() {
  const r = buildFixture();
  fixtures.push(r);
  return r;
}
test.after(() => {
  for (const r of fixtures) { try { rmSync(r, { recursive: true, force: true }); } catch {} }
});

// --- G026: uuid / kind derivation -------------------------------------------

test('deriveMigrationUuid extracts task hex, keeps legacy slug ids, sanitizes others', () => {
  assert.equal(deriveMigrationUuid('TASK_REQUEST_5b7591e7.md'), '5b7591e7');
  assert.equal(deriveMigrationUuid('VERIFY_CHECKLIST_923a69eb.md'), '923a69eb');
  assert.equal(deriveMigrationUuid('TASK_REQUEST_qsumm001.md'), 'qsumm001');
  assert.equal(deriveMigrationUuid('SECURITY_REPORT_20260712_223940.md'), 'SECURITY_REPORT_20260712_223940');
  assert.equal(deriveMigrationUuid('GC_REPORT.md'), 'GC_REPORT');
  // Every derived id must satisfy the lint's legacy-id allowance.
  for (const n of ['codex-foreground-only.md', 'audit-skills-agents.md']) {
    assert.match(deriveMigrationUuid(n), /^[A-Za-z0-9._-]+$/);
  }
});

test('inferKind maps filenames to the six convention kinds', () => {
  assert.equal(inferKind('TASK_REQUEST_5b7591e7.md'), 'spec');
  assert.equal(inferKind('VERIFY_CHECKLIST_5b7591e7.md'), 'verify');
  assert.equal(inferKind('SECURITY_REPORT_x.md'), 'audit');
  assert.equal(inferKind('HANDOFF_x.md'), 'handoff');
  assert.equal(inferKind('GC_REPORT.md'), 'report');
});

// --- G026: frontmatter render round-trips through the real extractor ---------

test('renderFrontmatter output is recognized by extractDocFrontmatter', () => {
  const block = renderFrontmatter({ kind: 'spec', uuid: '5b7591e7', plan: 'legacy', phase: 'legacy', created: '2026-07-25', status: 'in-progress' });
  const doc = `# TASK_REQUEST_5b7591e7.md — T\n${block}\n\n## body\n`;
  const fm = extractDocFrontmatter(doc);
  assert.equal(fm.state, 'valid');
  assert.equal(fm.metadata.kind, 'spec');
  assert.equal(fm.metadata.uuid, '5b7591e7');
  assert.deepEqual(fm.metadata.links, []);
});

// --- G026 + NO-H1: migrateContent transform ---------------------------------

test('migrateContent inserts frontmatter after an existing H1 and preserves body', () => {
  const original = '# TASK_REQUEST_5b7591e7.md — T\n\n## 무엇을 원하는가?\n\nBody one.\n';
  const { text, synthesizedTitle } = migrateContent(original, { kind: 'spec', uuid: '5b7591e7', plan: 'legacy', phase: 'legacy', created: '2026-07-25', status: 'in-progress' });
  assert.equal(synthesizedTitle, null);
  const lines = text.split('\n');
  assert.equal(lines[0], '# TASK_REQUEST_5b7591e7.md — T');
  assert.equal(lines[1], '<!-- qe-doc-frontmatter');
  assert.ok(text.includes('## 무엇을 원하는가?'));
  assert.ok(text.includes('Body one.'));
  assert.equal(extractDocFrontmatter(text).state, 'valid');
});

test('migrateContent synthesizes an H1 for NO-H1 legacy docs', () => {
  const original = '## 무엇을 원하는가?\n\nTriage body without a title.\n';
  const { text, synthesizedTitle } = migrateContent(original, { kind: 'spec', uuid: '923a69eb', plan: 'legacy', phase: 'legacy', created: '2026-07-25', status: 'in-progress', title: 'TASK_REQUEST_923a69eb' });
  assert.equal(synthesizedTitle, 'TASK_REQUEST_923a69eb');
  assert.equal(text.split('\n')[0], '# TASK_REQUEST_923a69eb');
  assert.equal(extractDocFrontmatter(text).state, 'valid');
  assert.ok(text.includes('## 무엇을 원하는가?'));
  assert.ok(text.includes('Triage body without a title.'));
});

// --- G026 dry-run default + G028 scope --------------------------------------

test('planMigration classifies scope and NEVER writes (dry-run default)', () => {
  const root = fixture();
  const before = snapshot(join(root, '.qe'));
  const plan = planMigration(root);
  const after = snapshot(join(root, '.qe'));
  assert.deepEqual(after, before, 'planMigration must not modify any file');

  const byRel = Object.fromEntries(plan.entries.map(e => [e.rel, e]));
  // In-scope legacy docs are migrate targets.
  assert.equal(byRel['.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md'].action, 'migrate');
  assert.equal(byRel['.qe/tasks/in-progress/TASK_REQUEST_923a69eb.md'].action, 'migrate');
  assert.equal(byRel['.qe/tasks/in-progress/TASK_REQUEST_923a69eb.md'].synthesizeH1, true);
  assert.equal(byRel['.qe/security-reports/SECURITY_REPORT_20260712_223940.md'].action, 'migrate');
  assert.equal(byRel['.qe/docs/README.md'].action, 'migrate');
  assert.equal(byRel['.qe/gc/GC_REPORT.md'].action, 'migrate');
  // Already-migrated doc is skipped.
  assert.equal(byRel['.qe/tasks/pending/TASK_REQUEST_fbbb8aef.md'].action, 'skip-valid');
  // Nested dot-segment, .archive, and analysis are excluded entirely.
  assert.ok(!('.qe/checklists/pending/.qe/learning/CONTEXT.md' in byRel));
  assert.ok(!('.qe/.archive/old/TASK_REQUEST_deadbeef.md' in byRel));
  assert.ok(!('.qe/analysis/summary.md' in byRel));
});

// --- G027 backup + G029 apply + G030 index rebuild --------------------------

test('applyPlan backs up originals, writes valid frontmatter, and rebuilds the index', () => {
  const root = fixture();
  const legacyRel = '.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md';
  const originalText = readFileSync(join(root, legacyRel), 'utf8');

  const plan = planMigration(root);
  const result = applyPlan(root, plan);

  // Backup exists and equals the pre-migration original.
  const backup = join(root, '.qe/.archive/pre-v9/tasks/in-progress/TASK_REQUEST_5b7591e7.md');
  assert.ok(existsSync(backup), 'backup file must exist');
  assert.equal(readFileSync(backup, 'utf8'), originalText);

  // The migrated file now carries a valid frontmatter block.
  assert.equal(extractDocFrontmatter(readFileSync(join(root, legacyRel), 'utf8')).state, 'valid');
  // Index was rebuilt and now lists the migrated NO-H1 doc with a title.
  assert.ok(existsSync(join(root, '.qe/index.md')));
  assert.ok(result.changed.length >= 5);
});

// --- G026 idempotency -------------------------------------------------------

test('re-running apply is a no-op (idempotent)', () => {
  const root = fixture();
  applyPlan(root, planMigration(root));
  const afterFirst = snapshot(join(root, '.qe'));
  // Second pass: plan should find zero migrate targets; apply must not change bytes.
  const secondPlan = planMigration(root);
  assert.equal(secondPlan.summary.migrate, 0, 'second plan must have no migrate targets');
  applyPlan(root, secondPlan);
  const afterSecond = snapshot(join(root, '.qe'));
  assert.deepEqual(afterSecond, afterFirst, 'second apply must be byte-identical');
});

// --- G031 convention lint passes on migrated docs ---------------------------

test('check-doc-conventions passes (exit 0) after apply', () => {
  const root = fixture();
  applyPlan(root, planMigration(root));
  // Real lint over the fixture root: must exit 0 (no violations).
  const out = execFileSync(process.execPath, [LINT_SCRIPT, root], { encoding: 'utf8' });
  assert.match(out, /PASS/);
});

// --- G032 consumer regression: index + body preservation --------------------

test('consumers see migrated docs: index populates titles and bodies are intact', () => {
  const root = fixture();
  applyPlan(root, planMigration(root));

  // doc-index consumer: the NO-H1 task now has a derived title and uuid.
  const docs = scanDocs(root);
  const migrated = docs.find(d => d.rel === '.qe/tasks/in-progress/TASK_REQUEST_923a69eb.md');
  assert.ok(migrated, 'index must still list the migrated task');
  assert.equal(migrated.uuid, '923a69eb');
  assert.equal(migrated.title, 'TASK_REQUEST_923a69eb');

  // Qresume handoff consumer: the resume marker survives migration.
  const handoff = readFileSync(join(root, '.qe/handoffs/sessions/abc123/HANDOFF_20260725_0117.md'), 'utf8');
  assert.ok(handoff.includes('CONTINUE-HERE'));
  // Qgc tasks-sweep consumer: original task body survives.
  const task = readFileSync(join(root, '.qe/tasks/in-progress/TASK_REQUEST_923a69eb.md'), 'utf8');
  assert.ok(task.includes('Triage body without a title.'));
});

// --- G033 archive regression: archived docs untouched & still readable -------

test('archived docs under .qe/.archive are never migrated and stay byte-identical', () => {
  const root = fixture();
  const archRel = '.qe/.archive/old/TASK_REQUEST_deadbeef.md';
  const before = readFileSync(join(root, archRel), 'utf8');
  applyPlan(root, planMigration(root));
  const after = readFileSync(join(root, archRel), 'utf8');
  assert.equal(after, before, 'archived doc must not be modified');
});

// --- Security: repo-relative containment / traversal guard ------------------

test('resolveWithin rejects path traversal and absolute escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-guard-'));
  fixtures.push(root);
  assert.throws(() => resolveWithin(root, '../evil.md'));
  assert.throws(() => resolveWithin(root, '/etc/passwd'));
  const ok = resolveWithin(root, '.qe/tasks/pending/x.md');
  assert.ok(ok.startsWith(root));
});

// --- Security hardening: TOCTOU re-check (concurrent apply) ------------------

test('applyPlan re-checks legacy state at write time (no double-insert on a race)', () => {
  const root = fixture();
  const rel = '.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md';
  const plan = planMigration(root); // captures the file as a migrate target.
  // Simulate a racing writer that migrates the file between plan and apply.
  const racedText = '# TASK_REQUEST_5b7591e7.md — Hardening\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: 5b7591e7\nplan: legacy\nphase: "legacy"\ncreated: "2026-07-25"\nstatus: in-progress\nlinks: []\n-->\n\n## 무엇을 원하는가?\n\nBody one.\n';
  writeFileSync(join(root, rel), racedText, 'utf8');

  const result = applyPlan(root, plan); // stale plan still lists it as migrate.
  const after = readFileSync(join(root, rel), 'utf8');
  const blockCount = (after.match(/<!-- qe-doc-frontmatter/g) || []).length;
  assert.equal(blockCount, 1, 'must not insert a second frontmatter block');
  assert.equal(after, racedText, 'raced file must be left untouched');
  assert.ok(result.skippedRace.includes(rel), 'raced file must be reported as skipped');
});

// --- Security hardening: realpath containment against a symlinked scan root ---

test('applyPlan refuses to write through a symlinked scan-root escaping the repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-sym-'));
  const external = mkdtempSync(join(tmpdir(), 'qe-ext-'));
  fixtures.push(root, external);
  // A legacy doc living in an external dir, exposed via a symlinked scan root.
  writeFileSync(join(external, 'TASK_REQUEST_ext.md'), '# TASK_REQUEST_ext.md — X\n\n## body\n', 'utf8');
  mkdirSync(join(root, '.qe'), { recursive: true });
  symlinkSync(external, join(root, '.qe', 'tasks'), 'dir');

  const before = readFileSync(join(external, 'TASK_REQUEST_ext.md'), 'utf8');
  const plan = planMigration(root);
  const result = applyPlan(root, plan);
  const after = readFileSync(join(external, 'TASK_REQUEST_ext.md'), 'utf8');
  assert.equal(after, before, 'file outside the repo must never be written');
  assert.ok(result.failed.length >= 1, 'the escaping write must be recorded as failed');
});

// --- Security hardening: synthesized title is newline-sanitized ---------------

test('migrateContent sanitizes newlines in a synthesized H1 title', () => {
  const { text } = migrateContent('## body only\n', { kind: 'spec', uuid: 'x', plan: 'legacy', phase: 'legacy', created: '2026-07-25', status: 'pending', title: 'evil\ntitle\rline' });
  assert.equal(text.split('\n')[0], '# evil title line');
  assert.equal(extractDocFrontmatter(text).state, 'valid');
});

// --- Exclusion: in-flight docs can be held back from migration ---------------

test('planMigration honors an exclude list (by uuid or path token)', () => {
  const root = fixture();
  const plan = planMigration(root, { exclude: ['5b7591e7'] });
  const byRel = Object.fromEntries(plan.entries.map(e => [e.rel, e]));
  // Both the task and its checklist share the excluded uuid → both skipped.
  assert.equal(byRel['.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md'].action, 'skip-excluded');
  assert.equal(byRel['.qe/checklists/in-progress/VERIFY_CHECKLIST_5b7591e7.md'].action, 'skip-excluded');
  // A non-excluded legacy doc is still a migrate target.
  assert.equal(byRel['.qe/gc/GC_REPORT.md'].action, 'migrate');
});

test('applyPlan leaves excluded docs byte-identical', () => {
  const root = fixture();
  const rel = '.qe/tasks/in-progress/TASK_REQUEST_5b7591e7.md';
  const before = readFileSync(join(root, rel), 'utf8');
  applyPlan(root, planMigration(root, { exclude: ['5b7591e7'] }));
  assert.equal(readFileSync(join(root, rel), 'utf8'), before);
});

// --- G029: substantive report is preserved across an idempotent re-run -------

test('a no-op re-apply does not clobber the substantive migration report', () => {
  const root = fixture();
  const reportPath = join(root, '.qe/.archive/pre-v9/MIGRATION_REPORT.md');
  runMigration(root, { apply: true });               // substantive run writes the report.
  const substantive = readFileSync(reportPath, 'utf8');
  assert.match(substantive, /mode: APPLY/);
  assert.ok(/changed: [1-9]/.test(substantive), 'report should record a non-zero change count');
  runMigration(root, { apply: true });               // idempotent re-run: 0 changed.
  assert.equal(readFileSync(reportPath, 'utf8'), substantive, 'report must be preserved');
});

// --- runMigration wiring: apply=false leaves the tree untouched --------------

test('runMigration with apply=false produces a report but writes nothing', () => {
  const root = fixture();
  const before = snapshot(join(root, '.qe'));
  const res = runMigration(root, { apply: false });
  const after = snapshot(join(root, '.qe'));
  assert.deepEqual(after, before);
  assert.ok(res.report.includes('migrate'));
  assert.ok(res.plan.summary.migrate > 0);
});
