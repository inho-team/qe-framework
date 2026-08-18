import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { openGlobalQeStore } from './global-store-bootstrap.mjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEMP_NAME = /^project\.json\.tmp-[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MARKER_NAME = 'project.json';
const REGISTRY_VERSION = '1';
const MAX_MARKER_BYTES = 128;

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

export class GlobalProjectIdentityError extends Error {
  constructor(code, message = code, options = {}) {
    super(message, options);
    this.name = 'GlobalProjectIdentityError';
    this.code = code;
    if (Object.prototype.hasOwnProperty.call(options, 'priorError')) this.priorError = options.priorError;
  }
}

function error(code, message, cause, priorError) {
  const options = {};
  if (cause !== undefined) options.cause = cause;
  if (priorError !== undefined) options.priorError = priorError;
  return new GlobalProjectIdentityError(code, message, options);
}

function argument(message, cause) {
  return error('GLOBAL_PROJECT_ARGUMENT', message, cause);
}

function exactArguments(args, count, name) {
  if (args.length !== count) throw argument(`${name} requires exactly ${count} argument`);
}

function sleepSync(ms) {
  if (ms <= 0) return;
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no-op */ }
}

function isBusy(value) {
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i
    .test(`${value?.code || ''} ${value?.message || ''}`);
}

function safeMetadata(stat) {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return true;
  return stat.uid === process.getuid() && (stat.mode & 0o022) === 0;
}

function lstatOptional(entry) {
  try { return fs.lstatSync(entry); }
  catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', `cannot inspect ${entry}`, cause);
  }
}

function validateDirectory(entry, stat, checkMetadata = false) {
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', `unsafe directory: ${entry}`);
  }
  if (checkMetadata && !safeMetadata(stat)) {
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', `unsafe directory metadata: ${entry}`);
  }
  return stat;
}

function canonicalProjectRoot(projectRoot) {
  if (process.platform === 'win32') {
    throw error('GLOBAL_PROJECT_UNSUPPORTED_PLATFORM', 'project identity registration awaits G008 on Windows');
  }
  if (typeof projectRoot !== 'string' || !projectRoot || projectRoot.includes('\0')
    || !path.isAbsolute(projectRoot) || path.resolve(projectRoot) !== projectRoot) {
    throw argument('projectRoot must be one canonical absolute path');
  }
  const stat = validateDirectory(projectRoot, lstatOptional(projectRoot));
  let real;
  try { real = fs.realpathSync.native(projectRoot); }
  catch (cause) { throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'cannot resolve projectRoot', cause); }
  if (real !== projectRoot) throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'projectRoot must not traverse links');
  try {
    const home = fs.realpathSync.native(os.homedir());
    if (real === home) throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'the OS home cannot be a project root');
  } catch (cause) {
    if (cause instanceof GlobalProjectIdentityError) throw cause;
    if (cause?.code !== 'ENOENT') throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'cannot inspect OS home', cause);
  }
  return { path: real, stat };
}

function ensureQeDirectory(projectRoot) {
  const qeDir = path.join(projectRoot, '.qe');
  let stat = lstatOptional(qeDir);
  if (!stat) {
    try { fs.mkdirSync(qeDir, { mode: 0o700 }); }
    catch (cause) {
      if (cause?.code !== 'EEXIST') throw error('GLOBAL_PROJECT_IDENTITY_IO', 'cannot create .qe', cause);
    }
    stat = lstatOptional(qeDir);
  }
  return { path: qeDir, stat: validateDirectory(qeDir, stat, true) };
}

function exactMarker(projectId) {
  return `${JSON.stringify({ schema: 1, projectId })}\n`;
}

function parseMarkerBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MARKER_BYTES) {
    throw error('GLOBAL_PROJECT_IDENTITY_CORRUPT', 'project marker is oversized');
  }
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(bytes) !== 0) {
    throw error('GLOBAL_PROJECT_IDENTITY_CORRUPT', 'project marker is not UTF-8');
  }
  let value;
  try { value = JSON.parse(text); }
  catch (cause) { throw error('GLOBAL_PROJECT_IDENTITY_CORRUPT', 'project marker is malformed', cause); }
  if (!value || Object.keys(value).join('|') !== 'schema|projectId'
    || value.schema !== 1 || !UUID_V4.test(value.projectId)
    || text !== exactMarker(value.projectId)) {
    throw error('GLOBAL_PROJECT_IDENTITY_CORRUPT', 'project marker is not canonical');
  }
  return value.projectId;
}

