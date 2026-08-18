import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { openGlobalQeStore } from './global-store-bootstrap.mjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CONTENT = 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const VERSION = '1';
const RESERVED = new Set(['.qe/qe.db', '.qe/qe.db-wal', '.qe/qe.db-shm',
  '.qe/qe.db-journal', '.qe/project.json']);

const PROJECTS_SQL = `CREATE TABLE projects(
  project_id TEXT NOT NULL,
  current_path TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  PRIMARY KEY(project_id), UNIQUE(current_path)
) WITHOUT ROWID`;

const PATHS_SQL = `CREATE TABLE project_paths(
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL CHECK(first_seen_at >= 0),
  last_seen_at INTEGER NOT NULL CHECK(last_seen_at >= first_seen_at),
  PRIMARY KEY(project_id,path),
  FOREIGN KEY(project_id) REFERENCES projects(project_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) WITHOUT ROWID`;

const RECORDS_SQL = `CREATE TABLE project_qe_files(
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1 AND revision <= 9007199254740991),
  content TEXT NOT NULL,
  encoding TEXT NOT NULL CHECK(encoding IN ('utf8','base64')),
  size INTEGER NOT NULL CHECK(size >= 0),
  mode INTEGER NOT NULL CHECK(mode >= 0 AND mode <= 4294967295),
  mtime_ms INTEGER NOT NULL CHECK(mtime_ms >= 0),
  sha256 TEXT NOT NULL,
  migrated_at INTEGER NOT NULL CHECK(migrated_at >= 0),
  PRIMARY KEY(project_id,path),
  FOREIGN KEY(project_id) REFERENCES projects(project_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) WITHOUT ROWID`;

export class GlobalProjectRecordError extends Error {
  constructor(code, message = code, options = {}) {
    super(message, options);
    this.name = 'GlobalProjectRecordError'; this.code = code;
    if (Object.prototype.hasOwnProperty.call(options, 'priorError')) this.priorError = options.priorError;
  }
}

function fail(code, message, cause, priorError) {
  const options = {};
  if (cause !== undefined) options.cause = cause;
  if (priorError !== undefined) options.priorError = priorError;
  return new GlobalProjectRecordError(code, message, options);
}

function args(message, cause) { return fail('GLOBAL_PROJECT_RECORD_ARGUMENT', message, cause); }
function exactArity(actual, allowed, name) {
  if (!allowed.includes(actual)) throw args(`${name} received an invalid argument count`);
}
function safeInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function busy(error) {
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i
    .test(`${error?.code || ''} ${error?.message || ''}`);
}
function sleep(ms) {
  if (ms <= 0) return;
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no-op */ }
}
function normalizeSql(sql) { return String(sql || '').trim().replace(/;$/, '').replace(/\s+/g, ' '); }

function validateProjectId(projectId) {
  if (typeof projectId !== 'string' || !UUID_V4.test(projectId)) throw args('projectId must be canonical UUIDv4');
  return projectId;
}

function canonicalAbsolutePath(value) {
  return typeof value === 'string' && !value.includes('\0')
    && isAbsolute(value) && resolve(value) === value;
}

function pathSegments(value) {
  if (typeof value !== 'string' || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES || /[\u0000-\u001f\u007f\\]/u.test(value)
    || !value.startsWith('.qe/') || value.includes('//')) return null;
  const segments = value.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null;
  return segments;
}

function validatePath(value) {
  if (!pathSegments(value) || value.endsWith('/') || RESERVED.has(value)) {
    throw args('path must be one safe canonical .qe logical file');
  }
  return value;
}

function validatePrefix(value) {
  if (value === '.qe/') return value;
  if (typeof value !== 'string' || !value.endsWith('/')) throw args('prefix must be a canonical directory prefix');
  const body = value.slice(0, -1);
  if (!pathSegments(body)) throw args('prefix must be a canonical directory prefix');
  return value;
}

