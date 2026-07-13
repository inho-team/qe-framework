#!/usr/bin/env node

/**
 * qexecute-tdd-policy.test.mjs
 * Verifies deterministic branching of the TDD applicability judge:
 *   - apply=true when all three inclusion signals fire and no exclusion fires.
 *   - apply=false (with populated exclusions/reason) for each exclusion class.
 *   - apply=false when an inclusion signal is missing even without exclusions.
 *   - formatExclusionHandoff produces the correct handoff note text.
 *
 * Run with:
 *   node --test hooks/scripts/lib/__tests__/qexecute-tdd-policy.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { judgeTddPolicy, formatExclusionHandoff } from '../qexecute-tdd-policy.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full apply-eligible input — all three inclusion signals true, no exclusion. */
const FULL_APPLY = {
  taskType: 'code',
  hasTestRunner: true,
  hasTestableLogic: true,
  isConfigOrDocOnly: false,
  hasTestInfrastructure: true,
};

// ---------------------------------------------------------------------------
// APPLY cases — all three inclusion signals must fire
// ---------------------------------------------------------------------------

test('apply: type:code + runner + testable logic → apply=true', () => {
  const r = judgeTddPolicy(FULL_APPLY);
  assert.equal(r.apply, true, `Expected apply=true, got: ${r.reason}`);
  assert.equal(r.exclusions.length, 0, 'No exclusions expected');
  assert.ok(r.inclusions.length >= 3, 'Expected all three inclusions recorded');
});

test('apply: reason string mentions RED-GREEN-REFACTOR', () => {
  const r = judgeTddPolicy(FULL_APPLY);
  assert.ok(
    r.reason.includes('RED-GREEN-REFACTOR'),
    `Expected RED-GREEN-REFACTOR in reason, got: ${r.reason}`
  );
});

test('apply: inclusions list mentions type:code, 검증 명령, 테스트 가능', () => {
  const r = judgeTddPolicy(FULL_APPLY);
  assert.ok(r.inclusions.some((s) => s.includes('type:code')));
  assert.ok(r.inclusions.some((s) => s.includes('검증 명령')));
  assert.ok(r.inclusions.some((s) => s.includes('테스트 가능')));
});

// ---------------------------------------------------------------------------
// EXCLUSION class 1 — docs/analysis task type
// ---------------------------------------------------------------------------

test('exclude: taskType=docs → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'docs' });
  assert.equal(r.apply, false);
  assert.ok(r.exclusions.length > 0, 'Expected exclusion recorded for docs');
  assert.ok(
    r.exclusions.some((s) => s.toLowerCase().includes('docs')),
    `Expected docs exclusion, got: ${JSON.stringify(r.exclusions)}`
  );
});

test('exclude: taskType=analysis → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'analysis' });
  assert.equal(r.apply, false);
  assert.ok(r.exclusions.some((s) => s.toLowerCase().includes('analysis')));
});

test('exclude: taskType=DOCS (case-insensitive) → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'DOCS' });
  assert.equal(r.apply, false);
});

// ---------------------------------------------------------------------------
// EXCLUSION class 2 — config/document-only change
// ---------------------------------------------------------------------------

test('exclude: isConfigOrDocOnly=true → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'code', isConfigOrDocOnly: true });
  assert.equal(r.apply, false);
  assert.ok(
    r.exclusions.some((s) => s.includes('설정') || s.includes('문서 전용')),
    `Expected config-only exclusion, got: ${JSON.stringify(r.exclusions)}`
  );
});

// ---------------------------------------------------------------------------
// EXCLUSION class 3 — no test infrastructure
// ---------------------------------------------------------------------------

test('exclude: hasTestInfrastructure=false → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, hasTestInfrastructure: false });
  assert.equal(r.apply, false);
  assert.ok(
    r.exclusions.some((s) => s.includes('인프라') || s.includes('테스트 인프라')),
    `Expected infra exclusion, got: ${JSON.stringify(r.exclusions)}`
  );
});

