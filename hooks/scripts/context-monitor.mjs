#!/usr/bin/env node
'use strict';

/**
 * Context Usage Monitor — Auto-Compaction Trigger
 *
 * Monitors context window usage and emits system directives to automatically
 * invoke Ecompact-executor when pressure thresholds are crossed.
 *
 * Behavior:
 * - At 70% of the active context window (WARNING): Emits ACTION REQUIRED directive with Agent
 *   tool invocation instructions for Ecompact-executor.
 * - At 85% of the active context window (CRITICAL): Emits MANDATORY stop-and-compact directive.
 *   Overrides cooldown.
 *
 * Design notes:
 * - Pressure zones are governed by core/CONTEXT_BUDGET.md and evaluated as
 *   ratios of the active model window. The live ratio is sourced through
 *   context-meter:
 *     1. readCachedRatio() — recent cached live-window reading, when present.
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
import { readCachedRatio, readCachedLimit, readConfiguredLimit, readDetectedLimit, readNativeCodexWindow, writeCachedLimit, writeDetectedLimit, estimateUsage, modelIdToLimit } from './lib/context-meter.mjs';
import {
  CONTEXT_POLICY_DEFAULTS,
  CONTEXT_SEVERITY,
  CONTEXT_SEVERITY_ORDER,
  estimateContextSeverityFromRatio,
  loadContextPolicy,
  usedTokensFromRatio,
} from './lib/context-policy.mjs';

// Cooldown period: 5 minutes after a compaction trigger
const COMPACTION_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Build context pressure message with the current usage.
 * Returns a system-instruction-style directive for auto-compaction.
 *
 * @param {string} severity - CONTEXT_SEVERITY.WARNING or CONTEXT_SEVERITY.CRITICAL
 * @param {number} ratio - Live context usage ratio in [0, 1]
 * @param {number} limit - Model context-window token limit (for labelling)
 * @param {number} usedTokens - Live context tokens used.
 * @returns {string} Formatted directive message
 */
