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
 * Semantics for .qe/ paths: DB is the source of truth.
 *   read      → row content if present, else the on-disk file (un-migrated), else ENOENT
 *   write     → upsert the row; the on-disk file is NOT (re)created
 *   exists    → a row OR an on-disk file
 *   readdir   → union of immediate children from rows and from disk
 *   unlink    → drop the row (and the disk file if it lingers)
 *   rename    → move the row (supports the write-tmp-then-rename atomic pattern)
 * Reads fall back to disk so a not-yet-migrated file still works; because reads
 * are row-first, a stale disk file never shadows a written row.
 */

import * as realFs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, relative, join, dirname, basename } from 'node:path';

const ROOT = process.env.QE_ROOT || process.cwd();
const QE = join(ROOT, '.qe');
const DB_PATH = join(QE, 'qe.db');
const DB_SELF = /\.qe\/qe\.db(-wal|-shm|-journal)?$/;

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
function db() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec(`CREATE TABLE IF NOT EXISTS qe_files(
    path TEXT PRIMARY KEY, content TEXT, encoding TEXT, size INTEGER,
    mode INTEGER, mtime_ms INTEGER, sha256 TEXT, migrated_at INTEGER)`);
  return _db;
}
const getRow = (rel) => db().prepare('SELECT * FROM qe_files WHERE path=?').get(rel);
const rowBytes = (r) => Buffer.from(r.content ?? '', r.encoding === 'base64' ? 'base64' : 'utf8');

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
  const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
  return enc ? buf.toString(enc) : buf;
}

export function writeFileSync(p, data, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.writeFileSync(p, data, opts);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), (opts && opts.encoding) || 'utf8');
  upsert(rel, buf, opts && opts.mode);
}

export function existsSync(p) {
  const rel = qeRel(p);
  if (rel == null) return realFs.existsSync(p);
  return !!getRow(rel) || realFs.existsSync(p);
}

export function mkdirSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.mkdirSync(p, opts);
  return undefined; // directories are implicit in the path column
}

export function unlinkSync(p) {
  const rel = qeRel(p);
  if (rel == null) return realFs.unlinkSync(p);
  db().prepare('DELETE FROM qe_files WHERE path=?').run(rel);
  if (realFs.existsSync(p)) { try { realFs.unlinkSync(p); } catch { /* ignore */ } }
}

export function renameSync(a, b) {
  const ra = qeRel(a); const rb = qeRel(b);
  if (ra == null && rb == null) return realFs.renameSync(a, b);
  // read source (row or disk), write dest, drop source
  const buf = readFileSync(a);
  if (rb == null) { realFs.writeFileSync(b, buf); } else { upsert(rb, buf); }
  unlinkSync(a);
}

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

export function statSync(p, opts) {
  const rel = qeRel(p);
  if (rel == null) return realFs.statSync(p, opts);
  const row = getRow(rel);
  if (!row) return realFs.statSync(p, opts);
  return {
    size: row.size, mode: row.mode, mtimeMs: row.mtime_ms,
    mtime: new Date(row.mtime_ms), isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
  };
}

// Pass-throughs for anything a consumer imports but we don't virtualize.
export const {
  appendFileSync, rmSync, chmodSync, copyFileSync, realpathSync, openSync, closeSync,
} = realFs;
export default realFs;