function readMarkerFile(markerPath, expectedNlink = 1) {
  const before = lstatOptional(markerPath);
  if (!before) throw error('GLOBAL_PROJECT_IDENTITY_MISSING', 'project marker is missing');
  if (before.isSymbolicLink() || !before.isFile() || !safeMetadata(before)) {
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'unsafe project marker');
  }
  if (before.nlink !== expectedNlink) throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'unsafe project marker link count');
  if (before.size > MAX_MARKER_BYTES) throw error('GLOBAL_PROJECT_IDENTITY_CORRUPT', 'project marker is oversized');
  let fd;
  try {
    fd = fs.openSync(markerPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== expectedNlink
      || !opened.isFile() || !safeMetadata(opened) || opened.size > MAX_MARKER_BYTES) {
      throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'project marker changed during open');
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) throw error('GLOBAL_PROJECT_IDENTITY_CORRUPT', 'project marker is truncated');
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.nlink !== expectedNlink) throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'project marker changed during read');
    return { projectId: parseMarkerBytes(bytes), stat: after, bytes };
  } catch (cause) {
    if (cause instanceof GlobalProjectIdentityError) throw cause;
    throw error('GLOBAL_PROJECT_IDENTITY_IO', 'cannot read project marker', cause);
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* read handle */ } }
}

function recoverPublishedCompanion(qeDir, qeStat, markerPath, markerStat) {
  if (markerStat.nlink !== 2) throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'unsafe project marker link count');
  let names;
  try { names = fs.readdirSync(qeDir).filter(name => TEMP_NAME.test(name)); }
  catch (cause) { throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'cannot inspect marker companions', cause); }
  const matches = [];
  for (const name of names) {
    const entry = path.join(qeDir, name);
    const stat = lstatOptional(entry);
    if (stat && !stat.isSymbolicLink() && stat.isFile() && safeMetadata(stat)
      && stat.dev === markerStat.dev && stat.ino === markerStat.ino && stat.nlink === 2
      && (stat.mode & 0o777) === 0o600) matches.push({ entry, stat });
  }
  if (matches.length !== 1) throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'ambiguous project marker companion');
  readMarkerFile(markerPath, 2);
  const currentDir = fs.lstatSync(qeDir);
  const currentMarker = fs.lstatSync(markerPath);
  let currentCompanion;
  try { currentCompanion = fs.lstatSync(matches[0].entry); }
  catch (cause) {
    if (cause?.code === 'ENOENT' && currentMarker.nlink === 1) return readMarkerFile(markerPath, 1);
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'project marker companion changed', cause);
  }
  if (currentDir.dev !== qeStat.dev || currentDir.ino !== qeStat.ino
    || currentMarker.dev !== markerStat.dev || currentMarker.ino !== markerStat.ino
    || currentCompanion.dev !== markerStat.dev || currentCompanion.ino !== markerStat.ino
    || currentMarker.nlink !== 2 || currentCompanion.nlink !== 2) {
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'project marker companion changed');
  }
  try { fs.unlinkSync(matches[0].entry); }
  catch (cause) {
    if (cause?.code === 'ENOENT' && lstatOptional(markerPath)?.nlink === 1) {
      return readMarkerFile(markerPath, 1);
    }
    throw error('GLOBAL_PROJECT_IDENTITY_IO', 'cannot recover project marker companion', cause);
  }
  return readMarkerFile(markerPath, 1);
}

function readExistingMarker(projectRoot) {
  const root = canonicalProjectRoot(projectRoot);
  const qeDir = path.join(root.path, '.qe');
  const optionalQe = lstatOptional(qeDir);
  if (!optionalQe) throw error('GLOBAL_PROJECT_IDENTITY_MISSING', 'project marker directory is missing');
  const qeStat = validateDirectory(qeDir, optionalQe, true);
  const markerPath = path.join(qeDir, MARKER_NAME);
  const markerStat = lstatOptional(markerPath);
  if (!markerStat) throw error('GLOBAL_PROJECT_IDENTITY_MISSING', 'project marker is missing');
  const read = markerStat.nlink === 2
    ? recoverPublishedCompanion(qeDir, qeStat, markerPath, markerStat)
    : readMarkerFile(markerPath, 1);
  return { root: root.path, qeDir, qeStat, markerPath, projectId: read.projectId };
}