function contentValue(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = Buffer.from(input, 'utf8');
    if (bytes.toString('utf8') !== input) throw args('string content must round-trip through UTF-8');
  } else if (Buffer.isBuffer(input)) bytes = Buffer.from(input);
  else if (input && Object.getPrototypeOf(input) === Uint8Array.prototype) bytes = Buffer.from(input);
  else throw args('content must be string, Buffer, or plain Uint8Array');
  if (bytes.length > MAX_CONTENT) throw args('content exceeds 1 MiB');
  const text = bytes.toString('utf8');
  const utf8 = !bytes.includes(0) && Buffer.from(text, 'utf8').equals(bytes);
  return { bytes, encoding: utf8 ? 'utf8' : 'base64',
    content: utf8 ? text : bytes.toString('base64'), size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

function decodeRow(row, code = 'GLOBAL_PROJECT_RECORD_CORRUPT') {
  const validMeta = row && UUID_V4.test(String(row.project_id || ''))
    && pathSegments(row.path) && !row.path.endsWith('/') && !RESERVED.has(row.path)
    && safeInt(row.revision, 1, MAX_REVISION) && ['utf8', 'base64'].includes(row.encoding)
    && safeInt(row.size) && safeInt(row.mode, 0, 0xffffffff) && safeInt(row.mtime_ms)
    && safeInt(row.migrated_at) && SHA256.test(String(row.sha256 || ''))
    && typeof row.content === 'string';
  if (!validMeta) throw fail(code, 'project record metadata is corrupt');
  let bytes;
  if (row.encoding === 'utf8') {
    bytes = Buffer.from(row.content, 'utf8');
    if (bytes.toString('utf8') !== row.content || bytes.includes(0)) throw fail(code, 'invalid UTF-8 project record');
  } else {
    bytes = Buffer.from(row.content, 'base64');
    if (bytes.toString('base64') !== row.content) throw fail(code, 'invalid base64 project record');
  }
  if (bytes.length !== row.size || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
    throw fail(code, 'project record content hash mismatch');
  }
  return bytes;
}

function metadata(row) {
  return Object.freeze({ projectId: row.project_id, path: row.path, revision: row.revision,
    encoding: row.encoding, size: row.size, mode: row.mode, mtimeMs: row.mtime_ms,
    sha256: row.sha256, migratedAt: row.migrated_at });
}

function tableSql(db, name) {
  return db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(name)?.sql || null;
}

function pragmaIndexManifest(db, table) {
  return db.prepare(`PRAGMA index_list("${table}")`).all().map(row => {
    const safe = row.name.replaceAll('"', '""');
    return { origin: row.origin, unique: row.unique,
      xinfo: db.prepare(`PRAGMA index_xinfo("${safe}")`).all()
        .map(item => [item.seqno,item.cid,item.name,item.desc,item.coll,item.key]) };
  });
}

function validateRegistry(db) {
  const marker = db.prepare("SELECT v FROM schema_meta WHERE k='project_registry_version'").all();
  if (marker.length !== 1 || marker[0].v !== '1'
    || normalizeSql(tableSql(db, 'projects')) !== normalizeSql(PROJECTS_SQL)
    || normalizeSql(tableSql(db, 'project_paths')) !== normalizeSql(PATHS_SQL)) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry schema mismatch');
  }
  const tableList = new Map(db.prepare('PRAGMA table_list').all().map(row => [row.name, row]));
  if (tableList.get('projects')?.wr !== 1 || tableList.get('project_paths')?.wr !== 1
    || db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='trigger' AND tbl_name IN ('projects','project_paths')").get().count !== 0) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry table shape mismatch');
  }
  const projectIndexes = db.prepare('PRAGMA index_list(projects)').all();
  const pathIndexes = db.prepare('PRAGMA index_list(project_paths)').all();
  if (projectIndexes.length !== 2 || !projectIndexes.some(row => row.origin === 'pk' && row.unique === 1)
    || !projectIndexes.some(row => row.origin === 'u' && row.unique === 1)
    || pathIndexes.length !== 1 || pathIndexes[0].origin !== 'pk' || pathIndexes[0].unique !== 1) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry index mismatch');
  }
  const columnShape = rows => rows.map(row => [row.name,String(row.type).toUpperCase(),row.notnull,row.pk,row.hidden]);
  if (JSON.stringify(columnShape(db.prepare('PRAGMA table_xinfo(projects)').all())) !== JSON.stringify([
    ['project_id','TEXT',1,1,0],['current_path','TEXT',1,0,0],['created_at','INTEGER',1,0,0],['updated_at','INTEGER',1,0,0],
  ]) || JSON.stringify(columnShape(db.prepare('PRAGMA table_xinfo(project_paths)').all())) !== JSON.stringify([
    ['project_id','TEXT',1,1,0],['path','TEXT',1,2,0],['first_seen_at','INTEGER',1,0,0],['last_seen_at','INTEGER',1,0,0],
  ])) throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry columns mismatch');
  const pi = pragmaIndexManifest(db, 'projects'); const ppi = pragmaIndexManifest(db, 'project_paths');
  const projectPk = [[0,0,'project_id',0,'BINARY',1],[1,1,'current_path',0,'BINARY',0],
    [2,2,'created_at',0,'BINARY',0],[3,3,'updated_at',0,'BINARY',0]];
  const projectUnique = [[0,1,'current_path',0,'BINARY',1],[1,0,'project_id',0,'BINARY',0]];
  const pathsPk = [[0,0,'project_id',0,'BINARY',1],[1,1,'path',0,'BINARY',1],
    [2,2,'first_seen_at',0,'BINARY',0],[3,3,'last_seen_at',0,'BINARY',0]];
  if (!pi.some(row => row.origin === 'pk' && JSON.stringify(row.xinfo) === JSON.stringify(projectPk))
    || !pi.some(row => row.origin === 'u' && JSON.stringify(row.xinfo) === JSON.stringify(projectUnique))
    || ppi.length !== 1 || ppi[0].origin !== 'pk' || JSON.stringify(ppi[0].xinfo) !== JSON.stringify(pathsPk)) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry index manifest mismatch');
  }
  const foreign = db.prepare('PRAGMA foreign_key_list(project_paths)').all();
  if (foreign.length !== 1 || foreign[0].table !== 'projects' || foreign[0].from !== 'project_id'
    || foreign[0].to !== 'project_id' || foreign[0].on_update !== 'CASCADE'
    || foreign[0].on_delete !== 'RESTRICT') throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry foreign key mismatch');
  const projects = db.prepare('SELECT * FROM projects').all();
  const paths = db.prepare('SELECT * FROM project_paths').all();
  const membership = new Set(paths.map(row => `${row.project_id}\0${row.path}`));
  for (const row of projects) {
    if (!UUID_V4.test(row.project_id) || !canonicalAbsolutePath(row.current_path)
      || !safeInt(row.created_at) || !safeInt(row.updated_at, row.created_at)
      || !membership.has(`${row.project_id}\0${row.current_path}`)) {
      throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project registry row mismatch');
    }
  }
  for (const row of paths) {
    if (!UUID_V4.test(row.project_id) || !canonicalAbsolutePath(row.path)
      || !safeInt(row.first_seen_at) || !safeInt(row.last_seen_at, row.first_seen_at)) {
      throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project path row mismatch');
    }
  }
}

