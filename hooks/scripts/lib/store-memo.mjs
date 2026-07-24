#!/usr/bin/env node
'use strict';

/**
 * store-memo.mjs — lean ContextMemo entry point for the hot path (ADR-027).
 *
 * `pre-tool-use` and `post-tool-use` touch the memo cache on every Read, so
 * their import cost is paid thousands of times per session. Going through the
 * full `store.mjs` facade drags in `metrics.mjs`, `session-registry.mjs` and
 * `store-indexer.mjs` — none of which the memo path uses — and measured 2.46 ms
 * of marginal import against 1.17 ms for the sqlite backend alone.
 *
 * This module is that narrow path: sqlite when the runtime provides it, the
 * existing `state.mjs` blob otherwise. It intentionally exposes only the five
 * memo operations. Anything broader belongs in `store.mjs`.
 *
 * Fail-open is absolute. `valid()` feeds a decision that HARD-BLOCKS a user's
 * Read, so every error path here answers "not cached": a missed block costs one
 * redundant read, a wrong block hands the model content it never received.
 *
 * @module store-memo
 */

import {
  isMemoValid,
  markMemoModified,
  readUnifiedState,
  updateContextMemo,
  writeUnifiedState,
} from './state.mjs';
import { createSqliteBackend } from './store-sqlite.mjs';
import { loadConfig } from './config.mjs';

/**
 * Derive the memo scope for a hook payload.
 *
 * Every hook that touches ContextMemo must agree on this string. `pre-tool-use`
 * reads the cache, `post-tool-use` writes it, `session-start` and `pre-compact`
 * clear it — a scope that differs by one character makes the cache never hit,
 * so the dedup feature would die silently rather than loudly.
 *
 * @param {object} payload - Raw hook stdin payload
 * @returns {string} Session scope, or '' when the payload carries no id
 */
export function memoScope(payload) {
  return String(payload?.session_id || payload?.sessionId || '');
}

/**
 * Open the memo cache for a project.
 *
 * @param {string} cwd - Project root
 * @param {object} [opts]
 * @param {string} [opts.sessionId] - Session scope, from `memoScope()`
 * @returns {object} Memo handle: backend, valid, put, markModified, clear, stats, close
 */
export function openMemo(cwd, opts = {}) {
  const sessionId = opts.sessionId || '';

  let sqlite = null;
  const preference = process.env.QE_STORAGE_BACKEND || loadConfig(cwd)?.storage || 'auto';
  if (preference !== 'file') {
    try {
      sqlite = createSqliteBackend(cwd, { sessionId });
    } catch {
      sqlite = null;
    }
  }

  /**
   * Run a sqlite memo call, demoting to the blob on any failure.
   * @param {(backend: object) => any} fn - Operation against the sqlite backend
   * @param {any} fallback - Value meaning "sqlite did not handle this"
   * @returns {any}
   */
  const viaSqlite = (fn, fallback) => {
    if (!sqlite) return fallback;
    try {
      return fn(sqlite);
    } catch {
      sqlite = null; // one failure is enough; stop paying for retries
      return fallback;
    }
  };

  return {
    get backend() { return sqlite ? 'sqlite' : 'file'; },

    valid(path) {
      if (!path) return false;
      if (sqlite) {
        const hit = viaSqlite(b => b.memoValid(path), null);
        if (hit !== null) return hit;
      }
      try {
        return isMemoValid(readUnifiedState(cwd), path);
      } catch {
        return false;
      }
    },

    put(path, content) {
      if (!path || typeof content !== 'string') return false;
      if (sqlite && viaSqlite(b => b.memoPut(path, content), null) !== null) return true;
      try {
        const state = readUnifiedState(cwd);
        updateContextMemo(state, path, content);
        writeUnifiedState(cwd, state);
        return true;
      } catch {
        return false;
      }
    },

    // Invalidation is the safety-critical direction: a missed one leaves the
    // next read blocked against stale content, so it runs on both stores
    // rather than stopping at the first that succeeds.
    markModified(path) {
      if (!path) return false;
      viaSqlite(b => b.memoMarkModified(path), null);
      try {
        const state = readUnifiedState(cwd);
        markMemoModified(state, path);
        writeUnifiedState(cwd, state);
      } catch {
        // The sqlite invalidation above may still have landed.
      }
      return true;
    },

    clear() {
      viaSqlite(b => b.memoClear(), null);
      try {
        const state = readUnifiedState(cwd);
        state.memo = { files: {}, meta: {}, total_size: 0, blocked_reads: 0 };
        writeUnifiedState(cwd, state);
      } catch {
        // Same reasoning as markModified — clear both, report success either way.
      }
      return true;
    },

    stats() {
      const fromSqlite = viaSqlite(b => b.memoStats(), null);
      if (fromSqlite) return fromSqlite;
      try {
        const memo = readUnifiedState(cwd)?.memo || {};
        const files = memo.files && typeof memo.files === 'object'
          ? Object.keys(memo.files).length
          : 0;
        return { files, bytes: Number(memo.total_size) || 0 };
      } catch {
        return { files: 0, bytes: 0 };
      }
    },

    close() {
      try { sqlite?.close(); } catch { /* nothing recoverable */ }
    },
  };
}