function cleanupOwnedTemp(tempPath, owned) {
  if (!owned) return;
  try {
    const current = fs.lstatSync(tempPath);
    if (current.dev === owned.dev && current.ino === owned.ino && !current.isSymbolicLink() && current.isFile()) {
      fs.unlinkSync(tempPath);
    }
  } catch { /* never remove an unproven entry */ }
}

function ensureMarker(projectRoot, uuidFactory, onTransition) {
  const root = canonicalProjectRoot(projectRoot);
  const qePath = path.join(root.path, '.qe');
  const qeExisting = lstatOptional(qePath);
  if (qeExisting) validateDirectory(qePath, qeExisting, true);
  const markerPath = path.join(qePath, MARKER_NAME);
  const existing = qeExisting ? lstatOptional(markerPath) : null;
  if (qeExisting && existing) {
    const read = existing.nlink === 2
      ? recoverPublishedCompanion(qePath, qeExisting, markerPath, existing)
      : readMarkerFile(markerPath, 1);
    return { projectId: read.projectId, created: false, root: root.path };
  }
  let projectId;
  try { projectId = uuidFactory(); }
  catch (cause) { throw argument('uuidFactory failed', cause); }
  if (!UUID_V4.test(projectId)) throw argument('uuidFactory must return a canonical UUIDv4');
  const qe = qeExisting ? { path: qePath, stat: qeExisting } : ensureQeDirectory(root.path);
  const bytes = Buffer.from(exactMarker(projectId));
  const tempPath = path.join(qe.path, `project.json.tmp-${process.pid}-${randomUUID()}`);
  let fd; let owned = null;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    owned = fs.fstatSync(fd);
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    onTransition('before-marker-publish', { path: markerPath, projectId });
    try { fs.linkSync(tempPath, markerPath); }
    catch (cause) {
      if (cause?.code === 'EEXIST') {
        cleanupOwnedTemp(tempPath, owned);
        const read = readExistingMarker(root.path);
        return { projectId: read.projectId, created: false, root: root.path };
      }
      throw error('GLOBAL_PROJECT_IDENTITY_IO', 'cannot publish project marker', cause);
    }
    onTransition('marker-published', { path: markerPath, projectId });
    cleanupOwnedTemp(tempPath, owned); owned = null;
    const read = readMarkerFile(markerPath, 1);
    return { projectId: read.projectId, created: true, root: root.path };
  } catch (cause) {
    if (cause instanceof GlobalProjectIdentityError) throw cause;
    throw error('GLOBAL_PROJECT_IDENTITY_IO', 'cannot create project marker', cause);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* write handle */ }
    cleanupOwnedTemp(tempPath, owned);
  }
}

function normalizeSql(sql) {
  return String(sql || '').trim().replace(/;$/, '').replace(/\s+/g, ' ');
}

function indexColumns(db, name) {
  const safe = String(name).replaceAll('"', '""');
  return db.prepare(`PRAGMA index_info("${safe}")`).all().map(row => row.name);
}

function validateIndexShape(db, table, expected) {
  const rows = db.prepare(`PRAGMA index_list("${table}")`).all();
  if (rows.length !== expected.length) throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', `unexpected ${table} indexes`);
  const actual = rows.map(row => {
    const safe = String(row.name).replaceAll('"', '""');
    const xinfo = db.prepare(`PRAGMA index_xinfo("${safe}")`).all();
    if (!xinfo.length || xinfo.some(item => !Number.isInteger(item.seqno)
      || !Number.isInteger(item.cid) || ![0, 1].includes(item.key))) {
      throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', `invalid ${table} index metadata`);
    }
    return { origin: row.origin, unique: row.unique, columns: indexColumns(db, row.name),
      xinfo: xinfo.map(item => [item.seqno, item.cid, item.name, item.desc, item.coll, item.key]) };
  });
  for (const item of expected) {
    if (!actual.some(row => row.origin === item.origin && row.unique === 1
      && JSON.stringify(row.columns) === JSON.stringify(item.columns)
      && JSON.stringify(row.xinfo) === JSON.stringify(item.xinfo))) {
      throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', `missing ${table} index`);
    }
  }
}