function validateRecordManifest(db) {
  const marker = db.prepare("SELECT v FROM schema_meta WHERE k='project_records_version'").all();
  if (marker.length !== 1 || marker[0].v !== VERSION
    || normalizeSql(tableSql(db, 'project_qe_files')) !== normalizeSql(RECORDS_SQL)) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project record schema mismatch');
  }
  const table = db.prepare("SELECT wr FROM pragma_table_list WHERE name='project_qe_files'").get();
  if (table?.wr !== 1 || db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='trigger' AND tbl_name='project_qe_files'").get().count !== 0) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project record table shape mismatch');
  }
  const columns = db.prepare('PRAGMA table_xinfo(project_qe_files)').all();
  const expected = [['project_id','TEXT',1,1,0],['path','TEXT',1,2,0],['revision','INTEGER',1,0,0],
    ['content','TEXT',1,0,0],['encoding','TEXT',1,0,0],['size','INTEGER',1,0,0],
    ['mode','INTEGER',1,0,0],['mtime_ms','INTEGER',1,0,0],['sha256','TEXT',1,0,0],
    ['migrated_at','INTEGER',1,0,0]];
  const actual = columns.map(row => [row.name,String(row.type).toUpperCase(),row.notnull,row.pk,row.hidden]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project record columns mismatch');
  const indexes = db.prepare('PRAGMA index_list(project_qe_files)').all();
  if (indexes.length !== 1 || indexes[0].origin !== 'pk' || indexes[0].unique !== 1) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project record primary index mismatch');
  }
  const safe = indexes[0].name.replaceAll('"', '""');
  const xinfo = db.prepare(`PRAGMA index_xinfo("${safe}")`).all()
    .map(row => [row.seqno,row.cid,row.name,row.desc,row.coll,row.key]);
  const expectedIndex = [
    [0,0,'project_id',0,'BINARY',1],[1,1,'path',0,'BINARY',1],[2,2,'revision',0,'BINARY',0],
    [3,3,'content',0,'BINARY',0],[4,4,'encoding',0,'BINARY',0],[5,5,'size',0,'BINARY',0],
    [6,6,'mode',0,'BINARY',0],[7,7,'mtime_ms',0,'BINARY',0],[8,8,'sha256',0,'BINARY',0],
    [9,9,'migrated_at',0,'BINARY',0],
  ];
  if (JSON.stringify(xinfo) !== JSON.stringify(expectedIndex)) throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project record primary key mismatch');
  const foreign = db.prepare('PRAGMA foreign_key_list(project_qe_files)').all();
  if (foreign.length !== 1 || foreign[0].table !== 'projects' || foreign[0].from !== 'project_id'
    || foreign[0].to !== 'project_id' || foreign[0].on_update !== 'CASCADE' || foreign[0].on_delete !== 'RESTRICT') {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'project record foreign key mismatch');
  }
}

