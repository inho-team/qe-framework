#!/usr/bin/env node
'use strict';

/**
 * loop-guard.mjs — SIVS loop-safety limits (Phase 3 / R005, R006).
 *
 * Two per-UUID counters live in `unified-state.json` under `sivs_loops[uuid]`:
 *   - reentry           : backward-routing hops within one remediation attempt (limit = depth, default 5).
 *   - remediation_rounds: full-loop restarts, i.e. REMEDIATION_REQUEST files created (limit 3).
 * Key = the FULL task UUID (never the 8-char failure-capture slug — the two systems must stay disjoint).
 *
 * Enforcement (see DECISION_LOG D-5033dbc3-1):
 *   - R006 is deterministically enforced by the PreToolUse hook, which calls
 *     recordAndCheck(uuid,'remediation') when a REMEDIATION_REQUEST_{UUID}_{N}.md
 *     write is attempted and hard-blocks (exit 2) on round > 3.
 *   - R005 (depth) is code-computed here; the gate protocols call recordAndCheck
 *     ('reentry') at backward re-entry and obey `blocked` — protocol-enforced.
 *
 * Fail direction (safety cap): absent state = fresh (allow, count 0). A
 * loop-scoped-corrupt entry (sivs_loops[uuid] exists but its counters are
 * malformed) fails CLOSED (blocked, kind 'corrupt') for that uuid's remediation
 * only. A whole-file-unparseable unified-state is NOT this lib's deadlock —
 * readUnifiedState returns {} → treated as fresh (self-heals on write-back);
 * session health is Qdoctor's concern, never wedge the session here.
 */

import { readUnifiedState, writeUnifiedState } from './state.mjs';
import { openStore } from './store.mjs';

export const DEFAULT_DEPTH_LIMIT = 5;      // R005 backward-routing depth
export const REMEDIATION_LIMIT = 3;        // R006 remediation rounds
export const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — sweep window (last-activity based)
const MAX_STAGES = 50;                      // hard cap on the stages breadcrumb array

/**
 * Resolve the depth limit from QE_SIVS_DEPTH_LIMIT. Only a valid positive integer
 * is honored; 0 / negative / non-numeric fall back to the default (never disable
 * the cap, never instant-block) and emit a one-line warning.
 */
export function resolveDepthLimit() {
  const raw = process.env.QE_SIVS_DEPTH_LIMIT;
  if (raw === undefined || raw === '') return DEFAULT_DEPTH_LIMIT;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  try { process.stderr.write(`[loop-guard] invalid QE_SIVS_DEPTH_LIMIT="${raw}"; using default ${DEFAULT_DEPTH_LIMIT}\n`); } catch {}
  return DEFAULT_DEPTH_LIMIT;
}

/** The limit for a counter kind: remediation → 3, reentry → resolved depth. */
function limitFor(kind) {
  return kind === 'remediation' ? REMEDIATION_LIMIT : resolveDepthLimit();
}
/** The sivs_loops entry field a counter kind writes to. */
function counterField(kind) {
  return kind === 'remediation' ? 'remediation_rounds' : 'reentry';
}

/**
 * Is a sivs_loops entry loop-scoped-corrupt? Present but structurally invalid
 * (not an object, or a numeric counter field holding a non-number). Absent is
 * NOT corrupt — it is fresh.
 */
function isEntryCorrupt(entry) {
  if (entry === undefined) return false;               // absent = fresh
  if (entry === null || typeof entry !== 'object') return true;
  for (const f of ['reentry', 'remediation_rounds']) {
    if (entry[f] !== undefined && typeof entry[f] !== 'number') return true;
    if (typeof entry[f] === 'number' && !Number.isFinite(entry[f])) return true;
  }
  return false;
}

