#!/usr/bin/env node
'use strict';

/**
 * Ralph State — Qexecute -utopia Ralph integration state management, rate limiting,
 * progress tracking, and report generation.
 *
 * Ralph state is stored in `.qe/state/unified-state.json`'s `ralph` namespace and provides:
 *   - Initialization with mode, task source, and configuration
 *   - Rate limiting (max requests per hour)
 *   - Circuit breaker (consecutive failure tracking)
 *   - Loop counting and progress updates
 *   - Report generation with duration and completion stats
 *   - Auto-migration from legacy ralph-state.json
 *
 * Integration pattern:
 *
 *   import {
 *     createRalphState,
 *     readRalphState,
 *     incrementLoop,
 *     checkRateLimit,
 *     recordCircuitBreaker,
 *     cleanupRalphState,
 *     generateReport,
 *   } from './lib/ralph-state.mjs';
 *
 *   const cwd = process.cwd();
 *
 *   // Initialize
 *   createRalphState(cwd, {
 *     mode: 'work',
 *     taskSource: '/path/to/VERIFY_CHECKLIST',
 *     maxLoops: 50,
 *     maxPerHour: 100,
 *     maxConsecutiveFailures: 3,
 *   });
 *
 *   // Check rate limit before loop
 *   const rateLimitCheck = checkRateLimit(cwd);
 *   if (!rateLimitCheck.allowed) {
 *     console.log(`Rate limited. Reset in ${rateLimitCheck.resetIn}ms`);
 *     process.exit(1);
 *   }
 *
 *   // Execute loop
 *   const loopResult = incrementLoop(cwd);
 *   if (loopResult.exceeded) {
 *     console.log('Max loops exceeded');
 *     process.exit(1);
 *   }
 *
 *   // Record success/failure
 *   const cbResult = recordCircuitBreaker(cwd, true); // success
 *   if (cbResult.tripped) {
 *     console.log('Circuit breaker tripped');
 *     process.exit(1);
 *   }
 *
 *   // Update progress
 *   updateRalphProgress(cwd, { completed: 5, remaining: 7 });
 *
 *   // Print progress
 *   const msg = formatProgressMessage(cwd); // "5/12 done (42%) — Loop #1"
 *   console.log(msg);
 *
 *   // Generate final report
 *   generateReport(cwd);
 *
 *   // Cleanup
 *   cleanupRalphState(cwd);
 *
 * @module ralph-state
 */

import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { readUnifiedState, writeUnifiedState, getNamespace, setNamespace, atomicWriteJson } from './state.mjs';
import { exitPersistentMode } from './persistent-mode.mjs';

/**
 * Get ralph report file path
 * @param {string} cwd - Project root directory
 * @returns {string} Absolute path to .qe/state/ralph-report.json
 */
function getRalphReportPath(cwd) {
  return join(cwd, '.qe', 'state', 'ralph-report.json');
}

/**
 * Auto-migrate from standalone ralph-state.json to unified-state namespace.
 * Called once on first read; deletes the standalone file after migration.
 * @param {string} cwd - Project root directory
 */
function migrateIfNeeded(cwd) {
  const legacyPath = join(cwd, '.qe', 'state', 'ralph-state.json');
  if (existsSync(legacyPath)) {
    try {
      const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
      const state = readUnifiedState(cwd);
      if (!state.ralph || !state.ralph.enabled) {
        state.ralph = legacy;
        writeUnifiedState(cwd, state);
      }
      unlinkSync(legacyPath);
    } catch {}
  }
}

/**
 * Create ralph state in unified-state.json's `ralph` namespace with defaults.
 * Initializes a new ralph state object with mode, task source, and configuration
 * for rate limiting, loop counting, and circuit breaker tracking.
 *
 * @param {string} cwd - Project root directory
 * @param {object} options - Configuration options
 * @param {string} options.mode - 'work' | 'qa' or other mode string
 * @param {string} options.taskSource - Path to VERIFY_CHECKLIST file
 * @param {number} [options.maxLoops=50] - Maximum loop count before exit
 * @param {number} [options.maxPerHour=100] - Rate limit: max requests per hour
 * @param {number} [options.maxConsecutiveFailures=3] - Circuit breaker threshold
 * @returns {object} Created state object with enabled, mode, progress, and metadata
 */
