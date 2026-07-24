#!/usr/bin/env node
'use strict';

/**
 * store-sqlite.mjs — `node:sqlite` backend for the QE store facade (ADR-027).
 *
 * Scope discipline: `node:sqlite` is pre-stable (stability 1.1 in Node 24,
 * 1.2 RC from v25.7), so this module touches only the narrowest API surface
 * that is unlikely to move — `DatabaseSync`, `.exec()`, `.prepare()`, and the
 * statement `.run()/.get()/.all()` trio. No `backup()`, no session extension,
 * no async `sqlite` API.
 *
 * Nothing here throws at the caller. `openSqlite()` returns null when the
 * runtime cannot provide SQLite, and store.mjs falls back to the file backend.
 *
 * @module store-sqlite
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';

import { parseTaskLog } from './store-indexer.mjs';

export const SCHEMA_VERSION = 1;

/**
 * Load `node:sqlite` without leaking Node's ExperimentalWarning to stderr.
 *
 * Hooks write structured JSON to stdout and are read back by the client; a
 * stray warning on stderr is cosmetic but shows up in every debug transcript.
 * Of the three suppression routes tested (see ADR-027 D2), patching
 * `process.emitWarning` for the duration of the load is the only one that
 * needs no launcher change and still lets genuine warnings through.
 *
 * @returns {object|null} The `node:sqlite` namespace, or null when unavailable.
 */
export function loadSqliteModule() {
  if (typeof process.getBuiltinModule !== 'function') return null; // Node < 22.3

  const original = process.emitWarning;
  try {
    process.emitWarning = function (warning, ...rest) {
      const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
      const message = typeof warning === 'string' ? warning : warning?.message || '';
      if (type === 'ExperimentalWarning' || /experimental/i.test(message)) return;
      return original.call(process, warning, ...rest);
    };
    const mod = process.getBuiltinModule('node:sqlite');
    return mod?.DatabaseSync ? mod : null;
  } catch {
    return null; // Node 22.3/22.4: getBuiltinModule exists, node:sqlite does not
  } finally {
    process.emitWarning = original;
  }
}

/**
 * Whether this runtime can serve the SQLite backend at all.
 * @returns {boolean}
 */
export function isSqliteAvailable() {
  return loadSqliteModule() !== null;
}

/**
 * Absolute path of the project store database.
 * @param {string} cwd - Project root
 * @returns {string}
 */
export function getDbPath(cwd) {
  return join(cwd, '.qe', 'qe.db');
}

