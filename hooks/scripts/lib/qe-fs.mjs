/**
 * qe-fs.mjs — a drop-in `fs` replacement that makes the DB authoritative for
 * `.qe/` content, so framework code can run with the underlying files deleted.
 *
 * Usage: a module that reads/writes .qe swaps its import source, e.g.
 *   import { readFileSync, writeFileSync, existsSync } from './qe-fs.mjs';
 * Every path under `<root>/.qe/` (except the store's own qe.db* files) is
 * served from and written to the `qe_files` table; every other path — /dev/stdin,
 * source files, anything outside .qe — passes straight through to real fs.
 *
 * Semantics for .qe/ paths (DB is the read source of truth):
 *   read      → row content if present, else the on-disk file (un-migrated), else ENOENT
 *   write     → upsert the row; ALSO mirror to disk unless DB_ONLY (see below)
 *   exists    → a row OR an on-disk file
 *   readdir   → union of immediate children from rows and from disk
 *   unlink    → drop the row (and the disk file)
 *   rename    → move the row (supports the write-tmp-then-rename atomic pattern)
 *
 * Persistence policy:
 *   .qe/planning/** is always DB-only. Qplan owns this namespace, and all of
 *   its framework consumers use this shim, so materializing a parallel folder
 *   tree only creates a second, potentially stale representation.
 *
 * Two modes for every other .qe path (env QE_STORE_DB_ONLY):
 *   unset/0 (default, transition-safe): writes go to BOTH the row and the disk
 *     file, so consumers not yet routed through this shim still read fresh data.
 *   1 (abolition end-state): writes go to the row ONLY — no disk file is created,
 *     so the .qe files can stay deleted. Flip this once every consumer is on the
 *     shim.
 * Reads are row-first so a stale disk file never shadows a written row.
 */

import * as realFs from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, relative, join, dirname, basename } from 'node:path';
import { loadSqliteModule } from './store-sqlite.mjs';

const ROOT = process.env.QE_ROOT || process.cwd();
const QE = join(ROOT, '.qe');
const DB_PATH = join(QE, 'qe.db');
const DB_SELF = /\.qe\/qe\.db(-wal|-shm|-journal)?$/;
// default: mirror writes to disk too (safe while some consumers still read files).
// Flip to DB-only (no disk writes, so .qe files stay deleted) via env
// QE_STORE_DB_ONLY=1 OR a persistent marker file .qe/.store-db-only that every
// hook process sees. The marker is read with real fs so it never depends on the
// store being readable.
const DB_ONLY = process.env.QE_STORE_DB_ONLY === '1'
  || realFs.existsSync(join(QE, '.store-db-only'));

/** Whether a store-backed path should also be mirrored to the legacy disk tree. */
function shouldMirrorToDisk(rel) {
  if (DB_ONLY) return false;
  return rel !== '.qe/planning' && !rel.startsWith('.qe/planning/');
}

/** Repo-relative `.qe/...` path when `p` addresses a store-backed file, else null. */
function qeRel(p) {
  if (typeof p !== 'string') return null;              // fd / URL / Buffer → real fs
  if (p.startsWith('/dev/') || p.startsWith('\\\\')) return null;
  const abs = isAbsolute(p) ? p : resolve(ROOT, p);
  if (abs !== QE && !abs.startsWith(QE + '/')) return null;
  const rel = relative(ROOT, abs);
  if (DB_SELF.test(rel) || rel.endsWith('/qe.db')) return null; // never virtualize the store
  return rel;
}

