#!/usr/bin/env node
'use strict';

/**
 * Context Usage Monitor
 *
 * Monitors context window usage via tool call count as a proxy for context
 * consumption. Provides WARNING (35% estimated remaining) and CRITICAL
 * (25% estimated remaining) alerts with debounce logic.
 *
 * Design notes:
 * - Claude Code does not expose context remaining directly — tool call count
 *   is used as an approximation. The threshold mapping is abstracted so it
 *   can be swapped for real metrics when the API supports them.
 * - Debounce: after the first alert, suppress re-alerts for 5 tool calls
 *   unless severity escalates.
 * - State is persisted in session-stats.json alongside existing fields.
 * - Does not use imperative tone toward the user (GSD principle).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteJson } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';

// --- Severity levels ---
const SEVERITY = {
  NONE: 'none',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

// Severity ordering for escalation comparison
const SEVERITY_ORDER = { none: 0, warning: 1, critical: 2 };

// --- Default thresholds (tool-call-count-based proxy) ---
// These map to approximate context remaining percentages:
//   WARNING  (~35% remaining) => 150 tool calls
//   CRITICAL (~25% remaining) => 250 tool calls
// Values can be overridden via .qe/config.json hooks section.
const DEFAULT_THRESHOLDS = {
  context_warning_calls: 150,   // ~35% remaining
  context_critical_calls: 250,  // ~25% remaining
  context_debounce_count: 5,    // suppress re-alert for N tool calls
};

// --- Messages (non-imperative tone) ---
const MESSAGES = {
  [SEVERITY.WARNING]: [
    '[Context Monitor - WARNING] Estimated ~35% context remaining.',
    'Starting new complex tasks at this point may lead to incomplete results.',
    'It may be a good time to wrap up current work or consolidate progress.',
    'Running /Qcompact can help reclaim context space.',
  ].join(' '),

  [SEVERITY.CRITICAL]: [
    '[Context Monitor - CRITICAL] Context usage is at a critical level — estimated ~25% remaining.',
    'Context exhaustion is imminent.',
    'Running Ecompact-executor now is strongly recommended to preserve session continuity.',
    'If in Utopia mode, Ecompact-executor will handle compaction automatically.',
  ].join(' '),
};

/**
 * Estimate context severity based on tool call count.
 *
 * Abstraction layer: when Claude Code exposes real context metrics,
 * replace this function body without changing the interface.
 *
 * @param {number} toolCalls - Current tool call count
 * @param {object} thresholds - Threshold configuration
 * @returns {string} Severity level (SEVERITY.NONE | WARNING | CRITICAL)
 */
export function estimateSeverity(toolCalls, thresholds) {
  if (toolCalls >= thresholds.context_critical_calls) {
    return SEVERITY.CRITICAL;
  }
  if (toolCalls >= thresholds.context_warning_calls) {
    return SEVERITY.WARNING;
  }
  return SEVERITY.NONE;
}

/**
 * Check whether the alert should be suppressed by debounce logic.
 *
 * Rules:
 * 1. If no previous warning — do not suppress.
 * 2. If severity escalated since last warning — do not suppress (bypass).
 * 3. If fewer than debounce_count tool calls since last warning — suppress.
 *
 * @param {string} currentSeverity
 * @param {object} stats - session-stats.json data
 * @param {object} thresholds
 * @returns {boolean} true if alert should be suppressed
 */
export function shouldDebounce(currentSeverity, stats, thresholds) {
  const lastSeverity = stats.warning_severity || SEVERITY.NONE;
  const lastWarningAt = stats.last_warning_at || 0;
  const debounceCount = thresholds.context_debounce_count;

  // No previous warning — never suppress
  if (lastWarningAt === 0) return false;

  // Severity escalated — bypass debounce
  if (SEVERITY_ORDER[currentSeverity] > SEVERITY_ORDER[lastSeverity]) return false;

  // Within debounce window — suppress
  const callsSinceWarning = (stats.tool_calls || 0) - lastWarningAt;
  return callsSinceWarning < debounceCount;
}

/**
 * Main entry point: evaluate context pressure and return an alert if needed.
 *
 * @param {string} cwd - Project working directory
 * @returns {{ message: string|null, severity: string }}
 */
export function checkContextPressure(cwd) {
  const cfg = loadConfig(cwd);
  const thresholds = {
    context_warning_calls: cfg.context_warning_calls ?? cfg.context_pressure_warn ?? DEFAULT_THRESHOLDS.context_warning_calls,
    context_critical_calls: cfg.context_critical_calls ?? DEFAULT_THRESHOLDS.context_critical_calls,
    context_debounce_count: cfg.context_debounce_count ?? DEFAULT_THRESHOLDS.context_debounce_count,
  };

  // Read session stats
  const statsFile = join(cwd, '.qe', 'state', 'session-stats.json');
  let stats = { tool_calls: 0, session_start: Date.now() };

  if (existsSync(statsFile)) {
    try {
      stats = JSON.parse(readFileSync(statsFile, 'utf8'));
    } catch {
      return { message: null, severity: SEVERITY.NONE };
    }
  }

  const toolCalls = stats.tool_calls || 0;
  const severity = estimateSeverity(toolCalls, thresholds);

  if (severity === SEVERITY.NONE) {
    return { message: null, severity };
  }

  // Debounce check
  if (shouldDebounce(severity, stats, thresholds)) {
    return { message: null, severity };
  }

  // Update stats with warning metadata
  stats.last_warning_at = toolCalls;
  stats.warning_severity = severity;
  stats.debounce_counter = (stats.debounce_counter || 0) + 1;

  try {
    atomicWriteJson(statsFile, stats);
  } catch {
    // Fault-tolerant: proceed even if write fails
  }

  // Check Utopia mode for tailored message
  let message = MESSAGES[severity];
  const utopiaFile = join(cwd, '.qe', 'state', 'utopia-state.json');
  if (severity === SEVERITY.CRITICAL) {
    try {
      if (existsSync(utopiaFile)) {
        const utopiaState = JSON.parse(readFileSync(utopiaFile, 'utf8'));
        if (utopiaState.enabled === true) {
          message = [
            '[Context Monitor - CRITICAL] Estimated ~25% context remaining.',
            'Context exhaustion is imminent in Utopia mode.',
            'Ecompact-executor should be triggered now to preserve autonomous session continuity.',
          ].join(' ');
        }
      }
    } catch {
      // Fault-tolerant: use default message
    }
  }

  return { message, severity };
}
