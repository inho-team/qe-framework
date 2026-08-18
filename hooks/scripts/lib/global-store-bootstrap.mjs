import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { resolveGlobalQeStorePath } from './global-store-path.mjs';
import { SCHEMA_VERSION, loadSqliteModule, openSqlite } from './store-sqlite.mjs';

export const GLOBAL_STORE_APPLICATION_ID = 0x51454657;

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');
const LOCK_NAME = 'qe.bootstrap.lock';
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 20;

export class GlobalStoreBootstrapError extends Error {
  constructor(code, message = code, options = {}) {
    super(message, options);
    this.name = 'GlobalStoreBootstrapError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  return new GlobalStoreBootstrapError(code, message, cause === undefined ? {} : { cause });
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no-op */ }
}

/** Pure POSIX owner/write policy used by the real lstat path and unit tests. */
export function isSafeQeEntryMetadata(stat, uid = typeof process.getuid === 'function' ? process.getuid() : null) {
  if (process.platform === 'win32' || uid == null) return true;
  return Number.isInteger(stat?.uid) && stat.uid === uid
    && Number.isInteger(stat?.mode) && (stat.mode & 0o022) === 0;
}

function lstatOptional(entry) {
  try { return fs.lstatSync(entry); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw fail('GLOBAL_STORE_UNSAFE_PATH', `cannot inspect ${entry}`, error);
  }
}

function validateMetadata(entry, stat, kind) {
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
    throw fail('GLOBAL_STORE_UNSAFE_PATH', `unsafe ${kind} entry: ${entry}`);
  }
  if (!isSafeQeEntryMetadata(stat)) {
    throw fail('GLOBAL_STORE_UNSAFE_PERMISSIONS', `unsafe permissions: ${entry}`);
  }
  return stat;
}

function ensureQeDirectory(qeDir) {
  let stat = lstatOptional(qeDir);
  if (!stat) {
    try { fs.mkdirSync(qeDir, { mode: 0o700 }); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw fail('GLOBAL_STORE_UNSAFE_PATH', `cannot create ${qeDir}`, error);
    }
    stat = lstatOptional(qeDir);
  }
  if (!stat) throw fail('GLOBAL_STORE_UNSAFE_PATH', `missing directory after create: ${qeDir}`);
  return validateMetadata(qeDir, stat, 'directory');
}

function inspectEntry(entry, kind) {
  const stat = lstatOptional(entry);
  return stat ? validateMetadata(entry, stat, kind) : null;
}

function inspectPaths(dbPath, lockPath) {
  const qeDir = path.dirname(dbPath);
  const parent = lstatOptional(qeDir);
  if (!parent) throw fail('GLOBAL_STORE_UNSAFE_PATH', `missing parent directory: ${qeDir}`);
  validateMetadata(qeDir, parent, 'directory');
  const lock = inspectEntry(lockPath, 'directory');
  const main = inspectEntry(dbPath, 'file');
  const wal = inspectEntry(`${dbPath}-wal`, 'file');
  const shm = inspectEntry(`${dbPath}-shm`, 'file');
  const journal = inspectEntry(`${dbPath}-journal`, 'file');
  if (!main && (wal || shm || journal)) {
    throw fail('GLOBAL_STORE_UNSAFE_PATH', 'orphan SQLite sidecar');
  }
  if (journal || (shm && !wal)) {
    throw fail('GLOBAL_STORE_UNSAFE_PATH', 'unsupported SQLite sidecar state');
  }
  return { qeDir, lock, main, wal, shm, journal };
}

function readHeader(dbPath) {
  let fd;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(dbPath, flags);
    const header = Buffer.alloc(100);
    const count = fs.readSync(fd, header, 0, header.length, 0);
    if (count < 100 || !header.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
      throw fail('GLOBAL_STORE_IDENTITY_MISMATCH', 'invalid SQLite header');
    }
    return {
      applicationId: header.readUInt32BE(68),
      userVersion: header.readUInt32BE(60),
    };
  } catch (error) {
    if (error instanceof GlobalStoreBootstrapError) throw error;
    throw fail('GLOBAL_STORE_IDENTITY_MISMATCH', 'cannot read SQLite identity', error);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
  }
}