export function createRalphState(cwd, options) {
  const now = new Date().toISOString();
  const ralphData = {
    enabled: true,
    mode: options.mode || 'work',
    taskSource: options.taskSource || '',
    progress: {
      total: 0,
      completed: 0,
      remaining: 0,
      skipped: 0,
    },
    loopCount: 0,
    maxLoops: options.maxLoops ?? 50,
    rateLimit: {
      maxPerHour: options.maxPerHour ?? 100,
      currentHourCount: 0,
      hourStart: now,
    },
    circuitBreaker: {
      consecutiveFailures: 0,
      maxConsecutiveFailures: options.maxConsecutiveFailures ?? 3,
    },
    startedAt: now,
    lastLoopAt: now,
  };

  const state = readUnifiedState(cwd);
  setNamespace(cwd, state, 'ralph', ralphData);

  return ralphData;
}

/**
 * Read ralph state from unified-state.json's `ralph` namespace.
 * Auto-migrates from legacy ralph-state.json if needed.
 * Returns parsed state object or null if not enabled or missing.
 *
 * @param {string} cwd - Project root directory
 * @returns {object|null} Parsed state object, or null if not enabled
 */
export function readRalphState(cwd) {
  migrateIfNeeded(cwd);

  const state = readUnifiedState(cwd);
  const ralph = getNamespace(state, 'ralph');

  if (!ralph.enabled) {
    return null;
  }

  return ralph;
}

/**
 * Update ralph progress with given progress object.
 * Merges progress fields and updates lastLoopAt timestamp.
 *
 * @param {string} cwd - Project root directory
 * @param {object} progress - Progress delta/updates (completed, remaining, skipped, etc.)
 * @returns {object|null} Updated state, or null if state missing
 */
export function updateRalphProgress(cwd, progress) {
  const unifiedState = readUnifiedState(cwd);
  const ralph = getNamespace(unifiedState, 'ralph');

  if (!ralph.enabled) return null;

  ralph.progress = {
    ...ralph.progress,
    ...progress,
  };
  ralph.lastLoopAt = new Date().toISOString();

  setNamespace(cwd, unifiedState, 'ralph', ralph);

  return ralph;
}

/**
 * Check rate limit: compare current time against hourStart.
 * If > 1h has elapsed, reset currentHourCount to 0 and update hourStart.
 *
 * @param {string} cwd - Project root directory
 * @returns {object} { allowed: boolean, remaining: number, resetIn: number }
 */
export function checkRateLimit(cwd) {
  const unifiedState = readUnifiedState(cwd);
  const ralph = getNamespace(unifiedState, 'ralph');

  if (!ralph.enabled) {
    return { allowed: true, remaining: -1, resetIn: 0 };
  }

  const now = new Date();
  const hourStart = new Date(ralph.rateLimit.hourStart);
  const elapsedMs = now - hourStart;
  const HOUR_MS = 60 * 60 * 1000;

  // If > 1 hour has elapsed, reset
  if (elapsedMs > HOUR_MS) {
    ralph.rateLimit.currentHourCount = 0;
    ralph.rateLimit.hourStart = now.toISOString();
    ralph.lastLoopAt = now.toISOString();

    setNamespace(cwd, unifiedState, 'ralph', ralph);

    const remaining = ralph.rateLimit.maxPerHour;
    return { allowed: true, remaining, resetIn: 0 };
  }

  const remaining = ralph.rateLimit.maxPerHour - ralph.rateLimit.currentHourCount;
  const allowed = remaining > 0;
  const resetIn = HOUR_MS - elapsedMs;

  return { allowed, remaining, resetIn };
}

/**
 * Increment loop count and rate limit counter.
 * Updates lastLoopAt and increments rateLimit.currentHourCount.
 *
 * @param {string} cwd - Project root directory
 * @returns {object} { exceeded: boolean, loopCount: number, maxLoops: number }
 */