let _db = null;
/** Open and memoize the authoritative QE SQLite connection. */
function db() {
  if (_db) return _db;
  // Keep the Node SQLite experimental-warning suppression centralized in the
  // backend loader. Hooks must keep stderr clean because clients consume it
  // as diagnostic output.
  const sqlite = loadSqliteModule();
  if (!sqlite) throw new Error('qe-fs: node:sqlite is unavailable');
  // Ensure the store's parent dir exists so DatabaseSync can open/create the
  // file. Without this, a hook running in a cwd that has no .qe/ fails with
  // SQLITE_CANTOPEN (errcode 14). Matches the write-path mkdir already used below.
  realFs.mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new sqlite.DatabaseSync(DB_PATH);
  _db.exec(`CREATE TABLE IF NOT EXISTS qe_files(
    path TEXT PRIMARY KEY, content TEXT, encoding TEXT, size INTEGER,
    mode INTEGER, mtime_ms INTEGER, sha256 TEXT, migrated_at INTEGER)`);
  return _db;
}
const getRow = (rel) => db().prepare('SELECT * FROM qe_files WHERE path=?').get(rel);
const getRowMeta = (rel) => db().prepare(
  'SELECT path,encoding,size,mode,mtime_ms,sha256,migrated_at FROM qe_files WHERE path=?',
).get(rel);
const rowBytes = (r) => Buffer.from(r.content ?? '', r.encoding === 'base64' ? 'base64' : 'utf8');
const MAX_BOUNDED_READ_BYTES = 1024 * 1024;

/** Create a stable coded error without changing native errors from passthroughs. */
function qeError(code, message, ErrorClass = Error) {
  const error = new ErrorClass(message);
  error.code = code;
  return error;
}

/** Validate bounded-read arguments before any path or store access. */
function validateBoundedReadArgs(p, maxBytes) {
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes)
    || maxBytes < 0 || maxBytes > MAX_BOUNDED_READ_BYTES) {
    throw qeError('ERR_INVALID_ARG_VALUE',
      `maxBytes must be a safe integer between 0 and ${MAX_BOUNDED_READ_BYTES}`,
      TypeError);
  }
  if (typeof p !== 'string') {
    throw qeError('ERR_INVALID_ARG_TYPE', 'path must be a string', TypeError);
  }
}

/** Reject malformed DB metadata before deciding whether content may be selected. */
function validateRowMeta(row) {
  if (!row || !['utf8', 'base64'].includes(row.encoding)
    || !Number.isSafeInteger(row.size) || row.size < 0
    || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)) {
    throw qeError('ERR_QE_FILE_CORRUPT', 'invalid QE file metadata');
  }
}

/** Decode a bounded row and bind it to the first metadata identity. */
function strictRowBytes(row, expected) {
  if (row.encoding !== expected.encoding || row.size !== expected.size
    || row.sha256 !== expected.sha256 || typeof row.content !== 'string') {
    throw qeError('ERR_QE_FILE_CORRUPT', 'QE file identity changed during decoding');
  }
  let buf;
  if (row.encoding === 'base64') {
    const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!canonicalBase64.test(row.content)) {
      throw qeError('ERR_QE_FILE_CORRUPT', 'invalid canonical base64 content');
    }
    buf = Buffer.from(row.content, 'base64');
    if (buf.toString('base64') !== row.content) {
      throw qeError('ERR_QE_FILE_CORRUPT', 'invalid canonical base64 content');
    }
  } else {
    buf = Buffer.from(row.content, 'utf8');
  }
  if (buf.byteLength !== expected.size
    || createHash('sha256').update(buf).digest('hex') !== expected.sha256) {
    throw qeError('ERR_QE_FILE_CORRUPT', 'QE file content does not match metadata');
  }
  return buf;
}

/** Apply the same encoding option shape as node:fs readFileSync. */
function formatReadResult(buf, opts) {
  const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
  return enc ? buf.toString(enc) : buf;
}

