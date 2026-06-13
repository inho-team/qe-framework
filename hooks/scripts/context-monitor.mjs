#!/usr/bin/env node
'use strict';

/**
 * Context Usage Monitor — Auto-Compaction Trigger
 *
 * Monitors context window usage and emits system directives to automatically
 * invoke Ecompact-executor when pressure thresholds are crossed.
 *
 * Behavior:
 * - At 70% of the window (WARNING): Emits ACTION REQUIRED directive with Agent
 *   tool invocation instructions for Ecompact-executor.
 * - At 85% of the window (CRITICAL): Emits MANDATORY stop-and-compact directive.
 *   Overrides cooldown.
 *
 * Design notes:
 * - Pressure is judged as a RATIO of the live context window, not as an
 *   absolute token count. The ratio is sourced the same way the HUD and the
 *   Stop hook (context-guard) source it — via context-meter:
 *     1. readCachedRatio() — Claude Code's authoritative statusline reading.
 *     2. estimateUsageRatio() — latest transcript `usage` entry / model limit.
 *   This makes the monitor model-aware: a 1M-context model (e.g.
 *   `claude-opus-4-8[1m]`) is no longer falsely flagged "critical" at ~17% of
 *   its real window, which previously happened because the old code compared an
 *   ACCUMULATED `input_tokens` sum against a hardcoded 170k / 200k limit.
 * - Debounce: after the first alert, suppress re-alerts for 5 tool calls
 *   unless severity escalates.
 * - Cooldown: after a compaction trigger, suppress re-triggers for 5 minutes
 *   (tracked in unified-state.json contextCompaction field). CRITICAL
 *   severity bypasses cooldown.
 * - State is persisted in session-stats.json alongside existing fields.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteJson, readUnifiedState, writeUnifiedState } from './lib/state.mjs';
import { loadConfig } from './lib/config.mjs';
import { readCachedRatio, readCachedLimit, writeCachedLimit, estimateUsage, modelIdToLimit } from './lib/context-meter.mjs';

// Cooldown period: 5 minutes after a compaction trigger
const COMPACTION_COOLDOWN_MS = 5 * 60 * 1000;

// --- Severity levels ---
const SEVERITY = {
  NONE: 'none',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

// Severity ordering for escalation comparison
const SEVERITY_ORDER = { none: 0, warning: 1, critical: 2 };

// --- Default thresholds (ratio-based metrics) ---
// Pressure is a fraction of the LIVE context window, independent of model size:
//   WARNING  => 70% used (~30% remaining)
//   CRITICAL => 85% used (~15% remaining)
// Values can be overridden via .qe/config.json hooks section.
const DEFAULT_THRESHOLDS = {
  context_warning_ratio: 0.70,   // ~30% remaining
  context_critical_ratio: 0.85,  // ~15% remaining
  context_debounce_count: 5,     // suppress re-alert for N tool calls
};

/**
 * Build context pressure message with the current usage ratio.
 * Returns a system-instruction-style directive for auto-compaction.
 *
 * @param {string} severity - SEVERITY.WARNING or SEVERITY.CRITICAL
 * @param {number} ratio - Live context usage ratio in [0, 1]
 * @param {number} limit - Model context-window token limit (for labelling)
 * @returns {string} Formatted directive message
 */
function buildDirectiveMessage(severity, ratio, limit) {
  const pct = Math.round(ratio * 100);
  const usedK = Math.round((ratio * limit) / 1000);
  const limitK = Math.round(limit / 1000);
  const label = `${pct}% (~${usedK}k / ${limitK}k tokens)`;

  if (severity === SEVERITY.CRITICAL) {
    return [
      `\u{1F534} CRITICAL CONTEXT PRESSURE: ${label}`,
      'MANDATORY: Stop current work. Invoke Ecompact-executor immediately.',
      'Context will be lost if you continue without compaction.',
      `Run: Agent tool \u2192 subagent_type: "Ecompact-executor", prompt: "Auto-compaction triggered at ${pct}% context"`,
    ].join('\n');
  }

  // WARNING (Yellow zone)
  return [
    `\u26A0\uFE0F CONTEXT PRESSURE: ${label} (Yellow zone)`,
    'ACTION REQUIRED: Invoke Ecompact-executor to save context snapshot before continuing.',
    `Run: Agent tool \u2192 subagent_type: "Ecompact-executor", prompt: "Auto-compaction triggered at ${pct}% context"`,
  ].join('\n');
}

