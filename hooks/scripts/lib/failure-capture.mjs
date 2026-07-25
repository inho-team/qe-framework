#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Maximum failure captures per UUID to prevent log bloat
const MAX_FAILURES_PER_UUID = 5;

// CONTEXT.md line limit
const CONTEXT_MAX_LINES = 200;

// Path pattern: .qe/learning/failures/{YYYY-MM}/{timestamp}_{slug}/CONTEXT.md
export function getFailuresDir(cwd) {
  return join(cwd, '.qe', 'learning', 'failures');
}

function getAgentErrorsPath(cwd) {
  return join(cwd, '.qe', 'state', 'agent-errors.json');
}

function normalizeExitCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSignal(value) {
  if (typeof value === 'number') return value === 9 ? 'SIGKILL' : String(value);
  if (typeof value !== 'string') return null;
  const signal = value.trim().toUpperCase();
  if (!signal) return null;
  if (signal === '9' || signal === 'KILL') return 'SIGKILL';
  return signal;
}

/**
 * Detect worker exits caused by OOM-style process death.
 * Exit code 137 is the conventional SIGKILL/OOM code (128 + 9).
 */
export function isAbnormalWorkerExit(exitInfo = {}) {
  if (isCodexMaterializationCrash(exitInfo)) return true;

  const exitCode = normalizeExitCode(
    exitInfo.exitCode ?? exitInfo.exit_code ?? exitInfo.code ?? exitInfo.status
  );
  const signal = normalizeSignal(
    exitInfo.signal ?? exitInfo.termSignal ?? exitInfo.terminationSignal ?? exitInfo.term_signal
  );

  return exitCode === 137 || signal === 'SIGKILL';
}

export function isCodexMaterializationCrash(exitInfo = {}) {
  return (
    exitInfo?.crashed === true ||
    exitInfo?.status === 'crashed' ||
    exitInfo?.codex_materialization?.status === 'crashed'
  );
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

/**
 * Find an abnormal worker exit in hook payloads while remaining tolerant of
 * client-specific field names.
 */
export function findAbnormalWorkerExit(payload = {}) {
  const candidates = [
    payload.workerExit,
    payload.worker_exit,
    payload.agentExit,
    payload.agent_exit,
    payload.childExit,
    payload.child_exit,
    payload.teammateExit,
    payload.teammate_exit,
    payload,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isAbnormalWorkerExit(candidate)) return candidate;
  }

  return null;
}

function readAgentErrors(cwd) {
  try {
    const errorLogPath = getAgentErrorsPath(cwd);
    if (!existsSync(errorLogPath)) return [];
    const errors = JSON.parse(readFileSync(errorLogPath, 'utf8'));
    if (Array.isArray(errors)) return errors;
    if (Array.isArray(errors?.errors)) return errors.errors;
  } catch {}
  return [];
}

function writeAgentErrors(cwd, errors) {
  const errorLogPath = getAgentErrorsPath(cwd);
  mkdirSync(join(cwd, '.qe', 'state'), { recursive: true });
  writeFileSync(errorLogPath, JSON.stringify(errors, null, 2), 'utf8');
}

function workerExitSignature(entry) {
  return [
    entry.taskUuid || 'no-task',
    entry.workerId || 'no-worker',
    entry.itemId || 'no-item',
  ].join('|');
}

function makeWorkerExitMessage(exitCode, signal, crashed = false) {
  if (crashed) return 'Codex companion process died before materialization';
  if (exitCode === 137) return 'Worker terminated with exit code 137 (SIGKILL/OOM-equivalent)';
  if (signal === 'SIGKILL') return 'Worker terminated with SIGKILL (OOM-equivalent)';
  return 'Worker terminated abnormally';
}

/**
 * Capture an abnormal worker exit in .qe/state/agent-errors.json.
 * Returns retry metadata so callers can auto-retry once without owning the log format.
 */