function inspectIdentity(dbPath, sqlite) {
  const header = readHeader(dbPath);
  if (header.applicationId !== GLOBAL_STORE_APPLICATION_ID) {
    throw fail('GLOBAL_STORE_IDENTITY_MISMATCH', 'database is not a QE global store');
  }
  let db;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (!Number.isSafeInteger(version) || version > SCHEMA_VERSION) {
      throw fail('GLOBAL_STORE_FUTURE_SCHEMA', `unsupported schema version: ${version}`);
    }
    const table = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
    const columns = table ? db.prepare('PRAGMA table_xinfo(schema_meta)').all() : [];
    const keyColumns = columns.filter(column => column.pk > 0);
    const canonicalColumns = columns.length === 2
      && columns[0]?.name === 'k' && String(columns[0]?.type).toUpperCase() === 'TEXT'
      && columns[0]?.hidden === 0
      && columns[1]?.name === 'v' && String(columns[1]?.type).toUpperCase() === 'TEXT'
      && columns[1]?.pk === 0 && columns[1]?.hidden === 0;
    const hasKey = canonicalColumns && keyColumns.length === 1
      && keyColumns[0].name === 'k' && keyColumns[0].pk === 1;
    const trigger = table
      ? db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='trigger' AND tbl_name='schema_meta'").get()
      : null;
    const markers = hasKey && !trigger
      ? db.prepare("SELECT v FROM schema_meta WHERE k='store_scope'").all()
      : [];
    if (markers.length !== 1 || markers[0]?.v !== 'global') {
      throw fail('GLOBAL_STORE_IDENTITY_MISMATCH', 'global scope marker is missing or conflicting');
    }
    return { version, headerVersion: header.userVersion };
  } catch (error) {
    if (error instanceof GlobalStoreBootstrapError) throw error;
    throw fail('GLOBAL_STORE_IDENTITY_MISMATCH', 'cannot inspect global store identity', error);
  } finally {
    if (db) try { db.close(); } catch { /* read-only probe only */ }
  }
}

function cleanupOwnedLock(lockPath, owned) {
  if (!owned) return false;
  const quarantine = `${lockPath}.cleanup-${process.pid}-${randomUUID()}`;
  try {
    const current = fs.lstatSync(lockPath);
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== owned.dev || current.ino !== owned.ino
      || fs.readdirSync(lockPath).length !== 0) return false;
    fs.renameSync(lockPath, quarantine);
    const moved = fs.lstatSync(quarantine);
    if (!moved.isDirectory() || moved.isSymbolicLink()
      || moved.dev !== owned.dev || moved.ino !== owned.ino) {
      if (!lstatOptional(lockPath)) fs.renameSync(quarantine, lockPath);
      return false;
    }
    if (fs.readdirSync(quarantine).length !== 0) {
      if (!lstatOptional(lockPath)) fs.renameSync(quarantine, lockPath);
      return false;
    }
    fs.rmdirSync(quarantine);
    return true;
  } catch { return false; }
}

function codeForStage(stage) {
  if (stage === 'wal') return 'GLOBAL_STORE_WAL_FAILED';
  if (stage === 'marker') return 'GLOBAL_STORE_MARKER_FAILED';
  if (stage === 'checkpoint') return 'GLOBAL_STORE_CHECKPOINT_FAILED';
  return 'GLOBAL_STORE_OPEN_FAILED';
}

function isBusyError(error) {
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i
    .test(`${error?.code || ''} ${error?.message || ''}`);
}

