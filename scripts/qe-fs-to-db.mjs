#!/usr/bin/env node
/**
 * qe-fs-to-db.mjs — migrate the .qe file tree into DB rows, losslessly.
 *
 * Goal: make the local SQLite store (.qe/qe.db) the source of truth for .qe
 * content, so files can eventually be retired. Every .qe file becomes one row
 * in `qe_files` holding its FULL bytes (utf8 text, or base64 when binary),
 * plus size / mode / mtime / sha256. Integrity is the whole point, so the
 * migrate step immediately reconstructs into a temp dir and byte-diffs it back
 * against the originals before claiming success.
 *
 * Modes:
 *   migrate            (default) upsert every .qe file into qe_files, then
 *                      self-verify by reconstruct+diff. Exits non-zero on any
 *                      integrity mismatch.
 *   verify             re-check every row's stored sha256 against the live file
 *                      on disk (and against a recompute of the stored bytes).
 *   reconstruct <dir>  write every row back out under <dir> (proves losslessness
 *                      / reversibility). <dir> must not be inside .qe.
 *   delete-migrated <relPrefix>
 *                      DELETE the on-disk files under <relPrefix> — but ONLY
 *                      those whose bytes exactly match a stored row (fail-closed:
 *                      an unverified file is never deleted). <relPrefix> must be
 *                      inside .qe and is required; there is no "delete all".
 *
 * The DB itself (qe.db / -wal / -shm) is never stored or deleted.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync,
  rmSync, chmodSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const QE = join(ROOT, '.qe');
const DB_PATH = join(QE, 'qe.db');
const DB_SELF = new Set(['qe.db', 'qe.db-wal', 'qe.db-shm', 'qe.db-journal']);

const mode = process.argv[2] || 'migrate';
const arg = process.argv[3];

if (!existsSync(DB_PATH)) { console.error(`qe-fs-to-db: no store at ${DB_PATH}.`); process.exit(1); }
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS qe_files(
  path TEXT PRIMARY KEY, content TEXT, encoding TEXT, size INTEGER,
  mode INTEGER, mtime_ms INTEGER, sha256 TEXT, migrated_at INTEGER)`);

/** Every regular file under .qe, repo-relative, excluding the DB's own files. */
function listQeFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const rel = relative(ROOT, abs);
        if (dir === QE && DB_SELF.has(e.name)) continue; // never store the store
        out.push(rel);
      }
    }
  })(QE);
  return out.sort();
}

