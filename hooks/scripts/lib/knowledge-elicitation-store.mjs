import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadSqliteModule } from './store-sqlite.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class IntakeStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntakeStoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new IntakeStoreError(code, message);
}

function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    fail('INTAKE_STORE_INVALID_SLUG', 'Plan slug must be a safe lowercase slug');
  }
  return slug;
}

function assertSession(session) {
  if (typeof session !== 'string' || !SESSION_RE.test(session)) {
    fail('INTAKE_STORE_INVALID_SESSION', 'Session owner must be a full UUID');
  }
  return session.toLowerCase();
}

function assertRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    fail('INTAKE_STORE_INVALID_REVISION', 'Expected revision must be a positive safe integer');
  }
  return revision;
}

function clone(value, label = 'value') {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('INTAKE_STORE_INVALID_JSON', `${label} must be JSON-safe`); }
  if (encoded === undefined) fail('INTAKE_STORE_INVALID_JSON', `${label} must be JSON-safe`);
  try { return JSON.parse(encoded); } catch { fail('INTAKE_STORE_INVALID_JSON', `${label} must be JSON-safe`); }
}

function relativeIntakePath(slug) {
  return `.qe/planning/plans/${assertSlug(slug)}/INTAKE.json`;
}

export function getIntakePath(cwd, slug) {
  return join(cwd, relativeIntakePath(slug));
}

function openDatabase(cwd) {
  const sqlite = loadSqliteModule();
  if (!sqlite) fail('INTAKE_STORE_UNAVAILABLE', 'node:sqlite is unavailable');
  const db = new sqlite.DatabaseSync(join(cwd, '.qe', 'qe.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS qe_files(
    path TEXT PRIMARY KEY, content TEXT, encoding TEXT, size INTEGER,
    mode INTEGER, mtime_ms INTEGER, sha256 TEXT, migrated_at INTEGER)`);
  return db;
}

function decodeRow(row) {
  if (!row) return null;
  const text = row.encoding === 'base64'
    ? Buffer.from(row.content ?? '', 'base64').toString('utf8')
    : String(row.content ?? '');
  try { return { record: JSON.parse(text), bytes: text }; }
  catch { fail('INTAKE_STORE_CORRUPT', 'Stored intake is not valid JSON'); }
}

function validateRecord(record, slug) {
  if (!record || record.schema !== 1 || record.planSlug !== slug
    || !SESSION_RE.test(record.ownerSession ?? '')
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !record.intake || record.intake.schema !== 1 || !Array.isArray(record.intake.history)) {
    fail('INTAKE_STORE_CORRUPT', 'Stored intake record has an invalid schema');
  }
  return record;
}

function putRow(db, path, record) {
  const content = `${JSON.stringify(record, null, 2)}\n`;
  const now = Date.now();
  db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET content=excluded.content,encoding=excluded.encoding,
      size=excluded.size,mode=excluded.mode,mtime_ms=excluded.mtime_ms,
      sha256=excluded.sha256,migrated_at=excluded.migrated_at`)
    .run(path, content, 'utf8', Buffer.byteLength(content), 0o644, now,
      createHash('sha256').update(content).digest('hex'), now);
}

function transact(cwd, callback) {
  const db = openDatabase(cwd);
  try {
    db.exec('BEGIN IMMEDIATE');
    const result = callback(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    try { db.close(); } catch {}
  }
}

function historyPrefixIsPreserved(previous, next) {
  if (!Array.isArray(next?.history) || next.history.length < previous.history.length) return false;
  return previous.history.every((event, index) => JSON.stringify(event) === JSON.stringify(next.history[index]));
}

export function readIntakeRecord(cwd, slug) {
  const normalizedSlug = assertSlug(slug);
  const db = openDatabase(cwd);
  try {
    const row = db.prepare('SELECT content,encoding FROM qe_files WHERE path=?').get(relativeIntakePath(normalizedSlug));
    if (!row) fail('INTAKE_STORE_NOT_FOUND', `No intake exists for ${normalizedSlug}`);
    return clone(validateRecord(decodeRow(row).record, normalizedSlug), 'record');
  } finally {
    try { db.close(); } catch {}
  }
}

export function initializeIntakeRecord(cwd, slug, ownerSession, intake) {
  const normalizedSlug = assertSlug(slug);
  const owner = assertSession(ownerSession);
  const initial = clone(intake, 'intake');
  if (!initial || initial.schema !== 1 || !Array.isArray(initial.history)) {
    fail('INTAKE_STORE_INVALID_STATE', 'Initial intake must be a schema-1 engine state');
  }
  return transact(cwd, (db) => {
    const path = relativeIntakePath(normalizedSlug);
    if (db.prepare('SELECT 1 FROM qe_files WHERE path=?').get(path)) {
      fail('INTAKE_STORE_EXISTS', `An intake already exists for ${normalizedSlug}`);
    }
    const record = { schema: 1, planSlug: normalizedSlug, ownerSession: owner, revision: 1, intake: initial };
    putRow(db, path, record);
    return clone(record, 'record');
  });
}

export function mutateIntakeRecord(cwd, slug, options) {
  const normalizedSlug = assertSlug(slug);
  const owner = assertSession(options?.ownerSession);
  const expectedRevision = assertRevision(options?.expectedRevision);
  if (typeof options?.transition !== 'function') {
    fail('INTAKE_STORE_INVALID_TRANSITION', 'A transition function is required');
  }
  return transact(cwd, (db) => {
    const path = relativeIntakePath(normalizedSlug);
    const row = db.prepare('SELECT content,encoding FROM qe_files WHERE path=?').get(path);
    if (!row) fail('INTAKE_STORE_NOT_FOUND', `No intake exists for ${normalizedSlug}`);
    const current = validateRecord(decodeRow(row).record, normalizedSlug);
    if (current.ownerSession.toLowerCase() !== owner) {
      fail('INTAKE_STORE_OWNER_CONFLICT', 'The intake belongs to another session');
    }
    if (current.revision !== expectedRevision) {
      fail('INTAKE_STORE_STALE_REVISION', `Expected revision ${expectedRevision}, found ${current.revision}`);
    }
    const transitioned = options.transition(clone(current.intake, 'intake'));
    const nextIntake = transitioned?.state?.schema === 1 ? transitioned.state : transitioned;
    const result = transitioned?.state?.schema === 1 ? clone(transitioned.result ?? null, 'result') : null;
    const next = clone(nextIntake, 'transition result');
    if (!next || next.schema !== 1 || !Array.isArray(next.history)) {
      fail('INTAKE_STORE_INVALID_STATE', 'Transition must return a schema-1 engine state');
    }
    if (!historyPrefixIsPreserved(current.intake, next)) {
      fail('INTAKE_STORE_HISTORY_REWRITE', 'Transition rewrote existing intake history');
    }
    if (JSON.stringify(next) === JSON.stringify(current.intake)) {
      return { changed: false, record: clone(current, 'record'), result };
    }
    const record = { ...current, revision: current.revision + 1, intake: next };
    putRow(db, path, record);
    return { changed: true, record: clone(record, 'record'), result };
  });
}
