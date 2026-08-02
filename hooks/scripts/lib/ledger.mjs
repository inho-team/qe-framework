#!/usr/bin/env node
'use strict';

/**
 * lib/ledger.mjs — ultragoal-style append-only goal ledger for Named Plans.
 *
 * Phase 1 (Qplan-owned). Brings the durable half of oh-my-claudecode's
 * `ultragoal` into QE: an ordered microgoal list (`goals.json`) plus an
 * append-only audit trail (`ledger.jsonl`) under `.qe/planning/plans/{slug}/`.
 * `STATE.md`'s progress block is *derived* from these, not hand-maintained.
 *
 * Design (efficiency is a P0 requirement here):
 *   - goals.json write  → state.mjs `atomicWriteJson` (temp+rename, no corruption)
 *   - ledger append     → trace-logger idiom `appendFileSync(line + '\n')` — O(1),
 *                         never rewrites existing lines.
 *   - status read       → bounded tail read (last ~8KB), never loads whole file.
 *   - slug layout       → mirrors plan-resolver; zero new external deps.
 *
 * CLI:
 *   node ledger.mjs create-goals --slug S [--goal "Title::Objective" ...]
 *   node ledger.mjs append --slug S --goal-id G001 --event checkpoint --status complete [--evidence "..."]
 *   node ledger.mjs set-acceptance --slug S --goal-id G001 --file contract.json
 *   node ledger.mjs run-evidence --slug S --goal-id G001 --role implementation|verification [--verifier NAME]
 *   node ledger.mjs record-evidence --slug S --goal-id G001 --file evidence.json
 *   node ledger.mjs render-state --slug S
 *   node ledger.mjs status --slug S
 */

import { appendFileSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, openSync, readSync, closeSync, fstatSync } from './qe-fs.mjs';
import { join } from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { atomicWriteJson } from './state.mjs';
import { resolveActivePlanSlug } from './plan-resolver.mjs';
import { readCurrentSessionId } from './session-resolver.mjs';
import { writeVerifiedGoalKnowledge } from './plan-knowledge.mjs';
import { isAllowlistCommand, isBehavioralEvidenceCommand } from './verification-evidence-gate.mjs';

const PLANS_DIR = '.qe/planning/plans';
const STATUS_ENUM = ['pending', 'active', 'complete', 'failed', 'blocked'];
// 'measurement' added for phase-report measured-evidence sourcing; all other values unchanged.
const EVENT_ENUM = ['created', 'started', 'checkpoint', 'blocker', 'failed', 'measurement', 'verified'];
const PROGRESS_HEADING = '## Phase Progress';
const STATUS_TAIL_BYTES = 8192;

// ── paths ────────────────────────────────────────────────────────────────
function normalizeSlug(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s) ? s : null;
}
/** Absolute path to a plan's directory under `.qe/planning/plans/`. */
function planDir(cwd, slug) { return join(cwd, PLANS_DIR, slug); }
/** Path to the plan's `goals.json`. */
function goalsPath(cwd, slug) { return join(planDir(cwd, slug), 'goals.json'); }
/** Path to the plan's append-only `ledger.jsonl`. */
function ledgerPath(cwd, slug) { return join(planDir(cwd, slug), 'ledger.jsonl'); }
/** Path to the plan's `ROADMAP.md` (source of microgoals). */
function roadmapPath(cwd, slug) { return join(planDir(cwd, slug), 'ROADMAP.md'); }
/** Path to the plan's `STATE.md` (derived progress view). */
function statePath(cwd, slug) { return join(planDir(cwd, slug), 'STATE.md'); }
/** Path to the plan's `REQUIREMENTS.md`. */
function requirementsPath(cwd, slug) { return join(planDir(cwd, slug), 'REQUIREMENTS.md'); }
/** Path to the plan's `DECISION_LOG.md`. */
function decisionLogPath(cwd, slug) { return join(planDir(cwd, slug), 'DECISION_LOG.md'); }
/** Directory holding per-goal acceptance contracts and completion evidence. */
function evidenceDir(cwd, slug) { return join(planDir(cwd, slug), 'evidence'); }
function acceptancePath(cwd, slug, goalId) { return join(evidenceDir(cwd, slug), `${goalId}.acceptance.json`); }
function completionEvidencePath(cwd, slug, goalId) { return join(evidenceDir(cwd, slug), `${goalId}.completion.json`); }
function runEvidencePath(cwd, slug, goalId, role) { return join(evidenceDir(cwd, slug), `${goalId}.${role}-run.json`); }
/** Path for a phase report file (reports/ subdir under plan). */
function reportPath(cwd, slug, phaseNum) { return join(planDir(cwd, slug), 'reports', `PHASE_${phaseNum}_REPORT.md`); }
/** Current time as an ISO-8601 string (ledger event timestamp). */
function nowIso() { return new Date().toISOString(); }

