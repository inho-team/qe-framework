#!/usr/bin/env node
'use strict';

/**
 * Persistent Mode — Prevents Claude from stopping prematurely during active
 * multi-step execution (SIVS loops, Wave execution, Qexecute, etc.).
 *
 * ## How it works
 *
 * When a pipeline enters persistent mode, the Stop hook blocks early termination
 * whenever Claude appears to be wrapping up. The mode is stored in
 * `unified-state.json` under the
 * `persistentMode` key so all hooks share the same truth.
 *
 * ## Integration pattern for skills
 *
 * Skills that run multi-step pipelines (e.g., Qexecute) should:
 *
 *   1. Call `enterPersistentMode(mode, reason)` at the start of execution.
 *      - mode: 'sivs-loop' | 'wave-execution' | 'qexecute' | string
 *      - reason: human-readable string explaining why stopping is blocked
 *
 *   2. Call `exitPersistentMode()` at their Handoff step, after the full
 *      pipeline completes.
 *
 * Example (inside a skill's execution logic):
 *
 *   import { enterPersistentMode, exitPersistentMode } from './lib/persistent-mode.mjs';
 *   enterPersistentMode(cwd, 'qexecute', 'Wave execution Phase 2 — 3/5 items remaining');
 *   // ... execute pipeline ...
 *   exitPersistentMode(cwd);
 *
 * The stop-handler.mjs hook reads persistent mode state automatically — no
 * additional wiring is needed.
 *
 * @module persistent-mode
 */

import { readUnifiedState, writeUnifiedState } from './state.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createProcessControllerStore } from './process-controller-store.mjs';

function persistentStoreCall(cwd, method, input, options = {}) {
  const store = createProcessControllerStore(cwd, options);
  if (!store) return { ok: false, allowed: false, code: 'PERSISTENT_STORE_UNAVAILABLE' };
  try { return store[method](input); } finally { store.close(); }
}

/** Acquire a controller-owned completion lease for one full session UUID. */
export function acquirePersistentCompletionLease(cwd, input, options = {}) {
  return persistentStoreCall(cwd, 'acquirePersistentLease', input, options);
}

/** Renew the current generation; stale tokens, fences, and generations fail closed. */
export function renewPersistentCompletionLease(cwd, input, options = {}) {
  return persistentStoreCall(cwd, 'renewPersistentLease', input, options);
}

/**
 * Resolve controller authority for a Stop hook event. A project with no QE DB
 * deliberately falls through to the legacy persistent-mode implementation.
 */
export function decidePersistentCompletionStop(cwd, event, options = {}) {
  if (!existsSync(join(cwd, '.qe', 'qe.db'))) {
    return { ok: true, code: 'PERSISTENT_LEASE_NOT_FOUND', legacy: true };
  }
  const sessionId = event?.session_id || event?.sessionId || '';
  const userText = event?.last_user_message || event?.userText || '';
  const assistantText = event?.last_assistant_message || event?.assistantText || '';
  const transcriptPath = event?.transcript_path || event?.transcriptPath || '';
  const turnId = event?.turn_id || event?.turnId || '';
  const explicitKey = event?.event_key || event?.eventKey || event?.hook_event_id;
  const eventKey = explicitKey || createHash('sha256').update(JSON.stringify([
    'qe-persistent-stop-event-v1', cwd, transcriptPath, turnId, sessionId, userText, assistantText,
  ])).digest('hex');
  return persistentStoreCall(cwd, 'decidePersistentStop', {
    eventKey, cwd, transcriptPath, turnId, userText, assistantText, sessionId,
  }, options);
}

/**
 * Enter persistent mode — registers an active pipeline execution that should
 * not be interrupted by premature stopping.
 *
 * @param {string} cwd - Project root directory
 * @param {string} mode - Pipeline identifier (e.g., 'svs-loop', 'wave-execution', 'qexecute')
 * @param {string} reason - Human-readable explanation of why stopping is blocked
 * @returns {{ active: boolean, mode: string, reason: string, startedAt: string }}
 */
export function enterPersistentMode(cwd, mode, reason) {
  const state = readUnifiedState(cwd);

  state.persistentMode = {
    active: true,
    mode: mode,
    reason: reason,
    startedAt: new Date().toISOString(),
    reinforcements: 0,
  };

  writeUnifiedState(cwd, state);
  return state.persistentMode;
}

