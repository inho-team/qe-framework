#!/usr/bin/env node
/**
 * @fileoverview qexecute-tdd-policy.mjs — Deterministic TDD applicability judge
 * for the Qexecute skill (R004).
 *
 * Decides whether a given execution context requires the RED-GREEN-REFACTOR
 * test-first gate before implementation may proceed. The decision is purely
 * deterministic: no LLM calls, no I/O beyond what the caller supplies.
 *
 * Adapted from obra/superpowers test-driven-development Iron Law in QE terms.
 * Original concept: MIT License © Jesse Vincent / Prime Radiant
 * (https://github.com/obra/superpowers — see skills/test-driven-development/)
 *
 * Scale-aware constraint (D017): TDD is NOT blanket-mandatory for every task.
 * This module only returns apply=true when all three inclusion signals fire AND
 * no exclusion signal fires. Bulk-mandating TDD on docs/analysis/config-only
 * changes violates the D017 scale-aware principle and is explicitly prohibited.
 *
 * Pure helper — no side effects on import.
 * @module hooks/scripts/lib/qexecute-tdd-policy
 */

'use strict';

// ---------------------------------------------------------------------------
// Inclusion signals
// ---------------------------------------------------------------------------

/**
 * Signal 1 — task type is code.
 * The TASK_REQUEST `<!-- type: code -->` annotation (or the `taskType` field
 * from a parsed TASK_REQUEST header) must match "code".  Any other value
 * (docs, analysis, other) → not applicable.
 *
 * @param {string|undefined} taskType - Normalised task type string.
 * @returns {boolean}
 */
function isCodeTask(taskType) {
  return typeof taskType === 'string' && taskType.trim().toLowerCase() === 'code';
}

/**
 * Signal 2 — a deterministic test runner / validation command is available.
 * Checked by whether the caller passes known allowlist commands present in the
 * target repo's package.json scripts or as runnable node files.
 *
 * Allowlist (closed — same list as verification-evidence allowlist):
 *   npm run qe:validate
 *   node scripts/check-all.mjs
 *   node --test <path>
 *
 * The caller must perform the file-system probe (exists? executable?); this
 * module receives the result as a boolean for testability.
 *
 * @param {boolean} hasTestRunner - True when at least one allowlist command is available.
 * @returns {boolean}
 */
function hasVerifiableRunner(hasTestRunner) {
  return hasTestRunner === true;
}

/**
 * Signal 3 — the changed / new logic is testable (determinism signal).
 * "Testable" means the change introduces or modifies logic with observable
 * outputs (functions, classes, algorithms) — not purely declarative or
 * structural content (prose, config schemas, asset files).
 *
 * The caller assesses this from the checklist item annotations and file
 * extensions of the `→ output:` paths; this module receives the result as a
 * boolean.
 *
 * @param {boolean} hasTestablLogic - True when changed files contain testable logic.
 * @returns {boolean}
 */
function hasTestablLogic(hasTestablLogic) {
  return hasTestablLogic === true;
}

// ---------------------------------------------------------------------------
// Exclusion signals
// ---------------------------------------------------------------------------

/**
 * Exclusion class 1 — docs/analysis task.
 * If the task type is "docs" or "analysis", TDD does not apply regardless of
 * other signals.
 *
 * @param {string|undefined} taskType
 * @returns {boolean} True if this exclusion fires.
 */
function isDocsOrAnalysis(taskType) {
  if (typeof taskType !== 'string') return false;
  const t = taskType.trim().toLowerCase();
  return t === 'docs' || t === 'analysis';
}

/**
 * Exclusion class 2 — config/document-only change.
 * When every `→ output:` path in the checklist item is a config, Markdown,
 * JSON, or YAML file — and no .mjs/.js/.ts logic file is in scope — TDD does
 * not apply.
 *
 * @param {boolean} isConfigOrDocOnly - True when no logic file is in scope.
 * @returns {boolean} True if this exclusion fires.
 */
function isConfigOrDocOnlyChange(isConfigOrDocOnly) {
  return isConfigOrDocOnly === true;
}

/**
 * Exclusion class 3 — no test infrastructure present.
 * When the target repo has no test runner, no test files, and no node:test
 * capability, TDD cannot be applied mechanically.
 *
 * @param {boolean} hasTestInfrastructure - True when a test runner/infra is present.
 * @returns {boolean} True if this exclusion fires (i.e. infra is absent).
 */