/**
 * Estimate context severity from the live usage ratio.
 *
 * @param {number} ratio - Live context usage ratio in [0, 1]
 * @param {object} thresholds - Threshold configuration (ratio-based)
 * @returns {string} Severity level (SEVERITY.NONE | WARNING | CRITICAL)
 */
export function estimateSeverity(ratio, thresholds) {
  const r = typeof ratio === 'number' ? ratio : 0;
  if (r >= thresholds.context_critical_ratio) {
    return SEVERITY.CRITICAL;
  }
  if (r >= thresholds.context_warning_ratio) {
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
  const lastWarningCall = stats.last_warning_call || 0;
  const debounceCount = thresholds.context_debounce_count;

  // No previous warning — never suppress
  if (lastWarningCall === 0 && lastSeverity === SEVERITY.NONE) return false;

  // Severity escalated — bypass debounce
  if (SEVERITY_ORDER[currentSeverity] > SEVERITY_ORDER[lastSeverity]) return false;

  // Within debounce window — suppress (measured in tool calls since last warning)
  const callsSinceWarning = (stats.tool_calls || 0) - lastWarningCall;
  return callsSinceWarning < debounceCount;
}

/**
 * Check whether compaction is in cooldown (recently triggered).
 *
 * @param {object} compactionState - contextCompaction object from unified-state
 * @returns {boolean} true if still in cooldown
 */
function isInCooldown(compactionState) {
  if (!compactionState || !compactionState.cooldownUntil) return false;
  return Date.now() < new Date(compactionState.cooldownUntil).getTime();
}

/**
 * Record that compaction was auto-triggered in unified-state.
 *
 * @param {string} cwd - Project working directory
 */
function recordCompactionTrigger(cwd) {
  try {
    const unified = readUnifiedState(cwd);
    const now = new Date().toISOString();
    unified.contextCompaction = {
      lastTriggeredAt: now,
      autoTriggered: true,
      cooldownUntil: new Date(Date.now() + COMPACTION_COOLDOWN_MS).toISOString(),
    };
    writeUnifiedState(cwd, unified);
  } catch {
    // Fault-tolerant: proceed even if state update fails
  }
}

/**
 * Main entry point: evaluate context pressure and return an alert if needed.
 *
 * At 140k tokens (WARNING / Yellow zone), emits a system directive instructing
 * Claude to invoke Ecompact-executor. At 170k tokens (CRITICAL / Red zone),
 * emits a mandatory stop-and-compact directive. A 5-minute cooldown prevents
 * re-triggering after a compaction has already been initiated.
 *
 * @param {string} cwd - Project working directory
 * @param {object} [preloadedStats] - Pre-read session stats (avoids duplicate file I/O)
 * @param {object} [preloadedCfg] - Pre-read config (avoids duplicate loadConfig call)
 * @param {{ transcriptPath?: string, modelId?: string }} [opts] - Live-window
 *   hints. transcriptPath enables the fallback ratio estimate; modelId selects
 *   the correct window limit (200k vs 1M) for that estimate and for labelling.
 * @returns {{ message: string|null, severity: string, stats: object }}
 */
export function checkContextPressure(cwd, preloadedStats, preloadedCfg, opts = {}) {
  const cfg = preloadedCfg || loadConfig(cwd);
  const thresholds = {
    context_warning_ratio: cfg.context_warning_ratio ?? DEFAULT_THRESHOLDS.context_warning_ratio,
    context_critical_ratio: cfg.context_critical_ratio ?? DEFAULT_THRESHOLDS.context_critical_ratio,
    context_debounce_count: cfg.context_debounce_count ?? DEFAULT_THRESHOLDS.context_debounce_count,
  };

  // Use pre-loaded stats or read from disk (fallback for standalone usage)
  let stats;
  let statsFile = null;
  if (preloadedStats) {
    stats = preloadedStats;
  } else {
    statsFile = join(cwd, '.qe', 'state', 'session-stats.json');
    stats = { tool_calls: 0, session_start: Date.now(), usage: { input_tokens: 0 } };
    if (existsSync(statsFile)) {
      try {
        stats = JSON.parse(readFileSync(statsFile, 'utf8'));
      } catch {
        return { message: null, severity: SEVERITY.NONE, stats };
      }
    }
  }

  // Resolve the LIVE context-usage ratio the same way the HUD / Stop hook do.
  // Prefer Claude Code's authoritative statusline reading (model-aware); fall
  // back to the latest transcript usage entry divided by the model limit.
  // The accumulated stats.usage.input_tokens sum is intentionally NOT used —
  // it grows unbounded and is not a measure of live window occupancy.
  // The statusline persists the true window limit (200k vs 1M); prefer it so
  // the fallback estimate and the label denominator survive a stripped `[1m]`
  // marker. Falls back to id-based resolution when no statusline has run yet.
  const cachedLimit = readCachedLimit(cwd);
  let ratio = readCachedRatio(cwd);
  let limit = cachedLimit ?? modelIdToLimit(opts.modelId);
  if (ratio === null) {
    const u = opts.transcriptPath
      ? estimateUsage(opts.transcriptPath, { modelId: opts.modelId, modelLimit: cachedLimit ?? undefined })
      : null;
    if (u) {
      ratio = u.ratio;
      limit = u.limit;
      // Sticky 1M: once a reading deterministically proves the 1M tier, persist
      // it so later sub-200k readings this session aren't mis-scored against 200k.
      if (!cachedLimit && u.limit === 1000000) writeCachedLimit(cwd, 1000000);
    } else {
      ratio = 0;
    }
  }

  const severity = estimateSeverity(ratio, thresholds);

  if (severity === SEVERITY.NONE) {
    return { message: null, severity, stats };
  }

  // Check compaction cooldown — if recently triggered, suppress unless severity escalated
  try {
    const unified = readUnifiedState(cwd);
    const compactionState = unified.contextCompaction;
    if (compactionState && isInCooldown(compactionState)) {
      // Even during cooldown, CRITICAL always breaks through
      if (severity !== SEVERITY.CRITICAL) {
        return { message: null, severity, stats };
      }
    }
  } catch {
    // Fault-tolerant: proceed with alert if state read fails
  }

  // Debounce check (tool-call-based, separate from cooldown)
  if (shouldDebounce(severity, stats, thresholds)) {
    return { message: null, severity, stats };
  }

  // Update stats with warning metadata
  stats.warning_severity = severity;
  stats.last_warning_ratio = ratio;
  // Debounce is measured in tool calls since the last warning
  stats.last_warning_call = stats.tool_calls || 0;

  // Only write to disk when stats were loaded from disk (not preloaded).
  // When preloadedStats is provided, the caller owns the write lifecycle.
  if (!preloadedStats && statsFile) {
    try {
      atomicWriteJson(statsFile, stats);
    } catch {
      // Fault-tolerant: proceed even if write fails
    }
  }

  // Build directive message from the live usage ratio
  let message = buildDirectiveMessage(severity, ratio, limit);

  // Record compaction trigger in unified-state (sets cooldown)
  recordCompactionTrigger(cwd);

  return { message, severity, stats };
}
