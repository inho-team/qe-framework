#!/usr/bin/env node
/**
 * Guard for the deterministic skill-routing benchmark.
 *
 * Validates the fixture shape when present and locks in alias/no-route behavior
 * against exported helpers from scripts/benchmark-skill-routing.mjs.
 */
import {
  DEFAULT_FIXTURE_PATH,
  DEFAULT_THRESHOLD,
  evaluateCases,
  loadFixtureData,
  normalizeSkillName,
  routePrompt,
  runBenchmark,
  validateFixtureData,
} from './benchmark-skill-routing.mjs';

const failures = [];
const warnings = [];

/**
 * Records a failure when a guard assertion is false.
 * @param {boolean} condition
 * @param {string} message
 */
function expect(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * Records a non-fatal guard warning.
 * @param {string} message
 */
function warn(message) {
  warnings.push(message);
}

const fixture = loadFixtureData(DEFAULT_FIXTURE_PATH);
const validation = validateFixtureData(fixture);
for (const warning of validation.warnings) warn(warning);
for (const error of validation.errors) failures.push(`[fixture] ${error}`);

expect(normalizeSkillName('Qgs') === 'Qgenerate-spec', '[alias] Qgs should normalize to Qgenerate-spec');
expect(normalizeSkillName('Qrt') === 'Qrun-task', '[alias] Qrt should normalize to Qrun-task');
expect(normalizeSkillName('qe-framework:Qgs') === 'Qgenerate-spec', '[alias] namespaced Qgs should normalize');

const syntheticRoutes = {
  routes: {
    'generate-spec/spec-document/task-request': 'Qgs',
    'run-task/execute-task': 'Qrt',
  },
};

{
  const routed = routePrompt('please create a spec document for this task request', syntheticRoutes, {
    threshold: DEFAULT_THRESHOLD,
  });
  expect(routed.routedTo === 'Qgenerate-spec', `[routing] expected Qgenerate-spec, got ${routed.routedTo}`);
  expect(routed.matched === true, '[routing] spec prompt should produce a match');
}

{
  const noRoute = routePrompt('this sentence should not match any configured skill route', syntheticRoutes, {
    threshold: DEFAULT_THRESHOLD,
  });
  expect(noRoute.routedTo === null, `[no-route] expected null route, got ${noRoute.routedTo}`);
  expect(noRoute.matched === false, '[no-route] unrelated prompt should stay unmatched');
}

{
  const report = evaluateCases(
    [
      { id: 'alias', prompt: 'generate a spec document', expectedSkill: 'Qgs' },
      { id: 'none', prompt: 'utterly unrelated phrase', noRoute: true },
    ],
    syntheticRoutes,
    { threshold: DEFAULT_THRESHOLD }
  );
  expect(report.total === 2, `[report] expected 2 cases, got ${report.total}`);
  expect(report.failed === 0, `[report] expected 0 failures, got ${report.failed}`);
}

if (fixture.exists && validation.errors.length === 0) {
  const run = runBenchmark({ threshold: DEFAULT_THRESHOLD });
  if (run.summary.failed > 0) {
    const failedIds = run.summary.results
      .filter((entry) => !entry.pass)
      .map((entry) => `${entry.id}:${entry.expectedSkill ?? 'NO_ROUTE'}→${entry.predictedSkill ?? 'NO_ROUTE'}`)
      .join(', ');
    failures.push(`[benchmark] full fixture must pass; failures: ${failedIds}`);
  }
  const phase2RequiredIds = new Set([
    'pse-plan-en',
    'pm-roadmap-en',
    'ambiguous-plan-first-en',
    'pm-phase-spec-ko',
    'pse-verify-ko',
    'lifecycle-compact-ko',
    'lifecycle-refresh-ko',
    'git-commit-en',
    'git-version-ko',
    'docs-help-en',
  ]);
  for (const id of phase2RequiredIds) {
    const result = run.summary.results.find((entry) => entry.id === id);
    expect(Boolean(result), `[phase2] required case missing: ${id}`);
    if (result) expect(result.pass, `[phase2] ${id} expected ${result.expectedSkill ?? 'NO_ROUTE'} got ${result.predictedSkill ?? 'NO_ROUTE'}`);
  }
  const negativeFailures = run.summary.results.filter((entry) => entry.noRoute && !entry.pass);
  expect(negativeFailures.length === 0, `[phase2] no-route regression(s): ${negativeFailures.map((entry) => entry.id).join(', ')}`);
}

if (failures.length > 0) {
  console.error('check-skill-routing-benchmark: FAIL');
  for (const warning of warnings) console.error(`  ! ${warning}`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

if (warnings.length > 0) {
  for (const warning of warnings) console.log(`check-skill-routing-benchmark: WARN ${warning}`);
}
console.log('check-skill-routing-benchmark: PASS (fixture schema, alias normalization, deterministic no-route behavior)');