function validateRegistryRows(db) {
  const projects = db.prepare('SELECT * FROM projects').all();
  const paths = db.prepare('SELECT * FROM project_paths').all();
  const byId = new Map(projects.map(row => [row.project_id, row]));
  const memberships = new Set(paths.map(row => `${row.project_id}\0${row.path}`));
  const validPath = value => typeof value === 'string' && !value.includes('\0')
    && path.isAbsolute(value) && path.resolve(value) === value;
  for (const row of projects) {
    if (!UUID_V4.test(row.project_id) || !validPath(row.current_path)
      || !Number.isSafeInteger(row.created_at) || row.created_at < 0
      || !Number.isSafeInteger(row.updated_at) || row.updated_at < row.created_at
      || !memberships.has(`${row.project_id}\0${row.current_path}`)) {
      throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'invalid project registry row');
    }
  }
  for (const row of paths) {
    if (!byId.has(row.project_id) || !validPath(row.path)
      || !Number.isSafeInteger(row.first_seen_at) || row.first_seen_at < 0
      || !Number.isSafeInteger(row.last_seen_at) || row.last_seen_at < row.first_seen_at) {
      throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'invalid project path row');
    }
  }
}

function validateRegistrySchema(db, onTransition) {
  const markers = db.prepare("SELECT v FROM schema_meta WHERE k='project_registry_version'").all();
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('projects','project_paths')")
    .all().map(row => row.name));
  if (markers.length === 0 && tables.size === 0) {
    db.exec(PROJECTS_SQL); onTransition('after-projects-ddl', {});
    db.exec(PATHS_SQL); onTransition('after-paths-ddl', {});
    db.prepare("INSERT INTO schema_meta(k,v) VALUES('project_registry_version',?)").run(REGISTRY_VERSION);
    onTransition('after-registry-marker', {});
  } else if (markers.length !== 1 || markers[0].v !== REGISTRY_VERSION
    || tables.size !== 2 || !tables.has('projects') || !tables.has('project_paths')) {
    throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'partial or future project registry schema');
  }
  const sqlRows = new Map(db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name IN ('projects','project_paths')")
    .all().map(row => [row.name, row.sql]));
  if (normalizeSql(sqlRows.get('projects')) !== normalizeSql(PROJECTS_SQL)
    || normalizeSql(sqlRows.get('project_paths')) !== normalizeSql(PATHS_SQL)) {
    throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'project registry DDL mismatch');
  }
  const tableList = new Map(db.prepare('PRAGMA table_list').all().map(row => [row.name, row]));
  if (tableList.get('projects')?.wr !== 1 || tableList.get('project_paths')?.wr !== 1) {
    throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'project registry must be WITHOUT ROWID');
  }
  if (db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='trigger' AND tbl_name IN ('projects','project_paths')").get().count !== 0) {
    throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'project registry triggers are forbidden');
  }
  const columnShape = rows => rows.map(row => [row.name, String(row.type).toUpperCase(),
    row.notnull, row.pk, row.hidden]);
  if (JSON.stringify(columnShape(db.prepare('PRAGMA table_xinfo(projects)').all())) !== JSON.stringify([
    ['project_id', 'TEXT', 1, 1, 0], ['current_path', 'TEXT', 1, 0, 0],
    ['created_at', 'INTEGER', 1, 0, 0], ['updated_at', 'INTEGER', 1, 0, 0],
  ]) || JSON.stringify(columnShape(db.prepare('PRAGMA table_xinfo(project_paths)').all())) !== JSON.stringify([
    ['project_id', 'TEXT', 1, 1, 0], ['path', 'TEXT', 1, 2, 0],
    ['first_seen_at', 'INTEGER', 1, 0, 0], ['last_seen_at', 'INTEGER', 1, 0, 0],
  ])) throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'project registry column manifest mismatch');
  validateIndexShape(db, 'projects', [
    { origin: 'pk', columns: ['project_id'], xinfo: [
      [0, 0, 'project_id', 0, 'BINARY', 1], [1, 1, 'current_path', 0, 'BINARY', 0],
      [2, 2, 'created_at', 0, 'BINARY', 0], [3, 3, 'updated_at', 0, 'BINARY', 0],
    ] },
    { origin: 'u', columns: ['current_path'], xinfo: [
      [0, 1, 'current_path', 0, 'BINARY', 1], [1, 0, 'project_id', 0, 'BINARY', 0],
    ] },
  ]);
  validateIndexShape(db, 'project_paths', [{ origin: 'pk', columns: ['project_id', 'path'], xinfo: [
    [0, 0, 'project_id', 0, 'BINARY', 1], [1, 1, 'path', 0, 'BINARY', 1],
    [2, 2, 'first_seen_at', 0, 'BINARY', 0], [3, 3, 'last_seen_at', 0, 'BINARY', 0],
  ] }]);
  const foreign = db.prepare('PRAGMA foreign_key_list(project_paths)').all();
  if (foreign.length !== 1 || foreign[0].table !== 'projects' || foreign[0].from !== 'project_id'
    || foreign[0].to !== 'project_id' || foreign[0].on_update !== 'CASCADE'
    || foreign[0].on_delete !== 'RESTRICT') {
    throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'project registry foreign key mismatch');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) {
    throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'project registry foreign key violation');
  }
  validateRegistryRows(db);
}