/** Upsert one canonical QE file row and all integrity metadata. */
function upsert(rel, buf, mode) {
  const isBin = buf.includes(0) || !Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
  const encoding = isBin ? 'base64' : 'utf8';
  const content = isBin ? buf.toString('base64') : buf.toString('utf8');
  const now = Date.now();
  db().prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET content=excluded.content,encoding=excluded.encoding,
      size=excluded.size,mode=excluded.mode,mtime_ms=excluded.mtime_ms,sha256=excluded.sha256,migrated_at=excluded.migrated_at`)
    .run(rel, content, encoding, buf.length, mode ?? 0o644, now, createHash('sha256').update(buf).digest('hex'), now);
}

// ---- fs surface (only what the framework uses; extend as consumers migrate) --

export function readFileSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.readFileSync(p, opts);
  const row = getRow(rel);
  const buf = row ? rowBytes(row)
    : (realFs.existsSync(p) ? realFs.readFileSync(p) : null);
  if (buf == null) { const e = new Error(`ENOENT: no such file, open '${p}'`); e.code = 'ENOENT'; throw e; }
  return formatReadResult(buf, opts);
}

/**
 * Read at most 1 MiB while keeping DB content out of the JS boundary until a
 * metadata-only size and identity check has passed.
 */
export function readFileBoundedSync(p, maxBytes, opts) {
  validateBoundedReadArgs(p, maxBytes);
  const rel = qeRel(p);
  if (rel != null) {
    let meta;
    try {
      meta = getRowMeta(rel);
    } catch (error) {
      if (error instanceof RangeError || error?.code === 'ERR_OUT_OF_RANGE') {
        throw qeError('ERR_QE_FILE_CORRUPT', 'QE file metadata integer is out of range');
      }
      throw error;
    }
    if (meta) {
      validateRowMeta(meta);
      if (meta.size > maxBytes) {
        throw qeError('ERR_QE_FILE_TOO_LARGE', `QE file exceeds ${maxBytes} bytes`);
      }
      const expectedEncodedLength = 4 * Math.ceil(meta.size / 3);
      const row = db().prepare(`SELECT content,encoding,size,sha256 FROM qe_files
        WHERE path=? AND size=? AND encoding=? AND sha256=? AND size<=?
          AND ((encoding='utf8'
                AND octet_length(content)=size)
            OR (encoding='base64'
                AND octet_length(content)=?))`)
        .get(rel, meta.size, meta.encoding, meta.sha256, maxBytes, expectedEncodedLength);
      if (!row) {
        throw qeError('ERR_QE_FILE_CHANGED_DURING_READ', 'QE file changed during bounded read');
      }
      return formatReadResult(strictRowBytes(row, meta), opts);
    }
  }

  const flags = realFs.constants.O_RDONLY
    | (realFs.constants.O_NONBLOCK || 0)
    | (realFs.constants.O_CLOEXEC || 0);
  const fd = realFs.openSync(p, flags);
  try {
    const stat = realFs.fstatSync(fd);
    if (!stat.isFile()) {
      throw qeError('ERR_QE_UNSUPPORTED_FILE_TYPE', 'bounded reads require a regular file');
    }
    if (stat.size > maxBytes) {
      throw qeError('ERR_QE_FILE_TOO_LARGE', `file exceeds ${maxBytes} bytes`);
    }
    const chunks = [];
    let total = 0;
    while (total <= maxBytes) {
      const remaining = maxBytes + 1 - total;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const read = realFs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      chunks.push(read === chunk.length ? chunk : chunk.subarray(0, read));
      total += read;
    }
    if (total > maxBytes) {
      throw qeError('ERR_QE_FILE_TOO_LARGE', `file exceeds ${maxBytes} bytes`);
    }
    const after = realFs.fstatSync(fd);
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs
      || after.dev !== stat.dev || after.ino !== stat.ino) {
      throw qeError('ERR_QE_FILE_CHANGED_DURING_READ', 'file changed during bounded read');
    }
    return formatReadResult(Buffer.concat(chunks, total), opts);
  } finally {
    realFs.closeSync(fd);
  }
}

/** Write through the QE store or delegate a non-QE path to node:fs. */
export function writeFileSync(p, data, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.writeFileSync(p, data, opts);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), (opts && opts.encoding) || 'utf8');
  upsert(rel, buf, opts && opts.mode);
  if (shouldMirrorToDisk(rel)) { // mirror only namespaces still in transition
    try { realFs.mkdirSync(dirname(p), { recursive: true }); realFs.writeFileSync(p, data, opts); } catch { /* best effort */ }
  }
}

/** Test QE-row, virtual-directory, or disk existence without selecting content. */
export function existsSync(p) {
  const rel = qeRel(p);
  if (rel == null) return realFs.existsSync(p);
  if (getRowMeta(rel) || realFs.existsSync(p)) return true;
  const prefix = rel.endsWith('/') ? rel : rel + '/';
  return !!db().prepare('SELECT 1 FROM qe_files WHERE path LIKE ? LIMIT 1').get(prefix + '%');
}

/** Create a real directory, while QE virtual directories remain implicit. */
export function mkdirSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.mkdirSync(p, opts);
  return undefined; // directories are implicit in the path column
}

/** Remove a QE row and its transitional disk mirror, or delegate to node:fs. */
export function unlinkSync(p) {
  const rel = qeRel(p);
  if (rel == null) return realFs.unlinkSync(p);
  db().prepare('DELETE FROM qe_files WHERE path=?').run(rel);
  if (realFs.existsSync(p)) { try { realFs.unlinkSync(p); } catch { /* ignore */ } }
}

/** Move a file across QE or native namespaces using the shim's read/write path. */
export function renameSync(a, b) {
  const ra = qeRel(a); const rb = qeRel(b);
  if (ra == null && rb == null) return realFs.renameSync(a, b);
  // read source (row or disk), write dest (shim write = dual-aware), drop source
  const buf = readFileSync(a);
  if (rb == null) realFs.writeFileSync(b, buf); else writeFileSync(b, buf);
  unlinkSync(a);
}

/** List the union of immediate DB-backed and disk-backed children. */
export function readdirSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.readdirSync(p, opts);
  const prefix = rel.endsWith('/') ? rel : rel + '/';
  const names = new Set();
  for (const r of db().prepare('SELECT path FROM qe_files WHERE path LIKE ?').all(prefix + '%')) {
    const rest = r.path.slice(prefix.length);
    names.add(rest.includes('/') ? { name: rest.split('/')[0], dir: true } : { name: rest, dir: false });
  }
  // fold to unique basenames (a name seen as both dir and file → dir wins)
  const byName = new Map();
  for (const it of names) { const prev = byName.get(it.name); byName.set(it.name, { name: it.name, dir: it.dir || (prev && prev.dir) }); }
  if (realFs.existsSync(p)) {
    for (const e of realFs.readdirSync(p, { withFileTypes: true })) {
      if (!byName.has(e.name)) byName.set(e.name, { name: e.name, dir: e.isDirectory() });
    }
  }
  const withTypes = opts && opts.withFileTypes;
  return [...byName.values()].map((it) => (withTypes
    ? { name: it.name, isFile: () => !it.dir, isDirectory: () => it.dir, isSymbolicLink: () => false }
    : it.name));
}

/** Return metadata-only stats for QE rows and virtual directories. */
export function statSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.statSync(p, opts);
  const row = getRowMeta(rel);
  if (row) return {
    size: row.size, mode: row.mode, mtimeMs: row.mtime_ms,
    mtime: new Date(row.mtime_ms), isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
  };
  const prefix = rel.endsWith('/') ? rel : rel + '/';
  const child = db().prepare('SELECT mtime_ms FROM qe_files WHERE path LIKE ? LIMIT 1').get(prefix + '%');
  if (child) return {
    size: 0, mode: 0o755, mtimeMs: child.mtime_ms,
    mtime: new Date(child.mtime_ms), isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false,
  };
  return realFs.statSync(p, opts);
}

/** Remove a QE subtree and its mirror, or delegate a non-QE path. */
export function rmSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.rmSync(p, opts);
  const prefix = rel.endsWith('/') ? rel : rel + '/';
  db().prepare('DELETE FROM qe_files WHERE path=? OR path LIKE ?').run(rel, prefix + '%');
  if (realFs.existsSync(p)) { try { realFs.rmSync(p, { recursive: true, force: true, ...opts }); } catch { /* ignore */ } }
}

/** Append to a QE row through a read/concat/write cycle. */
export function appendFileSync(p, data, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.appendFileSync(p, data, opts);
  const prev = existsSync(p) ? readFileSync(p) : Buffer.alloc(0);
  const add = Buffer.isBuffer(data) ? data : Buffer.from(String(data), (opts && opts.encoding) || 'utf8');
  writeFileSync(p, Buffer.concat([prev, add]));
}

/** QE rows cannot be symlinks, so lstat shares the metadata-only stat path. */
export function lstatSync(p, opts) { return statSync(p, opts); }
/** Update native timestamps; QE row timestamps are assigned on write. */
export function utimesSync(p, a, m) { if (qeRel(p) == null) return realFs.utimesSync(p, a, m); }

// Pass-throughs for fd-based / temp ops we never virtualize.
export const {
  chmodSync, copyFileSync, realpathSync, openSync, closeSync, readSync, fstatSync, mkdtempSync,
} = realFs;
export default realFs;