test('exclude: hasTestInfrastructure=undefined → apply=false (fail-safe)', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, hasTestInfrastructure: undefined });
  assert.equal(r.apply, false);
});

// ---------------------------------------------------------------------------
// MISSING inclusion signal — not excluded but not fully applicable
// ---------------------------------------------------------------------------

test('not-apply: taskType=other (not code, not docs/analysis) → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'other' });
  assert.equal(r.apply, false);
  // Should not fire a docs/analysis exclusion — falls through to missing inclusion
  assert.equal(r.exclusions.length, 0, 'other type is not an exclusion class');
  assert.ok(r.reason.includes('type:code'), 'reason should mention missing type:code signal');
});

test('not-apply: hasTestRunner=false → apply=false, inclusions partial', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, hasTestRunner: false });
  assert.equal(r.apply, false);
  assert.equal(r.exclusions.length, 0);
  assert.ok(
    r.reason.includes('테스트 러너') || r.reason.includes('검증 명령'),
    `Expected runner-missing in reason, got: ${r.reason}`
  );
});

test('not-apply: hasTestableLogic=false → apply=false', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, hasTestableLogic: false });
  assert.equal(r.apply, false);
  assert.equal(r.exclusions.length, 0);
});

test('not-apply: empty input → apply=false (all signals missing)', () => {
  const r = judgeTddPolicy({});
  assert.equal(r.apply, false);
});

test('not-apply: undefined input → apply=false (no throw)', () => {
  const r = judgeTddPolicy(undefined);
  assert.equal(r.apply, false);
});

// ---------------------------------------------------------------------------
// Exclusion takes precedence over missing inclusion
// ---------------------------------------------------------------------------

test('exclusion wins: taskType=docs + hasTestRunner=false → exclusion fires first', () => {
  const r = judgeTddPolicy({ taskType: 'docs', hasTestRunner: false, hasTestableLogic: false });
  assert.equal(r.apply, false);
  assert.ok(r.exclusions.length > 0, 'Exclusion should fire for docs');
  // When exclusion fires, inclusions list should be empty (exclusion short-circuits)
  assert.equal(r.inclusions.length, 0);
});

// ---------------------------------------------------------------------------
// formatExclusionHandoff
// ---------------------------------------------------------------------------

test('handoff: apply=false produces non-empty handoff note', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'docs' });
  const note = formatExclusionHandoff(r, 'C3');
  assert.ok(note.length > 0);
  assert.ok(note.includes('[TDD-SKIP C3]'), `Expected item id prefix, got: ${note}`);
  assert.ok(note.includes('TDD 제외') || note.includes('TDD'), `Expected reason in note, got: ${note}`);
});

test('handoff: apply=true produces empty string', () => {
  const r = judgeTddPolicy(FULL_APPLY);
  assert.equal(r.apply, true);
  const note = formatExclusionHandoff(r, 'C3');
  assert.equal(note, '');
});

test('handoff: no itemId → fallback prefix [TDD-SKIP]', () => {
  const r = judgeTddPolicy({ ...FULL_APPLY, taskType: 'analysis' });
  const note = formatExclusionHandoff(r);
  assert.ok(note.startsWith('[TDD-SKIP]'), `Expected default prefix, got: ${note}`);
});

// ---------------------------------------------------------------------------
// result shape is stable (no extra keys that change the contract)
// ---------------------------------------------------------------------------

test('result shape: has apply, reason, exclusions, inclusions', () => {
  const r = judgeTddPolicy(FULL_APPLY);
  assert.ok('apply' in r);
  assert.ok('reason' in r);
  assert.ok('exclusions' in r);
  assert.ok('inclusions' in r);
  assert.equal(typeof r.apply, 'boolean');
  assert.equal(typeof r.reason, 'string');
  assert.ok(Array.isArray(r.exclusions));
  assert.ok(Array.isArray(r.inclusions));
});