function validateAllRecordRows(db) {
  for (const row of db.prepare('SELECT * FROM project_qe_files').all()) decodeRow(row, 'GLOBAL_PROJECT_RECORD_SCHEMA');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'foreign key violation');
}

function assertProject(db, projectId) {
  const row = db.prepare('SELECT * FROM projects WHERE project_id=?').get(projectId);
  if (!row) throw fail('GLOBAL_PROJECT_RECORD_PROJECT_UNKNOWN', 'project is not registered');
  const membership = db.prepare('SELECT 1 ok FROM project_paths WHERE project_id=? AND path=?')
    .get(projectId, row.current_path);
  if (!UUID_V4.test(row.project_id) || !canonicalAbsolutePath(row.current_path)
    || !safeInt(row.created_at) || !safeInt(row.updated_at, row.created_at) || !membership) {
    throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'registered project row is corrupt');
  }
  return row;
}

function validateJoinedProject(row) {
  if (!row) throw fail('GLOBAL_PROJECT_RECORD_PROJECT_UNKNOWN', 'project is not registered');
  if (!UUID_V4.test(row.registry_project_id) || !canonicalAbsolutePath(row.current_path)
    || !safeInt(row.registry_created_at) || !safeInt(row.registry_updated_at, row.registry_created_at)
    || row.current_membership !== 1) throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'registered project row is corrupt');
}

