#!/usr/bin/env node
'use strict';

/**
 * Codex Result Handler — Bridges the gap between codex-poll-watcher
 * (which writes signal files) and skills (which need to consume results).
 *
 * Provides two strategies:
 *   1. Companion Job State — reads Codex companion's state.json directly
 *   2. Signal File — reads .qe/agent-results/codex-ready.signal written by poll watcher
 *
 * Skills call checkCodexResult(cwd) to get a unified status without
 * needing to know which strategy produced it.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from './qe-fs.mjs';
import { join } from 'path';
import {
  resolveCodexStateDir,
  getLatestCodexJobStatus,
  reapStaleCodexJobs,
  isCodexRuntimeLossMessage,
  sanitizeCodexDiagnosticMessage,
} from '../../../scripts/lib/codex_bridge.mjs';
import { recordAutoFallback } from './failure-capture.mjs';

// Codex stage outcomes that are eligible for automatic Claude takeover.
const AUTO_FALLBACK_STATUSES = ['crashed', 'failed', 'timeout'];

const SIGNAL_DIR_NAME = join('.qe', 'agent-results');
const SIGNAL_FILE_NAME = 'codex-ready.signal';
const RESULT_LOG_NAME = 'codex-materialization.md';
const AUTO_REAP_MARKER_NAME = 'codex-auto-reaped.json';

/**
 * @typedef {Object} CodexResult
 * @property {'completed'|'running'|'failed'|'crashed'|'timeout'|'unknown'} status
 * @property {string} source - 'companion' | 'signal' | 'none'
 * @property {string|null} diffStat - git diff summary if available
 * @property {number|null} elapsedSec - seconds since delegation
 * @property {string|null} error - error message if failed
 * @property {string} timestamp - ISO timestamp of this check
 */

/**
 * Check Codex result using both companion state and signal file.
 * Companion state is preferred (more authoritative); signal file is fallback.
 *
 * @param {string} cwd - Project root directory
 * @returns {CodexResult}
 */