/**
 * Increment (or read) a loop counter in the store, which is atomic across
 * processes. Returns null when the store cannot serve it, so the caller falls
 * back to the read-modify-write path.
 *
 * This exists because the read-modify-write below is NOT atomic between
 * processes, and Claude issues tool calls in parallel. Measured: six concurrent
 * remediation rounds each reported `count: 1, blocked: false` and persisted a
 * final count of 1 — the round limit was defeated entirely, letting a runaway
 * SIVS loop through the one gate meant to stop it. Sequentially the same six
 * calls counted 1..6 and blocked from the fourth, as intended.
 *
 * @param {string} cwd - Project root
 * @param {string} uuid - Task UUID
 * @param {string} field - 'reentry' | 'remediation_rounds'
 * @param {number} delta - 1 to increment, 0 to read without incrementing
 * @returns {number|null} Post-increment count, or null when unavailable
 */
function storeCounter(cwd, uuid, field, delta, seedFrom = 0) {
  let store = null;
  try {
    store = openStore(cwd);
    if (store.backend !== 'sqlite') return null;
    const key = `${uuid}:${field}`;
    // Carry any count already recorded in unified-state into the store the
    // first time this key is touched. Without it the store starts at 0 and
    // silently discards the existing rounds — a task mid-loop when the store
    // is introduced would get its limit reset, weakening the guard exactly
    // when it is doing its job. The seed is insert-if-absent, so concurrent
    // first touches cannot double it.
    if (seedFrom > 0) store.seedCounter('sivs_loop', key, seedFrom);
    return delta
      ? store.bumpCounter('sivs_loop', key, delta)
      : store.getCounter('sivs_loop', key);
  } catch {
    return null;
  } finally {
    try { store?.close(); } catch { /* nothing recoverable */ }
  }
}

/**
 * Record one loop event and return the limit verdict. `blocked` is true when
 * the post-increment count exceeds the limit (so depth 5 / round 3 are allowed,
 * 6 / 4 are blocked), or when the entry is loop-scoped-corrupt.
 *
 * The count comes from the store when available, because only its UPSERT is
 * atomic across processes. The unified-state entry is still maintained for the
 * breadcrumbs (`stages`, `first_seen`, `updated_at`), for `sweepStale`, and as
 * the fallback count on runtimes without sqlite.
 *
 * @param {string} cwd
 * @param {string} uuid  full task UUID
 * @param {'reentry'|'remediation'} kind
 * @param {string} [stage]  optional stage label for the reentry breadcrumb
 * @returns {{ blocked: boolean, kind: string, count: number, limit: number }}
 */
export function recordAndCheck(cwd, uuid, kind, stage) {
  const state = readUnifiedState(cwd);
  // Reset a missing/non-object OR ARRAY container. `typeof [] === 'object'`, and an
  // array container silently drops named props on JSON.stringify → the cap would
  // never engage (fail-closed intent, container level). Mirror of isEntryCorrupt.
  if (!state.sivs_loops || typeof state.sivs_loops !== 'object' || Array.isArray(state.sivs_loops)) {
    state.sivs_loops = {};
  }
  const entry = state.sivs_loops[uuid];

  if (isEntryCorrupt(entry)) {
    return { blocked: true, kind: 'corrupt', count: -1, limit: limitFor(kind) };
  }

  const now = Date.now();
  const rec = entry || { reentry: 0, remediation_rounds: 0, stages: [], first_seen: now, updated_at: now };
  if (!Array.isArray(rec.stages)) rec.stages = [];

  const field = counterField(kind);
  // Authoritative count first. When the store answers, its value wins and is
  // mirrored into the entry so both views agree; otherwise fall back to the
  // in-place increment, which keeps pre-store behaviour on older runtimes.
  const legacy = typeof rec[field] === 'number' ? rec[field] : 0;
  const atomic = storeCounter(cwd, uuid, field, 1, legacy);
  rec[field] = atomic === null
    ? (typeof rec[field] === 'number' ? rec[field] : 0) + 1
    : atomic;
  if (kind === 'reentry' && stage) {
    rec.stages.push(stage);
    if (rec.stages.length > MAX_STAGES) rec.stages = rec.stages.slice(-MAX_STAGES);
  }
  rec.updated_at = now;
  if (!rec.first_seen) rec.first_seen = now;

  state.sivs_loops[uuid] = rec;
  try { writeUnifiedState(cwd, state); } catch {}

  const limit = limitFor(kind);
  return { blocked: rec[field] > limit, kind, count: rec[field], limit };
}