export function captureAbnormalWorkerExit(cwd, exitInfo = {}, options = {}) {
  if (!isAbnormalWorkerExit(exitInfo)) {
    return { captured: false, shouldRetry: false, retryCount: 0, entry: null };
  }
  const crashed = isCodexMaterializationCrash(exitInfo);

  const exitCode = normalizeExitCode(
    exitInfo.exitCode ?? exitInfo.exit_code ?? exitInfo.code ?? exitInfo.status
  );
  const signal = normalizeSignal(
    exitInfo.signal ?? exitInfo.termSignal ?? exitInfo.terminationSignal ?? exitInfo.term_signal
  );
  const taskUuid = pickFirst(
    options.taskUuid,
    exitInfo.taskUuid,
    exitInfo.task_uuid,
    exitInfo.uuid,
    exitInfo.task?.uuid,
    exitInfo.codex_materialization?.taskUuid,
    exitInfo.codex_materialization?.task_uuid
  );
  const workerId = pickFirst(
    options.workerId,
    exitInfo.workerId,
    exitInfo.worker_id,
    exitInfo.agentId,
    exitInfo.agent_id,
    exitInfo.teammateId,
    exitInfo.teammate_id,
    exitInfo.name,
    exitInfo.codex_materialization?.workerId,
    exitInfo.codex_materialization?.worker_id
  );
  const itemId = pickFirst(
    options.itemId,
    exitInfo.itemId,
    exitInfo.item_id,
    exitInfo.item,
    exitInfo.checklistItem,
    exitInfo.checklist_item,
    exitInfo.codex_materialization?.itemId,
    exitInfo.codex_materialization?.item_id
  );
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 1;
  const baseEntry = {
    kind: 'abnormal-worker-exit',
    timestamp: new Date().toISOString(),
    workerId,
    itemId,
    exitCode,
    signal,
    crashed,
    pid: pickFirst(options.pid, exitInfo.pid, exitInfo.codex_materialization?.pid),
    jobId: pickFirst(options.jobId, exitInfo.jobId, exitInfo.job_id, exitInfo.codex_materialization?.jobId),
    source: pickFirst(options.source, exitInfo.source, crashed ? 'codex-materialization' : null),
    message: pickFirst(options.message, exitInfo.message, makeWorkerExitMessage(exitCode, signal, crashed)),
    taskUuid,
  };
  const signature = workerExitSignature(baseEntry);
  const errors = readAgentErrors(cwd);
  const retryCount = errors
    .filter(error => error?.kind === 'abnormal-worker-exit')
    .filter(error => workerExitSignature(error) === signature)
    .length;
  const entry = {
    ...baseEntry,
    retryCount,
    retryAllowed: retryCount < maxRetries,
  };

  errors.push(entry);
  writeAgentErrors(cwd, errors);

  return {
    captured: true,
    shouldRetry: entry.retryAllowed,
    retryCount,
    entry,
  };
}

const AUTO_FALLBACK_REASONS = ['crashed', 'failed', 'timeout'];

/**
 * Record a SIVS auto-fallback (Claude took over a failed Codex stage) into
 * `.qe/state/agent-errors.json`. Reuses the same log the retry counter reads,
 * but writes `kind: 'auto-fallback'` so it is NEVER counted as a Codex retry
 * (the retry counter only tallies `kind: 'abnormal-worker-exit'`). This is the
 * concurrency guard that keeps the auto-fallback path from causing double-retry.
 *
 * Best-effort: a write failure returns `{ recorded: false }` and never throws,
 * so a broken log cannot block stage continuation. The persisted `reason` is
 * clamped to the greppable `crashed`/`failed`/`timeout` enum and no raw error
 * body is stored, so the log stays free of sensitive diagnostic text.
 *
 * @param {string} cwd - Project root directory
 * @param {object} opts
 * @param {string} [opts.stage] - failed SIVS stage (spec|implement|verify)
 * @param {string} [opts.taskUuid] - owning task UUID
 * @param {string} [opts.reason] - one of crashed|failed|timeout
 * @param {string|null} [opts.jobId] - Codex job id, when known
 * @param {number|null} [opts.pid] - Codex worker pid, when known
 * @returns {{ recorded: boolean, entry: object }}
 */
export function recordAutoFallback(cwd, opts = {}) {
  const reason = AUTO_FALLBACK_REASONS.includes(opts.reason) ? opts.reason : 'failed';
  const entry = {
    kind: 'auto-fallback',
    timestamp: new Date().toISOString(),
    stage: opts.stage || null,
    taskUuid: opts.taskUuid || null,
    reason,
    fallbackEngine: 'claude',
  };
  const jobId = pickFirst(opts.jobId);
  if (jobId !== null) entry.jobId = jobId;
  if (Number.isInteger(opts.pid) && opts.pid > 0) entry.pid = opts.pid;

  try {
    const errors = readAgentErrors(cwd);
    errors.push(entry);
    writeAgentErrors(cwd, errors);
    return { recorded: true, entry };
  } catch {
    // Best-effort — a broken log must not block stage continuation.
    return { recorded: false, entry };
  }
}

/**
 * Detect failure conditions for the current session.
 * Returns { failed: boolean, reasons: string[], uncheckedItems: string[], taskUuid: string|null }
 *
 * Failure conditions:
 *   1. VERIFY_CHECKLIST_{UUID}.md has unchecked items at session end
 *   2. Agent error log exists in .qe/state/agent-errors.json
 */