function initSchema(db, config) {
  db.exec(`PRAGMA busy_timeout=${Math.max(1, config.pollMs)}`); db.exec('PRAGMA foreign_keys=ON');
  let lastBusy;
  for (let attempt = 0; attempt < config.busyAttempts; attempt += 1) {
    let transaction = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      config.onTransition('before-schema', { attempt }); validateRegistry(db);
      const marker = db.prepare("SELECT v FROM schema_meta WHERE k='project_records_version'").all();
      const object = db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='project_qe_files'").all();
      if (!marker.length && !object.length) {
        db.exec(RECORDS_SQL); config.onTransition('after-table', {});
        db.prepare("INSERT INTO schema_meta(k,v) VALUES('project_records_version',?)").run(VERSION);
        config.onTransition('after-marker', {});
      } else if (marker.length !== 1 || marker[0].v !== VERSION
        || object.length !== 1 || object[0].type !== 'table') {
        throw fail('GLOBAL_PROJECT_RECORD_SCHEMA', 'partial or future project record schema');
      }
      validateRecordManifest(db); validateAllRecordRows(db); db.exec('COMMIT'); transaction = false; return;
    } catch (cause) {
      if (transaction) try { db.exec('ROLLBACK'); } catch (rollback) {
        throw fail('GLOBAL_PROJECT_RECORD_WRITE', 'schema rollback failed', rollback, cause);
      }
      if (cause instanceof GlobalProjectRecordError) throw cause;
      if (!busy(cause)) throw fail('GLOBAL_PROJECT_RECORD_WRITE', 'cannot initialize project record schema', cause);
      lastBusy = cause; if (attempt < config.busyAttempts - 1) sleep(config.pollMs);
    }
  }
  throw fail('GLOBAL_PROJECT_RECORD_BUSY', 'record schema remained busy', lastBusy);
}

function validateOptions(options, allowed) {
  if (options === undefined) return {};
  if (!options || Object.getPrototypeOf(options) !== Object.prototype
    || Object.keys(options).some(key => !allowed.includes(key))) throw args('invalid options');
  return options;
}