/**
 * Read-only limit check without incrementing. Returns the same shape; a corrupt
 * entry is reported blocked. Absent = fresh (count 0, not blocked).
 */
export function checkLimits(cwd, uuid) {
  const state = readUnifiedState(cwd);
  const entry = state?.sivs_loops?.[uuid];
  if (isEntryCorrupt(entry)) {
    return { corrupt: true, reentry: { count: -1, limit: resolveDepthLimit(), blocked: true },
             remediation: { count: -1, limit: REMEDIATION_LIMIT, blocked: true } };
  }
  // Prefer the store's counts for the same reason recordAndCheck does: the
  // unified-state copy can be short by however many concurrent increments were
  // lost, and reporting a count lower than reality is what lets a runaway pass.
  const legacyReentry = (entry && typeof entry.reentry === 'number') ? entry.reentry : 0;
  const legacyRemediation = (entry && typeof entry.remediation_rounds === 'number')
    ? entry.remediation_rounds : 0;
  const storedReentry = storeCounter(cwd, uuid, 'reentry', 0, legacyReentry);
  const storedRemediation = storeCounter(cwd, uuid, 'remediation_rounds', 0, legacyRemediation);

  const reentry = storedReentry !== null
    ? storedReentry
    : ((entry && typeof entry.reentry === 'number') ? entry.reentry : 0);
  const remediation = storedRemediation !== null
    ? storedRemediation
    : ((entry && typeof entry.remediation_rounds === 'number') ? entry.remediation_rounds : 0);
  const depth = resolveDepthLimit();
  return {
    corrupt: false,
    reentry: { count: reentry, limit: depth, blocked: reentry > depth },
    remediation: { count: remediation, limit: REMEDIATION_LIMIT, blocked: remediation > REMEDIATION_LIMIT },
  };
}

/**
 * Drop a task's counters from the store.
 *
 * Must run for every path that clears a loop entry. A store counter left behind
 * after a reset would keep reporting the old count and block the task forever —
 * the opposite failure from under-counting, and the worse one, because it stops
 * legitimate work rather than merely failing to stop a runaway.
 *
 * @param {string} cwd - Project root
 * @param {string} uuid - Task UUID
 */
function clearStoreCounters(cwd, uuid) {
  let store = null;
  try {
    store = openStore(cwd);
    if (store.backend !== 'sqlite') return;
    store.resetCounter('sivs_loop', `${uuid}:reentry`);
    store.resetCounter('sivs_loop', `${uuid}:remediation_rounds`);
  } catch {
    // Best effort; the unified-state entry is cleared by the caller regardless.
  } finally {
    try { store?.close(); } catch { /* nothing recoverable */ }
  }
}

/** Clear a task's loop counters (call on clean task completion). */
export function resetLoop(cwd, uuid) {
  clearStoreCounters(cwd, uuid);
  const state = readUnifiedState(cwd);
  if (state?.sivs_loops && uuid in state.sivs_loops) {
    delete state.sivs_loops[uuid];
    try { writeUnifiedState(cwd, state); } catch {}
  }
}

/**
 * Remove stale loop entries — keyed on `updated_at` (LAST ACTIVITY), never
 * first_seen — so a long-running-but-active at-limit run (whose recordAndCheck
 * keeps bumping updated_at) is preserved and never swept out from under itself
 * (that would reopen the runaway). Only entries idle beyond maxAgeMs are dropped.
 * @returns {number} count of entries swept
 */
export function sweepStale(cwd, maxAgeMs = STALE_MAX_AGE_MS) {
  const state = readUnifiedState(cwd);
  if (!state?.sivs_loops || typeof state.sivs_loops !== 'object' || Array.isArray(state.sivs_loops)) return 0;
  const now = Date.now();
  let swept = 0;
  for (const [uuid, entry] of Object.entries(state.sivs_loops)) {
    const last = entry && typeof entry.updated_at === 'number' ? entry.updated_at : (entry && entry.first_seen) || 0;
    if (now - last > maxAgeMs) {
      clearStoreCounters(cwd, uuid);
      delete state.sivs_loops[uuid];
      swept++;
    }
  }
  if (swept > 0) { try { writeUnifiedState(cwd, state); } catch {} }
  return swept;
}