export function incrementLoop(cwd) {
  const unifiedState = readUnifiedState(cwd);
  const ralph = getNamespace(unifiedState, 'ralph');

  if (!ralph.enabled) {
    return { exceeded: true, loopCount: 0, maxLoops: 50 };
  }

  ralph.loopCount += 1;
  ralph.rateLimit.currentHourCount += 1;
  ralph.lastLoopAt = new Date().toISOString();

  setNamespace(cwd, unifiedState, 'ralph', ralph);

  const exceeded = ralph.loopCount >= ralph.maxLoops;
  return { exceeded, loopCount: ralph.loopCount, maxLoops: ralph.maxLoops };
}

/**
 * Record circuit breaker state: reset on success, increment on failure.
 * If consecutiveFailures >= maxConsecutiveFailures, circuit is tripped.
 *
 * @param {string} cwd - Project root directory
 * @param {boolean} success - True if operation succeeded, false otherwise
 * @returns {object} { tripped: boolean, consecutiveFailures: number, max: number }
 */
export function recordCircuitBreaker(cwd, success) {
  const unifiedState = readUnifiedState(cwd);
  const ralph = getNamespace(unifiedState, 'ralph');

  if (!ralph.enabled) {
    return { tripped: false, consecutiveFailures: 0, max: 3 };
  }

  if (success) {
    ralph.circuitBreaker.consecutiveFailures = 0;
  } else {
    ralph.circuitBreaker.consecutiveFailures += 1;
  }

  ralph.lastLoopAt = new Date().toISOString();

  setNamespace(cwd, unifiedState, 'ralph', ralph);

  const tripped = ralph.circuitBreaker.consecutiveFailures >= ralph.circuitBreaker.maxConsecutiveFailures;
  return {
    tripped,
    consecutiveFailures: ralph.circuitBreaker.consecutiveFailures,
    max: ralph.circuitBreaker.maxConsecutiveFailures,
  };
}

/**
 * Clean up ralph state: deletes the ralph namespace and exits persistent mode.
 *
 * @param {string} cwd - Project root directory
 */
export function cleanupRalphState(cwd) {
  const state = readUnifiedState(cwd);
  delete state.ralph;
  writeUnifiedState(cwd, state);

  // Exit persistent mode
  try {
    exitPersistentMode(cwd);
  } catch {}
}

/**
 * Generate completion report: reads current state, computes duration,
 * writes .qe/state/ralph-report.json with completion metadata.
 *
 * @param {string} cwd - Project root directory
 * @returns {object|null} Report object, or null if state missing
 */
export function generateReport(cwd) {
  const unifiedState = readUnifiedState(cwd);
  const ralph = getNamespace(unifiedState, 'ralph');

  if (!ralph.enabled) return null;

  const now = new Date();
  const startedAt = new Date(ralph.startedAt);
  const durationMs = now - startedAt;

  const report = {
    completedAt: now.toISOString(),
    totalLoops: ralph.loopCount,
    durationMs,
    progress: ralph.progress,
    skipped: ralph.progress.skipped || 0,
    failed: ralph.circuitBreaker.consecutiveFailures,
    circuitBreakerTripped: ralph.circuitBreaker.consecutiveFailures >= ralph.circuitBreaker.maxConsecutiveFailures,
  };

  const filePath = getRalphReportPath(cwd);
  atomicWriteJson(filePath, report);

  return report;
}

/**
 * Format a progress message from current ralph state.
 * Returns string like "7/12 done (58%) — Loop #4" or empty string if state missing.
 *
 * @param {string} cwd - Project root directory
 * @returns {string} Formatted progress message
 */
export function formatProgressMessage(cwd) {
  const unifiedState = readUnifiedState(cwd);
  const ralph = getNamespace(unifiedState, 'ralph');

  if (!ralph.enabled) return '';

  const { completed, total } = ralph.progress;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const loopNum = ralph.loopCount;

  return `${completed}/${total} done (${percent}%) — Loop #${loopNum}`;
}
