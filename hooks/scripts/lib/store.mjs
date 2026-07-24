#!/usr/bin/env node
'use strict';

/**
 * store.mjs — backend-agnostic state store for QE (ADR-027).
 *
 * QE keeps runtime state in files. That is fine for latency (file I/O is 1.5%
 * of hook cost) but not for concurrency: `unified-state.json` is
 * read-modify-written by 16 modules with no lock, and under 8 concurrent
 * writers 86.6% of updates are lost. This facade exists so that problem can be
 * fixed by swapping a backend rather than by editing 51 hook modules.
 *
 * Backend selection (`.qe/config.json` -> `hooks.storage`):
 *   "auto"   (default) SQLite when `node:sqlite` exists, else files
 *   "file"   force the file backend — the rollback switch for every phase
 *   "sqlite" force SQLite; still falls back to files if the runtime lacks it
 *
 * Fail-open is absolute: a storage error degrades that one call to the file
 * backend and warns once per process. A hook must never fail, and must never
 * block the user's tool call, because of the store.
 *
 * @module store
 */

import { loadConfig } from './config.mjs';
import { createFileBackend } from './store-file.mjs';
import { createSqliteBackend, isSqliteAvailable } from './store-sqlite.mjs';

/** Methods that carry the store's public contract. */
const METHODS = [
  'getState', 'setState', 'getNamespace',
  'bumpCounter', 'getCounter',
  'appendEvent', 'queryEvents',
  'upsertSession', 'listSessions', 'endSession',
  'indexFile', 'queryFiles', 'pruneIndex',
  'upsertTaskRow', 'queryTasks',
  'upsertFailure', 'queryFailures',
];

/** One warning per process, not per call — hooks run thousands of calls. */
let warned = false;

/**
 * Emit the backend-degradation warning at most once per process.
 * @param {Error|string} err - The failure that triggered the demotion
 */
function warnOnce(err) {
  if (warned) return;
  warned = true;
  try {
    process.emitWarning(
      `qe-store: sqlite backend degraded to files (${err?.message || err})`,
      'QEStoreWarning',
    );
  } catch { /* warning must never itself break a hook */ }
}

/**
 * Resolve the configured backend preference.
 *
 * @param {string} cwd - Project root
 * @param {object} [opts]
 * @param {string} [opts.backend] - Explicit override, bypasses config
 * @returns {'auto'|'file'|'sqlite'}
 */
export function resolveBackendPreference(cwd, opts = {}) {
  if (opts.backend) return opts.backend;
  const fromEnv = process.env.QE_STORAGE_BACKEND;
  if (fromEnv) return fromEnv;
  const cfg = loadConfig(cwd);
  const value = cfg?.storage;
  return value === 'file' || value === 'sqlite' ? value : 'auto';
}

/**
 * Open a store for a project.
 *
 * Neither backend performs I/O at construction time, so calling this in a hot
 * hook is cheap even when the hook takes an early-exit path.
 *
 * @param {string} cwd - Project root
 * @param {object} [opts]
 * @param {string} [opts.sessionId] - Default session scope
 * @param {string} [opts.backend] - 'auto' | 'file' | 'sqlite'
 * @returns {object} Store with a `.backend` name and the METHODS surface
 */
export function openStore(cwd, opts = {}) {
  const preference = resolveBackendPreference(cwd, opts);
  const fileBackend = createFileBackend(cwd, opts);

  let primary = fileBackend;
  if (preference !== 'file') {
    const sqlite = createSqliteBackend(cwd, opts);
    // `preference === 'sqlite'` still falls back rather than throwing: a user
    // who pins the backend on one machine should not break QE on another that
    // runs an older Node.
    if (sqlite) primary = sqlite;
  }

  const store = {
    get backend() { return primary.name; },
    /** True when the runtime could serve SQLite at all, regardless of choice. */
    sqliteAvailable: isSqliteAvailable(),
    close() {
      try { primary.close?.(); } catch { /* nothing recoverable to do */ }
      if (primary !== fileBackend) {
        try { fileBackend.close?.(); } catch { /* idem */ }
      }
    },
  };

  for (const method of METHODS) {
    store[method] = (...args) => {
      try {
        return primary[method](...args);
      } catch (err) {
        if (primary === fileBackend) throw err; // file backend failing is a real fault
        warnOnce(err);
        // Demote permanently for this store: once SQLite has failed, retrying
        // it on every subsequent call just multiplies the latency of whatever
        // is broken (locked file, corrupt page, read-only mount).
        try { primary.close?.(); } catch { /* best effort */ }
        primary = fileBackend;
        return fileBackend[method](...args);
      }
    };
  }

  return store;
}

export { METHODS };