// Schema is applied as an ordered migration list so an existing database is
// upgraded in place. Each entry is idempotent on its own, but `user_version`
// is what decides whether it runs, so entries must never be reordered or
// rewritten once released — only appended.
const MIGRATIONS = [
  // v1 — ADR-027 initial schema.
  `
  CREATE TABLE IF NOT EXISTS schema_meta(k TEXT PRIMARY KEY, v TEXT);

  CREATE TABLE IF NOT EXISTS state_kv(
    ns         TEXT NOT NULL,
    k          TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    v          TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(ns, k, session_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS counters(
    ns         TEXT NOT NULL,
    k          TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    n          INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER,
    PRIMARY KEY(ns, k, session_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS memo(
    session_id TEXT NOT NULL,
    path       TEXT NOT NULL,
    content    TEXT,
    size       INTEGER,
    mtime_ms   REAL,
    read_at    INTEGER,
    modified   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(session_id, path)
  );
  CREATE INDEX IF NOT EXISTS memo_lru ON memo(session_id, read_at);

  CREATE TABLE IF NOT EXISTS events(
    id         INTEGER PRIMARY KEY,
    ts         INTEGER NOT NULL,
    session_id TEXT,
    kind       TEXT NOT NULL,
    tool       TEXT,
    stage      TEXT,
    ok         INTEGER,
    dur_ms     INTEGER,
    payload    TEXT
  );
  CREATE INDEX IF NOT EXISTS ev_kind_ts ON events(kind, ts);
  CREATE INDEX IF NOT EXISTS ev_sess_ts ON events(session_id, ts);

  CREATE TABLE IF NOT EXISTS sessions(
    sid        TEXT PRIMARY KEY,
    name       TEXT,
    plan       TEXT,
    pid        INTEGER,
    cwd        TEXT,
    started_at INTEGER,
    last_seen  INTEGER,
    ended_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS sess_last ON sessions(last_seen);

  CREATE TABLE IF NOT EXISTS file_index(
    path       TEXT PRIMARY KEY,
    kind       TEXT,
    status     TEXT,
    uuid       TEXT,
    title      TEXT,
    mtime_ms   REAL,
    size       INTEGER,
    hash       TEXT,
    indexed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS fi_kind_status ON file_index(kind, status);

  CREATE TABLE IF NOT EXISTS learnings(
    id            TEXT PRIMARY KEY,
    type          TEXT,
    severity      TEXT,
    title         TEXT,
    learning      TEXT,
    context       TEXT,
    dated_at      INTEGER,
    reinforced_at INTEGER,
    resolved      INTEGER,
    src_path      TEXT,
    score         REAL
  );
  CREATE INDEX IF NOT EXISTS ln_rank ON learnings(resolved, score DESC);
  `,

  // v2 — task log rows (Tier B). `.qe/TASK_LOG.md` is ~20k tokens; an agent
  // that needs "which tasks are open" should not have to read the whole file
  // into context. Rows are derived from the Markdown table and rebuildable,
  // so the Markdown stays the source of truth.
  `
  CREATE TABLE IF NOT EXISTS task_log(
    uuid       TEXT PRIMARY KEY,
    title      TEXT,
    body       TEXT,
    status     TEXT,
    status_raw TEXT,
    plan       TEXT,
    dated_at   INTEGER,
    src_path   TEXT,
    row_no     INTEGER,
    indexed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS tl_status ON task_log(status, dated_at DESC);
  CREATE INDEX IF NOT EXISTS tl_date   ON task_log(dated_at DESC);
  `,

  // v3 — verification failure history (Tier B), derived from
  // `.qe/learning/failures/**/CONTEXT.md`. These records already exist and
  // already carry the structure worth querying (when, which task, why, how
  // much was left unchecked); nothing new is emitted to produce them.
  `
  CREATE TABLE IF NOT EXISTS failures(
    id              TEXT PRIMARY KEY,
    occurred_at     INTEGER,
    task_uuid       TEXT,
    reason          TEXT,
    unchecked_count INTEGER,
    changed_files   INTEGER,
    src_path        TEXT,
    indexed_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS fa_time ON failures(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS fa_task ON failures(task_uuid, occurred_at DESC);
  `,
];

/**
 * Apply any migrations the database has not seen yet.
 *
 * `user_version` is read inside the same connection that applies the DDL, and
 * each step commits before the version bump, so a crash mid-migration re-runs
 * that step — which is why every statement is `IF NOT EXISTS`.
 *
 * @param {object} db - An open DatabaseSync handle
 */
function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get()?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
}

/**
 * Open (and if needed create + migrate) the project store database.
 *
 * @param {string} cwd - Project root
 * @param {object} [opts]
 * @param {boolean} [opts.readOnly=false] - Open read-only; never migrates.
 * @param {number}  [opts.timeoutMs=5000] - Busy timeout for lock contention.
 * @returns {object|null} DatabaseSync handle, or null if SQLite is unusable.
 */
export function openSqlite(cwd, opts = {}) {
  const sqlite = loadSqliteModule();
  if (!sqlite) return null;

  const { readOnly = false, timeoutMs = 5000 } = opts;
  const dbPath = getDbPath(cwd);

  // Refuse to materialize a project tree under a root that does not exist.
  // `mkdirSync(..., {recursive: true})` will happily create every missing
  // parent, so a mistyped path used to produce a whole new `.qe` directory
  // and an empty database instead of an error — and the caller then saw an
  // empty result set that looked like a legitimate "nothing found".
  if (!cwd || !existsSync(cwd)) return null;

  try {
    if (!readOnly) mkdirSync(dirname(dbPath), { recursive: true });

    const db = readOnly
      ? new sqlite.DatabaseSync(dbPath, { readOnly: true })
      : new sqlite.DatabaseSync(dbPath);

    // busy_timeout is what turns concurrent-writer contention from an error
    // into a wait. Without it, 8 parallel hook processes lose writes to
    // SQLITE_BUSY — the exact failure the file backend already has.
    db.exec(`PRAGMA busy_timeout = ${Number(timeoutMs) || 5000}`);

    if (!readOnly) {
      // WAL lets readers proceed during a write, which matters because hooks
      // read far more often than they write. synchronous=NORMAL is the
      // standard WAL pairing: durable against process crash, which is the
      // only failure mode that matters for cache and telemetry data.
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      migrate(db);
    }
    return db;
  } catch {
    return null;
  }
}

