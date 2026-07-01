#!/usr/bin/env node
'use strict';

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
    totalLinesChanged: 0,
    totalImplementMs: 0,
    totalVerifyMs: 0,
    defectEscapes: 0,
    sessionStartedAt: new Date().toISOString()
  };
}

/**
 * Record a task completion event.
 * @param {Object} metrics - Current metrics object
 * @param {boolean} passedFirstAttempt - Whether task passed verification on first try
 * @returns {Object} Updated metrics
 */
export function recordTaskCompletion(metrics, passedFirstAttempt) {
  metrics.tasksCompleted += 1;
  if (passedFirstAttempt) {
    metrics.tasksPassAt1 += 1;
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

  const passAt1Rate = metrics.tasksCompleted > 0
    ? Math.round(metrics.tasksPassAt1 / metrics.tasksCompleted * 100)
    : 0;

  const churnRate = metrics.tasksCompleted > 0
    ? Math.round(metrics.totalLinesChanged / metrics.tasksCompleted)
    : 0;

  const verifyTax = metrics.totalImplementMs > 0
    ? (metrics.totalVerifyMs / metrics.totalImplementMs).toFixed(2)
    : '0.00';

  return `Tasks: ${metrics.tasksCompleted}/${metrics.tasksTotal} (${resolutionRate}%) | Pass@1: ${passAt1Rate}% | Churn: ${churnRate} lines/task | VTax: ${verifyTax}`;
}
