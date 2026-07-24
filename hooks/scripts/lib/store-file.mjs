#!/usr/bin/env node
'use strict';

/**
 * store-file.mjs — file backend for the QE store facade (ADR-027).
 *
 * This backend is the *current* QE behaviour expressed behind the facade API.
 * It deliberately delegates to the existing modules (`state.mjs`,
 * `metrics.mjs`, `session-registry.mjs`) rather than reimplementing their file
 * formats, so P0 is a pure refactor: identical files, identical semantics,
 * including the known lost-update window under concurrency (ADR-027
 * Measurement 2). Fixing that is P2's job via the SQLite backend, not this
 * module's — a divergence here would make the P1 parity check meaningless.
 *
 * @module store-file
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import { readUnifiedState, writeUnifiedState } from './state.mjs';
import { appendTelemetry, getTelemetryPath, readTelemetry } from './metrics.mjs';
import { parseFailureContext, parseTaskLog } from './store-indexer.mjs';
import {
  filterActiveSessions,
  readSessionRegistry,
  upsertSession as registryUpsert,
} from './session-registry.mjs';

/** Namespace bucket used for counters inside unified-state. */
const COUNTER_ROOT = '__counters';

/**
 * Create a file-backed store bound to a project root.
 *
 * @param {string} cwd - Project root
 * @param {object} [opts]
 * @param {string} [opts.sessionId] - Default session scope for session-scoped keys
 * @returns {object} Store backend
 */