function probeOldRoot(oldPath, projectId) {
  const stat = lstatOptional(oldPath);
  if (!stat) return 'absent';
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw error('GLOBAL_PROJECT_UNSAFE_PATH', 'old project path is unsafe');
  }
  const existing = readExistingMarker(oldPath);
  if (existing.projectId === projectId) {
    throw error('GLOBAL_PROJECT_DUPLICATE_IDENTITY', 'the same project identity is live at another path');
  }
  return 'reused';
}

function registerTransaction(db, identity, nowValue, onTransition, busyAttempts, pollMs) {
  let lastBusy;
  try { db.exec(`PRAGMA busy_timeout=${Math.max(1, pollMs)}`); }
  catch (cause) { throw error('GLOBAL_PROJECT_REGISTRY_WRITE', 'cannot bound registry busy timeout', cause); }
  for (let attempt = 0; attempt < busyAttempts; attempt += 1) {
    let transaction = false;
    try {
      db.exec('PRAGMA foreign_keys=ON');
      if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) {
        throw error('GLOBAL_PROJECT_REGISTRY_SCHEMA', 'foreign keys could not be enabled');
      }
      onTransition('before-registry-transaction', { attempt });
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      validateRegistrySchema(db, onTransition);
      const pathOwner = db.prepare('SELECT project_id FROM projects WHERE current_path=?').get(identity.root);
      if (pathOwner && pathOwner.project_id !== identity.projectId) {
        throw error('GLOBAL_PROJECT_PATH_COLLISION', 'current path belongs to another project');
      }
      const current = db.prepare('SELECT * FROM projects WHERE project_id=?').get(identity.projectId);
      let moved = false;
      if (!current) {
        db.prepare('INSERT INTO projects(project_id,current_path,created_at,updated_at) VALUES(?,?,?,?)')
          .run(identity.projectId, identity.root, nowValue, nowValue);
        onTransition('after-project-row', { projectId: identity.projectId });
        db.prepare('INSERT INTO project_paths(project_id,path,first_seen_at,last_seen_at) VALUES(?,?,?,?)')
          .run(identity.projectId, identity.root, nowValue, nowValue);
        onTransition('after-path-row', { projectId: identity.projectId, path: identity.root });
      } else {
        if (current.current_path !== identity.root) {
          probeOldRoot(current.current_path, identity.projectId);
          moved = true;
        }
        const updatedAt = Math.max(current.updated_at, nowValue);
        db.prepare('UPDATE projects SET current_path=?,updated_at=? WHERE project_id=?')
          .run(identity.root, updatedAt, identity.projectId);
        const seen = db.prepare('SELECT * FROM project_paths WHERE project_id=? AND path=?')
          .get(identity.projectId, identity.root);
        if (seen) {
          db.prepare('UPDATE project_paths SET last_seen_at=? WHERE project_id=? AND path=?')
            .run(Math.max(seen.last_seen_at, nowValue), identity.projectId, identity.root);
        } else {
          db.prepare('INSERT INTO project_paths(project_id,path,first_seen_at,last_seen_at) VALUES(?,?,?,?)')
            .run(identity.projectId, identity.root, nowValue, nowValue);
        }
        onTransition('after-project-row', { projectId: identity.projectId });
        onTransition('after-path-row', { projectId: identity.projectId, path: identity.root });
      }
      const previousPaths = db.prepare('SELECT path FROM project_paths WHERE project_id=? AND path<>? ORDER BY path')
        .all(identity.projectId, identity.root).map(row => row.path);
      onTransition('before-registry-commit', { projectId: identity.projectId });
      db.exec('COMMIT'); transaction = false;
      const frozenPaths = Object.freeze(previousPaths);
      return Object.freeze({ projectId: identity.projectId, currentPath: identity.root,
        previousPaths: frozenPaths, created: identity.created, moved });
    } catch (cause) {
      if (transaction) try { db.exec('ROLLBACK'); } catch (rollback) {
        throw error('GLOBAL_PROJECT_REGISTRY_WRITE', 'registry rollback failed', rollback, cause);
      }
      if (cause instanceof GlobalProjectIdentityError) throw cause;
      if (!isBusy(cause)) throw error('GLOBAL_PROJECT_REGISTRY_WRITE', 'project registry write failed', cause);
      lastBusy = cause;
      if (attempt < busyAttempts - 1) sleepSync(pollMs);
    }
  }
  throw error('GLOBAL_PROJECT_REGISTRY_BUSY', 'project registry remained busy', lastBusy);
}

