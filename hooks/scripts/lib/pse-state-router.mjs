/**
 * @fileoverview Best-effort PSE state summarizer for prompt-check soft hints.
 *
 * This module is intentionally read-only and fail-open. It does not choose or
 * mutate tasks; it only summarizes enough local QE state for the prompt hook to
 * suggest the next PSE command when no explicit or hard route already wins.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { getChangedFiles } from './changed-files.mjs';
import { resolveActivePlanSlug, resolveRoadmapPath, resolveStatePath } from './plan-resolver.mjs';

const PLAN_LINE_PREFIX = '관련 계획:';
const PENDING_TASK_DIR = '.qe/tasks/pending';
const PENDING_CHECKLIST_DIR = '.qe/checklists/pending';
const COMMAND_PREFIX = process.env.QE_COMMAND_PREFIX || '/';
const skillCommand = (name, args = '') => `${COMMAND_PREFIX}${name}${args ? ` ${args}` : ''}`;

/**
 * Reads JSON from disk and returns null when the file is absent or malformed.
 * @param {string} path - File path to read.
 * @returns {Record<string, unknown>|null}
 */
function readJsonObject(path) {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads UTF-8 text from disk and returns an empty string on failure.
 * @param {string} path - File path to read.
 * @returns {string}
 */
function readText(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * Resolves the current session id from QE state when the caller did not pass it.
 * @param {string} cwd - Project root.
 * @returns {string|null}
 */
function readStateSessionId(cwd) {
  const state = readJsonObject(join(cwd, '.qe', 'state', 'current-session.json'));
  const raw = state?.session_id ?? state?.sessionId ?? null;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Extracts the active phase line from a STATE.md file.
 * @param {string} content - STATE.md content.
 * @returns {string|null}
 */
function parseActivePhase(content) {
  const match = content.match(/Active Phase\*\*:\s*([^\n\r]+)/i) || content.match(/Active Phase:\s*([^\n\r]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Produces a short phase alias for copy-pasteable Qgs commands.
 * @param {string|null} phaseLabel - Active phase label.
 * @returns {string}
 */
function shortPhaseAlias(phaseLabel) {
  const cleaned = String(phaseLabel || '')
    .replace(/^Phase\s+\d+(?:\.\d+)?\s*[-—:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'current phase';
  return cleaned.split(/\s+/).slice(0, 6).join(' ');
}

/**
 * Extracts phase labels from common ROADMAP formats (headings, bullets, tables).
 * @param {string} text - ROADMAP.md content.
 * @returns {string[]}
 */
function extractRoadmapPhases(text) {
  const phases = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match =
      line.match(/^#{1,6}\s*(Phase\s+\d+(?:\.\d+)?\s*[-—:]\s*[^|#]+)/i) ||
      line.match(/^[-*]\s*(Phase\s+\d+(?:\.\d+)?\s*[-—:]\s*[^|]+)/i) ||
      line.match(/^\|\s*(Phase\s+\d+(?:\.\d+)?\s*[-—:][^|]+)\|/i);
    if (match) phases.push(match[1].trim());
  }
  return phases;
}

/**
 * Finds the roadmap phase after the active phase when the roadmap is parseable.
 * @param {string} cwd - Project root.
 * @param {string|null} planSlug - Active plan slug.
 * @param {string|null} activePhase - Active phase label.
 * @param {string|null} sessionId - Session id.
 * @returns {string|null}
 */
function findNextRoadmapPhase(cwd, planSlug, activePhase, sessionId) {
  if (!planSlug || !activePhase) return null;
  const roadmapPath = resolveRoadmapPath(cwd, sessionId);
  const phases = extractRoadmapPhases(readText(roadmapPath || ''));
  if (phases.length === 0) return null;
  const activeNumber = activePhase.match(/Phase\s+(\d+(?:\.\d+)?)/i)?.[1] || null;
  const activeIndex = phases.findIndex((phase) => {
    if (phase === activePhase) return true;
    const phaseNumber = phase.match(/Phase\s+(\d+(?:\.\d+)?)/i)?.[1] || null;
    return activeNumber && phaseNumber === activeNumber;
  });
  return activeIndex >= 0 && activeIndex + 1 < phases.length ? phases[activeIndex + 1] : null;
}

/**
 * Lists markdown filenames from a directory.
 * @param {string} dir - Directory path.
 * @returns {string[]}
 */
function listMarkdownFiles(dir) {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Finds pending TASK_REQUEST/VERIFY_CHECKLIST pairs that explicitly belong to
 * the active plan. Membership is based only on the TASK_REQUEST plan line.
 * @param {string} cwd - Project root.
 * @param {string} planSlug - Active plan slug.
 * @returns {Array<{uuid: string, taskPath: string, checklistPath: string}>}
 */
function findPendingPairsForPlan(cwd, planSlug) {
  if (!planSlug) return [];
  const taskDir = join(cwd, PENDING_TASK_DIR);
  const checklistDir = join(cwd, PENDING_CHECKLIST_DIR);
  const expectedPlanLine = `${PLAN_LINE_PREFIX} .qe/planning/plans/${planSlug}/ROADMAP.md`;
  const pairs = [];

  for (const name of listMarkdownFiles(taskDir)) {
    const uuidMatch = name.match(/^TASK_REQUEST_(.+)\.md$/);
    if (!uuidMatch) continue;
    const uuid = uuidMatch[1];
    const taskPath = join(taskDir, name);
    const checklistPath = join(checklistDir, `VERIFY_CHECKLIST_${uuid}.md`);
    if (!existsSync(checklistPath)) continue;
    const taskText = readText(taskPath);
    const hasPlanLine = taskText.split(/\r?\n/).some((line) => line.trim().replace(/^-\s*/, '') === expectedPlanLine);
    if (hasPlanLine) pairs.push({ uuid, taskPath, checklistPath });
  }

  return pairs;
}

/**
 * Checks whether a TASK_LOG row is a true completion record for a plan phase.
 * @param {string} line - One TASK_LOG line.
 * @param {string} planSlug - Active plan slug.
 * @param {string} activePhase - Active phase label.
 * @returns {boolean}
 */
function isCompletedTaskLogRow(line, planSlug, activePhase) {
  if (!line.includes(planSlug) || !line.includes(activePhase)) return false;
  const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
  const statusCell = cells.length >= 3 ? cells[2] : line;
  if (/\b(pending|in[- ]progress|qcode pending)\b|진행|대기/i.test(statusCell)) return false;
  return /✅|\b(complete|completed|verified)\b|완료/i.test(statusCell);
}

/**
 * Checks whether the active phase is already complete by goals.json or log text.
 * @param {string} cwd - Project root.
 * @param {string|null} planSlug - Active plan slug.
 * @param {string|null} activePhase - Active phase label from STATE.md.
 * @returns {boolean}
 */
function isPhaseCompleted(cwd, planSlug, activePhase) {
  if (!planSlug || !activePhase) return false;

  const goals = readJsonObject(join(cwd, '.qe', 'planning', 'plans', planSlug, 'goals.json'));
  if (Array.isArray(goals?.goals)) {
    const phaseGoals = goals.goals.filter((goal) => goal?.phase === activePhase);
    if (phaseGoals.length > 0 && phaseGoals.every((goal) => String(goal?.status || '').toLowerCase() === 'complete')) {
      return true;
    }
  }

  const logText = readText(join(cwd, '.qe', 'TASK_LOG.md'));
  if (logText.split(/\r?\n/).some((line) => isCompletedTaskLogRow(line, planSlug, activePhase))) {
    return true;
  }

  return false;
}

/**
 * Builds a small read-only snapshot of QE PSE state.
 * @param {string} cwd - Project root.
 * @param {{sessionId?: string|null, changedFiles?: ReturnType<typeof getChangedFiles>}} [options]
 * @returns {Record<string, unknown>}
 */
export function collectPseState(cwd, options = {}) {
  const qeDir = join(cwd, '.qe');
  if (!existsSync(qeDir)) {
    return { kind: 'absent-qe', hintTarget: null, hintMessage: null };
  }

  const sessionId = options.sessionId ?? readStateSessionId(cwd);
  const activePlanSlug = resolveActivePlanSlug(cwd, sessionId);
  const statePath = resolveStatePath(cwd, sessionId);
  const stateText = statePath ? readText(statePath) : '';
  const activePhase = parseActivePhase(stateText);
  const changedFiles = options.changedFiles ?? getChangedFiles(cwd);
  const nonQeChangedFiles = Array.isArray(changedFiles?.all)
    ? changedFiles.all.filter((path) => !path.startsWith('.qe/'))
    : [];
  const hasUncommittedCode = nonQeChangedFiles.length > 0;
  const pendingPairs = activePlanSlug ? findPendingPairsForPlan(cwd, activePlanSlug) : [];
  const completedPhase = isPhaseCompleted(cwd, activePlanSlug, activePhase);
  const nextRoadmapPhase = findNextRoadmapPhase(cwd, activePlanSlug, activePhase, sessionId);

  let kind = 'no-active-plan';
  let hintTarget = 'Qplan';
  let hintMessage = 'No active QE plan is selected; use Qplan before generating task specs.';

  if (activePlanSlug) {
    kind = 'active-plan-no-pending-spec';
    hintTarget = 'Qgs';
    hintMessage = `Active plan "${activePlanSlug}" has no current pending spec pair for ${activePhase || 'the active phase'}; end the response with Next Command: ${skillCommand('Qgs', `${activePlanSlug}: ${shortPhaseAlias(activePhase)}`)}.`;
  }

  if (completedPhase) {
    kind = 'completed-phase';
    hintTarget = 'Qplan';
    hintMessage = nextRoadmapPhase
      ? `Active phase "${activePhase}" is complete and the roadmap has "${nextRoadmapPhase}"; end the response with Next Command: ${skillCommand('Qplan', `${activePlanSlug}: move to ${shortPhaseAlias(nextRoadmapPhase)}`)}.`
      : `Active phase "${activePhase}" is complete; end the response with Next Command: ${skillCommand('Qplan', `${activePlanSlug}: review phase transition`)}.`;
  } else if (pendingPairs.length === 1) {
    kind = 'exactly-one-pending-spec';
    hintTarget = 'Qrun-task';
    hintMessage = `Pending spec ${basename(pendingPairs[0].taskPath)} belongs to active plan "${activePlanSlug}"; use Qrun-task ${pendingPairs[0].uuid} or Qatomic-run ${pendingPairs[0].uuid}.`;
  } else if (pendingPairs.length > 1) {
    kind = 'multiple-pending-specs';
    hintTarget = null;
    hintMessage = `Multiple pending specs belong to active plan "${activePlanSlug}"; choose an explicit Qrun-task/Qatomic-run UUID.`;
  } else if (hasUncommittedCode) {
    kind = 'uncommitted-code';
    hintTarget = 'Qcode-run-task';
    hintMessage = 'Uncommitted code changes are present; use Qcode-run-task when implementation is ready for verification.';
  }

  return {
    kind,
    activePlanSlug,
    activePhase,
    statePath,
    pendingPairCount: pendingPairs.length,
    pendingPairs,
    completedPhase,
    nextRoadmapPhase,
    changedFiles: nonQeChangedFiles,
    hintTarget,
    hintMessage,
  };
}

/**
 * Converts a collected state object into a hook hint.
 * @param {Record<string, unknown>} state - State from collectPseState.
 * @returns {{target: string|null, message: string|null, kind: string}}
 */
export function buildPseStateHint(state) {
  return {
    target: typeof state?.hintTarget === 'string' ? state.hintTarget : null,
    message: typeof state?.hintMessage === 'string' ? state.hintMessage : null,
    kind: typeof state?.kind === 'string' ? state.kind : 'unknown',
  };
}

/**
 * Collects state and returns the best soft hint, swallowing all filesystem and
 * git errors so prompt submission never blocks on routing context.
 * @param {string} cwd - Project root.
 * @param {{sessionId?: string|null, changedFiles?: ReturnType<typeof getChangedFiles>}} [options]
 * @returns {{target: string|null, message: string|null, kind: string}}
 */
export function resolvePseStateHint(cwd, options = {}) {
  try {
    return buildPseStateHint(collectPseState(cwd, options));
  } catch {
    return { target: null, message: null, kind: 'error' };
  }
}