export function createFileBackend(cwd, opts = {}) {
  const defaultSession = opts.sessionId || '';

  const scopeKey = (key, sessionId) => {
    const sid = sessionId === undefined ? defaultSession : sessionId;
    return sid ? `${sid}::${key}` : key;
  };

  return {
    name: 'file',

    // ---- state -----------------------------------------------------------

    getState(ns, key, o = {}) {
      const state = readUnifiedState(cwd);
      const bucket = state?.[ns];
      if (!bucket || typeof bucket !== 'object') return null;
      const v = bucket[scopeKey(key, o.sessionId)];
      return v === undefined ? null : v;
    },

    setState(ns, key, value, o = {}) {
      const state = readUnifiedState(cwd);
      if (!state[ns] || typeof state[ns] !== 'object') state[ns] = {};
      state[ns][scopeKey(key, o.sessionId)] = value;
      writeUnifiedState(cwd, state);
    },

    getNamespace(ns) {
      const state = readUnifiedState(cwd);
      const bucket = state?.[ns];
      return bucket && typeof bucket === 'object' ? bucket : {};
    },

    // ---- counters --------------------------------------------------------

    // Read-modify-write, exactly as QE does today. Concurrent hook processes
    // can lose increments here; that is the documented current behaviour.
    bumpCounter(ns, key, delta = 1, o = {}) {
      const state = readUnifiedState(cwd);
      if (!state[COUNTER_ROOT] || typeof state[COUNTER_ROOT] !== 'object') {
        state[COUNTER_ROOT] = {};
      }
      const bucket = state[COUNTER_ROOT];
      const k = `${ns}::${scopeKey(key, o.sessionId)}`;
      const next = (Number(bucket[k]) || 0) + Number(delta || 0);
      bucket[k] = next;
      writeUnifiedState(cwd, state);
      return next;
    },

    getCounter(ns, key, o = {}) {
      const state = readUnifiedState(cwd);
      const bucket = state?.[COUNTER_ROOT];
      if (!bucket || typeof bucket !== 'object') return 0;
      return Number(bucket[`${ns}::${scopeKey(key, o.sessionId)}`]) || 0;
    },

    // ---- events ----------------------------------------------------------

    appendEvent(event = {}) {
      appendTelemetry(cwd, {
        eventType: event.kind || 'unknown',
        sessionId: event.sessionId || defaultSession || 'unknown',
        data: {
          tool: event.tool,
          stage: event.stage,
          ok: event.ok,
          durMs: event.durMs,
          ...(event.payload && typeof event.payload === 'object' ? event.payload : {}),
        },
      });
    },

    // The file backend has no index, so a filtered read is a full scan of
    // every daily JSONL file — O(N) by construction (ADR-027 Measurement 4).
    queryEvents(filter = {}) {
      const dir = getTelemetryPath(cwd);
      if (!existsSync(dir)) return [];

      let days;
      try {
        days = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
      } catch {
        return [];
      }

      const rows = [];
      for (const file of days) {
        for (const rec of readTelemetry(cwd, file.slice(0, -'.jsonl'.length))) {
          const ts = Date.parse(rec.timestamp) || 0;
          if (filter.kind && rec.eventType !== filter.kind) continue;
          if (filter.sessionId && rec.sessionId !== filter.sessionId) continue;
          if (filter.since && ts < filter.since) continue;
          if (filter.until && ts > filter.until) continue;
          rows.push({
            ts,
            session_id: rec.sessionId,
            kind: rec.eventType,
            tool: rec.data?.tool ?? null,
            stage: rec.data?.stage ?? null,
            ok: rec.data?.ok ?? null,
            dur_ms: rec.data?.durMs ?? null,
            payload: rec.data ? JSON.stringify(rec.data) : null,
          });
        }
      }

      rows.sort((a, b) => a.ts - b.ts);
      return filter.limit > 0 ? rows.slice(-filter.limit) : rows;
    },

    // ---- sessions --------------------------------------------------------

    upsertSession(entry = {}) {
      registryUpsert(cwd, {
        sid: entry.sid,
        name: entry.name || '',
        plan: entry.plan || '',
        pid: entry.pid,
        lastSeen: entry.lastSeen || new Date().toISOString(),
      });
    },

    listSessions(o = {}) {
      const entries = readSessionRegistry(cwd);
      const active = o.activeOnly ? filterActiveSessions(entries) : entries;
      return active.map(e => ({
        sid: e.sid,
        name: e.name || null,
        plan: e.plan || null,
        pid: e.pid ?? null,
        last_seen: Date.parse(e.lastSeen) || null,
      }));
    },

    // ---- file index (Tier B) ---------------------------------------------

    // There is no index to write into. Callers treat `null` from queryFiles as
    // "no index — scan the filesystem", which is what they do today.
    indexFile() { return false; },
    queryFiles() { return null; },
    pruneIndex() { return 0; },
    upsertTaskRow() { return false; },
    upsertFailure() { return false; },

    // Like queryTasks, this reads the source files directly so the query CLI
    // still answers on Node < 22.5. Failure records are small and few (tens),
    // so a full walk is cheap; the index exists for consistency, not speed.
    queryFailures(filter = {}) {
      const root = join(cwd, '.qe', 'learning', 'failures');
      if (!existsSync(root)) return [];

      /**
       * Collect CONTEXT.md paths beneath the failures root.
       * @param {string} dir - Directory to walk
       * @param {string[]} acc - Accumulator
       * @returns {string[]} Absolute paths
       */
      const collect = (dir, acc = []) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) collect(full, acc);
          else if (entry.name === 'CONTEXT.md') acc.push(full);
        }
        return acc;
      };

      const rows = [];
      for (const abs of collect(root)) {
        let record;
        try {
          record = parseFailureContext(readFileSync(abs, 'utf8'), relative(cwd, abs));
        } catch { continue; }
        if (!record) continue;
        if (filter.uuid && record.taskUuid !== filter.uuid) continue;
        if (filter.since && (record.occurredAt || 0) < Number(filter.since)) continue;
        rows.push({
          occurred_at: record.occurredAt,
          task_uuid: record.taskUuid,
          reason: record.reason,
          unchecked_count: record.uncheckedCount,
          changed_files: record.changedFiles,
          src_path: record.srcPath,
        });
      }

      rows.sort((a, b) => (b.occurred_at || 0) - (a.occurred_at || 0));
      return filter.limit > 0 ? rows.slice(0, Math.floor(filter.limit)) : rows;
    },

    // queryTasks is the exception: it parses `.qe/TASK_LOG.md` on demand. The
    // Markdown is the source of truth for both backends, so this returns real
    // rows rather than null, and the query CLI keeps working on Node < 22.5
    // where SQLite is unavailable. It re-parses the whole file each call —
    // acceptable at 0.25 ms, and precisely the O(N) cost the index removes.
    queryTasks(filter = {}) {
      const path = join(cwd, '.qe', 'TASK_LOG.md');
      if (!existsSync(path)) return [];

      let rows;
      try {
        rows = parseTaskLog(readFileSync(path, 'utf8'), '.qe/TASK_LOG.md');
      } catch {
        return [];
      }

      let out = rows.filter(r => (
        (!filter.status || r.status === filter.status)
        && (!filter.uuid || r.uuid === filter.uuid)
        && (!filter.plan || String(r.plan || '').includes(filter.plan))
        && (!filter.since || (r.datedAt || 0) >= Number(filter.since))
      ));

      out.sort((a, b) => (b.datedAt || 0) - (a.datedAt || 0) || a.rowNo - b.rowNo);
      if (filter.limit > 0) out = out.slice(0, Math.floor(filter.limit));

      // Column shape must match the sqlite backend exactly, or the query CLI
      // would render different headers depending on the runtime.
      return out.map(r => (filter.full
        ? { uuid: r.uuid, status: r.status, plan: r.plan, dated_at: r.datedAt, title: r.title, body: r.body }
        : { uuid: r.uuid, status: r.status, plan: r.plan, dated_at: r.datedAt, title: r.title }));
    },

    close() { /* nothing to release */ },
  };
}

export { COUNTER_ROOT };