function openGlobalForRegistration(config) {
  for (let attempt = 0; attempt < config.busyAttempts; attempt += 1) {
    try { return config.openGlobalStore(); }
    catch (cause) {
      const transientSidecar = cause?.code === 'GLOBAL_STORE_UNSAFE_PATH'
        && cause?.message === 'unsupported SQLite sidecar state';
      const transientIdentityLock = cause?.code === 'GLOBAL_STORE_IDENTITY_MISMATCH'
        && (isBusy(cause?.cause) || isBusy(cause?.cause?.cause));
      if ((!transientSidecar && !transientIdentityLock) || attempt === config.busyAttempts - 1) throw cause;
      sleepSync(config.pollMs);
    }
  }
  return undefined;
}

export function createProjectIdentityRegistry(options = {}) {
  exactArguments(arguments, arguments.length === 0 ? 0 : 1, 'createProjectIdentityRegistry');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw argument('options must be an object');
  const allowed = ['busyAttempts', 'now', 'onTransition', 'openGlobalStore', 'pollMs', 'uuidFactory'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw argument('unknown project identity option');
  const config = {
    openGlobalStore: options.openGlobalStore ?? openGlobalQeStore,
    uuidFactory: options.uuidFactory ?? randomUUID,
    onTransition: options.onTransition ?? (() => {}),
    now: options.now ?? Date.now,
    busyAttempts: options.busyAttempts ?? 4,
    pollMs: options.pollMs ?? 20,
  };
  if (typeof config.openGlobalStore !== 'function' || typeof config.uuidFactory !== 'function'
    || typeof config.onTransition !== 'function' || typeof config.now !== 'function'
    || !Number.isInteger(config.busyAttempts) || config.busyAttempts < 1 || config.busyAttempts > 32
    || !Number.isInteger(config.pollMs) || config.pollMs < 0 || config.pollMs > 1000) {
    throw argument('invalid project identity options');
  }
  return function register(projectRoot) {
    exactArguments(arguments, 1, 'registerProjectIdentity');
    canonicalProjectRoot(projectRoot);
    let nowValue;
    try { nowValue = config.now(); }
    catch (cause) { throw argument('now failed', cause); }
    if (!Number.isSafeInteger(nowValue) || nowValue < 0) throw argument('now must return a non-negative safe integer');
    const identity = ensureMarker(projectRoot, config.uuidFactory, config.onTransition);
    let handle; let primary = null; let result;
    try {
      try { handle = openGlobalForRegistration(config); }
      catch (cause) {
        if (String(cause?.code || '').startsWith('GLOBAL_STORE_')) throw cause;
        throw error('GLOBAL_PROJECT_REGISTRY_WRITE', 'cannot open the global project registry', cause);
      }
      if (!handle?.db || typeof handle.db.prepare !== 'function') {
        throw error('GLOBAL_PROJECT_REGISTRY_WRITE', 'global store returned no database handle');
      }
      result = registerTransaction(handle.db, identity, nowValue, config.onTransition,
        config.busyAttempts, config.pollMs);
    } catch (cause) { primary = cause; }
    if (handle?.db) {
      try { handle.db.close(); }
      catch (closeCause) {
        throw error('GLOBAL_PROJECT_CLOSE_FAILED', 'cannot close global project registry', closeCause, primary);
      }
    }
    if (primary) throw primary;
    return result;
  };
}

export function readProjectIdentity(projectRoot) {
  exactArguments(arguments, 1, 'readProjectIdentity');
  const identity = readExistingMarker(projectRoot);
  return Object.freeze({ schema: 1, projectId: identity.projectId });
}

export const registerProjectIdentity = createProjectIdentityRegistry();