// ── io primitives ────────────────────────────────────────────────────────
export function readGoals(cwd, slug) {
  const p = goalsPath(cwd, slug);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Atomically persist the goals doc (temp+rename via state.mjs). */
function writeGoals(cwd, slug, doc) {
  const dir = planDir(cwd, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteJson(goalsPath(cwd, slug), doc); // temp+rename
}

/** Append one event line. O(1) — never reads or rewrites existing lines. */
export function recordEvent(cwd, slug, event) {
  const dir = planDir(cwd, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(ledgerPath(cwd, slug), JSON.stringify(event) + '\n', 'utf8');
}

/** Bounded tail read of ledger.jsonl — reads at most STATUS_TAIL_BYTES. */
export function tailLedger(cwd, slug, maxLines = 5) {
  const p = ledgerPath(cwd, slug);
  if (!existsSync(p)) return [];
  let fd;
  try {
    fd = openSync(p, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, STATUS_TAIL_BYTES);
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, size - len);
    let parts = buf.toString('utf8').split('\n');
    // A truncated read may begin mid-line — and mid-UTF-8-codepoint, which
    // matters for non-ASCII (e.g. Korean) evidence. That leading fragment is
    // never a whole event, so drop it before parsing.
    if (len < size) parts = parts.slice(1);
    return parts.filter(Boolean)
      .slice(-maxLines)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ── ROADMAP → microgoals ───────────────────────────────────────────────────
/**
 * Parse bullets that live under a `### Wave …` heading inside the active
 * Phase as microgoals. Restricting to Wave bullets keeps tables/prose out.
 */
function parseRoadmapGoals(cwd, slug) {
  const rp = roadmapPath(cwd, slug);
  if (!existsSync(rp)) return [];
  const lines = readFileSync(rp, 'utf8').split('\n');
  const goals = [];
  let phase = null, wave = null, n = 0;
  for (const line of lines) {
    const ph = line.match(/^##\s+(Phase\s+[\d.]+[^\n]*)/i);
    if (ph) { phase = ph[1].trim(); wave = null; continue; }
    if (/^##\s+/.test(line) && !/^##\s+Phase/i.test(line)) { phase = null; wave = null; continue; }
    const wv = line.match(/^###\s+(Wave[^\n]*)/i);
    if (wv) { wave = wv[1].trim(); continue; }
    const bul = line.match(/^\s*[-*]\s+(.+)$/);
    if (bul && phase && wave) {
      n += 1;
      const title = bul[1].replace(/`/g, '').replace(/\s+/g, ' ').slice(0, 120).trim();
      goals.push({ id: `G${String(n).padStart(3, '0')}`, title, objective: title,
        status: 'pending', attempts: 0, phase, wave });
    }
  }
  return goals;
}

// ── commands ───────────────────────────────────────────────────────────────
/**
 * Initialize goals.json + ledger.jsonl for a plan. Idempotent: if goals.json
 * already exists it is preserved (re-running Qplan must not wipe history).
 */
export function createGoals(cwd, slug, explicitGoals = []) {
  if (readGoals(cwd, slug)) return { skipped: true, reason: 'goals.json exists' };

  let goals = explicitGoals.map((g, i) => {
    const [title, objective] = String(g).split('::');
    return { id: `G${String(i + 1).padStart(3, '0')}`, title: (title || g).trim(),
      objective: (objective || title || g).trim(), status: 'pending', attempts: 0,
      phase: 'Phase 1', wave: '-' };
  });
  if (goals.length === 0) goals = parseRoadmapGoals(cwd, slug);

  const doc = { planSlug: slug, schema: 1, createdAt: nowIso(), goals };
  writeGoals(cwd, slug, doc);
  for (const g of goals) {
    recordEvent(cwd, slug, { ts: nowIso(), event: 'created', goalId: g.id, status: 'pending', evidence: '', attempt: 0 });
  }
  return { created: goals.length };
}

/**
 * Append a lifecycle event and update only the affected goal's status/attempts.
 * Fail-closed enforcement (only-active-mutable) is Phase 2 (Qgenerate-spec); Phase 1
 * keeps the primitive permissive but records every transition.
 */
export function append(cwd, slug, { goalId, event, status, evidence = '', allowComplete = false }) {
  if (!EVENT_ENUM.includes(event)) throw new Error(`invalid event: ${event}`);
  if (status && !STATUS_ENUM.includes(status)) throw new Error(`invalid status: ${status}`);
  if (status === 'complete' && !allowComplete) throw new Error('Goal completion must use advance --action complete');
  const doc = readGoals(cwd, slug);
  if (!doc) throw new Error(`no goals.json for slug ${slug}`);
  const goal = doc.goals.find(g => g.id === goalId);
  if (!goal) throw new Error(`unknown goalId: ${goalId}`);

  if (event === 'started') goal.attempts += 1;
  if (status) goal.status = status;
  writeGoals(cwd, slug, doc); // atomic; only the mutated object changed in-memory
  recordEvent(cwd, slug, { ts: nowIso(), event, goalId, status: status || goal.status, evidence, attempt: goal.attempts });
  return { goalId, status: goal.status, attempts: goal.attempts };
}

function readJsonFile(file, label) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${label} must be readable JSON`); }
}

function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
function contractHash(contract) { return createHash('sha256').update(JSON.stringify(contract)).digest('hex'); }

const RISK_CATEGORIES = new Set([
  'none', 'authentication', 'authorization', 'payment', 'deployment',
  'data-migration', 'destructive-data-change', 'external-integration', 'security',
]);

const RISK_SIGNALS = [
  ['authentication', /\bauth(?:entication)?\b|로그인|인증/iu],
  ['authorization', /\bauthori[sz]ation\b|\bpermission(?:s)?\b|권한/iu],
  ['payment', /\bpayment(?:s)?\b|\bbilling\b|결제/iu],
  ['deployment', /\bdeploy(?:ment)?\b|\brelease\b|배포|릴리스/iu],
  ['data-migration', /\bmigrat(?:e|ion)\b|\bschema\b|\bdatabase\b|\bdb\b|마이그레이션|스키마|데이터베이스/iu],
  ['destructive-data-change', /\bdelete\b|\bpurge\b|\bdrop\b|삭제|파기/iu],
  ['external-integration', /\bexternal\s+api\b|\bthird[- ]party\b|외부\s*(?:api|연동)|서드파티/iu],
  ['security', /\bsecurity\b|\bencrypt(?:ion)?\b|보안|암호화/iu],
];

const MAX_GOAL_REQUIREMENTS = 3;
const MAX_GOAL_SCENARIOS = 2;
const MAX_GOAL_PATHS = 5;
const CODE_PATH_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte)$/iu;
const MACHINE_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GOAL_COMMAND_TIMEOUT_MS = 120_000;

function normalizedText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

function contractTouchesCode(contract) {
  return contract.goalShape.allowedPaths.some(path => CODE_PATH_RE.test(path));
}

function contractHasBehavioralEvidence(contract) {
  return [...contract.requirements, ...contract.scenarios, contract.regression]
    .some(item => isBehavioralEvidenceCommand(item.command));
}

function requiredRiskCategories(goalObjective) {
  return RISK_SIGNALS
    .filter(([, pattern]) => pattern.test(String(goalObjective ?? '')))
    .map(([category]) => category);
}

function idsAreUnique(items) {
  const ids = items.map(item => item?.id);
  return ids.every(nonEmpty) && new Set(ids).size === ids.length;
}

function isBoundedPath(value) {
  return typeof value === 'string' && value.length <= 180 && value.trim() !== '' &&
    !value.startsWith('/') && !value.includes('..') && !/[\\*]/.test(value);
}

/**
 * A Goal is deliberately smaller than a Phase: one observable outcome, a
 * bounded write surface, and explicit non-goals prevent a broad request from
 * being certified by a shallow set of tests.
 */
function validateGoalShape(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) throw new Error('acceptance contract requires goalShape');
  if (!nonEmpty(shape.primaryOutcome) || !nonEmpty(shape.completionMetric)) {
    throw new Error('goalShape requires one primaryOutcome and one completionMetric');
  }
  if (!Array.isArray(shape.allowedPaths) || shape.allowedPaths.length === 0 || shape.allowedPaths.length > MAX_GOAL_PATHS ||
      !shape.allowedPaths.every(isBoundedPath) || new Set(shape.allowedPaths).size !== shape.allowedPaths.length) {
    throw new Error(`goalShape allowedPaths must contain 1-${MAX_GOAL_PATHS} unique relative paths without globs`);
  }
  if (!Array.isArray(shape.nonGoals) || shape.nonGoals.length === 0 || !shape.nonGoals.every(nonEmpty)) {
    throw new Error('goalShape requires at least one explicit nonGoal');
  }
  if (!Array.isArray(shape.dependencies) || !shape.dependencies.every(nonEmpty)) {
    throw new Error('goalShape dependencies must be an array of non-empty Goal IDs or []');
  }
  return shape;
}

/**
 * Validate the contract written before a Goal starts.  It deliberately names
 * scenarios and requirements separately: a passing test alone must not become
 * a retroactive definition of user value.
 */
function validateAcceptanceContract(contract, goalId, goalObjective = '') {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('acceptance contract must be an object');
  if (contract.schema !== 1 || contract.goalId !== goalId) throw new Error(`acceptance contract must declare schema: 1 and goalId: ${goalId}`);
  validateGoalShape(contract.goalShape);
  if (!Array.isArray(contract.requirements) || contract.requirements.length === 0 || !idsAreUnique(contract.requirements) ||
      !contract.requirements.every(item => nonEmpty(item.criterion) && isGoalRunnerCommand(item.command))) throw new Error('acceptance contract requires uniquely identified requirements with criteria and runnable commands');
  if (contract.requirements.length > MAX_GOAL_REQUIREMENTS) throw new Error(`acceptance contract allows at most ${MAX_GOAL_REQUIREMENTS} requirements; split broad work into Goals`);
  if (!Array.isArray(contract.scenarios) || contract.scenarios.length === 0 || !idsAreUnique(contract.scenarios) ||
      !contract.scenarios.every(item => item.kind === 'user-journey' && nonEmpty(item.scenario) && nonEmpty(item.expected) && isGoalRunnerCommand(item.command))) throw new Error('acceptance contract requires uniquely identified user-journey scenarios with expected results and runnable commands');
  if (contract.scenarios.length > MAX_GOAL_SCENARIOS) throw new Error(`acceptance contract allows at most ${MAX_GOAL_SCENARIOS} user journeys; split broad work into Goals`);
  if (!contract.regression || !nonEmpty(contract.regression.scope) || !isGoalRunnerCommand(contract.regression.command)) throw new Error('acceptance contract requires regression scope and runnable command');
  if (contractTouchesCode(contract) && !contractHasBehavioralEvidence(contract)) {
    throw new Error('code-changing Goal acceptance requires at least one behavioral node --test command');
  }
  if (!contract.humanAcceptance || typeof contract.humanAcceptance.required !== 'boolean') throw new Error('acceptance contract requires humanAcceptance.required');
  if (!contract.goalAlignment || normalizedText(contract.goalAlignment.objective) !== normalizedText(goalObjective) || !nonEmpty(contract.goalAlignment.rationale)) {
    throw new Error('acceptance contract must preserve the Goal objective verbatim and explain requirement/scenario coverage');
  }
  const risk = contract.riskAssessment;
  if (!risk || !Array.isArray(risk.categories) || risk.categories.length === 0 || !new Set(risk.categories).size ||
      !risk.categories.every(category => RISK_CATEGORIES.has(category)) ||
      (risk.categories.includes('none') && risk.categories.length !== 1) || !nonEmpty(risk.rationale)) {
    throw new Error('acceptance contract requires a valid risk assessment with categories and rationale');
  }
  const requiredRisks = requiredRiskCategories(goalObjective);
  if (requiredRisks.some(category => !risk.categories.includes(category))) {
    throw new Error(`acceptance contract risk assessment omits detected Goal risk: ${requiredRisks.filter(category => !risk.categories.includes(category)).join(', ')}`);
  }
  if (risk.categories.some(category => category !== 'none') && !contract.humanAcceptance.required) {
    throw new Error('risk-bearing Goals require humanAcceptance.required: true');
  }
  return contract;
}

function isGoalRunnerCommand(command) {
  return typeof command === 'string' && !/^\s*cd\s/i.test(command) && isAllowlistCommand(command);
}

function commandResult(cwd, command) {
  const parts = command.trim().split(/\s+/);
  const result = spawnSync(parts[0], parts.slice(1), { cwd, encoding: 'utf8', timeout: GOAL_COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return { command, exitCode: Number.isInteger(result.status) ? result.status : null, signal: result.signal || null,
    passed: !result.error && result.status === 0, outputHash: createHash('sha256').update(output).digest('hex'), executedAt: nowIso() };
}

/** Execute every locked Goal command and persist machine-collected evidence. */
export function runGoalEvidence(cwd, slug, { goalId, role, verifier = '', sessionId: explicitSessionId = '' }) {
  if (!['implementation', 'verification'].includes(role)) throw new Error('run role must be implementation or verification');
  if (role === 'verification' && !nonEmpty(verifier)) throw new Error('verification run requires a verifier identity');
  const doc = readGoals(cwd, slug);
  const goal = doc?.goals?.find(item => item.id === goalId);
  if (!goal || goal.status !== 'active') throw new Error('evidence runs require the active Goal');
  const sessionId = explicitSessionId || readCurrentSessionId(cwd);
  if (!sessionId) throw new Error('machine evidence run requires a current QE session id');
  if (!MACHINE_SESSION_RE.test(sessionId)) throw new Error('machine evidence run requires a valid full QE session id');
  const contract = validateAcceptanceContract(readJsonFile(acceptancePath(cwd, slug, goalId), 'acceptance contract'), goalId, goal.objective);
  if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
  const commands = [...contract.requirements, ...contract.scenarios, contract.regression]
    .map(item => item.command).filter((value, index, values) => values.indexOf(value) === index);
  const runs = commands.map(command => commandResult(cwd, command));
  const record = { schema: 1, goalId, role, sessionId, verifier: role === 'verification' ? verifier : null, contractHash: goal.acceptance.hash, runs, passed: runs.every(run => run.passed), executedAt: nowIso() };
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  atomicWriteJson(runEvidencePath(cwd, slug, goalId, role), record);
  recordEvent(cwd, slug, { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `${role}-run=${join('evidence', `${goalId}.${role}-run.json`)}; passed=${record.passed}`, attempt: goal.attempts });
  return { goalId, role, passed: record.passed, runs };
}

function requirePassingRuns(cwd, slug, goal, goalId) {
  let implementationSession = null;
  for (const role of ['implementation', 'verification']) {
    const file = runEvidencePath(cwd, slug, goalId, role);
    if (!existsSync(file)) throw new Error(`verified completion requires a ${role} machine evidence run`);
    const run = readJsonFile(file, `${role} evidence run`);
    if (run.schema !== 1 || run.goalId !== goalId || run.role !== role || !nonEmpty(run.sessionId) || run.contractHash !== goal.acceptance?.hash || run.passed !== true || !Array.isArray(run.runs) || run.runs.length === 0 || !run.runs.every(item => item.passed === true && nonEmpty(item.outputHash))) {
      throw new Error(`${role} machine evidence run is missing, stale, or failed`);
    }
    if (role === 'implementation') implementationSession = run.sessionId;
    if (role === 'verification' && (!nonEmpty(run.verifier) || run.sessionId === implementationSession)) throw new Error('verification evidence must come from a distinct QE session with a verifier identity');
  }
}

function evidenceCovers(contractItems, evidenceItems, label) {
  if (!Array.isArray(evidenceItems) || !idsAreUnique(evidenceItems)) throw new Error(`completion evidence requires uniquely identified ${label}`);
  const byId = new Map(evidenceItems.map(item => [item.id, item]));
  for (const item of contractItems) {
    const result = byId.get(item.id);
    if (!result || result.outcome !== 'pass' || !nonEmpty(result.evidence)) throw new Error(`completion evidence does not pass ${label} ${item.id}`);
  }
}

/** Validate a completion record against the pre-existing acceptance contract. */
function validateCompletionEvidence(evidence, contract, goalId, goalObjective = '') {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('completion evidence must be an object');
  if (evidence.schema !== 1 || evidence.goalId !== goalId) throw new Error(`completion evidence must declare schema: 1 and goalId: ${goalId}`);
  evidenceCovers(contract.requirements, evidence.requirements, 'requirements');
  evidenceCovers(contract.scenarios, evidence.scenarios, 'scenarios');
  if (!evidence.regression || evidence.regression.outcome !== 'pass' || !nonEmpty(evidence.regression.evidence)) throw new Error('completion evidence requires a passing regression result');
  const independent = evidence.independentVerification;
  if (!independent || !nonEmpty(independent.verifier) || independent.mode !== 'machine-reexecution' ||
      independent.outcome !== 'pass' || !nonEmpty(independent.evidence)) throw new Error('completion evidence requires passing independent verification');
  const alignment = evidence.goalAlignment;
  if (!alignment || alignment.outcome !== 'pass' || normalizedText(alignment.objective) !== normalizedText(goalObjective) ||
      alignment.verifier !== independent.verifier || !nonEmpty(alignment.evidence)) {
    throw new Error('completion evidence requires the independent verifier to pass Goal-to-evidence alignment');
  }
  const human = evidence.humanAcceptance;
  if (!human || (contract.humanAcceptance.required ? human.status !== 'passed' || !nonEmpty(human.evidence) : human.status !== 'not-required' && human.status !== 'passed')) {
    throw new Error('completion evidence does not satisfy human acceptance requirement');
  }
  if (!Array.isArray(evidence.limitations)) throw new Error('completion evidence requires limitations array (use [] when none)');
  return evidence;
}

/** Persist a pre-execution, user-outcome-oriented acceptance contract for a pending Goal. */
export function setGoalAcceptance(cwd, slug, { goalId, file }) {
  const doc = readGoals(cwd, slug);
  const goal = doc?.goals?.find(item => item.id === goalId);
  if (!goal) throw new Error(`unknown goalId: ${goalId}`);
  if (goal.status !== 'pending') throw new Error('acceptance contract can only be set before a Goal starts');
  const contract = validateAcceptanceContract(readJsonFile(file, 'acceptance contract'), goalId, goal.objective);
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  atomicWriteJson(acceptancePath(cwd, slug, goalId), contract);
  goal.acceptance = { status: 'defined', file: join('evidence', `${goalId}.acceptance.json`), hash: contractHash(contract) };
  writeGoals(cwd, slug, doc);
  recordEvent(cwd, slug, { ts: nowIso(), event: 'checkpoint', goalId, status: goal.status, evidence: `acceptance=${goal.acceptance.file}`, attempt: goal.attempts });
  return { goalId, acceptance: goal.acceptance };
}

/** Persist evidence only when it satisfies the Goal's immutable acceptance contract. */
export function recordGoalEvidence(cwd, slug, { goalId, file }) {
  const doc = readGoals(cwd, slug);
  const goal = doc?.goals?.find(item => item.id === goalId);
  if (!goal) throw new Error(`unknown goalId: ${goalId}`);
  if (goal.status !== 'active') throw new Error('completion evidence can only be recorded for the active Goal');
  const contractFile = acceptancePath(cwd, slug, goalId);
  if (!existsSync(contractFile)) throw new Error('Goal has no acceptance contract');
  const contract = validateAcceptanceContract(readJsonFile(contractFile, 'acceptance contract'), goalId, goal.objective);
  if (!goal.acceptance?.hash || goal.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
  const evidence = validateCompletionEvidence(readJsonFile(file, 'completion evidence'), contract, goalId, goal.objective);
  requirePassingRuns(cwd, slug, goal, goalId);
  if (!existsSync(evidenceDir(cwd, slug))) mkdirSync(evidenceDir(cwd, slug), { recursive: true });
  atomicWriteJson(completionEvidencePath(cwd, slug, goalId), evidence);
  goal.completionEvidence = { status: 'recorded', file: join('evidence', `${goalId}.completion.json`) };
  writeGoals(cwd, slug, doc);
  recordEvent(cwd, slug, { ts: nowIso(), event: 'measurement', goalId, status: 'active', evidence: `completion=${goal.completionEvidence.file}; verifier=${evidence.independentVerification.verifier}`, attempt: goal.attempts });
  return { goalId, completionEvidence: goal.completionEvidence };
}

/**
 * Advance the Plan-owned Goal queue by one safe lifecycle action.
 *
 * `next` starts the first pending Goal only when no Goal is active or blocked.
 * `complete` requires evidence for the sole active Goal and writes a reviewed,
 * provenance-linked knowledge page. This is the only normal write-back path.
 */
export function advanceGoal(cwd, slug, { action = 'next', evidence = '' } = {}) {
  const doc = readGoals(cwd, slug);
  if (!doc || !Array.isArray(doc.goals)) throw new Error(`no goals.json for slug ${slug}`);
  const active = doc.goals.find((goal) => goal.status === 'active');
  const blocked = doc.goals.find((goal) => goal.status === 'blocked');

  if (action === 'next') {
    if (active) return { action: 'continue', goal: { id: active.id, title: active.title } };
    if (blocked) return { action: 'blocked', goal: { id: blocked.id, title: blocked.title } };
    const next = doc.goals.find((goal) => goal.status === 'pending');
    if (!next) return { action: 'complete', total: doc.goals.length };
    if (!existsSync(acceptancePath(cwd, slug, next.id))) {
      return { action: 'needs-acceptance', goal: { id: next.id, title: next.title }, reason: 'Define user scenarios, requirement criteria, regression command, and human-acceptance need before starting.' };
    }
    const contract = validateAcceptanceContract(readJsonFile(acceptancePath(cwd, slug, next.id), 'acceptance contract'), next.id, next.objective);
    if (!next.acceptance?.hash || next.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
    const result = append(cwd, slug, { goalId: next.id, event: 'started', status: 'active' });
    renderState(cwd, slug);
    return { action: 'started', goal: { id: next.id, title: next.title }, attempts: result.attempts };
  }

  if (action === 'complete') {
    if (!active) throw new Error('no active goal to complete');
    const evidenceFile = completionEvidencePath(cwd, slug, active.id);
    if (!existsSync(evidenceFile)) throw new Error('verified completion requires recorded acceptance, regression, and independent-verification evidence');
    const contract = validateAcceptanceContract(readJsonFile(acceptancePath(cwd, slug, active.id), 'acceptance contract'), active.id, active.objective);
    if (!active.acceptance?.hash || active.acceptance.hash !== contractHash(contract)) throw new Error('acceptance contract changed after it was recorded');
    const proof = validateCompletionEvidence(readJsonFile(evidenceFile, 'completion evidence'), contract, active.id, active.objective);
    requirePassingRuns(cwd, slug, active, active.id);
    append(cwd, slug, { goalId: active.id, event: 'verified', status: 'complete', evidence: `completion=${join('evidence', `${active.id}.completion.json`)}`, allowComplete: true });
    const knowledge = writeVerifiedGoalKnowledge(cwd, { slug, goal: active, evidence: JSON.stringify(proof) });
    renderState(cwd, slug);
    return { action: 'completed', goal: { id: active.id, title: active.title }, knowledge };
  }

  if (action === 'block') {
    if (!active) throw new Error('no active goal to block');
    const reason = String(evidence || '').trim();
    if (!reason) throw new Error('blocking a goal requires evidence');
    append(cwd, slug, { goalId: active.id, event: 'blocker', status: 'blocked', evidence: reason });
    renderState(cwd, slug);
    return { action: 'blocked', goal: { id: active.id, title: active.title } };
  }

  throw new Error(`invalid advance action: ${action}`);
}

/** Render STATE.md's "## Phase Progress" block from goals.json (derived view). */
export function renderState(cwd, slug) {
  const doc = readGoals(cwd, slug);
  if (!doc) throw new Error(`no goals.json for slug ${slug}`);
  const mark = { pending: ' ', active: '>', complete: 'x', failed: '!', blocked: '~' };
  const byPhase = new Map();
  for (const g of doc.goals) {
    if (!byPhase.has(g.phase)) byPhase.set(g.phase, []);
    byPhase.get(g.phase).push(g);
  }
  let block = `${PROGRESS_HEADING}\n\n> 자동 생성 (ledger.mjs render-state) — 직접 수정 금지\n`;
  for (const [phase, goals] of byPhase) {
    block += `\n### ${phase}\n`;
    for (const g of goals) {
      const w = g.wave && g.wave !== '-' ? `[${g.wave}] ` : '';
      block += `- [${mark[g.status] || ' '}] ${g.id} ${w}${g.title}\n`;
    }
  }

  const sp = statePath(cwd, slug);
  const prior = existsSync(sp) ? readFileSync(sp, 'utf8') : `# STATE — ${slug}\n`;
  let next;
  const idx = prior.indexOf(PROGRESS_HEADING);
  if (idx === -1) {
    next = prior.replace(/\n*$/, '\n') + '\n' + block;
  } else {
    const after = prior.slice(idx + PROGRESS_HEADING.length);
    const nextHeading = after.search(/\n##\s/);
    const tail = nextHeading === -1 ? '' : after.slice(nextHeading);
    next = prior.slice(0, idx) + block.replace(/\n*$/, '\n') + tail;
  }
  atomicWriteText(sp, next); // STATE.md is markdown, not JSON — own temp+rename
  return { state: sp, phases: byPhase.size };
}

/** Atomic temp+rename write for a text file (markdown STATE.md). */
function atomicWriteText(dest, content) {
  const tmp = dest + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, dest);
}

/** Compact current-status summary using only a bounded tail read. */
export function status(cwd, slug) {
  const doc = readGoals(cwd, slug);
  if (!doc) return { slug, exists: false };
  const counts = doc.goals.reduce((a, g) => (a[g.status] = (a[g.status] || 0) + 1, a), {});
  const active = doc.goals.find(g => g.status === 'active') || doc.goals.find(g => g.status === 'pending');
  return { slug, total: doc.goals.length, counts, active: active ? { id: active.id, title: active.title } : null,
    recent: tailLedger(cwd, slug, 3) };
}

// ── phase-report internals ───────────────────────────────────────────────

/**
 * Unit normalization table for measured evidence and DoD target comparison.
 * '회' (times/회) → treated as unitless integer.
 * 'k' multiplier → ×1000. 'M' multiplier → ×1000000.
 * Returns { value: number, unit: string } or null if ambiguous/unknown.
 * @param {string} numStr  raw number string (may include unit suffix)
 */
function normalizeUnit(numStr) {
  // Case-SENSITIVE units: a lowercase 'm' must never be read as the M (mega)
  // multiplier — "200m"/"200ms" style prose would silently become ×1,000,000
  // and enable a false `met` against an M-suffixed measurement.
  const m = String(numStr).trim().match(/^(\d+(?:\.\d+)?)(회|k|M)?$/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const suffix = m[2] || '';
  if (suffix === 'k') return { value: base * 1000, unit: 'k' };
  if (suffix === 'M') return { value: base * 1_000_000, unit: 'M' };
  // '회' and no suffix are both unitless — treat identically
  return { value: base, unit: '' };
}

/**
 * Extract a single numeric target from a DoD string.
 * Conservative contract: returns { comparator, value, unit } ONLY when exactly
 * one isolated <comparator><number>[unit] token exists (comparator ∈ ≤<≥>=).
 * Ranges (7~8), arrow multi-values (→ or ->), multiple numbers, baseline noise
 * (e.g. "981k/4.97M") → returns null (unmeasurable).
 * First-number grab is forbidden: returns null unless the single-token rule holds.
 * @param {string} text DoD text
 * @returns {{ comparator: string, value: number, unit: string }|null}
 */
function extractNumericTarget(text) {
  // Reject ranges (N~M) and arrow multi-values (N→M or N->M)
  if (/\d+\s*[~～]\s*\d+/.test(text)) return null;
  if (/\d+\s*(?:→|->)\s*\d+/.test(text)) return null;
  // Reject slash-separated multi-numbers (baseline noise like 981k/4.97M)
  if (/\d+(?:k|M)?\s*\/\s*\d+(?:k|M)?/i.test(text)) return null;

  // Find all comparator+number[unit] tokens (optional space between comparator
  // and number). ASCII digraphs <= / >= must match BEFORE < > = or they would
  // mis-parse as bare '=' (false strict-equality verdicts). The trailing
  // lookahead mirrors the measured-side boundary: "<= 200ms" must NOT parse
  // its 'm' as the mega multiplier (nor 200 as unitless) — ASCII alnum after
  // the token makes it ambiguous prose → unmeasurable. Case-sensitive units.
  const tokens = [...text.matchAll(/(≤|≥|<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)(회|k|M)?(?![A-Za-z0-9])/g)];
  if (tokens.length !== 1) return null; // zero → no target, multiple → ambiguous

  // Isolation guard (spec: "복수 숫자 → unmeasurable"): the comparator token's
  // number must be the ONLY standalone number in the DoD. An extra bare number
  // ("≤ 4 per cycle over 10 runs") makes the target ambiguous — sample sizes /
  // baseline noise must not ride along. Digits embedded in identifiers (R001)
  // or decimals are not counted as separate numbers.
  const standaloneNumbers = [...text.matchAll(/(?<![A-Za-z0-9.])\d+(?:\.\d+)?/g)];
  if (standaloneNumbers.length !== 1) return null;

  const [, comp, num, unitRaw] = tokens[0];
  const n = normalizeUnit(num + (unitRaw || ''));
  if (!n) return null;
  return { comparator: comp, value: n.value, unit: n.unit };
}

/**
 * Evaluate whether a measured value satisfies a numeric target comparator.
 * @param {string} comparator  one of ≤ < ≥ > =
 * @param {number} target
 * @param {number} measured
 * @returns {boolean}
 */
function comparatorSatisfied(comparator, target, measured) {
  if (comparator === '≤' || comparator === '<=' ) return measured <= target;
  if (comparator === '<')  return measured < target;
  if (comparator === '≥' || comparator === '>=' ) return measured >= target;
  if (comparator === '>')  return measured > target;
  if (comparator === '=')  return measured === target;
  return false;
}

/**
 * Parse ROADMAP.md and return the block for the requested phase number.
 * Phase-N boundary: heading "## Phase N" followed by non-digit or end.
 * Returns { goal: string, reqIds: string[] } or null if not found.
 * @param {string} text  full ROADMAP.md content
 * @param {string} phaseNum  validated digit-only string
 */
function parseRoadmapPhase(text, phaseNum) {
  const lines = text.split('\n');
  // Match "## Phase N" where N == phaseNum. Boundary must reject BOTH a further
  // digit ("Phase 10") AND a decimal sub-phase ("Phase 1.1") — '.' is \D, so a
  // plain non-digit boundary would bleed decimal phases into the whole phase.
  const phaseRe = new RegExp(`^##\\s+Phase\\s+${phaseNum}(?!\\d|\\.\\d)`, 'i');
  let inPhase = false;
  let goal = '';
  let reqLine = '';
  let goalBuf = [];
  let collectingGoal = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inPhase) {
      if (phaseRe.test(line)) { inPhase = true; collectingGoal = false; }
      continue;
    }
    // Stop at next ## heading (new phase or section)
    if (/^##\s/.test(line)) break;
    // Goal: paragraph — starts with "Goal:" and may wrap until blank line
    if (/^Goal:/i.test(line)) {
      collectingGoal = true;
      goalBuf = [line.replace(/^Goal:\s*/i, '').trim()];
      continue;
    }
    if (collectingGoal) {
      if (line.trim() === '') { collectingGoal = false; goal = goalBuf.join(' ').trim(); }
      else goalBuf.push(line.trim());
      continue;
    }
    // Requirements: R003, R004, ...
    if (/^Requirements:/i.test(line)) {
      reqLine = line.replace(/^Requirements:\s*/i, '').trim();
    }
  }
  if (collectingGoal && goalBuf.length) goal = goalBuf.join(' ').trim();
  if (!inPhase) return null;
  const reqIds = reqLine.split(',').map(s => s.trim()).filter(s => /^R\d+$/.test(s));
  return { goal, reqIds };
}

/**
 * Parse REQUIREMENTS.md and return a map of reqId → { title, dod }.
 * Each requirement bullet: "- **Rxxx** <title>: ..."
 * DoD text is collected until the next "- **R" bullet or heading.
 * @param {string} text  full REQUIREMENTS.md content
 * @returns {Map<string, { title: string, dod: string }>}
 */
function parseRequirements(text) {
  const lines = text.split('\n');
  const map = new Map();
  let currentId = null;
  let buf = [];

  const flush = () => {
    if (!currentId) return;
    const full = buf.join(' ').trim();
    // Extract DoD: text — everything after "DoD:" (may span continuation lines via buf join)
    const dodIdx = full.indexOf('DoD:');
    const dod = dodIdx >= 0 ? full.slice(dodIdx + 4).trim() : '';
    // Extract title: text between "**Rxxx**" and the first colon
    const titleM = full.match(/\*\*R\d+\*\*\s+([^:]+):/);
    const title = titleM ? titleM[1].trim() : currentId;
    map.set(currentId, { title, dod });
    currentId = null;
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^-\s+\*\*(R\d+)\*\*/);
    if (m) {
      flush();
      currentId = m[1];
      buf = [line.replace(/^\s*-\s+/, '')];
    } else if (currentId) {
      // Continuation line (indented or blank terminates): stop at next heading
      if (/^#/.test(line)) { flush(); }
      else { buf.push(line.trim()); }
    }
  }
  flush();
  return map;
}

/**
 * Parse DECISION_LOG.md and return decisions relevant to the given phase number.
 * Relevance is determined ONLY by the structured "- **Phase**: N" line inside
 * each decision block. Bare-integer substring matching is forbidden to avoid
 * collision with R-ids and percentages.
 * Returns array of { id, title, deferredReqs: string[] } objects.
 * @param {string} text  full DECISION_LOG.md content
 * @param {string} phaseNum  validated digit-only string
 */
function parseDecisionLogForPhase(text, phaseNum) {
  const lines = text.split('\n');
  // Decision blocks start: ## D-<uuid8>-<n> — <title>
  const blockRe = /^##\s+(D-[a-f0-9]+-\d+)\s+[—–-]\s+(.+)/i;
  // Structured phase line: - **Phase**: N (uuid) · ...
  // Boundary-safe: rejects further digits AND decimal sub-phases (see phaseRe).
  const phaseLineRe = new RegExp(`\\*\\*Phase\\*\\*:\\s*${phaseNum}(?!\\d|\\.\\d)`);
  // Deferral: line contains "defer" (case-insensitive) and names an R-id
  const deferRe = /defer/i;

  const results = [];
  let inBlock = false;
  let blockId = '';
  let blockTitle = '';
  let blockLines = [];

  const processBlock = () => {
    if (!blockId) return;
    const full = blockLines.join('\n');
    // Only include if structured Phase line matches phaseNum
    const phaseMatch = blockLines.some(l => phaseLineRe.test(l));
    if (phaseMatch) {
      // Determine if this block defers any requirements.
      // Strategy: if ANY line in the block contains "defer" (case-insensitive),
      // collect ALL R-ids mentioned in the entire block (not just the defer line),
      // since the Phase structured line lists the req IDs and the defer statement
      // may be on a separate line.
      const blockHasDefer = blockLines.some(l => deferRe.test(l));
      const deferredReqs = [];
      if (blockHasDefer) {
        // Collect all R-ids from the entire block
        const allRIds = [...full.matchAll(/R\d+/g)].map(m => m[0]);
        deferredReqs.push(...allRIds);
      }
      results.push({ id: blockId, title: blockTitle, deferredReqs: [...new Set(deferredReqs)], full });
    }
    blockId = '';
    blockTitle = '';
    blockLines = [];
  };

  for (const line of lines) {
    const bm = line.match(blockRe);
    if (bm) {
      processBlock();
      inBlock = true;
      blockId = bm[1];
      blockTitle = bm[2].trim();
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    }
  }
  processBlock();
  return results;
}

/**
 * Read ALL lines from ledger.jsonl (full read — low-frequency command, not bounded).
 * Returns array of parsed event objects.
 * @param {string} cwd
 * @param {string} slug
 */
function readFullLedger(cwd, slug) {
  const p = ledgerPath(cwd, slug);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf8').split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Parse measurement events from the full ledger for specific goal IDs.
 * Evidence schema (canonical): `measured=<number>[unit]` token.
 * Returns map goalId → ARRAY of { rawEvidence, value, unit } in event order.
 * A goal may carry measurements for different requirements over time, so
 * keeping only the last one per goal would silently drop earlier req-tagged
 * measurements (each req's lookup wants ITS latest, not the goal's latest).
 * @param {Array} events  all ledger events
 * @param {Set<string>} goalIds  goal IDs to filter for
 */
function extractMeasurements(events, goalIds) {
  const map = new Map();
  for (const ev of events) {
    if (ev.event !== 'measurement') continue;
    if (!goalIds.has(ev.goalId)) continue;
    const evidence = String(ev.evidence || '');
    // Parse canonical token: measured=<number>[unit]. Both sides bounded —
    // a malformed token like "measured=42abc" or "measured=1e3" must NOT
    // partially parse into an authoritative number (NF4 anti-fabrication).
    // Case-sensitive units, mirroring extractNumericTarget/normalizeUnit.
    const m = evidence.match(/(?:^|\s)measured=(\d+(?:\.\d+)?)(회|k|M)?(?=\s|$)/);
    if (m) {
      const n = normalizeUnit(m[1] + (m[2] || ''));
      if (n) {
        if (!map.has(ev.goalId)) map.set(ev.goalId, []);
        map.get(ev.goalId).push({ rawEvidence: evidence, value: n.value, unit: n.unit });
      }
    }
  }
  return map;
}

/**
 * Find the measurement for a requirement: a measurement event on a phase goal
 * whose evidence names the reqId. Single source for BOTH the Axis-2 table and
 * the Summary Findings — the two views must never disagree on a verdict.
 * Within each goal the NEWEST event naming this reqId wins (per-goal lists are
 * in event order; goals are scanned in map insertion order).
 * @param {Map<string, Array<{ rawEvidence: string, value: number, unit: string }>>} measurements
 * @param {string} rId  requirement id (e.g. "R001")
 * @returns {{ rawEvidence: string, value: number, unit: string, goalId: string }|null}
 */
function measurementForReq(measurements, rId) {
  // Boundary-safe req-id match: "R1" must not match evidence naming "R12".
  const rIdRe = new RegExp(`(?<![A-Za-z0-9])${rId}(?!\\d)`);
  for (const [gId, list] of measurements) {
    // Latest matching event wins for THIS requirement (scan newest-first).
    for (let i = list.length - 1; i >= 0; i--) {
      if (rIdRe.test(String(list[i].rawEvidence))) return { ...list[i], goalId: gId };
    }
  }
  return null;
}

/**
 * Escape a value for interpolation into a markdown table cell. Ledger evidence
 * is writable via the public `append` CLI, so raw `|` / newlines would let a
 * crafted event break out of the cell and forge report rows (e.g. a fake
 * "**met**" verdict) — presentation-level fabrication the NF4 rule forbids.
 * @param {*} v
 * @returns {string}
 */
function mdCell(v) {
  // \r\n? covers lone CR (old-Mac line ending) — CommonMark treats a bare CR
  // as a line ending, so `\r?\n` alone would let it split the table row.
  return String(v ?? '').replace(/\r\n?|\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Determine verdict for a single requirement given its DoD and available data.
 * Precedence: deferred > measured met/not-met > unmeasurable > unknown.
 * NF4: measured fabrication forbidden — absent measurement → unmeasurable.
 * @param {{ dod: string }} req  requirement entry
 * @param {object|null} measured  { value, unit } or null
 * @param {string[]} deferDecisionIds  decision IDs that defer this requirement
 * @returns {{ verdict: string, detail: string }}
 */
function computeVerdict(req, measured, deferDecisionIds) {
  // Deferred check has highest precedence (beats measured comparison)
  if (deferDecisionIds.length > 0) {
    return { verdict: 'deferred', detail: `Deferred by: ${deferDecisionIds.join(', ')}` };
  }
  const target = extractNumericTarget(req.dod);
  if (target === null) {
    // Qualitative or multi-number DoD → always unmeasurable (no fabrication)
    return { verdict: 'unmeasurable', detail: 'qualitative or multi-value DoD; no numeric-comparable target' };
  }
  // Numeric target — check for measured evidence
  if (!measured) {
    return { verdict: 'unmeasurable', detail: 'numeric target exists but no measurement event recorded' };
  }
  // Unit must normalize to the same unit class (both unitless, or same multiplier)
  if (measured.unit !== target.unit) {
    return { verdict: 'unmeasurable', detail: `unit mismatch: target unit="${target.unit}" measured unit="${measured.unit}"` };
  }
  const satisfied = comparatorSatisfied(target.comparator, target.value, measured.value);
  if (satisfied) {
    return { verdict: 'met', detail: `measured ${measured.value}${measured.unit} ${target.comparator} target ${target.value}${target.unit}` };
  }
  return { verdict: 'unknown', detail: `measured ${measured.value}${measured.unit} does NOT satisfy ${target.comparator}${target.value}${target.unit}` };
}

/**
 * Generate a Goal Satisfaction Report for the specified phase of a plan.
 * Four axes: ROADMAP goal/requirements, REQUIREMENTS DoD targets,
 * goals.json statuses, DECISION_LOG relevant decisions, + measured.
 * Fully backfill-safe: all parse errors degrade only that row ("no data");
 * the report is always generated when slug+phaseNum are valid. Never exits 1.
 *
 * @param {string} cwd  working directory (plan lives at join(cwd, PLANS_DIR, slug))
 * @param {string} slug  normalized plan slug
 * @param {string|number} phaseNum  phase number (validated to ^\d+$ — rejects traversal)
 * @returns {{ reportFile: string, findings: object }} or error object on invalid input
 */
export function phaseReport(cwd, slug, phaseNum) {
  // ── Input validation (security: reject traversal + non-numeric) ──────────
  // Slug is re-validated here (not only at the CLI) so direct API callers
  // cannot pass a traversal-shaped slug into path construction.
  const slugNorm = normalizeSlug(slug);
  if (!slugNorm) {
    return { error: `invalid slug: "${slug}" — must match ^[a-z0-9][a-z0-9-]{0,63}$` };
  }
  slug = slugNorm;
  const phaseStr = String(phaseNum ?? '').trim();
  if (!/^\d+$/.test(phaseStr)) {
    return { error: `invalid phase: "${phaseNum}" — must be a positive integer (digits only)` };
  }
  // Phase 0 is format-valid but semantically "no data" — degrade gracefully
  const phaseInt = parseInt(phaseStr, 10);

  // ── Read sources with per-source error isolation ─────────────────────────
  let roadmapText = '', requirementsText = '', decisionLogText = '';
  let roadmapErr = null, requirementsErr = null, decisionLogErr = null;

  try {
    const rp = roadmapPath(cwd, slug);
    roadmapText = existsSync(rp) ? readFileSync(rp, 'utf8') : '';
    if (!roadmapText) roadmapErr = 'ROADMAP.md not found or empty';
  } catch (e) { roadmapErr = `ROADMAP.md read error: ${e.message}`; }

  try {
    const rqp = requirementsPath(cwd, slug);
    requirementsText = existsSync(rqp) ? readFileSync(rqp, 'utf8') : '';
    if (!requirementsText) requirementsErr = 'REQUIREMENTS.md not found or empty';
  } catch (e) { requirementsErr = `REQUIREMENTS.md read error: ${e.message}`; }

  try {
    const dlp = decisionLogPath(cwd, slug);
    decisionLogText = existsSync(dlp) ? readFileSync(dlp, 'utf8') : '';
    // Empty DECISION_LOG is valid (no decisions yet)
  } catch (e) { decisionLogErr = `DECISION_LOG.md read error: ${e.message}`; }

  // ── Parse sources ────────────────────────────────────────────────────────
  let phaseBlock = null;
  if (roadmapText && !roadmapErr) {
    try { phaseBlock = parseRoadmapPhase(roadmapText, phaseStr); } catch { phaseBlock = null; }
  }

  let reqMap = new Map();
  if (requirementsText && !requirementsErr) {
    try { reqMap = parseRequirements(requirementsText); } catch { reqMap = new Map(); }
  }

  let decisions = [];
  if (decisionLogText && !decisionLogErr) {
    try { decisions = parseDecisionLogForPhase(decisionLogText, phaseStr); } catch { decisions = []; }
  }

  // ── goals.json: find goals for this phase (boundary-safe match) ──────────
  let phaseGoals = [];
  let goalsErr = null;
  const goalsDoc = readGoals(cwd, slug);
  // Schema-drift guard: goals.json can be valid JSON but not our shape (e.g.
  // `{}` or `{"goals":"str"}`) — that must degrade this row like any other
  // malformed source, never abort report generation (backfill-safe contract).
  if (goalsDoc && Array.isArray(goalsDoc.goals)) {
    // Match goals whose .phase starts with "Phase <phaseNum>"; boundary rejects
    // further digits and decimal sub-phases (Phase 1 ≠ Phase 10 ≠ Phase 1.1).
    const phaseGoalRe = new RegExp(`^Phase\\s+${phaseStr}(?!\\d|\\.\\d)`, 'i');
    phaseGoals = goalsDoc.goals.filter(g => g && typeof g === 'object' && phaseGoalRe.test(String(g.phase || '')));
  } else {
    goalsErr = 'goals.json not found or unparseable';
  }

  // ── ledger: full read for measurement events ─────────────────────────────
  const allEvents = readFullLedger(cwd, slug);
  const phaseGoalIds = new Set(phaseGoals.map(g => g.id));
  const measurements = extractMeasurements(allEvents, phaseGoalIds);

  // Lifecycle events (checkpoint complete / failed) for this phase's goals
  const lifecycleEvents = allEvents.filter(ev =>
    phaseGoalIds.has(ev.goalId) &&
    (ev.event === 'checkpoint' && ev.status === 'complete' || ev.event === 'failed')
  );

  // ── Build deferral index: reqId → [decisionId, ...] ─────────────────────
  const deferralIndex = new Map();
  for (const dec of decisions) {
    for (const rId of dec.deferredReqs) {
      if (!deferralIndex.has(rId)) deferralIndex.set(rId, []);
      deferralIndex.get(rId).push(dec.id);
    }
  }

  // ── Determine achievement / desync status (machine-source only) ──────────
  const allGoalsPending = phaseGoals.length > 0 && phaseGoals.every(g =>
    g.status === 'pending' || g.status === 'active'
  );
  const lifecycleCount = lifecycleEvents.length;
  const achievement = (!goalsErr && allGoalsPending && lifecycleCount === 0)
    ? 'UNVERIFIED'
    : (phaseGoals.length === 0 ? 'NO_GOALS_FOUND' : 'PARTIAL_OR_COMPLETE');

  // ── Render markdown report ───────────────────────────────────────────────
  const lines = [];
  lines.push(`# Phase ${phaseStr} Goal Satisfaction Report`);
  lines.push(`> Plan: \`${slug}\` | Phase: ${phaseStr} | Generated: ${nowIso()}`);
  lines.push('');

  // Axis 1: ROADMAP Goal + Requirements
  lines.push('## 1. Phase Goal (ROADMAP)');
  if (roadmapErr) {
    lines.push(`> source error: ${roadmapErr}`);
  } else if (!phaseBlock) {
    lines.push(`> Phase ${phaseStr} not found in ROADMAP.md`);
  } else {
    lines.push(`**Goal:** ${phaseBlock.goal || '(no goal text found)'}`);
    lines.push('');
    lines.push(`**Requirements:** ${phaseBlock.reqIds.length > 0 ? phaseBlock.reqIds.join(', ') : '(none listed)'}`);
  }
  lines.push('');

  // Axis 2: REQUIREMENTS DoD Targets + Verdicts
  lines.push('## 2. Requirement Targets & Verdicts');
  const reqIds = phaseBlock?.reqIds ?? [];
  if (requirementsErr) {
    lines.push(`> source error: ${requirementsErr}`);
  } else if (reqIds.length === 0) {
    lines.push('> No requirements linked to this phase.');
  } else {
    lines.push('| Req | Title | DoD (target) | Target type | Measured | Verdict |');
    lines.push('|-----|-------|--------------|-------------|----------|---------|');
    for (const rId of reqIds) {
      const req = reqMap.get(rId);
      if (!req) {
        lines.push(`| ${rId} | no data | no data | — | — | unknown |`);
        continue;
      }
      const target = extractNumericTarget(req.dod);
      const targetType = target ? `numeric (${target.comparator}${target.value}${target.unit})` : 'qualitative';
      // Goals carry no req backlinks, so req-level measured is authoritative only
      // when the measurement event's evidence itself names the reqId.
      const measuredForVerdict = measurementForReq(measurements, rId);
      const measuredDisplay = measuredForVerdict
        ? `${measuredForVerdict.value}${measuredForVerdict.unit} (goal ${measuredForVerdict.goalId})`
        : 'absent';
      const deferIds = deferralIndex.get(rId) || [];
      const { verdict, detail } = computeVerdict({ dod: req.dod }, measuredForVerdict, deferIds);
      lines.push(`| ${rId} | ${mdCell(req.title)} | ${mdCell(req.dod.slice(0, 80))} | ${targetType} | ${mdCell(measuredDisplay)} | **${verdict}** |`);
      if (detail && verdict !== 'met') lines.push(`|  |  | *${mdCell(detail)}* |  |  |  |`);
    }
  }
  lines.push('');

  // Axis 3: goals.json Statuses
  lines.push('## 3. Goal Status (goals.json)');
  if (goalsErr) {
    lines.push(`> source error: ${goalsErr}`);
  } else if (phaseGoals.length === 0) {
    lines.push(`> No goals found for Phase ${phaseStr} in goals.json.`);
  } else {
    lines.push('| Goal ID | Title (truncated) | Status | Measured evidence |');
    lines.push('|---------|-------------------|--------|-------------------|');
    for (const g of phaseGoals) {
      const list = measurements.get(g.id);
      const measDisplay = list && list.length
        ? list.map(m => m.rawEvidence).join('; ')
        : 'none';
      // String() coercion: schema drift may put non-strings in title/id.
      lines.push(`| ${mdCell(g.id)} | ${mdCell(String(g.title ?? '').slice(0, 60))} | ${mdCell(g.status)} | ${mdCell(measDisplay)} |`);
    }
    lines.push('');
    // Desync finding (machine-source only — no TASK_LOG/commit reading)
    if (achievement === 'UNVERIFIED') {
      lines.push('> **Finding: achievement=UNVERIFIED**');
      lines.push(`> status source=goals.json; ledger lifecycle events for phase=${lifecycleCount}`);
      lines.push('> All phase goals are pending/active and no checkpoint-complete or failed events');
      lines.push('> exist in ledger.jsonl for these goals. This command does NOT read TASK_LOG or');
      lines.push('> git history — "shipped" status cannot be asserted from available sources.');
    }
  }
  lines.push('');

  // Axis 4: DECISION_LOG relevant decisions
  lines.push('## 4. Relevant Decisions (DECISION_LOG)');
  if (decisionLogErr) {
    lines.push(`> source error: ${decisionLogErr}`);
  } else if (decisions.length === 0) {
    lines.push('> No relevant decisions for this phase.');
  } else {
    for (const dec of decisions) {
      lines.push(`### ${dec.id} — ${dec.title}`);
      if (dec.deferredReqs.length > 0) {
        lines.push(`- Defers requirements: ${dec.deferredReqs.join(', ')}`);
      }
      // Include first few lines of the decision block for context
      const excerpt = dec.full.split('\n').slice(0, 6).join('\n').trim();
      if (excerpt) lines.push('');
      if (excerpt) lines.push(excerpt);
      lines.push('');
    }
  }

  // Summary findings
  lines.push('## 5. Summary Findings');
  const verdicts = [];
  for (const rId of reqIds) {
    const req = reqMap.get(rId);
    if (!req) { verdicts.push(`${rId}: unknown (no req data)`); continue; }
    const deferIds = deferralIndex.get(rId) || [];
    // Same lookup as the Axis-2 table — summary and table must agree.
    const measuredForReq = measurementForReq(measurements, rId);
    const { verdict } = computeVerdict({ dod: req.dod }, measuredForReq, deferIds);
    verdicts.push(`${rId}: ${verdict}`);
  }
  if (verdicts.length > 0) lines.push(verdicts.map(v => `- ${v}`).join('\n'));
  lines.push('');
  lines.push(`**Overall achievement: ${achievement}**`);
  if (achievement === 'UNVERIFIED') {
    lines.push(`- status source=goals.json; ledger lifecycle events for phase=${lifecycleCount}`);
    lines.push('- Provenance caveat: desync between goals.json (all pending) and ledger (no completions).');
    lines.push('  This is a known staleness pattern when execution proceeded outside ledger.append().');
    lines.push('  Do NOT interpret as "not shipped" — it means "unverifiable from machine sources".');
  }
  lines.push('');
  lines.push('---');
  lines.push(`> Generated by: \`ledger.mjs phase-report --slug ${slug} --phase ${phaseStr}\``);

  // ── Write report ─────────────────────────────────────────────────────────
  const rFile = reportPath(cwd, slug, phaseStr);
  try {
    mkdirSync(join(rFile, '..'), { recursive: true });
    atomicWriteText(rFile, lines.join('\n') + '\n');
  } catch (e) {
    // Last-resort no-throw guarantee: direct API callers must get an error
    // object, never an exception, even on fs failures (backfill-safe).
    return { error: `phase-report write error: ${e.message}`, slug, phase: phaseStr };
  }

  return {
    reportFile: rFile,
    phase: phaseStr,
    slug,
    achievement,
    reqCount: reqIds.length,
    goalsCount: phaseGoals.length,
    decisionsCount: decisions.length,
    lifecycleEvents: lifecycleCount,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [], goal: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--goal') { out.goal.push(argv[++i]); continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]; continue; }
    out._.push(a);
  }
  return out;
}

/** CLI entrypoint: dispatch a subcommand to the matching ledger function. */
function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  const cwd = args.cwd || process.cwd();
  let slug = normalizeSlug(args.slug) || resolveActivePlanSlug(cwd, args.session || null);

  // phase-report is backfill-safe: dispatched before the shared slug exit-2
  // and outside the main try/catch, so NO failure path — including a missing
  // slug/active plan — ever exits non-zero for this subcommand.
  if (cmd === 'phase-report') {
    try {
      if (!slug) {
        console.log(JSON.stringify({ error: 'no valid --slug and no active plan', phase: args.phase ?? null }));
      } else {
        console.log(JSON.stringify(phaseReport(cwd, slug, args.phase)));
      }
    } catch (e) {
      // Unexpected error inside phaseReport — report but never exit 1
      console.log(JSON.stringify({ error: `phase-report internal error: ${e.message}`, phase: args.phase, slug }));
    }
    process.exit(0);
  }

  if (!slug) { console.error('ledger: no valid --slug and no active plan'); process.exit(2); }

  try {
    let res;
    if (cmd === 'create-goals') res = createGoals(cwd, slug, args.goal);
    else if (cmd === 'append') res = append(cwd, slug, { goalId: args['goal-id'], event: args.event, status: args.status, evidence: args.evidence });
    else if (cmd === 'set-acceptance') res = setGoalAcceptance(cwd, slug, { goalId: args['goal-id'], file: args.file });
    else if (cmd === 'record-evidence') res = recordGoalEvidence(cwd, slug, { goalId: args['goal-id'], file: args.file });
    else if (cmd === 'run-evidence') res = runGoalEvidence(cwd, slug, { goalId: args['goal-id'], role: args.role, verifier: args.verifier, sessionId: args.session });
    else if (cmd === 'advance') res = advanceGoal(cwd, slug, { action: args.action, evidence: args.evidence });
    else if (cmd === 'render-state') res = renderState(cwd, slug);
    else if (cmd === 'status') res = status(cwd, slug);
    else { console.error(`ledger: unknown command '${cmd}'`); process.exit(2); }
    console.log(JSON.stringify(res));
  } catch (e) {
    console.error(`ledger: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