function openStore(handle, config) {
  const db = handle.db; let closed = false;
  const ensureOpen = () => { if (closed) throw fail('GLOBAL_PROJECT_RECORD_CLOSED', 'record store is closed'); };
  const terminalClose = (prior) => {
    closed = true;
    try { db.close(); return prior; }
    catch (closeError) { return fail('GLOBAL_PROJECT_RECORD_CLOSE_FAILED', 'record store close failed', closeError, prior); }
  };

  const put = function put(projectId, logicalPath, input, options) {
    exactArity(arguments.length, [3,4], 'put'); ensureOpen(); validateProjectId(projectId);
    const recordPath = validatePath(logicalPath); const value = contentValue(input);
    const o = validateOptions(options, ['expectedRevision','mode','mtimeMs','migratedAt']);
    if (o.expectedRevision !== undefined && o.expectedRevision !== null && !safeInt(o.expectedRevision, 1, MAX_REVISION)) throw args('invalid expectedRevision');
    if (o.mode !== undefined && !safeInt(o.mode, 0, 0xffffffff)) throw args('invalid mode');
    if (o.mtimeMs !== undefined && !safeInt(o.mtimeMs)) throw args('invalid mtimeMs');
    if (o.migratedAt !== undefined && !safeInt(o.migratedAt)) throw args('invalid migratedAt');
    let now;
    try { now = config.now(); } catch (cause) { throw args('now failed', cause); }
    if (!safeInt(now)) throw args('now must return a non-negative safe integer');
    let lastBusy;
    for (let attempt = 0; attempt < config.busyAttempts; attempt += 1) {
      let transaction = false;
      try {
        db.exec('BEGIN IMMEDIATE'); transaction = true; validateRecordManifest(db); assertProject(db, projectId);
        config.onTransition('before-put', { projectId, path: recordPath, attempt });
        const current = db.prepare('SELECT * FROM project_qe_files WHERE project_id=? AND path=?').get(projectId, recordPath);
        let revision; let created = false; let updated = false; let replayed = false;
        if (!current) {
          if (o.expectedRevision !== undefined && o.expectedRevision !== null) throw fail('GLOBAL_PROJECT_RECORD_CONFLICT', 'new record requires null revision');
          revision = 1; const mode = o.mode ?? 0o644; const mtime = o.mtimeMs ?? now; const migrated = o.migratedAt ?? mtime;
          db.prepare(`INSERT INTO project_qe_files(project_id,path,revision,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(projectId, recordPath, revision, value.content, value.encoding,
            value.size, mode, mtime, value.sha256, migrated); created = true;
        } else {
          const currentBytes = decodeRow(current); const mode = o.mode ?? current.mode;
          const mtime = o.mtimeMs ?? current.mtime_ms; const migrated = o.migratedAt ?? current.migrated_at;
          const exact = currentBytes.equals(value.bytes) && mode === current.mode
            && mtime === current.mtime_ms && migrated === current.migrated_at;
          if (exact) { revision = current.revision; replayed = true; }
          else {
            if (o.expectedRevision !== current.revision || current.revision >= MAX_REVISION) {
              throw fail('GLOBAL_PROJECT_RECORD_CONFLICT', 'stale or exhausted record revision');
            }
            revision = current.revision + 1;
            db.prepare(`UPDATE project_qe_files SET revision=?,content=?,encoding=?,size=?,mode=?,mtime_ms=?,sha256=?,migrated_at=?
              WHERE project_id=? AND path=? AND revision=?`).run(revision, value.content, value.encoding,
              value.size, mode, mtime, value.sha256, migrated, projectId, recordPath, current.revision);
            updated = true;
          }
        }
        config.onTransition('after-row', { projectId, path: recordPath, revision });
        config.onTransition('before-commit', { projectId, path: recordPath, revision });
        db.exec('COMMIT'); transaction = false;
        return Object.freeze({ projectId, path: recordPath, revision, sha256: value.sha256,
          created, updated, replayed });
      } catch (cause) {
        if (transaction) try { db.exec('ROLLBACK'); } catch (rollback) {
          const primary = fail('GLOBAL_PROJECT_RECORD_WRITE', 'record rollback failed', rollback, cause);
          throw terminalClose(primary);
        }
        if (cause instanceof GlobalProjectRecordError) throw cause;
        if (!busy(cause)) throw fail('GLOBAL_PROJECT_RECORD_WRITE', 'record write failed', cause);
        lastBusy = cause; if (attempt < config.busyAttempts - 1) sleep(config.pollMs);
      }
    }
    throw fail('GLOBAL_PROJECT_RECORD_BUSY', 'record store remained busy', lastBusy);
  };

  const get = function get(projectId, logicalPath) {
    exactArity(arguments.length, [2], 'get'); ensureOpen(); validateProjectId(projectId);
    const recordPath = validatePath(logicalPath);
    const joined = db.prepare(`SELECT p.project_id registry_project_id,p.current_path,
      p.created_at registry_created_at,p.updated_at registry_updated_at,
      EXISTS(SELECT 1 FROM project_paths pp WHERE pp.project_id=p.project_id AND pp.path=p.current_path) current_membership,
      r.project_id,r.path,r.revision,r.content,r.encoding,r.size,r.mode,r.mtime_ms,r.sha256,r.migrated_at
      FROM projects p LEFT JOIN project_qe_files r
        ON r.project_id=p.project_id AND r.path=? WHERE p.project_id=?`).get(recordPath, projectId);
    validateJoinedProject(joined); if (joined.path == null) return null;
    const bytes = decodeRow(joined); return Object.freeze({ ...metadata(joined), bytes: Buffer.from(bytes) });
  };

  const list = function list(projectId, options) {
    exactArity(arguments.length, [1,2], 'list'); ensureOpen(); validateProjectId(projectId);
    const o = validateOptions(options, ['prefix']); const prefix = validatePrefix(o.prefix ?? '.qe/');
    const rows = db.prepare(`SELECT p.project_id registry_project_id,p.current_path,
      p.created_at registry_created_at,p.updated_at registry_updated_at,
      EXISTS(SELECT 1 FROM project_paths pp WHERE pp.project_id=p.project_id AND pp.path=p.current_path) current_membership,
      r.project_id,r.path,r.revision,r.encoding,r.size,r.mode,r.mtime_ms,r.sha256,r.migrated_at
      FROM projects p LEFT JOIN project_qe_files r ON r.project_id=p.project_id
        AND substr(r.path,1,length(?))=? WHERE p.project_id=? ORDER BY r.path COLLATE BINARY`)
      .all(prefix, prefix, projectId);
    if (!rows.length) throw fail('GLOBAL_PROJECT_RECORD_PROJECT_UNKNOWN', 'project is not registered');
    validateJoinedProject(rows[0]);
    const out = rows.filter(row => row.path != null).map(row => {
      if (!UUID_V4.test(row.project_id) || !pathSegments(row.path) || row.path.endsWith('/') || RESERVED.has(row.path)
        || !safeInt(row.revision,1,MAX_REVISION) || !['utf8','base64'].includes(row.encoding)
        || !safeInt(row.size) || !safeInt(row.mode,0,0xffffffff) || !safeInt(row.mtime_ms)
        || !safeInt(row.migrated_at) || !SHA256.test(String(row.sha256 || ''))) {
        throw fail('GLOBAL_PROJECT_RECORD_CORRUPT', 'listed project record metadata is corrupt');
      }
      return Object.freeze(metadata(row));
    });
    return Object.freeze(out);
  };

  const close = function close() {
    exactArity(arguments.length, [0], 'close'); if (closed) return false; closed = true;
    try { db.close(); return true; }
    catch (cause) { throw fail('GLOBAL_PROJECT_RECORD_CLOSE_FAILED', 'record store close failed', cause, null); }
  };
  return Object.freeze({ put, get, list, close });
}

function openGlobalHandle(config) {
  for (let attempt = 0; attempt < config.busyAttempts; attempt += 1) {
    try { return config.openGlobalStore(); }
    catch (cause) {
      const transientSidecar = cause?.code === 'GLOBAL_STORE_UNSAFE_PATH'
        && cause?.message === 'unsupported SQLite sidecar state';
      const transientIdentity = cause?.code === 'GLOBAL_STORE_IDENTITY_MISMATCH'
        && (busy(cause?.cause) || busy(cause?.cause?.cause));
      const transientRawBusy = busy(cause);
      if (!transientSidecar && !transientIdentity && !transientRawBusy) throw cause;
      if (attempt === config.busyAttempts - 1) {
        if (transientRawBusy) throw fail('GLOBAL_PROJECT_RECORD_BUSY', 'global record store open remained busy', cause);
        throw cause;
      }
      sleep(config.pollMs);
    }
  }
  return undefined;
}

export function createGlobalProjectRecordStore(options = {}) {
  exactArity(arguments.length, arguments.length === 0 ? [0] : [1], 'createGlobalProjectRecordStore');
  const o = validateOptions(options, ['openGlobalStore','onTransition','busyAttempts','pollMs','now']);
  const config = { openGlobalStore: o.openGlobalStore ?? openGlobalQeStore,
    onTransition: o.onTransition ?? (() => {}), busyAttempts: o.busyAttempts ?? 4,
    pollMs: o.pollMs ?? 20, now: o.now ?? Date.now };
  if (typeof config.openGlobalStore !== 'function' || typeof config.onTransition !== 'function'
    || typeof config.now !== 'function' || !safeInt(config.busyAttempts,1,32)
    || !safeInt(config.pollMs,0,1000)) throw args('invalid record store options');
  return function open() {
    exactArity(arguments.length, [0], 'openGlobalProjectRecordStore');
    let handle; let primary = null;
    try {
      handle = openGlobalHandle(config);
      if (!handle?.db || typeof handle.db.prepare !== 'function') throw fail('GLOBAL_PROJECT_RECORD_WRITE', 'global store returned no database handle');
      initSchema(handle.db, config); return openStore(handle, config);
    } catch (cause) {
      primary = cause?.code?.startsWith?.('GLOBAL_STORE_') || cause instanceof GlobalProjectRecordError
        ? cause : fail('GLOBAL_PROJECT_RECORD_WRITE', 'cannot open project record store', cause);
      if (handle?.db) {
        try { handle.db.close(); }
        catch (closeError) { throw fail('GLOBAL_PROJECT_RECORD_CLOSE_FAILED', 'open cleanup close failed', closeError, primary); }
      }
      throw primary;
    }
  };
}

export const openGlobalProjectRecordStore = createGlobalProjectRecordStore();
