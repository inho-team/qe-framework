#!/usr/bin/env node
/**
 * Deterministic regression check for state-aware PSE routing.
 *
 * The helper tests use temporary .qe fixtures. The hook tests execute the real
 * prompt-check subprocess to prove the soft hint wiring is not just unit-level.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { clearPlanResolverCache } from '../hooks/scripts/lib/plan-resolver.mjs';
import { collectPseState, resolvePseStateHint } from '../hooks/scripts/lib/pse-state-router.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const FIXTURE_PATH = join(REPO_ROOT, 'scripts', 'fixtures', 'skill-routing-state-benchmark.json');
const PROMPT_CHECK = join(REPO_ROOT, 'hooks', 'scripts', 'prompt-check.mjs');
const ROUTES_PATH = join(REPO_ROOT, 'hooks', 'scripts', 'lib', 'intent-routes.json');
const PLAN_SLUG = 'qe-skill-routing';
const PHASE = 'Phase 3 - State-Aware Routing and Catalog Pressure Controls';

const failures = [];
const warnings = [];
const latencySamples = [];

/**
 * Records a failing assertion.
 * @param {boolean} condition - Assertion condition.
 * @param {string} message - Failure message.
 */
function expect(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * Records a non-fatal warning.
 * @param {string} message - Warning message.
 */
function warn(message) {
  warnings.push(message);
}

/**
 * Writes a UTF-8 text file, creating parent directories first.
 * @param {string} path - Destination path.
 * @param {string} content - File content.
 */
function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/**
 * Creates a temporary project root.
 * @returns {string}
 */
function tempProject() {
  return mkdtempSync(join(tmpdir(), 'qe-state-routing-'));
}

/**
 * Creates the minimal active plan files for a fixture project.
 * @param {string} root - Temp project root.
 * @param {{slug?: string, activePointer?: boolean, sessionId?: string, staleSession?: boolean, completed?: boolean}} [options]
 */
function createPlan(root, options = {}) {
  const slug = options.slug || PLAN_SLUG;
  write(
    join(root, '.qe', 'planning', 'plans', slug, 'ROADMAP.md'),
    [
      `# ${slug}`,
      '',
      '## Phase 1 - Foundation',
      `## ${PHASE}`,
      '## Phase 4 - Release Polish',
      '',
    ].join('\n'),
  );
  write(join(root, '.qe', 'planning', 'plans', slug, 'STATE.md'), `# STATE\n\n- **Active Phase**: ${PHASE}\n`);
  if (options.activePointer !== false) write(join(root, '.qe', 'planning', 'ACTIVE_PLAN'), `${slug}\n`);

  if (options.sessionId) {
    write(join(root, '.qe', 'state', 'current-session.json'), JSON.stringify({ session_id: options.sessionId }, null, 2));
    const boundSlug = options.staleSession ? 'deleted-plan' : slug;
    write(join(root, '.qe', 'planning', '.sessions', `${options.sessionId}.json`), JSON.stringify({ activePlanSlug: boundSlug }, null, 2));
  }

  if (options.completed) {
    write(join(root, '.qe', 'planning', 'plans', slug, 'goals.json'), JSON.stringify({
      planSlug: slug,
      goals: [
        { id: 'G019', phase: PHASE, status: 'complete' },
        { id: 'G020', phase: PHASE, status: 'complete' },
      ],
    }, null, 2));
  }
}

/**
 * Creates a pending task/checklist pair.
 * @param {string} root - Temp project root.
 * @param {string} uuid - UUID suffix.
 * @param {{slug?: string, includePlanLine?: boolean}} [options]
 */
function createPendingPair(root, uuid, options = {}) {
  const slug = options.slug || PLAN_SLUG;
  const planLine = options.includePlanLine === false ? '' : `\n- 관련 계획: .qe/planning/plans/${slug}/ROADMAP.md\n`;
  write(join(root, '.qe', 'tasks', 'pending', `TASK_REQUEST_${uuid}.md`), `# Task ${uuid}\n${planLine}`);
  write(join(root, '.qe', 'checklists', 'pending', `VERIFY_CHECKLIST_${uuid}.md`), `# Verify ${uuid}\n`);
}

/**
 * Runs the real prompt-check hook with a JSON payload.
 * @param {string} cwd - Project root passed to the hook.
 * @param {string} message - User prompt.
 * @returns {{status: number|null, output: string, json: Record<string, unknown>|null, elapsedMs: number}}
 */
function runPromptCheck(cwd, message) {
  const started = Date.now();
  const proc = spawnSync(process.execPath, [PROMPT_CHECK], {
    cwd: REPO_ROOT,
    input: JSON.stringify({ cwd, user_message: message }),
    encoding: 'utf8',
    timeout: 5000,
  });
  const elapsedMs = Date.now() - started;
  const output = proc.stdout.trim();
  let json = null;
  try {
    json = output ? JSON.parse(output) : null;
  } catch {
    json = null;
  }
  return { status: proc.status, output, json, elapsedMs };
}

/**
 * Reads additionalContext from a prompt-check response.
 * @param {Record<string, unknown>|null} response - Parsed prompt-check JSON.
 * @returns {string}
 */
function additionalContext(response) {
  const hookOutput = response?.hookSpecificOutput;
  if (!hookOutput || typeof hookOutput !== 'object') return '';
  const context = hookOutput.additionalContext;
  return typeof context === 'string' ? context : '';
}

/**
 * Removes a temporary project tree.
 * @param {string} root - Temp project root.
 */
function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
expect(fixture.schema === 1, '[fixture] schema must be 1');
expect(Array.isArray(fixture.cases), '[fixture] cases must be an array');

{
  const root = tempProject();
  try {
    clearPlanResolverCache();
    const state = collectPseState(root, { changedFiles: { all: [] } });
    expect(state.kind === 'absent-qe', `[absent-qe] expected absent-qe, got ${state.kind}`);
    expect(resolvePseStateHint(root, { changedFiles: { all: [] } }).target === null, '[absent-qe] expected no target');
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    write(join(root, '.qe', 'planning', 'ACTIVE_PLAN'), '../bad\n');
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: [] } });
    expect(hint.kind === 'no-active-plan', `[malformed-active-plan] expected no-active-plan, got ${hint.kind}`);
    expect(hint.target === 'Qplan', `[malformed-active-plan] expected Qplan, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root, { sessionId: 's-1', staleSession: true });
    clearPlanResolverCache();
    const state = collectPseState(root, { sessionId: 's-1', changedFiles: { all: [] } });
    expect(state.activePlanSlug === PLAN_SLUG, `[stale-session] expected ACTIVE_PLAN fallback, got ${state.activePlanSlug}`);
    expect(state.kind === 'active-plan-no-pending-spec', `[stale-session] expected active-plan-no-pending-spec, got ${state.kind}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: [] } });
    expect(hint.kind === 'active-plan-no-pending-spec', `[active-plan] expected active-plan-no-pending-spec, got ${hint.kind}`);
    expect(hint.target === 'Qgs', `[active-plan] expected Qgs, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    createPendingPair(root, 'one');
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: [] } });
    expect(hint.kind === 'exactly-one-pending-spec', `[pending-one] expected exactly-one-pending-spec, got ${hint.kind}`);
    expect(hint.target === 'Qrun-task', `[pending-one] expected Qrun-task, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    createPendingPair(root, 'one');
    createPendingPair(root, 'two');
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: [] } });
    expect(hint.kind === 'multiple-pending-specs', `[pending-many] expected multiple-pending-specs, got ${hint.kind}`);
    expect(hint.target === null, `[pending-many] expected no target, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    createPendingPair(root, 'missing-line', { includePlanLine: false });
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: [] } });
    expect(hint.kind === 'active-plan-no-pending-spec', `[missing-plan-line] expected active-plan-no-pending-spec, got ${hint.kind}`);
    expect(hint.target === 'Qgs', `[missing-plan-line] expected Qgs, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: ['src/app.js'], gitAvailable: true } });
    expect(hint.kind === 'uncommitted-code', `[dirty] expected uncommitted-code, got ${hint.kind}`);
    expect(hint.target === 'Qcode-run-task', `[dirty] expected Qcode-run-task, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    write(
      join(root, '.qe', 'TASK_LOG.md'),
      [
        '| UUID | Summary | Status | Plan / Phase | Date |',
        '| --- | --- | --- | --- | --- |',
        '| old | Prior work | ✅ | qe-skill-routing / Phase 2 | 2026-07-01 |',
        `| current | State routing | 🔶 implementation complete / Qcode pending | ${PLAN_SLUG} / ${PHASE} | 2026-07-01 |`,
      ].join('\n'),
    );
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: ['src/app.js'], gitAvailable: true } });
    expect(hint.kind === 'uncommitted-code', `[task-log-pending] expected uncommitted-code, got ${hint.kind}`);
    expect(hint.target === 'Qcode-run-task', `[task-log-pending] expected Qcode-run-task, got ${hint.target}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root, { completed: true });
    createPendingPair(root, 'done');
    clearPlanResolverCache();
    const hint = resolvePseStateHint(root, { changedFiles: { all: ['src/app.js'], gitAvailable: true } });
    expect(hint.kind === 'completed-phase', `[completed] expected completed-phase, got ${hint.kind}`);
    expect(hint.target === 'Qplan', `[completed] expected Qplan, got ${hint.target}`);
    expect(hint.message.includes('Next Command:'), `[completed] expected Next Command hint, got ${hint.message}`);
    expect(hint.message.includes('Phase 4 - Release Polish'), `[completed] expected next roadmap phase, got ${hint.message}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    write(join(root, '.qe', 'planning', 'ROADMAP.md'), '# Legacy\n');
    write(join(root, '.qe', 'planning', 'STATE.md'), `# STATE\n\nActive Phase: ${PHASE}\n`);
    clearPlanResolverCache();
    const state = collectPseState(root, { changedFiles: { all: [] } });
    expect(String(state.statePath || '').endsWith('.qe/planning/STATE.md'), `[legacy-flat] expected flat state path, got ${state.statePath}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    clearPlanResolverCache();
    const result = runPromptCheck(root, 'What should I do next?');
    const context = additionalContext(result.json);
    expect(result.status === 0, `[prompt-subprocess] expected exit 0, got ${result.status}`);
    expect(context.includes('[PSE]'), `[prompt-subprocess] expected PSE context, got ${context}`);
    expect(context.includes('Qgs'), `[prompt-subprocess] expected Qgs hint, got ${context}`);
    expect(context.includes('Next Command:'), `[prompt-subprocess] expected Next Command hint, got ${context}`);
    expect(!context.includes('SKILL REQUIRED'), `[prompt-subprocess] state hint must not be hard required, got ${context}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    clearPlanResolverCache();
    const result = runPromptCheck(root, '$Qcommit');
    const context = additionalContext(result.json);
    expect(!context.includes('[PSE]'), `[explicit] expected PSE suppression, got ${context}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    clearPlanResolverCache();
    const result = runPromptCheck(root, 'What is the weather today?');
    const context = additionalContext(result.json);
    expect(!context.includes('[PSE]'), `[no-route-question] expected PSE suppression, got ${context}`);
    expect(!context.includes('SKILL REQUIRED'), `[no-route-question] expected no hard route, got ${context}`);
  } finally {
    cleanup(root);
  }
}

{
  const root = tempProject();
  try {
    createPlan(root);
    clearPlanResolverCache();
    for (const message of ['다음 작업 뭐야?', '계속하려면 무엇을 해야 해?', '다음 QE 단계 알려줘', '다음 Phase도 있나?']) {
      const result = runPromptCheck(root, message);
      const context = additionalContext(result.json);
      latencySamples.push(result.elapsedMs);
      expect(result.status === 0, `[cjk-latency] expected exit 0 for ${message}, got ${result.status}`);
      expect(context.includes('[PSE]'), `[cjk-next] expected PSE hint for ${message}, got ${context}`);
      expect(context.includes('Next Command:'), `[cjk-next] expected Next Command hint for ${message}, got ${context}`);
    }
  } finally {
    cleanup(root);
  }
}

{
  const routes = JSON.parse(readFileSync(ROUTES_PATH, 'utf8'));
  const deepRoute = Object.entries(routes.routes).find(([keywords]) => keywords.includes('deep-research'));
  expect(Boolean(deepRoute), '[wrapper-policy] expected deep-research route entry');
  expect(deepRoute?.[1] === 'Edeep-researcher', `[wrapper-policy] expected direct Edeep-researcher, got ${deepRoute?.[1]}`);
  expect(!Object.values(routes.routes).includes('Qdeepresearch'), '[wrapper-policy] Qdeepresearch wrapper route must not be forced in Phase 3');
}

if (latencySamples.length > 0) {
  const sorted = [...latencySamples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)];
  const p95 = sorted[Math.ceil((sorted.length - 1) * 0.95)];
  if (p95 > 1200) warn(`[latency] CJK prompt-check p50=${p50}ms p95=${p95}ms exceeds 1200ms soft budget`);
  else console.log(`check-skill-routing-state: CJK latency p50=${p50}ms p95=${p95}ms`);
}

if (failures.length > 0) {
  console.error('check-skill-routing-state: FAIL');
  for (const warning of warnings) console.error(`  ! ${warning}`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

for (const warning of warnings) console.log(`check-skill-routing-state: WARN ${warning}`);
console.log('check-skill-routing-state: PASS (state helper, prompt-check subprocess, wrapper fallback policy)');