function lacksTestInfrastructure(hasTestInfrastructure) {
  return hasTestInfrastructure !== true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TddPolicyInput
 * @property {string}  [taskType]              - 'code' | 'docs' | 'analysis' | other.
 * @property {boolean} [hasTestRunner]          - True when allowlist validation command is available.
 * @property {boolean} [hasTestableLogic]       - True when changed/new code has deterministic observable outputs.
 * @property {boolean} [isConfigOrDocOnly]      - True when every output path is config/markdown/JSON/YAML.
 * @property {boolean} [hasTestInfrastructure]  - True when the repo contains test files + node:test capability.
 */

/**
 * @typedef {Object} TddPolicyResult
 * @property {boolean}  apply          - True = RED-GREEN-REFACTOR gate must run before implementation.
 * @property {string}   reason         - Human-readable explanation (logged to handoff).
 * @property {string[]} exclusions     - Which exclusion classes fired (empty when apply=true).
 * @property {string[]} inclusions     - Which inclusion signals fired.
 */

/**
 * Judge whether the TDD gate applies to a given execution context.
 *
 * All three inclusion signals must be true AND no exclusion signal must fire
 * for apply=true. When apply=false, exclusions lists the fired reasons so
 * the caller can record them in the handoff notes (D017 — exclusion-reason
 * handoff recording rule).
 *
 * Contradictory inputs: exclusions win over inclusions — when an exclusion signal
 * fires alongside a matching inclusion signal (e.g. taskType='code' AND
 * isConfigOrDocOnly=true), the exclusion takes priority and the result is apply=false.
 * This resolves any contradictory caller inputs to the conservative (non-TDD) outcome.
 *
 * @param {TddPolicyInput} input
 * @returns {TddPolicyResult}
 */
export function judgeTddPolicy(input = {}) {
  const {
    taskType,
    hasTestRunner = false,
    hasTestableLogic = false,
    isConfigOrDocOnly = false,
    hasTestInfrastructure = false,
  } = input;

  // --- Evaluate exclusions first (short-circuit logic) --------------------
  const exclusions = [];

  if (isDocsOrAnalysis(taskType)) {
    exclusions.push('docs/analysis 태스크 — TDD 적용 제외');
  }
  if (isConfigOrDocOnlyChange(isConfigOrDocOnly)) {
    exclusions.push('설정/문서 전용 변경 — 로직 파일 없음');
  }
  if (lacksTestInfrastructure(hasTestInfrastructure)) {
    exclusions.push('테스트 인프라 부재 — 테스트 러너/파일 없음');
  }

  // If any exclusion fired, TDD does not apply.
  if (exclusions.length > 0) {
    return {
      apply: false,
      reason: `TDD 제외: ${exclusions.join('; ')}`,
      exclusions,
      inclusions: [],
    };
  }

  // --- Evaluate inclusions (all three must be true) -----------------------
  const inclusions = [];
  const missing = [];

  if (isCodeTask(taskType)) {
    inclusions.push('type:code 태스크');
  } else {
    missing.push('type:code 신호 없음 (taskType=' + String(taskType) + ')');
  }

  if (hasVerifiableRunner(hasTestRunner)) {
    inclusions.push('허용 목록 검증 명령 존재');
  } else {
    missing.push('테스트 러너/검증 명령 없음');
  }

  if (hasTestablLogic(hasTestableLogic)) {
    inclusions.push('테스트 가능한 신규/변경 로직 존재');
  } else {
    missing.push('테스트 가능 로직 신호 없음 (선언형/구조적 변경만)');
  }

  if (missing.length > 0) {
    return {
      apply: false,
      reason: `TDD 적용 조건 불충족: ${missing.join('; ')}`,
      exclusions: [],
      inclusions,
    };
  }

  // All three inclusion signals fired and no exclusion — TDD applies.
  return {
    apply: true,
    reason: `TDD 적용: ${inclusions.join(', ')} — RED-GREEN-REFACTOR 게이트 필수`,
    exclusions: [],
    inclusions,
  };
}

/**
 * Format a handoff note for exclusion recording (D017 rule).
 * When TDD does not apply, call this to produce the line that must be written
 * to the task handoff / DIAG record.
 *
 * @param {TddPolicyResult} result - Output of judgeTddPolicy().
 * @param {string} [itemId] - Checklist item identifier (e.g. "C2").
 * @returns {string} Ready-to-append handoff note.
 */
export function formatExclusionHandoff(result, itemId = '') {
  if (result.apply) return '';
  const prefix = itemId ? `[TDD-SKIP ${itemId}]` : '[TDD-SKIP]';
  return `${prefix} ${result.reason}`;
}
