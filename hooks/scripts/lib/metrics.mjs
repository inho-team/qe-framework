#!/usr/bin/env node
'use strict';

// Consolidates harness metrics (unified-state) + telemetry (JSONL).

import { appendFileSync, readFileSync, existsSync, mkdirSync } from './qe-fs.mjs';
import { join } from 'path';

/**
 * Get the telemetry directory path.
 * @param {string} cwd - Project root
 * @returns {string} Path to .qe/telemetry/
 */
export function getTelemetryPath(cwd) {
  return join(cwd, '.qe', 'telemetry');
}

/**
 * Get today's date string for file naming.
 * @returns {string} YYYY-MM-DD format
 */
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Append a telemetry event to the daily JSONL file.
 * Creates the directory and file if they don't exist.
 * @param {string} cwd - Project root
 * @param {Object} event - Event data: { eventType, sessionId, data }
 */
export function appendTelemetry(cwd, event) {
  const dir = getTelemetryPath(cwd);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, `${getDateString()}.jsonl`);
  const record = {
    timestamp: new Date().toISOString(),
    eventType: event.eventType || 'unknown',
    sessionId: event.sessionId || 'unknown',
    data: event.data || {}
  };

  appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * Read telemetry events for a specific date.
 * @param {string} cwd - Project root
 * @param {string} [date] - Date string (YYYY-MM-DD), defaults to today
 * @returns {Array<Object>} Array of parsed event objects
 */
export function readTelemetry(cwd, date) {
  const filePath = join(getTelemetryPath(cwd), `${date || getDateString()}.jsonl`);
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Harness engineering metrics collector.
 * Tracks 6 core metrics per session in unified-state.harnessMetrics.
 */

/**
 * Initialize an empty metrics object.
 * @returns {Object} Fresh metrics structure
 */
export function initMetrics() {
  return {
    tasksTotal: 0,
    tasksCompleted: 0,
    tasksPassAt1: 0,
    tasksPassAt1Observed: 0,
    totalLinesChanged: 0,
    totalImplementMs: 0,
    totalVerifyMs: 0,
    defectEscapes: 0,
    delegationRequests: 0,
    delegationAutoInjections: 0,
    delegationByAgent: {},
    delegationByModel: {},
    sessionStartedAt: new Date().toISOString()
  };
}

/**
 * Record a delegated-work request. This is dispatch telemetry, not completion
 * telemetry: runtimes do not expose a portable subagent-stop hook.
 *
 * @param {Object} metrics - Current metrics object
 * @param {{agentName?: string, model?: string, action?: string}} request
 * @returns {Object} Updated metrics
 */
export function recordDelegationRequest(metrics, request = {}) {
  const agentName = request.agentName || 'unknown';
  const model = request.model || 'unspecified';

  metrics.delegationRequests = (metrics.delegationRequests || 0) + 1;
  metrics.delegationByAgent = metrics.delegationByAgent || {};
  metrics.delegationByModel = metrics.delegationByModel || {};
  metrics.delegationByAgent[agentName] = (metrics.delegationByAgent[agentName] || 0) + 1;
  metrics.delegationByModel[model] = (metrics.delegationByModel[model] || 0) + 1;
  if (request.action === 'inject') {
    metrics.delegationAutoInjections = (metrics.delegationAutoInjections || 0) + 1;
  }
  return metrics;
}

/**
 * Record a task completion event.
 * @param {Object} metrics - Current metrics object
 * @param {boolean} passedFirstAttempt - Whether task passed verification on first try
 * @returns {Object} Updated metrics
 */
export function recordTaskCompletion(metrics, passedFirstAttempt) {
  metrics.tasksCompleted += 1;
  if (typeof passedFirstAttempt === 'boolean') {
    metrics.tasksPassAt1Observed = (metrics.tasksPassAt1Observed || 0) + 1;
    if (passedFirstAttempt) {
      metrics.tasksPassAt1 += 1;
    }
  }
  return metrics;
}

/**
 * Record code churn from file modifications.
 * @param {Object} metrics - Current metrics object
 * @param {number} filesChanged - Number of files modified
 * @param {number} linesChanged - Total lines added/removed
 * @returns {Object} Updated metrics
 */
export function recordCodeChurn(metrics, filesChanged, linesChanged) {
  metrics.totalLinesChanged += linesChanged;
  return metrics;
}

/**
 * Record verification and implementation timing.
 * @param {Object} metrics - Current metrics object
 * @param {number} verifyMs - Time spent on verification (ms)
 * @param {number} implementMs - Time spent on implementation (ms)
 * @returns {Object} Updated metrics
 */
export function recordVerificationTime(metrics, verifyMs, implementMs) {
  metrics.totalVerifyMs += verifyMs;
  metrics.totalImplementMs += implementMs;
  return metrics;
}

/**
 * Generate a human-readable metrics summary string.
 * @param {Object} metrics - Current metrics object
 * @returns {string} Summary line for session display
 */
export function getMetricsSummary(metrics) {
  if (!metrics || metrics.tasksTotal === 0) return '';

  const resolutionRate = metrics.tasksCompleted > 0
    ? Math.round(metrics.tasksCompleted / metrics.tasksTotal * 100)
    : 0;

  const passAt1Rate = metrics.tasksPassAt1Observed > 0
    ? `${Math.round(metrics.tasksPassAt1 / metrics.tasksPassAt1Observed * 100)}%`
    : 'unknown';

  const churnRate = metrics.tasksCompleted > 0
    ? Math.round(metrics.totalLinesChanged / metrics.tasksCompleted)
    : 0;

  const verifyTax = metrics.totalImplementMs > 0
    ? (metrics.totalVerifyMs / metrics.totalImplementMs).toFixed(2)
    : '0.00';

  return `Tasks: ${metrics.tasksCompleted}/${metrics.tasksTotal} (${resolutionRate}%) | Pass@1: ${passAt1Rate} | Churn: ${churnRate} lines/task | VTax: ${verifyTax}`;
}
