/**
 * qe-access.mjs — single programmatic access boundary for QE state.
 *
 * Hooks call this module, never a CLI. It owns DB-first `.qe` document access
 * (including disk fallback) and the named structured-state query contract.
 */
import { readFileSync, existsSync, readdirSync } from './qe-fs.mjs';
import { openSqlite, closeSqlite } from './store-sqlite.mjs';

export function readQeDocument(path, encoding = 'utf8') {
  return readFileSync(path, encoding);
}

export function qeDocumentExists(path) {
  return existsSync(path);
}

export function listQeDocuments(path) {
  return readdirSync(path).sort();
}

/** Run a named read-only query against an already-open QE store. */
export function queryQeState(store, command, args = {}) {
  const limit = args.limit;
  switch (command) {
    case 'tasks': return store.queryTasks({ status: args.status, plan: args.plan, since: args.since, limit: limit ?? 20, full: args.full });
    case 'task':
      if (!args.uuid) throw new Error('task requires --uuid=<id>');
      return store.queryTasks({ uuid: args.uuid, full: args.full ?? true, limit: 1 });
    case 'files': return store.queryFiles({ kind: args.kind, status: args.status, limit: limit ?? 50 });
    case 'specs': return store.queryFiles({ kind: 'task', status: args.status, limit: limit ?? 50 });
    case 'verification': return store.queryFiles({ kind: 'checklist', status: args.status, limit: limit ?? 50 });
    case 'contracts': return store.queryFiles({ kind: 'contract', limit: limit ?? 50 });
    case 'analysis': return store.queryFiles({ kind: 'analysis', limit: limit ?? 50 });
    case 'wiki': return store.queryWiki({ type: args.type, topic: args.topic, tier: args.tier, provenance: args.provenance, slug: args.slug, limit: limit ?? 50 });
    case 'wiki-links': return store.queryWikiLinks({ broken: args.broken, to: args.to, from: args.from });
    case 'failures': return store.queryFailures({ uuid: args.uuid, since: args.since, limit: limit ?? 50 });
    case 'events': return store.queryEvents({ kind: args.kind, sessionId: args.session, since: args.since, limit: limit ?? 50 });
    case 'sessions': return store.listSessions({ activeOnly: args.active });
    default: throw new Error(`unknown QE query: ${command}`);
  }
}

/** Read-only ERD surfaces that are not part of the task/wiki query facade. */
export function queryQeDiagnostics(cwd, command, args = {}) {
  const db = openSqlite(cwd, { readOnly: true });
  if (!db) throw new Error('sqlite unavailable');
  try {
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500);
    const rows = (sql, values = []) => db.prepare(`${sql} LIMIT ?`).all(...values, limit);
    switch (command) {
      case 'schema': return db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
      case 'state': return rows('SELECT ns, k, session_id, v, updated_at FROM state_kv ORDER BY updated_at DESC');
      case 'counters': return rows('SELECT ns, k, session_id, n, updated_at FROM counters ORDER BY updated_at DESC');
      case 'memo': return rows('SELECT session_id, path, size, mtime_ms, read_at, modified FROM memo ORDER BY read_at DESC');
      case 'learnings': return rows('SELECT id, type, severity, title, learning, context, dated_at, reinforced_at, resolved, src_path, score FROM learnings ORDER BY score DESC');
      case 'documents': return rows('SELECT path, encoding, size, mode, mtime_ms, sha256, migrated_at FROM qe_files ORDER BY mtime_ms DESC');
      default: return null;
    }
  } finally { closeSqlite(db); }
}