/**
 * Exit persistent mode — clears the active pipeline lock so Claude can stop
 * normally again.
 *
 * @param {string} cwd - Project root directory
 */
export function exitPersistentMode(cwd) {
  const state = readUnifiedState(cwd);
  delete state.persistentMode;
  writeUnifiedState(cwd, state);
}

/**
 * Check whether persistent mode is currently active.
 *
 * @param {string} cwd - Project root directory
 * @returns {{ active: boolean, mode?: string, reason?: string, startedAt?: string, reinforcements?: number }}
 */
export function isPersistentModeActive(cwd) {
  const state = readUnifiedState(cwd);
  const pm = state.persistentMode;

  if (!pm || !pm.active) {
    return { active: false };
  }

  // Staleness guard: auto-expire after 30 minutes to prevent zombies
  const STALE_MS = 30 * 60 * 1000;
  if (pm.startedAt) {
    const age = Date.now() - new Date(pm.startedAt).getTime();
    if (age > STALE_MS) {
      // Auto-cleanup stale persistent mode
      delete state.persistentMode;
      try { writeUnifiedState(cwd, state); } catch {}
      return { active: false };
    }
  }

  return {
    active: true,
    mode: pm.mode,
    reason: pm.reason,
    startedAt: pm.startedAt,
    reinforcements: pm.reinforcements || 0,
  };
}

/**
 * Check persistent mode from an already-loaded unified state object.
 * Avoids an extra file read when the caller already has the state.
 *
 * @param {object} state - Unified state object (from readUnifiedState)
 * @returns {{ active: boolean, mode?: string, reason?: string, startedAt?: string, reinforcements?: number }}
 */
export function isPersistentModeActiveFromState(state) {
  const pm = state?.persistentMode;

  if (!pm || !pm.active) {
    return { active: false };
  }

  const STALE_MS = 30 * 60 * 1000;
  if (pm.startedAt) {
    const age = Date.now() - new Date(pm.startedAt).getTime();
    if (age > STALE_MS) {
      return { active: false };
    }
  }

  return {
    active: true,
    mode: pm.mode,
    reason: pm.reason,
    startedAt: pm.startedAt,
    reinforcements: pm.reinforcements || 0,
  };
}

/**
 * Get a reinforcement message to inject when Claude appears to be wrapping up
 * during an active persistent mode. Also increments the reinforcement counter.
 *
 * @param {string} cwd - Project root directory
 * @returns {string|null} Reinforcement message, or null if persistent mode is inactive
 */
export function getPersistentModeMessage(cwd) {
  const state = readUnifiedState(cwd);
  const status = isPersistentModeActiveFromState(state);

  if (!status.active) return null;

  // Increment reinforcement counter
  if (state.persistentMode) {
    state.persistentMode.reinforcements = (state.persistentMode.reinforcements || 0) + 1;
  }

  // Safety valve: after 10 reinforcements, auto-exit to prevent infinite loops
  const MAX_REINFORCEMENTS = 10;
  if (state.persistentMode.reinforcements >= MAX_REINFORCEMENTS) {
    delete state.persistentMode;
    try { writeUnifiedState(cwd, state); } catch {}
    return null;
  }

  try { writeUnifiedState(cwd, state); } catch {}

  return [
    `PERSISTENT MODE ACTIVE: ${status.mode}`,
    'Do not stop. Continue with the next step in the pipeline.',
    `Reason: ${status.reason}`,
    'Exit persistent mode only when the full pipeline completes.',
  ].join('\n');
}

/**
 * Get a reinforcement message from an already-loaded state object.
 * Does NOT increment the counter or write state (caller must handle that).
 *
 * @param {object} state - Unified state object
 * @returns {string|null} Reinforcement message, or null if inactive
 */
export function getPersistentModeMessageFromState(state) {
  const status = isPersistentModeActiveFromState(state);
  if (!status.active) return null;

  return [
    `PERSISTENT MODE ACTIVE: ${status.mode}`,
    'Do not stop. Continue with the next step in the pipeline.',
    `Reason: ${status.reason}`,
    'Exit persistent mode only when the full pipeline completes.',
  ].join('\n');
}