/** Build the production bootstrap with an optional deterministic transition observer. */
export function createGlobalStoreBootstrap({
  onTransition = () => {},
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  if (typeof onTransition !== 'function') throw new TypeError('onTransition must be a function');

  return function openGlobalQeStore() {
    if (arguments.length !== 0) {
      throw fail('GLOBAL_STORE_ARGUMENTS', 'openGlobalQeStore does not accept arguments');
    }
    let dbPath;
    try { dbPath = resolveGlobalQeStorePath(); }
    catch (error) { throw fail('GLOBAL_STORE_UNSAFE_PATH', 'cannot resolve the global store path', error); }
    const sqlite = loadSqliteModule();
    if (!sqlite) throw fail('GLOBAL_STORE_SQLITE_UNAVAILABLE', 'node:sqlite is unavailable');
    const qeDir = path.dirname(dbPath);
    const home = path.dirname(qeDir);
    const lockPath = path.join(qeDir, LOCK_NAME);
    ensureQeDirectory(qeDir);

    let ownedLock = null;
    let created = false;

    const waitForCreator = () => {
      try { onTransition('waiting-for-creator', { path: lockPath }); }
      catch (error) { throw fail('GLOBAL_STORE_OPEN_FAILED', 'creator wait observer failed', error); }
      const deadline = Date.now() + Math.max(0, Number(waitTimeoutMs) || 0);
      while (Date.now() <= deadline) {
        const state = inspectPaths(dbPath, lockPath);
        if (state.main) {
          try {
            inspectIdentity(dbPath, sqlite);
            return false;
          } catch (error) {
            if (!state.lock || error?.code === 'GLOBAL_STORE_FUTURE_SCHEMA') throw error;
          }
        } else if (!state.lock) {
          throw fail('GLOBAL_STORE_IDENTITY_MISMATCH', 'creator disappeared before publishing identity');
        }
        sleepSync(Math.max(1, Number(pollMs) || 1));
      }
      throw fail('GLOBAL_STORE_BOOTSTRAP_BUSY', 'timed out waiting for global store creator');
    };

    const initial = inspectPaths(dbPath, lockPath);
    if (initial.main) {
      if (initial.lock) {
        try { inspectIdentity(dbPath, sqlite); }
        catch (error) {
          if (error?.code === 'GLOBAL_STORE_FUTURE_SCHEMA') throw error;
          waitForCreator();
        }
      } else inspectIdentity(dbPath, sqlite);
    } else if (initial.lock) {
      waitForCreator();
    } else {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        ownedLock = validateMetadata(lockPath, fs.lstatSync(lockPath), 'directory');
        created = true;
      } catch (error) {
        if (error?.code === 'EEXIST') waitForCreator();
        else if (error instanceof GlobalStoreBootstrapError) throw error;
        else throw fail('GLOBAL_STORE_UNSAFE_PATH', 'cannot acquire bootstrap lock', error);
      }
      try { onTransition('lock-acquired', { path: lockPath }); }
      catch (error) {
        cleanupOwnedLock(lockPath, ownedLock);
        throw fail('GLOBAL_STORE_OPEN_FAILED', 'creator lock observer failed', error);
      }
    }

    try {
      const classifiedState = inspectPaths(dbPath, lockPath);
      if (classifiedState.main) inspectIdentity(dbPath, sqlite);
      else if (!ownedLock) throw fail('GLOBAL_STORE_BOOTSTRAP_BUSY', 'global store is not ready');

      // Complete final snapshot immediately before the writable open. It includes
      // both path metadata and identity/version for an existing store, and binds
      // the final entries to the inodes that were just classified.
      onTransition('before-final-snapshot', { path: dbPath, created });
      const finalState = inspectPaths(dbPath, lockPath);
      if (classifiedState.main
        && (!finalState.main || finalState.main.dev !== classifiedState.main.dev
          || finalState.main.ino !== classifiedState.main.ino)) {
        throw fail('GLOBAL_STORE_UNSAFE_PATH', 'global store changed during final validation');
      }
      if (ownedLock && (!finalState.lock || finalState.lock.dev !== ownedLock.dev
        || finalState.lock.ino !== ownedLock.ino)) {
        throw fail('GLOBAL_STORE_UNSAFE_PATH', 'creator lock changed during final validation');
      }
      if (finalState.main) inspectIdentity(dbPath, sqlite);
      else if (!ownedLock) throw fail('GLOBAL_STORE_BOOTSTRAP_BUSY', 'global store is not ready');
      onTransition('before-writable-open', { path: dbPath, created });
    } catch (error) {
      cleanupOwnedLock(lockPath, ownedLock);
      if (error instanceof GlobalStoreBootstrapError) throw error;
      throw fail('GLOBAL_STORE_OPEN_FAILED', 'global store pre-open validation failed', error);
    }

    let db = null;
    let stage = 'open';
    try {
      db = openSqlite(home);
      if (!db) throw fail('GLOBAL_STORE_OPEN_FAILED', 'failed to open global SQLite store');

      const withBusyRetry = operation => {
        const attempts = 4;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try { return operation(); }
          catch (error) {
            if (!isBusyError(error) || attempt === attempts - 1) throw error;
            sleepSync(Math.max(1, Number(pollMs) || 1));
          }
        }
        return undefined;
      };

      stage = 'wal';
      const journal = withBusyRetry(
        () => db.prepare('PRAGMA journal_mode=WAL').get(),
      )?.journal_mode;
      if (String(journal).toLowerCase() !== 'wal') {
        throw fail('GLOBAL_STORE_WAL_FAILED', `unexpected journal mode: ${journal}`);
      }

      stage = 'marker';
      withBusyRetry(() => {
        let transaction = false;
        try {
          db.exec('BEGIN IMMEDIATE'); transaction = true;
          db.exec(`PRAGMA application_id=${GLOBAL_STORE_APPLICATION_ID}`);
          db.prepare(`INSERT INTO schema_meta(k,v) VALUES('store_scope','global')
            ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run();
          db.exec('COMMIT'); transaction = false;
        } catch (error) {
          if (transaction) try { db.exec('ROLLBACK'); } catch { /* best effort */ }
          throw error;
        }
      });
      onTransition('marker-committed', { path: dbPath, created });

      stage = 'checkpoint';
      onTransition('before-checkpoint', { path: dbPath, created });
      const checkpoint = withBusyRetry(
        () => db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(),
      );
      let checkpointApplicationId;
      try { checkpointApplicationId = readHeader(dbPath).applicationId; }
      catch (error) {
        throw fail('GLOBAL_STORE_CHECKPOINT_FAILED', 'cannot verify checkpointed global identity', error);
      }
      if (checkpoint?.busy !== 0 || checkpointApplicationId !== GLOBAL_STORE_APPLICATION_ID) {
        throw fail('GLOBAL_STORE_CHECKPOINT_FAILED', 'global identity checkpoint did not complete');
      }

      onTransition('before-lock-cleanup', { path: lockPath, created });
      cleanupOwnedLock(lockPath, ownedLock);
      return Object.freeze({ db, path: dbPath, created });
    } catch (error) {
      const primary = error instanceof GlobalStoreBootstrapError
        ? error : fail(codeForStage(stage), `global store ${stage} failed`, error);
      if (db) {
        try { db.close(); }
        catch (closeError) {
          throw fail('GLOBAL_STORE_CLOSE_FAILED', 'failed to close global store after bootstrap error', primary);
        }
      }
      cleanupOwnedLock(lockPath, ownedLock);
      throw primary;
    }
  };
}

export const openGlobalQeStore = createGlobalStoreBootstrap();