/**
 * Close a handle, swallowing errors — callers are hooks that must not fail
 * because a database handle was already gone.
 * @param {object|null} db
 */
export function closeSqlite(db) {
  try { db?.close(); } catch { /* already closed or never opened */ }
}

/**
 * Create a SQLite-backed store exposing the same surface as the file backend.
 *
 * The database handle is opened lazily: constructing the backend costs
 * nothing, and a hook that never touches persistent state never pays the
 * ~0.1-0.8 ms open. This matters because `pre-tool-use` runs on every tool
 * call and most of those calls take an early-exit path.
 *
 * @param {string} cwd - Project root
 * @param {object} [opts]
 * @param {string} [opts.sessionId] - Default session scope
 * @returns {object|null} Store backend, or null if SQLite is unavailable
 */
export function createSqliteBackend(cwd, opts = {}) {
  if (!isSqliteAvailable()) return null;

  const defaultSession = opts.sessionId || '';
  let db = null;
  const statements = new Map();

  const handle = () => {
    if (db === null) {
      db = openSqlite(cwd, opts);
      if (db === null) throw new Error('qe-store: sqlite open failed');
    }
    return db;
  };

  // Prepared statements are cached per connection. `prepare` is the expensive
  // half of a query; re-preparing per call would erase the row-level win that
  // motivated the backend in the first place.
  const stmt = (sql) => {
    let s = statements.get(sql);
    if (!s) {
      s = handle().prepare(sql);
      statements.set(sql, s);
    }
    return s;
  };

  const sid = (sessionId) => (sessionId === undefined ? defaultSession : sessionId) || '';

  return {
    name: 'sqlite',

    // ---- state -----------------------------------------------------------

    getState(ns, key, o = {}) {
      const row = stmt(
        'SELECT v FROM state_kv WHERE ns = ? AND k = ? AND session_id = ?',
      ).get(ns, key, sid(o.sessionId));
      if (!row) return null;
      try { return JSON.parse(row.v); } catch { return null; }
    },

    setState(ns, key, value, o = {}) {
      stmt(
        `INSERT INTO state_kv(ns, k, session_id, v, updated_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(ns, k, session_id) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
      ).run(ns, key, sid(o.sessionId), JSON.stringify(value ?? null), Date.now());
    },

    getNamespace(ns) {
      const out = {};
      for (const row of stmt('SELECT k, session_id, v FROM state_kv WHERE ns = ?').all(ns)) {
        const key = row.session_id ? `${row.session_id}::${row.k}` : row.k;
        try { out[key] = JSON.parse(row.v); } catch { /* skip unparsable row */ }
      }
      return out;
    },

    // ---- counters --------------------------------------------------------

    // A single UPSERT. There is no read-modify-write window, so concurrent
    // hook processes cannot lose increments (ADR-027 Measurement 2).
    bumpCounter(ns, key, delta = 1, o = {}) {
      const s = sid(o.sessionId);
      stmt(
        `INSERT INTO counters(ns, k, session_id, n, updated_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(ns, k, session_id) DO UPDATE SET n = n + excluded.n, updated_at = excluded.updated_at`,
      ).run(ns, key, s, Number(delta || 0), Date.now());
      return this.getCounter(ns, key, o);
    },

    getCounter(ns, key, o = {}) {
      const row = stmt(
        'SELECT n FROM counters WHERE ns = ? AND k = ? AND session_id = ?',
      ).get(ns, key, sid(o.sessionId));
      return Number(row?.n) || 0;
    },

    // ---- events ----------------------------------------------------------

    appendEvent(event = {}) {
      stmt(
        `INSERT INTO events(ts, session_id, kind, tool, stage, ok, dur_ms, payload)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        Number(event.ts) || Date.now(),
        event.sessionId || defaultSession || null,
        event.kind || 'unknown',
        event.tool ?? null,
        event.stage ?? null,
        event.ok === undefined || event.ok === null ? null : (event.ok ? 1 : 0),
        Number.isFinite(event.durMs) ? Math.round(event.durMs) : null,
        event.payload === undefined ? null : JSON.stringify(event.payload),
      );
    },

    // Filters are appended in the order the indexes lead with (kind, then
    // session, then time) so the planner can use ev_kind_ts / ev_sess_ts.
    // Measurement 4 in ADR-027 showed a wrong-order index yields a 1x result.
    queryEvents(filter = {}) {
      const where = [];
      const args = [];
      if (filter.kind) { where.push('kind = ?'); args.push(filter.kind); }
      if (filter.sessionId) { where.push('session_id = ?'); args.push(filter.sessionId); }
      if (filter.since) { where.push('ts >= ?'); args.push(Number(filter.since)); }
      if (filter.until) { where.push('ts <= ?'); args.push(Number(filter.until)); }

      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit > 0 ? ' LIMIT ?' : '';
      if (limit) args.push(Math.floor(filter.limit));

      // `id DESC` breaks ties on `ts`. Hook events routinely land in the same
      // millisecond, and without the tiebreak SQLite may return them in any
      // order — which would make results differ from the file backend, whose
      // JSONL is inherently insertion-ordered. Selected newest-first so LIMIT
      // keeps the most recent rows, then reversed back to chronological.
      return stmt(
        `SELECT ts, session_id, kind, tool, stage, ok, dur_ms, payload FROM events${clause} ORDER BY ts DESC, id DESC${limit}`,
      ).all(...args).reverse();
    },

    // ---- sessions --------------------------------------------------------

    upsertSession(entry = {}) {
      const now = Date.now();
      const lastSeen = entry.lastSeen ? (Date.parse(entry.lastSeen) || now) : now;
      stmt(
        `INSERT INTO sessions(sid, name, plan, pid, cwd, started_at, last_seen, ended_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(sid) DO UPDATE SET
           name = excluded.name, plan = excluded.plan, pid = excluded.pid,
           cwd = excluded.cwd, last_seen = excluded.last_seen`,
      ).run(
        entry.sid, entry.name || null, entry.plan || null,
        Number.isFinite(entry.pid) ? entry.pid : null,
        entry.cwd || cwd, now, lastSeen,
      );
    },

    listSessions(o = {}) {
      if (o.activeOnly) {
        const cutoff = Date.now() - (o.staleMs || 2 * 60 * 60 * 1000);
        return stmt(
          'SELECT sid, name, plan, pid, last_seen FROM sessions WHERE last_seen >= ? ORDER BY last_seen DESC',
        ).all(cutoff);
      }
      return stmt(
        'SELECT sid, name, plan, pid, last_seen FROM sessions ORDER BY last_seen DESC',
      ).all();
    },

    // ---- file index (Tier B) ---------------------------------------------

    indexFile(record = {}) {
      stmt(
        `INSERT INTO file_index(path, kind, status, uuid, title, mtime_ms, size, hash, indexed_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           kind = excluded.kind, status = excluded.status, uuid = excluded.uuid,
           title = excluded.title, mtime_ms = excluded.mtime_ms, size = excluded.size,
           hash = excluded.hash, indexed_at = excluded.indexed_at`,
      ).run(
        record.path, record.kind ?? null, record.status ?? null, record.uuid ?? null,
        record.title ?? null, record.mtimeMs ?? null, record.size ?? null,
        record.hash ?? null, Date.now(),
      );
      return true;
    },

    // Drop index rows whose file no longer exists. Without this a renamed or
    // archived task keeps answering queries forever, which is worse than
    // having no index at all.
    pruneIndex(livePaths = []) {
      const live = new Set(livePaths);
      const existing = stmt('SELECT path FROM file_index').all();
      const drop = stmt('DELETE FROM file_index WHERE path = ?');
      let pruned = 0;
      for (const row of existing) {
        if (!live.has(row.path)) { drop.run(row.path); pruned += 1; }
      }
      return pruned;
    },

    upsertTaskRow(row = {}) {
      stmt(
        `INSERT INTO task_log(uuid, title, body, status, status_raw, plan, dated_at, src_path, row_no, indexed_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO UPDATE SET
           title = excluded.title, body = excluded.body, status = excluded.status,
           status_raw = excluded.status_raw, plan = excluded.plan,
           dated_at = excluded.dated_at, src_path = excluded.src_path,
           row_no = excluded.row_no, indexed_at = excluded.indexed_at`,
      ).run(
        row.uuid, row.title ?? null, row.body ?? null, row.status ?? null,
        row.statusRaw ?? null, row.plan ?? null, row.datedAt ?? null,
        row.srcPath ?? null, Number.isFinite(row.rowNo) ? row.rowNo : null, Date.now(),
      );
      return true;
    },

    // Keep `task_log` in step with the Markdown before answering.
    //
    // Without this, a store whose index has never been built — or was built
    // before the last edit — answers "no open tasks" instead of erroring. A
    // silently empty result is the worst possible failure for an agent, which
    // has no way to tell it apart from a genuine empty set. One stat() per
    // call buys correctness; the re-parse only runs when the file is newer.
    ensureTaskLogFresh() {
      const taskLogPath = join(cwd, '.qe', 'TASK_LOG.md');
      let mtimeMs;
      try {
        mtimeMs = statSync(taskLogPath).mtimeMs;
      } catch {
        return false; // no TASK_LOG: nothing to mirror
      }

      const watermark = Number(
        stmt('SELECT v FROM schema_meta WHERE k = ?').get('task_log_mtime')?.v,
      ) || 0;
      if (watermark >= mtimeMs) return false;

      let rows;
      try {
        rows = parseTaskLog(readFileSync(taskLogPath, 'utf8'), '.qe/TASK_LOG.md');
      } catch {
        return false; // a malformed file must not blank an index that works
      }

      const live = new Set(rows.map(r => r.uuid));
      for (const row of rows) this.upsertTaskRow(row);
      // Drop rows for tasks removed from the Markdown, so the index cannot
      // keep reporting a task the source of truth no longer lists.
      const drop = stmt('DELETE FROM task_log WHERE uuid = ?');
      for (const existing of stmt('SELECT uuid FROM task_log').all()) {
        if (!live.has(existing.uuid)) drop.run(existing.uuid);
      }

      stmt(
        `INSERT INTO schema_meta(k, v) VALUES('task_log_mtime', ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      ).run(String(mtimeMs));
      return true;
    },

    queryTasks(filter = {}) {
      this.ensureTaskLogFresh();
      const where = [];
      const args = [];
      if (filter.status) { where.push('status = ?'); args.push(filter.status); }
      if (filter.plan) { where.push('plan LIKE ?'); args.push(`%${filter.plan}%`); }
      if (filter.since) { where.push('dated_at >= ?'); args.push(Number(filter.since)); }
      if (filter.uuid) { where.push('uuid = ?'); args.push(filter.uuid); }

      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit > 0 ? ' LIMIT ?' : '';
      // `body` is excluded unless explicitly requested: it is the multi-KB
      // cell whose cost this whole index exists to avoid.
      const cols = filter.full
        ? 'uuid, status, plan, dated_at, title, body'
        : 'uuid, status, plan, dated_at, title';
      if (limit) args.push(Math.floor(filter.limit));
      return stmt(
        `SELECT ${cols} FROM task_log${clause} ORDER BY dated_at DESC, row_no ASC${limit}`,
      ).all(...args);
    },

    upsertFailure(record = {}) {
      stmt(
        `INSERT INTO failures(id, occurred_at, task_uuid, reason, unchecked_count, changed_files, src_path, indexed_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           occurred_at = excluded.occurred_at, task_uuid = excluded.task_uuid,
           reason = excluded.reason, unchecked_count = excluded.unchecked_count,
           changed_files = excluded.changed_files, src_path = excluded.src_path,
           indexed_at = excluded.indexed_at`,
      ).run(
        record.id, record.occurredAt ?? null, record.taskUuid ?? null,
        record.reason ?? null, record.uncheckedCount ?? null,
        record.changedFiles ?? null, record.srcPath ?? null, Date.now(),
      );
      return true;
    },

    queryFailures(filter = {}) {
      const where = [];
      const args = [];
      if (filter.uuid) { where.push('task_uuid = ?'); args.push(filter.uuid); }
      if (filter.since) { where.push('occurred_at >= ?'); args.push(Number(filter.since)); }
      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit > 0 ? ' LIMIT ?' : '';
      if (limit) args.push(Math.floor(filter.limit));
      return stmt(
        `SELECT occurred_at, task_uuid, reason, unchecked_count, changed_files, src_path
         FROM failures${clause} ORDER BY occurred_at DESC${limit}`,
      ).all(...args);
    },

    queryFiles(filter = {}) {
      const where = [];
      const args = [];
      if (filter.kind) { where.push('kind = ?'); args.push(filter.kind); }
      if (filter.status) { where.push('status = ?'); args.push(filter.status); }
      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit > 0 ? ' LIMIT ?' : '';
      if (limit) args.push(Math.floor(filter.limit));
      return stmt(
        `SELECT path, kind, status, uuid, title, mtime_ms, size, hash FROM file_index${clause} ORDER BY mtime_ms DESC${limit}`,
      ).all(...args);
    },

    close() {
      statements.clear();
      closeSqlite(db);
      db = null;
    },
  };
}