export function checkCodexResult(cwd) {
  // Strategy 1: Companion job state (authoritative)
  const jobResult = checkCompanionJobState(cwd);
  if (jobResult.status !== 'unknown') {
    logMaterialization(cwd, jobResult);
    return jobResult;
  }

  // Strategy 2: Signal file from poll watcher
  const signalResult = checkSignalFile(cwd);
  if (signalResult.status !== 'unknown') {
    logMaterialization(cwd, signalResult);
    return signalResult;
  }

  // Neither source has data
  return {
    status: 'unknown',
    source: 'none',
    diffStat: null,
    elapsedSec: null,
    error: 'No companion state dir or signal file found. Codex companion may not be running.',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check Codex companion's state.json for job status.
 * @param {string} cwd
 * @returns {CodexResult}
 */
function checkCompanionJobState(cwd) {
  const job = getLatestCodexJobStatus(cwd);

  if (!job.found) {
    return { status: 'unknown', source: 'companion', diffStat: null, elapsedSec: null, error: null, timestamp: new Date().toISOString() };
  }

  const statusMap = {
    'completed': 'completed',
    'done': 'completed',
    'running': 'running',
    'pending': 'running',
    'queued': 'running',
    'failed': 'failed',
    'error': 'failed',
    'cancelled': 'failed',
  };

  let mapped = statusMap[job.status] || 'unknown';
  const safeJobError = sanitizeCodexDiagnosticMessage(job.error);
  const autoReapMarker = readAutoReapMarker(cwd, job.jobId);
  let runtimeLossError = (job.runtimeLost || isCodexRuntimeLossMessage(job.error))
    ? `Codex runtime session was lost: ${safeJobError || 'thread lost'}`
    : null;
  let autoReapError = null;
  if (job.status === 'cancelled' && autoReapMarker) {
    autoReapError = `Codex job was auto-reaped after a confirmed stale process: ${autoReapMarker.reason}`;
  }

  // Auto-reap confirmed zombies (worker process gone). Weak `log-silent` signals
  // are left alone — only `process-dead` is certain enough to cancel. A confirmed
  // process-dead job is terminal and crash-retry eligible, even if the best-effort
  // Codex cancel command cannot be resolved.
  let reaped = null;
  if (job.stale && job.staleKind === 'process-dead') {
    const r = reapStaleCodexJobs(cwd);
    reaped = {
      jobId: job.jobId,
      reaped: r.reaped.some((x) => x.id === job.jobId),
      reason: r.reaped.find((x) => x.id === job.jobId)?.reason || null,
      errors: r.errors.filter((x) => x.id === job.jobId),
    };
    const runtimeLossReapError = reaped.errors.find((x) => x.runtimeLost || isCodexRuntimeLossMessage(x.reason));
    if (runtimeLossReapError) {
      runtimeLossError = `Codex runtime session was lost during stale-job cleanup: ${runtimeLossReapError.reason}`;
    }
    mapped = 'crashed';
  }

  if (runtimeLossError) mapped = 'crashed';
  if (autoReapError) mapped = 'crashed';

  return {
    status: mapped,
    source: 'companion',
    diffStat: null,
    elapsedSec: null,
    // A stale "running" job is a zombie (worker gone) — surface its reason as the
    // error so callers do not wait forever on a job that will never finish.
    error: runtimeLossError || autoReapError || safeJobError || (job.stale ? `Job appears stale: ${job.staleReason}` : null),
    timestamp: new Date().toISOString(),
    jobId: job.jobId,
    pid: job.pid ?? null,
    phase: job.phase,
    completedAt: job.completedAt,
    stale: job.stale || false,
    staleReason: job.staleReason || null,
    staleKind: job.staleKind || null,
    reaped,
  };
}

/**
 * Read QE-owned auto-reap metadata. This never edits Codex companion state; it
 * only lets later checks distinguish QE auto-reap cancellation from user cancel.
 * @param {string} cwd
 * @param {string|undefined} jobId
 * @returns {object|null}
 */
function readAutoReapMarker(cwd, jobId) {
  if (!jobId) return null;
  const markerPath = join(cwd, SIGNAL_DIR_NAME, AUTO_REAP_MARKER_NAME);
  if (!existsSync(markerPath)) return null;
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
    return marker?.jobId === jobId ? marker : null;
  } catch {
    return null;
  }
}

/**
 * Check the signal file written by codex-poll-watcher.mjs.
 * @param {string} cwd
 * @returns {CodexResult}
 */
function checkSignalFile(cwd) {
  const signalPath = join(cwd, SIGNAL_DIR_NAME, SIGNAL_FILE_NAME);

  if (!existsSync(signalPath)) {
    return { status: 'unknown', source: 'signal', diffStat: null, elapsedSec: null, error: null, timestamp: new Date().toISOString() };
  }

  try {
    const signal = JSON.parse(readFileSync(signalPath, 'utf-8'));

    if (signal.crashed === true || signal.status === 'crashed') {
      return {
        status: 'crashed',
        source: 'signal',
        diffStat: null,
        elapsedSec: signal.elapsedSec || null,
        error: signal.message || 'Codex companion process died before materialization.',
        timestamp: signal.timestamp || new Date().toISOString(),
        pid: signal.pid ?? null,
      };
    }

    if (signal.detected === true) {
      return {
        status: 'completed',
        source: 'signal',
        diffStat: signal.diffStat || null,
        elapsedSec: signal.elapsedSec || null,
        error: null,
        timestamp: signal.timestamp || new Date().toISOString(),
      };
    }

    if (signal.timeout === true) {
      return {
        status: 'timeout',
        source: 'signal',
        diffStat: null,
        elapsedSec: signal.elapsedSec || null,
        error: signal.message || 'Polling timed out with no changes detected.',
        timestamp: signal.timestamp || new Date().toISOString(),
      };
    }

    // Signal file exists but no clear status
    return {
      status: 'running',
      source: 'signal',
      diffStat: null,
      elapsedSec: null,
      error: null,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return { status: 'unknown', source: 'signal', diffStat: null, elapsedSec: null, error: 'Failed to parse signal file.', timestamp: new Date().toISOString() };
  }
}

/**
 * Check if poll watcher is still running (signal file not yet written).
 * @param {string} cwd
 * @returns {boolean}
 */
export function isPollWatcherActive(cwd) {
  const signalPath = join(cwd, SIGNAL_DIR_NAME, SIGNAL_FILE_NAME);
  // If signal file doesn't exist, watcher may still be polling
  // If it exists, watcher has finished (either detected or timed out)
  return !existsSync(signalPath);
}

/**
 * Whether SIVS auto-fallback is enabled. Default ON — Claude auto-recovers a
 * failed Codex stage without prompting. The `QE_SIVS_AUTOFALLBACK=off` escape
 * hatch (also `0`/`false`/`no`) restores the legacy manual-prompt behavior.
 *
 * @param {NodeJS.ProcessEnv} [env] - environment to read (injectable for tests)
 * @returns {boolean}
 */
export function isAutoFallbackEnabled(env = process.env) {
  const raw = (env?.QE_SIVS_AUTOFALLBACK ?? '').toString().trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(raw);
}

/**
 * Build the non-blocking post-hoc notice shown when Claude has already taken
 * over a failed Codex stage. It must never route to a user question: it informs
 * after the fact. The message is greppable (`stage X: Codex <reason> ->
 * auto-recovered with Claude`) and reminds the reader that `.qe/sivs-config.json`
 * routing is untouched.
 *
 * @param {string} header - status header (CRASHED|FAILED|TIMEOUT)
 * @param {string} reason - lowercase reason (crashed|failed|timeout)
 * @param {string} stage - failed SIVS stage
 * @param {CodexResult} result
 * @returns {string}
 */
function autoRecoverInstruction(header, reason, stage, result) {
  return `**Codex Materialization: ${header} — auto-recovered with Claude** (source: ${result.source})
stage ${stage}: Codex ${reason} -> auto-recovered with Claude
${result.error ? `Reason detail: ${result.error}` : ''}
Claude has taken over this single failed stage automatically. This is a post-hoc notice — do NOT ask the user.
Next-stage routing follows \`.qe/sivs-config.json\` unchanged. Set \`QE_SIVS_AUTOFALLBACK=off\` to restore manual prompts.`;
}

/**
 * Generate a human-readable materialization instruction block
 * that skills can embed directly in their output.
 *
 * When auto-fallback is enabled (the default), the crashed/failed/timeout
 * branches return a non-blocking "auto-recovered with Claude" notice instead of
 * a user prompt. With `QE_SIVS_AUTOFALLBACK=off` the legacy manual instructions
 * are preserved verbatim.
 *
 * @param {CodexResult} result
 * @param {object} [options] - { autoFallback?: boolean, stage?: string }
 * @returns {string} Markdown instruction block
 */
export function formatResultInstruction(result, options = {}) {
  const autoFallback = options.autoFallback !== undefined
    ? options.autoFallback
    : isAutoFallbackEnabled();
  const stage = options.stage || result.phase || result.stage || 'implement';

  switch (result.status) {
    case 'completed':
      return `**Codex Materialization: COMPLETE** (source: ${result.source})
${result.diffStat ? `Changes detected:\n\`\`\`\n${result.diffStat}\n\`\`\`` : 'Files written. Run `git diff --stat` to review.'}
${result.elapsedSec != null ? `Elapsed: ${Math.round(result.elapsedSec / 60)}m ${result.elapsedSec % 60}s` : ''}
Proceed to **Verify** stage.`;

    case 'running':
      return `**Codex Materialization: IN PROGRESS** (source: ${result.source})
Companion is still working. Check again in 30 seconds.
Run: \`cat .qe/agent-results/codex-ready.signal 2>/dev/null || echo "still polling"\``;

    case 'timeout':
      if (autoFallback) return autoRecoverInstruction('TIMEOUT', 'timeout', stage, result);
      return `**Codex Materialization: TIMEOUT** (${result.elapsedSec ? Math.round(result.elapsedSec / 60) + 'm' : '1h'} elapsed)
No file changes detected. Ask user:
(a) Keep waiting +1h  (b) Retry with Codex  (c) Fallback to Claude  (d) Check Codex process`;

    case 'failed':
      if (autoFallback) return autoRecoverInstruction('FAILED', 'failed', stage, result);
      return `**Codex Materialization: FAILED**
${result.error ? `Error: ${result.error}` : 'Codex job failed without error details.'}
Ask user: (a) Retry with Codex  (b) Fallback to Claude  (c) Check logs`;

    case 'crashed':
      if (autoFallback) return autoRecoverInstruction('CRASHED', 'crashed', stage, result);
      return `**Codex Materialization: CRASHED**
${result.error ? `Error: ${result.error}` : 'Codex companion process died before file changes materialized.'}
Retry Codex once via the existing retry path, or fallback to Claude if the retry has already been used.`;

    default:
      return `**Codex Materialization: UNKNOWN**
Neither companion state nor signal file found. Codex companion may not be running.
Run: \`ps aux | grep -i codex | grep -v grep\` to check process.
Ask user: (a) Retry with Codex  (b) Implement with Claude  (c) Check Codex logs`;
  }
}

/**
 * Single orchestration entry point for a Codex stage outcome: when auto-fallback
 * is on and the stage crashed/failed/timed out, append a fallback record to
 * `.qe/state/agent-errors.json` (best-effort) and return the notice; otherwise
 * return the manual instruction. Recording uses `recordAutoFallback`, which
 * writes a non-retry-counted row, so this never causes a double Codex retry.
 *
 * @param {string} cwd - Project root directory
 * @param {CodexResult} result
 * @param {object} [options] - { autoFallback?: boolean, stage?: string, taskUuid?: string }
 * @returns {{ autoFallback: boolean, isFailure: boolean, recorded: object|null, instruction: string }}
 */
export function resolveCodexFallback(cwd, result, options = {}) {
  const autoFallback = options.autoFallback !== undefined
    ? options.autoFallback
    : isAutoFallbackEnabled();
  const isFailure = AUTO_FALLBACK_STATUSES.includes(result.status);
  const stage = options.stage || result.phase || result.stage || 'implement';

  let recorded = null;
  if (autoFallback && isFailure) {
    recorded = recordAutoFallback(cwd, {
      stage,
      taskUuid: options.taskUuid,
      reason: result.status,
      jobId: result.jobId ?? null,
      pid: result.pid ?? null,
    });
  }

  return {
    autoFallback,
    isFailure,
    recorded,
    instruction: formatResultInstruction(result, { ...options, autoFallback, stage }),
  };
}

/**
 * Log materialization result to .qe/agent-results/codex-materialization.md
 * @param {string} cwd
 * @param {CodexResult} result
 */
function logMaterialization(cwd, result) {
  const dir = join(cwd, SIGNAL_DIR_NAME);
  const logPath = join(dir, RESULT_LOG_NAME);

  try {
    mkdirSync(dir, { recursive: true });

    const entry = `## ${result.timestamp}
- **Status**: ${result.status}
- **Source**: ${result.source}
${result.diffStat ? `- **Changes**:\n\`\`\`\n${result.diffStat}\n\`\`\`` : ''}
${result.elapsedSec != null ? `- **Elapsed**: ${result.elapsedSec}s` : ''}
${result.error ? `- **Error**: ${result.error}` : ''}
---
`;

    writeFileSync(logPath, entry, { flag: 'a' });
    if (result.status === 'crashed' && result.reaped?.reaped && result.jobId) {
      writeFileSync(
        join(dir, AUTO_REAP_MARKER_NAME),
        JSON.stringify({
          jobId: result.jobId,
          status: 'crashed',
          reason: result.reaped.reason || result.staleReason || 'process-dead auto-reap',
          staleKind: result.staleKind || null,
          recordedAt: result.timestamp,
        }, null, 2)
      );
    }
  } catch {
    // Non-critical — don't fail the check
  }
}