export function detectFailure(cwd) {
  const result = {
    failed: false,
    reasons: [],
    uncheckedItems: [],
    taskUuid: null,
  };

  // Condition 1: Scan for VERIFY_CHECKLIST files with unchecked items
  // QE stores checklists in .qe/checklists/in-progress/ — scan there first, then root as fallback
  try {
    const searchDirs = [
      join(cwd, '.qe', 'checklists', 'in-progress'),
      cwd, // backward-compat fallback for checklists stored in project root
    ];

    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;
      const checklistFiles = readdirSync(dir)
        .filter(f => f.startsWith('VERIFY_CHECKLIST_') && f.endsWith('.md'));

      for (const file of checklistFiles) {
        const content = readFileSync(join(dir, file), 'utf8');
        const unchecked = extractUncheckedItems(content);
        if (unchecked.length > 0) {
          result.failed = true;
          result.uncheckedItems.push(...unchecked);
          // Extract UUID from filename: VERIFY_CHECKLIST_{UUID}.md
          const uuidMatch = file.match(/VERIFY_CHECKLIST_([^.]+)\.md/);
          if (uuidMatch) result.taskUuid = uuidMatch[1];
          result.reasons.push(`VERIFY_CHECKLIST ${file}: ${unchecked.length} unchecked item(s)`);
        }
      }
    }
  } catch {
    // Fault tolerance — ignore scan errors
  }

  // Condition 2: Agent error log has UNHANDLED failures.
  // `auto-fallback` rows record a Codex crash that Claude already recovered from,
  // so they are informational — a session with only recovered fallbacks is not a
  // failure. Only genuinely unhandled error rows trip the flag.
  try {
    const errorLogPath = join(cwd, '.qe', 'state', 'agent-errors.json');
    if (existsSync(errorLogPath)) {
      const raw = readFileSync(errorLogPath, 'utf8');
      const errors = JSON.parse(raw);
      if (Array.isArray(errors)) {
        const unhandled = errors.filter(e => e?.kind !== 'auto-fallback');
        if (unhandled.length > 0) {
          result.failed = true;
          result.reasons.push(`Agent errors: ${unhandled.length} error(s) logged`);
        }
      }
    }
  } catch {
    // Fault tolerance — ignore error log read failures
  }

  return result;
}

/**
 * Extract unchecked checklist items from VERIFY_CHECKLIST content.
 * Looks for lines matching `- [ ] ...`
 */
function extractUncheckedItems(content) {
  const lines = content.split('\n');
  return lines
    .filter(line => /^\s*-\s*\[\s*\]\s+.+/.test(line))
    .map(line => line.replace(/^\s*-\s*\[\s*\]\s+/, '').trim())
    .filter(Boolean);
}

/**
 * Generate a slug from task UUID or timestamp for directory naming.
 */
function makeSlug(taskUuid, reasons) {
  if (taskUuid) return taskUuid.slice(0, 8);
  // Fallback slug from first reason
  const first = (reasons[0] || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 20)
    .replace(/-$/, '');
  return first || 'unknown';
}

/**
 * Build CONTEXT.md content (max CONTEXT_MAX_LINES lines).
 */