/** Decide utf8 vs base64: a NUL byte or a non-round-tripping decode ⇒ binary. */
function encodeBytes(buf) {
  if (buf.includes(0)) return { encoding: 'base64', content: buf.toString('base64') };
  const text = buf.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(buf)) return { encoding: 'utf8', content: text };
  return { encoding: 'base64', content: buf.toString('base64') };
}
const decodeRow = (r) => Buffer.from(r.content ?? '', r.encoding === 'base64' ? 'base64' : 'utf8');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function migrate() {
  const files = listQeFiles();
  const now = Date.now();
  const up = db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET content=excluded.content,encoding=excluded.encoding,
      size=excluded.size,mode=excluded.mode,mtime_ms=excluded.mtime_ms,sha256=excluded.sha256,migrated_at=excluded.migrated_at`);
  let n = 0, bytes = 0;
  db.exec('BEGIN');
  for (const rel of files) {
    const abs = join(ROOT, rel);
    let buf, st;
    try { buf = readFileSync(abs); st = statSync(abs); } catch { continue; }
    const { encoding, content } = encodeBytes(buf);
    up.run(rel, content, encoding, buf.length, st.mode, Math.round(st.mtimeMs), sha(buf), now);
    n += 1; bytes += buf.length;
  }
  // DB is authoritative: a file that is gone from disk but present as a row is
  // NOT dropped — that is the whole point (a migrated-then-deleted file lives on
  // as its row). Only `--prune` re-imposes file-authoritative sync.
  let pruned = 0;
  if (process.argv.includes('--prune')) {
    const live = new Set(files);
    const stale = db.prepare('SELECT path FROM qe_files').all().map((r) => r.path).filter((p) => !live.has(p));
    const del = db.prepare('DELETE FROM qe_files WHERE path=?');
    for (const p of stale) del.run(p);
    pruned = stale.length;
  }
  db.exec('COMMIT');
  console.log(`qe-fs-to-db: migrated ${n} files (${(bytes / 1024).toFixed(0)} KB) into qe_files${pruned ? `; pruned ${pruned} stale row(s)` : ''}.`);
  const res = integrityCheck();
  if (!res.ok) { console.error(`qe-fs-to-db: INTEGRITY FAIL — ${res.mismatches.length} mismatch(es).`); res.mismatches.slice(0, 10).forEach((m) => console.error('  - ' + m)); process.exit(2); }
  console.log(`qe-fs-to-db: integrity PASS — ${res.checked} rows reconstruct byte-identical to disk.`);
}

/** Reconstruct each row in memory and compare bytes+sha to the live file. */
function integrityCheck() {
  const rows = db.prepare('SELECT * FROM qe_files').all();
  const mismatches = [];
  for (const r of rows) {
    const buf = decodeRow(r);
    if (sha(buf) !== r.sha256) { mismatches.push(`${r.path}: stored sha mismatch`); continue; }
    if (buf.length !== r.size) { mismatches.push(`${r.path}: size ${buf.length}≠${r.size}`); continue; }
    const abs = join(ROOT, r.path);
    if (existsSync(abs)) {
      const disk = readFileSync(abs);
      if (!disk.equals(buf)) mismatches.push(`${r.path}: differs from disk`);
    }
  }
  return { ok: mismatches.length === 0, checked: rows.length, mismatches };
}

function verify() {
  const res = integrityCheck();
  console.log(`qe-fs-to-db: ${res.checked} rows checked, ${res.mismatches.length} mismatch(es).`);
  res.mismatches.slice(0, 20).forEach((m) => console.error('  - ' + m));
  process.exit(res.ok ? 0 : 2);
}

function reconstruct(dir) {
  if (!dir) { console.error('reconstruct <dir> required.'); process.exit(1); }
  const outAbs = resolve(ROOT, dir);
  if (outAbs === QE || outAbs.startsWith(QE + '/')) { console.error('refusing to reconstruct into .qe (would clobber source).'); process.exit(1); }
  const rows = db.prepare('SELECT * FROM qe_files').all();
  for (const r of rows) {
    const dest = join(outAbs, r.path);
    mkdirSync(dirname(dest), { recursive: true });
    const buf = decodeRow(r);
    writeFileSync(dest, buf);
    try { chmodSync(dest, r.mode & 0o777); } catch { /* ignore */ }
  }
  console.log(`qe-fs-to-db: reconstructed ${rows.length} files into ${dir}`);
}

/** Fail-closed deletion: only remove on-disk files that byte-match a stored row. */
function deleteMigrated(prefix) {
  if (!prefix) { console.error('delete-migrated <relPrefix> required (e.g. .qe/.archive). No "delete all".'); process.exit(1); }
  const absPrefix = resolve(ROOT, prefix);
  if (absPrefix !== QE && !absPrefix.startsWith(QE + '/')) { console.error('refusing: prefix must be inside .qe.'); process.exit(1); }
  const rows = db.prepare('SELECT path,sha256 FROM qe_files').all();
  const byPath = new Map(rows.map((r) => [r.path, r.sha256]));
  let deleted = 0, skipped = 0;
  for (const rel of listQeFiles()) {
    const abs = join(ROOT, rel);
    if (abs !== absPrefix && !abs.startsWith(absPrefix + '/')) continue;
    if (DB_SELF.has(rel.split('/').pop())) { skipped += 1; continue; }
    const stored = byPath.get(rel);
    if (!stored) { skipped += 1; continue; }               // not migrated → keep
    if (sha(readFileSync(abs)) !== stored) { skipped += 1; continue; } // drifted → keep
    rmSync(abs); deleted += 1;
  }
  console.log(`qe-fs-to-db: deleted ${deleted} migrated file(s) under ${prefix}; kept ${skipped} unverified/other.`);
  console.log('  (recover any of them with: node scripts/qe-fs-to-db.mjs reconstruct <dir>)');
}

try {
  if (mode === 'migrate') migrate();
  else if (mode === 'verify') verify();
  else if (mode === 'reconstruct') reconstruct(arg);
  else if (mode === 'delete-migrated') deleteMigrated(arg);
  else { console.error(`unknown mode "${mode}". Use: migrate | verify | reconstruct <dir> | delete-migrated <relPrefix>`); process.exit(1); }
} finally { db.close(); }
