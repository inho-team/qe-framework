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

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';

import {
  collectIndexableFiles,
  collectWikiPages,
  parseFailureContext,
  parseTaskLog,
} from './store-indexer.mjs';

export const SCHEMA_VERSION = 4;

// Mirrors the limits state.mjs applies to the in-blob memo, so switching
// backends does not change how much is cached.
const MEMO_FILE_LIMIT = 10 * 1024;
const MEMO_TOTAL_LIMIT = 100 * 1024;

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

  // v4 — the LLM wiki under `.qe/wiki/pages/` (Tier B). The pages already
  // carry structured frontmatter and a [[wikilink]] graph per
  // `.qe/wiki/conventions.md`; none of it was queryable, so the questions the
  // frontmatter exists to answer (which concepts are unreviewed, what links to
  // a source, which links are broken) required reading every page.
  `
  CREATE TABLE IF NOT EXISTS wiki_pages(
    path       TEXT PRIMARY KEY,
    type       TEXT,
    topic      TEXT,
    slug       TEXT,
    title      TEXT,
    summary    TEXT,
    provenance TEXT,
    tier       TEXT,
    status     TEXT,
    aka        TEXT,
    updated_at INTEGER,
    size       INTEGER,
    words      INTEGER,
    indexed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS wp_type  ON wiki_pages(type, topic);
  CREATE INDEX IF NOT EXISTS wp_tier  ON wiki_pages(tier, provenance);
  CREATE INDEX IF NOT EXISTS wp_slug  ON wiki_pages(slug);

  CREATE TABLE IF NOT EXISTS wiki_links(
    src         TEXT NOT NULL,
    target      TEXT NOT NULL,
    target_path TEXT,
    PRIMARY KEY(src, target)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS wl_target ON wiki_links(target);
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
/** Every table the current schema is expected to provide. */
const EXPECTED_TABLES = [
  'schema_meta', 'state_kv', 'counters', 'memo', 'events', 'sessions',
  'file_index', 'learnings', 'task_log', 'failures', 'wiki_pages', 'wiki_links',
];

/**
 * Names of the tables a database actually has.
 * @param {object} db - An open DatabaseSync handle
 * @returns {Set<string>}
 */
function tableNames(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name),
  );
}

/**
 * Apply any migrations the database has not seen yet.
 *
 * `user_version` decides what runs, but it is only a claim: an interrupted
 * upgrade, a hand-edited database, or a partially restored backup can leave the
 * version ahead of the tables. That case is not theoretical — it was reproduced
 * while testing the upgrade path, and the failure is quiet and expensive: the
 * first query against a missing table throws, the facade demotes to the file
 * backend for the rest of the process, and the caller keeps working with the
 * lost-update behaviour this backend exists to remove.
 *
 * So the version is trusted only when the tables agree with it. Every statement
 * is `IF NOT EXISTS`, which makes replaying the full list safe and idempotent.
 *
 * @param {object} db - An open DatabaseSync handle
 */
function migrate(db) {
  const claimed = db.prepare('PRAGMA user_version').get()?.user_version ?? 0;
  const present = tableNames(db);
  const complete = EXPECTED_TABLES.every(name => present.has(name));

  // Replay everything when the tables disagree with the version, otherwise
  // continue from where the version says we left off.
  const from = complete ? claimed : 0;

  for (let v = from; v < MIGRATIONS.length; v += 1) {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
}

/**
 * Block the current thread briefly without spawning anything.
 *
 * Hooks are synchronous top to bottom, so there is no event loop to await on.
 * `Atomics.wait` is the portable synchronous sleep already used elsewhere in
 * this repository; it needs no PATH lookup and no child process.
 *
 * @param {number} ms - Milliseconds to sleep
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer unavailable — proceed without the backoff.
  }
}

/**
 * Whether an error is SQLite's "someone else holds the lock" signal.
 * @param {Error} err - Error thrown by DatabaseSync
 * @returns {boolean}
 */
function isBusyError(err) {
  const text = `${err?.code || ''} ${err?.message || ''}`;
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(text);
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

  if (!readOnly) {
    try { mkdirSync(dirname(dbPath), { recursive: true }); } catch { return null; }
  }

  // Retry the whole open: `PRAGMA journal_mode = WAL` and the first migration
  // both take an exclusive lock, and busy_timeout does not cover every path
  // into that lock. Without retries, several sessions starting at once race to
  // create the database and the losers silently degrade to the file backend —
  // which is precisely the lost-update behaviour this backend exists to avoid.
  const ATTEMPTS = 4;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let db = null;
    try {
      db = readOnly
        ? new sqlite.DatabaseSync(dbPath, { readOnly: true })
        : new sqlite.DatabaseSync(dbPath);

      // busy_timeout turns ordinary writer contention from an error into a
      // wait. It is the first line of defence; the retry loop is the second.
      db.exec(`PRAGMA busy_timeout = ${Number(timeoutMs) || 5000}`);

      if (!readOnly) {
        // synchronous is per-connection, so it is set every time. It is free
        // (measured at noise level) and NORMAL is the standard WAL pairing:
        // durable against process crash, which is the only failure mode that
        // matters for cache and telemetry data.
        db.exec('PRAGMA synchronous = NORMAL');

        // journal_mode is persisted in the database header, so re-declaring it
        // on an already-initialised file is pure cost — 0.41 ms of the ~1.8 ms
        // an open used to take, paid on every Read through the memo hot path.
        // `user_version` is the cheaper probe: it is 0 only for a database we
        // have not initialised, which also covers a file left behind by a
        // half-finished creation.
        // `user_version` alone is not enough to decide the schema is complete:
        // it is a claim the tables can contradict after an interrupted upgrade
        // or a partial restore. Counting tables is one indexed read of
        // `sqlite_master`, cheap enough to pay on every open, and skipping it
        // is how a half-migrated database silently demoted every caller to the
        // file backend.
        const version = db.prepare('PRAGMA user_version').get()?.user_version ?? 0;
        const tableCount = Number(
          db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get()?.n,
        ) || 0;

        if (version < MIGRATIONS.length || tableCount < EXPECTED_TABLES.length) {
          // WAL lets readers proceed during a write, which matters because
          // hooks read far more often than they write.
          db.exec('PRAGMA journal_mode = WAL');
          migrate(db);
        }
      }
      return db;
    } catch (err) {
      closeSqlite(db);
      if (!isBusyError(err) || attempt === ATTEMPTS - 1) return null;
      sleepSync(25 * (attempt + 1)); // 25ms, 50ms, 75ms
    }
  }
  return null;
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

    // Insert-if-absent, used to carry a pre-existing count from an older
    // storage location into the store the first time a key is touched. It must
    // be a single statement: two processes racing the same first touch would
    // otherwise both seed and double the count. ON CONFLICT DO NOTHING makes
    // the second one a no-op.
    seedCounter(ns, key, value, o = {}) {
      if (!Number.isFinite(value) || value <= 0) return false;
      stmt(
        `INSERT INTO counters(ns, k, session_id, n, updated_at) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(ns, k, session_id) DO NOTHING`,
      ).run(ns, key, sid(o.sessionId), Math.floor(value), Date.now());
      return true;
    },

    // Delete rather than set to 0: a reset means "this key has no history",
    // and an absent row reads back as 0 anyway. Callers use this after a task
    // completes, so leaving a stale non-zero count would block the next run
    // forever — the one failure direction worse than under-counting.
    resetCounter(ns, key, o = {}) {
      stmt('DELETE FROM counters WHERE ns = ? AND k = ? AND session_id = ?')
        .run(ns, key, sid(o.sessionId));
      return true;
    },

    getCounter(ns, key, o = {}) {
      const row = stmt(
        'SELECT n FROM counters WHERE ns = ? AND k = ? AND session_id = ?',
      ).get(ns, key, sid(o.sessionId));
      return Number(row?.n) || 0;
    },

    // ---- ContextMemo -----------------------------------------------------
    //
    // Row-per-file instead of one blob inside unified-state.json. Two wins:
    // a counter update no longer rewrites up to 100 KB of cached content, and
    // the cache is scoped per session — today's shared blob means one session's
    // start wipes every other session's cache (acknowledged in session-start.mjs
    // as "a lost re-read optimization").
    //
    // Every read here feeds a decision that can HARD-BLOCK a user's Read tool
    // call, so the contract is: when in any doubt, report not-cached. A missed
    // block costs one redundant read; a wrong block hands the model content it
    // does not have.

    memoPut(path, content, o = {}) {
      if (!path || typeof content !== 'string') return false;
      const size = Buffer.byteLength(content, 'utf8');
      if (size > (o.fileLimit ?? MEMO_FILE_LIMIT)) return false;

      let mtimeMs = null;
      try { mtimeMs = statSync(path).mtimeMs; } catch { /* unstattable → left null */ }

      const s = sid(o.sessionId);
      stmt(
        `INSERT INTO memo(session_id, path, content, size, mtime_ms, read_at, modified)
         VALUES(?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(session_id, path) DO UPDATE SET
           content = excluded.content, size = excluded.size,
           mtime_ms = excluded.mtime_ms, read_at = excluded.read_at, modified = 0`,
      ).run(s, path, content, size, mtimeMs, Date.now());

      // Evict least-recently-read rows until the session is back under budget.
      const total = () => Number(
        stmt('SELECT COALESCE(SUM(size), 0) AS n FROM memo WHERE session_id = ?').get(s)?.n,
      ) || 0;
      const oldest = stmt(
        'SELECT path FROM memo WHERE session_id = ? ORDER BY read_at ASC LIMIT 1',
      );
      const drop = stmt('DELETE FROM memo WHERE session_id = ? AND path = ?');
      const limit = o.totalLimit ?? MEMO_TOTAL_LIMIT;
      // Bounded: each pass deletes one row, and the row just inserted is under
      // the per-file limit, so this cannot spin.
      while (total() > limit) {
        const victim = oldest.get(s)?.path;
        if (!victim) break;
        drop.run(s, victim);
      }
      return true;
    },

    memoGet(path, o = {}) {
      const row = stmt(
        'SELECT content FROM memo WHERE session_id = ? AND path = ?',
      ).get(sid(o.sessionId), path);
      return row?.content ?? null;
    },

    memoValid(path, o = {}) {
      if (!path) return false;
      const row = stmt(
        'SELECT content, mtime_ms, modified FROM memo WHERE session_id = ? AND path = ?',
      ).get(sid(o.sessionId), path);
      // `!row.content` rather than a null check, so an empty body is not a hit.
      // state.mjs's isMemoValid tests the cached string for truthiness, making
      // "read returned nothing" a documented non-cache; blocking on it would
      // tell the model to reuse content that was never there.
      if (!row || row.modified || !row.content) return false;

      // An edit made outside the tool layer (Bash, git, another editor) never
      // calls memoMarkModified, so the on-disk mtime is the only signal. If it
      // moved, or the file cannot be stat'd at all, treat the entry as stale.
      if (row.mtime_ms !== null && row.mtime_ms !== undefined) {
        try {
          if (statSync(path).mtimeMs !== row.mtime_ms) return false;
        } catch {
          return false;
        }
      }
      return true;
    },

    memoMarkModified(path, o = {}) {
      if (!path) return false;
      // Drop the content outright rather than only flagging it: nothing reads a
      // stale body, and holding it keeps the session at its size budget.
      stmt(
        'UPDATE memo SET modified = 1, content = NULL, size = 0 WHERE session_id = ? AND path = ?',
      ).run(sid(o.sessionId), path);
      return true;
    },

    memoClear(o = {}) {
      // No sessionId means "this session"; `allSessions` is for the global
      // reset that pre-compact and session-start used to perform on the blob.
      if (o.allSessions) stmt('DELETE FROM memo').run();
      else stmt('DELETE FROM memo WHERE session_id = ?').run(sid(o.sessionId));
      return true;
    },

    memoStats(o = {}) {
      const s = sid(o.sessionId);
      const row = stmt(
        'SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM memo WHERE session_id = ?',
      ).get(s);
      return { files: Number(row?.files) || 0, bytes: Number(row?.bytes) || 0 };
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
        // `ended_at IS NULL` keeps a cleanly stopped session out of the list
        // immediately, instead of waiting for it to age past the stale cutoff.
        return stmt(
          `SELECT sid, name, plan, pid, last_seen FROM sessions
           WHERE last_seen >= ? AND ended_at IS NULL ORDER BY last_seen DESC`,
        ).all(cutoff);
      }
      return stmt(
        'SELECT sid, name, plan, pid, last_seen FROM sessions ORDER BY last_seen DESC',
      ).all();
    },

    // Mark a session finished rather than deleting the row: the history is
    // small, and keeping it lets "how many sessions ran today" stay answerable.
    endSession(sid) {
      if (!sid) return false;
      stmt('UPDATE sessions SET ended_at = ? WHERE sid = ?').run(Date.now(), sid);
      return true;
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

    // Keep the failure index in step with the files before answering.
    //
    // Same failure mode `ensureTaskLogFresh` exists for: without this, a store
    // whose index has never been built answers "no failures" instead of
    // erroring, and an agent cannot tell that apart from a genuine empty set.
    // The check counts directory entries without reading them, and only
    // re-parses when the count disagrees with the table.
    // A freshness signature that changes when files are added, removed OR
    // edited in place. Count alone misses an in-place edit — reproduced: a spec
    // whose content changed under a stable filename kept serving its old title.
    // Combining the count with the summed mtimes catches that at the cost of a
    // stat per file, which the rebuild walk pays anyway.
    freshSig(paths) {
      let sumMtime = 0;
      for (const p of paths) {
        try { sumMtime += Math.floor(statSync(p).mtimeMs); } catch { /* gone mid-walk */ }
      }
      return `${paths.length}:${sumMtime}`;
    },

    readFreshMark(key) {
      return stmt('SELECT v FROM schema_meta WHERE k = ?').get(key)?.v || '';
    },

    writeFreshMark(key, sig) {
      stmt(
        `INSERT INTO schema_meta(k, v) VALUES(?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      ).run(key, sig);
    },

    ensureFailuresFresh() {
      const root = join(cwd, '.qe', 'learning', 'failures');
      if (!existsSync(root)) return false;

      const paths = [];
      const walk = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'CONTEXT.md') paths.push(full);
        }
      };
      walk(root);

      const sig = this.freshSig(paths);
      if (sig === this.readFreshMark('failures_sig')) return false;
      this.writeFreshMark('failures_sig', sig);

      for (const abs of paths) {
        try {
          const record = parseFailureContext(readFileSync(abs, 'utf8'), relative(cwd, abs));
          if (record) this.upsertFailure(record);
        } catch {
          // One unreadable record must not abort the rest.
        }
      }
      return true;
    },

    queryFailures(filter = {}) {
      this.ensureFailuresFresh();
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

    // ---- wiki (Tier B) ---------------------------------------------------

    // Rebuild wiki rows and the link graph when the page count disagrees with
    // the table. Links are resolved against the pages collected in the same
    // pass, so `target_path IS NULL` means a genuinely broken `[[link]]`
    // rather than an ordering artefact.
    ensureWikiFresh() {
      const collected = collectWikiPages(cwd);
      const sig = this.freshSig(collected.map(({ page }) => join(cwd, page.path)));
      if (sig === this.readFreshMark('wiki_sig') && collected.length > 0) return false;
      this.writeFreshMark('wiki_sig', sig);

      const bySlug = new Map();
      for (const { page } of collected) if (page.slug) bySlug.set(page.slug, page.path);

      const upPage = stmt(
        `INSERT INTO wiki_pages(path, type, topic, slug, title, summary, provenance, tier, status, aka, updated_at, size, words, indexed_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           type = excluded.type, topic = excluded.topic, slug = excluded.slug,
           title = excluded.title, summary = excluded.summary,
           provenance = excluded.provenance, tier = excluded.tier,
           status = excluded.status, aka = excluded.aka,
           updated_at = excluded.updated_at, size = excluded.size,
           words = excluded.words, indexed_at = excluded.indexed_at`,
      );
      const upLink = stmt(
        `INSERT INTO wiki_links(src, target, target_path) VALUES(?, ?, ?)
         ON CONFLICT(src, target) DO UPDATE SET target_path = excluded.target_path`,
      );

      const live = new Set();
      const now = Date.now();
      for (const { page, links } of collected) {
        upPage.run(
          page.path, page.type, page.topic, page.slug, page.title, page.summary,
          page.provenance, page.tier, page.status, page.aka, page.updatedAt,
          page.size, page.words, now,
        );
        live.add(page.path);
        // Replace this page's links wholesale; an edit that removes a link must
        // remove the row, not leave a phantom edge in the graph.
        stmt('DELETE FROM wiki_links WHERE src = ?').run(page.path);
        for (const target of links) {
          upLink.run(page.path, target, bySlug.get(target) ?? null);
        }
      }

      const dropPage = stmt('DELETE FROM wiki_pages WHERE path = ?');
      const dropLinks = stmt('DELETE FROM wiki_links WHERE src = ?');
      for (const row of stmt('SELECT path FROM wiki_pages').all()) {
        if (!live.has(row.path)) { dropPage.run(row.path); dropLinks.run(row.path); }
      }
      return true;
    },

    queryWiki(filter = {}) {
      this.ensureWikiFresh();
      const where = [];
      const args = [];
      if (filter.type) { where.push('type = ?'); args.push(filter.type); }
      if (filter.topic) { where.push('topic = ?'); args.push(filter.topic); }
      if (filter.tier) { where.push('tier = ?'); args.push(filter.tier); }
      if (filter.provenance) { where.push('provenance = ?'); args.push(filter.provenance); }
      if (filter.slug) { where.push('slug = ?'); args.push(filter.slug); }
      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const limit = filter.limit > 0 ? ' LIMIT ?' : '';
      if (limit) args.push(Math.floor(filter.limit));
      return stmt(
        `SELECT slug, type, topic, tier, provenance, status, title, summary, words, updated_at, path
         FROM wiki_pages${clause} ORDER BY topic, type, slug${limit}`,
      ).all(...args);
    },

    // Backlinks by default (who points at this page); `--from` walks forward.
    queryWikiLinks(filter = {}) {
      this.ensureWikiFresh();
      if (filter.broken) {
        return stmt(
          `SELECT src, target FROM wiki_links WHERE target_path IS NULL ORDER BY src, target`,
        ).all();
      }
      if (filter.from) {
        return stmt(
          `SELECT src, target, target_path FROM wiki_links WHERE src LIKE ? ORDER BY target`,
        ).all(`%${filter.from}%`);
      }
      if (filter.to) {
        return stmt(
          `SELECT src, target, target_path FROM wiki_links WHERE target = ? ORDER BY src`,
        ).all(filter.to);
      }
      // No filter: the inbound-link count per page, which is what "what is
      // central and what is orphaned" reduces to.
      return stmt(
        `SELECT p.slug, p.type, p.tier, COUNT(l.src) AS inbound
         FROM wiki_pages p LEFT JOIN wiki_links l ON l.target_path = p.path
         GROUP BY p.path ORDER BY inbound DESC, p.slug`,
      ).all();
    },

    // Keep `file_index` in step with the `.qe` tree before answering.
    //
    // Same failure mode as `ensureTaskLogFresh` and `ensureFailuresFresh`:
    // without it, `specs --status pending` reported nothing while four
    // TASK_REQUEST files sat in `.qe/tasks/pending/`, and an agent cannot tell
    // that apart from "no pending specs". The signature (count + summed mtimes)
    // also catches an in-place edit that leaves the count unchanged; the
    // records already carry mtime, so it costs nothing extra here.
    ensureFileIndexFresh() {
      const records = collectIndexableFiles(cwd);
      const sumMtime = records.reduce((a, r) => a + Math.floor(r.mtimeMs || 0), 0);
      const sig = `${records.length}:${sumMtime}`;
      if (sig === this.readFreshMark('file_index_sig')) return false;
      this.writeFreshMark('file_index_sig', sig);

      const live = new Set();
      for (const record of records) {
        this.indexFile(record);
        live.add(record.path);
      }
      // Prune rows whose file is gone, or a completed task would keep
      // answering as pending from wherever it used to live.
      this.pruneIndex([...live]);
      return true;
    },

    queryFiles(filter = {}) {
      this.ensureFileIndexFresh();
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