function buildContextMd({ taskUuid, uncheckedItems, reasons, changedFiles, gitDiffSummary, errorSummary, timestamp }) {
  const lines = [];

  lines.push('# Failure Context');
  lines.push('');
  lines.push(`date: ${timestamp}`);
  if (taskUuid) lines.push(`task_uuid: ${taskUuid}`);
  lines.push('');

  lines.push('## Failure Reasons');
  for (const r of reasons) {
    lines.push(`- ${r}`);
  }
  lines.push('');

  if (uncheckedItems.length > 0) {
    lines.push('## Unchecked Checklist Items');
    for (const item of uncheckedItems) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  if (errorSummary) {
    lines.push('## Error Summary');
    lines.push(errorSummary.slice(0, 500));
    lines.push('');
  }

  if (changedFiles.length > 0) {
    lines.push('## Changed Files');
    for (const f of changedFiles) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  if (gitDiffSummary) {
    lines.push('## Git Diff Summary');
    lines.push(gitDiffSummary);
    lines.push('');
  }

  // Enforce line limit
  return lines.slice(0, CONTEXT_MAX_LINES).join('\n');
}

/**
 * Collect git context (changed files + diff stat summary).
 */
function collectGitContext(cwd) {
  let changedFiles = [];
  let gitDiffSummary = '';

  try {
    const diffNames = execSync('git diff --name-only HEAD', {
      cwd, encoding: 'utf8', timeout: 5000,
    }).trim();
    if (diffNames) changedFiles = diffNames.split('\n').filter(Boolean);
  } catch {}

  try {
    const diffStat = execSync('git diff --stat HEAD', {
      cwd, encoding: 'utf8', timeout: 5000,
    }).trim();
    // Take last 2 lines (summary lines) to keep it compact
    if (diffStat) {
      const statLines = diffStat.split('\n');
      gitDiffSummary = statLines.slice(-2).join('\n');
    }
  } catch {}

  return { changedFiles, gitDiffSummary };
}

/**
 * Collect error summary from agent-errors.json if present.
 */
function collectErrorSummary(cwd) {
  try {
    const errorLogPath = join(cwd, '.qe', 'state', 'agent-errors.json');
    if (!existsSync(errorLogPath)) return '';
    const errors = JSON.parse(readFileSync(errorLogPath, 'utf8'));
    if (!Array.isArray(errors) || errors.length === 0) return '';
    // Show first 3 errors compactly
    return errors
      .slice(0, 3)
      .map(e => `[${e.timestamp || '?'}] ${e.message || JSON.stringify(e)}`)
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Main entry point — detect failure and write CONTEXT.md if needed.
 * Returns true if a failure was captured, false if session was clean.
 */
export function captureFailureQuietly(cwd) {
  const detection = detectFailure(cwd);
  if (!detection.failed) return false;

  try {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const yearMonth = now.toISOString().slice(0, 7); // YYYY-MM

    const slug = makeSlug(detection.taskUuid, detection.reasons);

    // Enforce per-UUID cap: remove oldest failures if at limit
    if (slug) {
      pruneFailuresForSlug(cwd, yearMonth, slug);
    }

    const dirName = `${timestamp}_${slug}`;
    const failureDir = join(getFailuresDir(cwd), yearMonth, dirName);
    mkdirSync(failureDir, { recursive: true });

    const { changedFiles, gitDiffSummary } = collectGitContext(cwd);
    const errorSummary = collectErrorSummary(cwd);

    const contextContent = buildContextMd({
      taskUuid: detection.taskUuid,
      uncheckedItems: detection.uncheckedItems,
      reasons: detection.reasons,
      changedFiles,
      gitDiffSummary,
      errorSummary,
      timestamp: now.toISOString(),
    });

    writeFileSync(join(failureDir, 'CONTEXT.md'), contextContent, 'utf8');
    return true;
  } catch {
    // Fault tolerance — never crash the stop handler
    return false;
  }
}

/**
 * Read the most recent N failure CONTEXT.md files for session injection.
 * Returns compact summary string or empty string if no failures.
 */
/**
 * Remove oldest failure directories for a given slug when count exceeds MAX_FAILURES_PER_UUID.
 * Keeps the most recent entries, deletes the rest (FIFO).
 */
function pruneFailuresForSlug(cwd, yearMonth, slug) {
  try {
    const monthDir = join(getFailuresDir(cwd), yearMonth);
    if (!existsSync(monthDir)) return;
    const dirs = readdirSync(monthDir)
      .filter(d => d.endsWith(`_${slug}`))
      .sort(); // chronological (timestamp prefix)
    const excess = dirs.length - (MAX_FAILURES_PER_UUID - 1); // -1 because we're about to add one
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        try { rmSync(join(monthDir, dirs[i]), { recursive: true, force: true }); } catch {}
      }
    }
  } catch {}
}

export function readRecentFailures(cwd, limit = 3) {
  const failuresDir = getFailuresDir(cwd);
  if (!existsSync(failuresDir)) return '';

  try {
    // Collect all CONTEXT.md paths by traversing YYYY-MM subdirs
    const entries = [];
    const monthDirs = readdirSync(failuresDir)
      .filter(f => /^\d{4}-\d{2}$/.test(f))
      .sort()
      .reverse(); // newest month first

    for (const month of monthDirs) {
      const monthPath = join(failuresDir, month);
      try {
        const sessionDirs = readdirSync(monthPath).sort().reverse();
        for (const sessionDir of sessionDirs) {
          const contextPath = join(monthPath, sessionDir, 'CONTEXT.md');
          if (existsSync(contextPath)) {
            entries.push({ contextPath, sessionDir });
            if (entries.length >= limit) break;
          }
        }
      } catch {}
      if (entries.length >= limit) break;
    }

    if (entries.length === 0) return '';

    const summaries = entries.map(({ contextPath, sessionDir }) => {
      try {
        const content = readFileSync(contextPath, 'utf8');
        // Extract key fields for compact summary
        const dateMatch = content.match(/^date:\s*(.+)$/m);
        const taskMatch = content.match(/^task_uuid:\s*(.+)$/m);
        const reasonLines = content
          .match(/## Failure Reasons\n([\s\S]*?)(?=\n## |\n---|$)/)?.[1]
          ?.trim()
          .split('\n')
          .slice(0, 2)
          .join('; ') || '';

        const date = dateMatch ? dateMatch[1].trim().slice(0, 10) : sessionDir.slice(0, 10);
        const uuid = taskMatch ? taskMatch[1].trim() : '?';
        return `[${date}] task:${uuid} — ${reasonLines}`;
      } catch {
        return `[${sessionDir}] (unreadable)`;
      }
    });

    return `[Recent Failures (${entries.length})] ${summaries.join(' | ')}`;
  } catch {
    return '';
  }
}