function buildDirectiveMessage(severity, ratio, limit, usedTokens, verified = true) {
  const pct = Math.round(ratio * 100);
  const usedK = Math.round(usedTokens / 1000);
  const limitK = Math.round(limit / 1000);
  const label = `${pct}% (~${usedK}k / ${limitK}k tokens)`;

  // Unverified denominator: the true window tier was never proven this session
  // (no cached/configured/detected limit, token count
  // still below the 200k base). The percentage is computed against a GUESSED
  // 200k default and may be wildly high on a 1M run \u2014 so we never hard-stop on
  // it; we surface a soft, clearly-flagged note instead.
  if (!verified) {
    return [
      `\u26A0\uFE0F CONTEXT PRESSURE (estimated): ${label}`,
      'NOTE: window size is unverified \u2014 this % may be',
      'over-stated on a 1M-context model. Confirm the active model window before compacting.',
      'No forced compaction.',
    ].join('\n');
  }

  if (severity === CONTEXT_SEVERITY.CRITICAL) {
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
 * Estimate context severity from live window usage.
 *
 * @param {number} ratio - Live context usage ratio.
 * @param {number} limit - Active context-window token limit.
 * @param {object} policy - Context policy loaded from core/CONTEXT_BUDGET.md.
 * @returns {string} Severity level (none | warning | critical)
 */
export function estimateSeverity(ratio, limit, policy) {
  return estimateContextSeverityFromRatio(ratio, limit, policy);
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
export function shouldDebounce(currentSeverity, stats, policy) {
  const lastSeverity = stats.warning_severity || CONTEXT_SEVERITY.NONE;
  const lastWarningCall = stats.last_warning_call || 0;
  const debounceCount = policy.debounce_tool_calls;

  // No previous warning — never suppress
  if (lastWarningCall === 0 && lastSeverity === CONTEXT_SEVERITY.NONE) return false;

  // Severity escalated — bypass debounce
  if (CONTEXT_SEVERITY_ORDER[currentSeverity] > CONTEXT_SEVERITY_ORDER[lastSeverity]) return false;

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
  * At 70% of the active context window (WARNING / Orange zone), emits a system directive instructing
  * Claude to invoke Ecompact-executor. At 85% (CRITICAL / Red zone),
 * emits a mandatory stop-and-compact directive. A 5-minute cooldown prevents
 * re-triggering after a compaction has already been initiated.
 *
 * @param {string} cwd - Project working directory
 * @param {object} [preloadedStats] - Pre-read session stats (avoids duplicate file I/O)
 * @param {object} [preloadedCfg] - Pre-read config (avoids duplicate loadConfig call)
 * @param {{ transcriptPath?: string, modelId?: string, client?: string, sessionId?: string }} [opts] - Live-window
 *   hints. transcriptPath enables the fallback ratio estimate; modelId selects
 *   the correct window limit (200k vs 1M) for that estimate and for labelling.
 * @returns {{ message: string|null, severity: string, stats: object }}
 */
export function checkContextPressure(cwd, preloadedStats, preloadedCfg, opts = {}) {
  const policy = loadContextPolicy();

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
        return { message: null, severity: CONTEXT_SEVERITY.NONE, stats };
      }
    }
  }

  // Resolve the live context-usage ratio. Prefer a cached live reading; fall
  // back to the latest transcript usage entry divided by the model limit.
  // The accumulated stats.usage.input_tokens sum is intentionally NOT used —
  // it grows unbounded and is not a measure of live window occupancy.
  // Prefer configured/detected limits so the fallback estimate and label
  // denominator survive a stripped `[1m]` marker.
  // Without a configured/detected limit, a 1M run
  // would resolve to the 200k default and falsely flag "critical" at ~14% fill.
  const cacheScope = {
    client: opts.client || process.env.QE_CLIENT || 'claude',
    sessionId: opts.sessionId || '',
    modelId: opts.modelId || '',
  };
  const nativeLimit = cacheScope.client === 'codex' ? readNativeCodexWindow() : null;
  const knownLimit = nativeLimit
    ?? readCachedLimit(cwd, cacheScope)
    ?? readConfiguredLimit(cwd, { includeProjectConfig: false })
    ?? readDetectedLimit(cwd, opts.modelId);
  const cachedRatio = readCachedRatio(cwd, cacheScope);
  let ratio = cachedRatio;
  let limit = knownLimit ?? modelIdToLimit(opts.modelId);
  // A reading is trustworthy only when its denominator is PROVEN, not guessed:
  //   - cachedRatio: cached live-window reading, or
  //   - knownLimit: a back-solved / configured / previously-detected window, or
  //   - a transcript reading whose tokens passed the 200k base (deterministic 1M).
  // Otherwise the limit is the bare 200k default — a guess that over-states a 1M run.
  let limitVerified = knownLimit !== null;
  if (ratio === null) {
    const u = opts.transcriptPath
      ? estimateUsage(opts.transcriptPath, { modelId: opts.modelId, modelLimit: knownLimit ?? undefined })
      : null;
    if (u) {
      ratio = u.ratio;
      limit = u.limit;
      // Sticky 1M: once a reading deterministically proves the 1M tier, persist
      // it so later sub-200k readings this session aren't mis-scored against 200k.
      // Also persist DURABLY (model-keyed, survives a state-folder wipe) so the
      // detection holds across sessions — the backbone of self-correction.
      if (u.limit === CONTEXT_POLICY_DEFAULTS.extended_window_tokens) {
        limitVerified = true;
        if (!knownLimit) {
          writeCachedLimit(cwd, CONTEXT_POLICY_DEFAULTS.extended_window_tokens, cacheScope);
          writeDetectedLimit(cwd, opts.modelId, CONTEXT_POLICY_DEFAULTS.extended_window_tokens);
        }
      }
    } else {
      ratio = 0;
    }
  }

  const usedTokens = usedTokensFromRatio(ratio, limit);
  let severity = estimateSeverity(ratio, limit, policy);
  // Safety net: never escalate to a MANDATORY stop-and-compact on an unverified
  // (guessed-200k) denominator. A 1M run whose tier isn't yet proven would
  // otherwise be flagged "critical" near ~17% real fill and falsely told to halt.
  if (!limitVerified && severity === CONTEXT_SEVERITY.CRITICAL) {
    severity = CONTEXT_SEVERITY.WARNING;
  }

  if (severity === CONTEXT_SEVERITY.NONE) {
    return { message: null, severity, stats };
  }

  // Check compaction cooldown — if recently triggered, suppress unless severity escalated
  try {
    const unified = readUnifiedState(cwd);
    const compactionState = unified.contextCompaction;
    if (compactionState && isInCooldown(compactionState)) {
      // Even during cooldown, CRITICAL always breaks through
      if (severity !== CONTEXT_SEVERITY.CRITICAL) {
        return { message: null, severity, stats };
      }
    }
  } catch {
    // Fault-tolerant: proceed with alert if state read fails
  }

  // Debounce check (tool-call-based, separate from cooldown)
  if (shouldDebounce(severity, stats, policy)) {
    return { message: null, severity, stats };
  }

  // Update stats with warning metadata
  stats.warning_severity = severity;
  stats.last_warning_ratio = ratio;
  stats.last_warning_tokens = usedTokens;
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
  let message = buildDirectiveMessage(severity, ratio, limit, usedTokens, limitVerified);

  // Record compaction trigger in unified-state (sets cooldown)
  recordCompactionTrigger(cwd);

  return { message, severity, stats };
}
