#!/usr/bin/env node
/**
 * qe-fs.test.mjs — proves the DB-authoritative fs shim serves .qe/ paths from
 * the qe_files table and passes everything else through to real fs.
 *
 * Run: node --test hooks/scripts/lib/__tests__/qe-fs.test.mjs
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync as realWrite, existsSync as realExists, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = join(HERE, '..', 'qe-fs.mjs');

// Each test runs the shim in a fresh child process with QE_ROOT pointed at a
// temp sandbox (QE_ROOT is read at module load, so a child is the clean way).
function runInSandbox(body, { dbOnly = '1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qe-fs-'));
  mkdirSync(join(root, '.qe'), { recursive: true });
  // seed an empty store so the shim's CREATE TABLE has a db to open
  const seed = `import {DatabaseSync} from 'node:sqlite'; new DatabaseSync(${JSON.stringify(join(root, '.qe', 'qe.db'))}).close();`;
  spawnSync('node', ['--input-type=module', '-e', seed], { encoding: 'utf8' });
  const script = `
    process.env.QE_ROOT=${JSON.stringify(root)};
    const fs = await import(${JSON.stringify(pathToFileURL(SHIM).href)});
    const assert = (await import('node:assert/strict')).default;
    const ROOT=${JSON.stringify(root)};
    ${body}
    console.log('OK');
  `;
  // exercise the abolition end-state (DB_ONLY): writes never touch disk
  const env = { ...process.env };
  if (dbOnly == null) delete env.QE_STORE_DB_ONLY;
  else env.QE_STORE_DB_ONLY = dbOnly;
  const r = spawnSync('node', ['--input-type=module', '-e', script], {
    encoding: 'utf8', env,
  });
  return { ok: r.stdout.includes('OK'), out: r.stdout, err: r.stderr, status: r.status };
}

test('write then read a .qe file goes through the DB (no disk file created)', () => {
  const r = runInSandbox(`
    const p = ROOT + '/.qe/tasks/x.md';
    fs.writeFileSync(p, '# hello\\n한글');
    const real = (await import('node:fs')).default;
    assert.equal(real.existsSync(p), false, 'shim write must NOT create a disk file');
    assert.equal(fs.existsSync(p), true, 'shim existsSync sees the row');
    assert.equal(fs.readFileSync(p, 'utf8'), '# hello\\n한글');
  `);
  assert.equal(r.ok, true, r.err);
});

test('planning is DB-only by default while other .qe paths retain transition mirroring', () => {
  const r = runInSandbox(`
    const planning = ROOT + '/.qe/planning/plans/demo/ROADMAP.md';
    const task = ROOT + '/.qe/tasks/demo.md';
    fs.writeFileSync(planning, '# roadmap');
    fs.writeFileSync(task, '# task');
    const real = (await import('node:fs')).default;
    assert.equal(real.existsSync(planning), false, 'planning write must not create a disk file');
    assert.equal(real.existsSync(ROOT + '/.qe/planning'), false, 'planning directory must remain virtual');
    assert.equal(fs.readFileSync(planning, 'utf8'), '# roadmap');
    assert.deepEqual(fs.readdirSync(ROOT + '/.qe/planning/plans/demo'), ['ROADMAP.md']);
    assert.equal(real.existsSync(task), true, 'unmigrated namespaces must keep transition mirroring');
  `, { dbOnly: null });
  assert.equal(r.ok, true, r.err);
});

test('readdirSync unions row children; unlink drops the row', () => {
  const r = runInSandbox(`
    fs.writeFileSync(ROOT+'/.qe/d/a.md','A');
    fs.writeFileSync(ROOT+'/.qe/d/sub/b.md','B');
    const names = fs.readdirSync(ROOT+'/.qe/d').sort();
    assert.deepEqual(names, ['a.md','sub']);
    const types = fs.readdirSync(ROOT+'/.qe/d',{withFileTypes:true});
    assert.equal(types.find(e=>e.name==='sub').isDirectory(), true);
    assert.equal(types.find(e=>e.name==='a.md').isFile(), true);
    fs.unlinkSync(ROOT+'/.qe/d/a.md');
    assert.equal(fs.existsSync(ROOT+'/.qe/d/a.md'), false);
  `);
  assert.equal(r.ok, true, r.err);
});

test('atomic write-tmp-then-rename pattern lands the row at the final path', () => {
  const r = runInSandbox(`
    fs.writeFileSync(ROOT+'/.qe/state/s.json.tmp', '{"v":1}');
    fs.renameSync(ROOT+'/.qe/state/s.json.tmp', ROOT+'/.qe/state/s.json');
    assert.equal(fs.existsSync(ROOT+'/.qe/state/s.json.tmp'), false);
    assert.equal(fs.readFileSync(ROOT+'/.qe/state/s.json','utf8'), '{"v":1}');
  `);
  assert.equal(r.ok, true, r.err);
});

test('non-.qe paths pass straight through to real fs', () => {
  const r = runInSandbox(`
    const p = ROOT + '/outside.txt';
    fs.writeFileSync(p, 'plain');
    const real = (await import('node:fs')).default;
    assert.equal(real.existsSync(p), true, 'non-.qe write must hit real disk');
    assert.equal(fs.readFileSync(p,'utf8'), 'plain');
  `);
  assert.equal(r.ok, true, r.err);
});

test('reading a missing .qe file throws ENOENT', () => {
  const r = runInSandbox(`
    let code=null; try{ fs.readFileSync(ROOT+'/.qe/nope.md','utf8'); }catch(e){ code=e.code; }
    assert.equal(code, 'ENOENT');
  `);
  assert.equal(r.ok, true, r.err);
});

test('bounded DB reads reject over 1 MiB before preparing a content query', () => {
  const r = runInSandbox(`
    assert.equal(typeof fs.readFileBoundedSync, 'function');
    const p = ROOT + '/.qe/evidence/large.bin';
    fs.writeFileSync(p, Buffer.alloc(1_048_577, 0x61));
    const sqlite = await import('node:sqlite');
    const originalPrepare = sqlite.DatabaseSync.prototype.prepare;
    const queries = [];
    sqlite.DatabaseSync.prototype.prepare = function (sql) {
      queries.push(String(sql));
      return originalPrepare.call(this, sql);
    };
    let code = null;
    try { fs.readFileBoundedSync(p, 1_048_576); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_FILE_TOO_LARGE');
    assert.equal(queries.some(sql => /select\\s+content\\b/i.test(sql)), false, queries.join('\\n'));
  `);
  assert.equal(r.ok, true, r.err || r.out);
});

test('bounded DB reads preserve text and binary semantics at the exact limit', () => {
  const r = runInSandbox(`
    const text = ROOT + '/.qe/evidence/text.txt';
    const binary = ROOT + '/.qe/evidence/binary.bin';
    fs.writeFileSync(text, '한글');
    fs.writeFileSync(binary, Buffer.from([0, 1, 2, 255]));
    assert.equal(fs.readFileBoundedSync(text, 6, 'utf8'), '한글');
    assert.deepEqual(fs.readFileBoundedSync(binary, 4), Buffer.from([0, 1, 2, 255]));
    const edge = ROOT + '/.qe/evidence/edge.bin';
    const bytes = Buffer.alloc(1_048_576, 0x7f);
    fs.writeFileSync(edge, bytes);
    assert.deepEqual(fs.readFileBoundedSync(edge, 1_048_576), bytes);
  `);
  assert.equal(r.ok, true, r.err || r.out);
});

test('bounded DB reads fail closed on identity races and corrupt storage metadata', () => {
  const r = runInSandbox(`
    const sqlite = await import('node:sqlite');
    const dbPath = ROOT + '/.qe/qe.db';
    const raced = ROOT + '/.qe/evidence/raced.txt';
    fs.writeFileSync(raced, 'first');
    const originalPrepare = sqlite.DatabaseSync.prototype.prepare;
    let mutate = true;
    sqlite.DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (!/select\\s+content\\b/i.test(String(sql))) return statement;
      return new Proxy(statement, { get(target, property) {
        if (property === 'get') return (...args) => {
          if (mutate) {
            mutate = false;
            const other = new sqlite.DatabaseSync(dbPath);
            other.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?')
              .run('second', 6, 'f'.repeat(64), '.qe/evidence/raced.txt');
            other.close();
          }
          return target.get(...args);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
    };
    let code = null;
    try { fs.readFileBoundedSync(raced, 100); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_FILE_CHANGED_DURING_READ');

    const corrupt = ROOT + '/.qe/evidence/corrupt.txt';
    fs.writeFileSync(corrupt, 'x');
    const other = new sqlite.DatabaseSync(dbPath);
    other.prepare('UPDATE qe_files SET content=?,size=? WHERE path=?')
      .run('x'.repeat(2_000_000), 1, '.qe/evidence/corrupt.txt');
    other.close();
    code = null;
    try { fs.readFileBoundedSync(corrupt, 1_048_576); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_FILE_CHANGED_DURING_READ');
  `);
  assert.equal(r.ok, true, r.err || r.out);
});

test('bounded DB reads do not materialize a stale-small huge content value', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-fs-memory-'));
  try {
    mkdirSync(join(root, '.qe'), { recursive: true });
    const dbPath = join(root, '.qe', 'qe.db');
    const seed = `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      db.exec(\`CREATE TABLE qe_files(path TEXT PRIMARY KEY, content TEXT, encoding TEXT,
        size INTEGER, mode INTEGER, mtime_ms INTEGER, sha256 TEXT, migrated_at INTEGER)\`);
      db.prepare('INSERT INTO qe_files VALUES(?,CAST(zeroblob(67108864) AS TEXT),?,?,?,?,?,?)')
        .run('.qe/evidence/corrupt.bin', 'base64', 1, 420, 0, ${JSON.stringify('0'.repeat(64))}, 0);
      db.close();
    `;
    const seeded = spawnSync('node', ['--input-type=module', '-e', seed], { encoding: 'utf8' });
    assert.equal(seeded.status, 0, seeded.stderr);
    const probePrefix = `
      process.env.QE_ROOT=${JSON.stringify(root)};
      process.env.QE_STORE_DB_ONLY='1';
      const fs = await import(${JSON.stringify(pathToFileURL(SHIM).href)});
    `;
    const control = spawnSync('node', ['--input-type=module', '-e', `${probePrefix}
      fs.statSync(${JSON.stringify(join(root, '.qe/evidence/corrupt.bin'))});
      console.log(process.resourceUsage().maxRSS);
    `], { encoding: 'utf8' });
    assert.equal(control.status, 0, control.stderr);
    const baselineRSS = Number(control.stdout.trim());
    const read = `${probePrefix}
      let code = null;
      try { fs.readFileBoundedSync(${JSON.stringify(join(root, '.qe/evidence/corrupt.bin'))}, 10); }
      catch (error) { code = error.code; }
      console.log(JSON.stringify({ code, maxRSS: process.resourceUsage().maxRSS }));
    `;
    const result = spawnSync('node', ['--input-type=module', '-e', read], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout.trim());
    assert.equal(observed.code, 'ERR_QE_FILE_CHANGED_DURING_READ');
    assert.ok(observed.maxRSS - baselineRSS < 24 * 1024,
      `bounded lookup materialized the 64 MiB value (baseline=${baselineRSS} KiB, maxRSS=${observed.maxRSS} KiB)`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounded DB reads bind the first hash and reject malformed stored encodings', () => {
  const r = runInSandbox(`
    const sqlite = await import('node:sqlite');
    const crypto = await import('node:crypto');
    const dbPath = ROOT + '/.qe/qe.db';
    const path = ROOT + '/.qe/evidence/identity.txt';
    fs.writeFileSync(path, 'first');
    const originalPrepare = sqlite.DatabaseSync.prototype.prepare;
    let mutate = true;
    sqlite.DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (!/select\\s+content\\b/i.test(String(sql))) return statement;
      return new Proxy(statement, { get(target, property) {
        if (property === 'get') return (...args) => {
          if (mutate) {
            mutate = false;
            const replacement = 'other';
            const hash = crypto.createHash('sha256').update(replacement).digest('hex');
            const other = new sqlite.DatabaseSync(dbPath);
            other.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?')
              .run(replacement, 5, hash, '.qe/evidence/identity.txt');
            other.close();
          }
          return target.get(...args);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
    };
    let code = null;
    try { fs.readFileBoundedSync(path, 10); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_FILE_CHANGED_DURING_READ');

    const db = new sqlite.DatabaseSync(dbPath);
    fs.writeFileSync(ROOT + '/.qe/evidence/encoding.bin', Buffer.from([0]));
    db.prepare('UPDATE qe_files SET encoding=? WHERE path=?')
      .run('hex', '.qe/evidence/encoding.bin');
    code = null;
    try { fs.readFileBoundedSync(ROOT + '/.qe/evidence/encoding.bin', 10); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_FILE_CORRUPT');
    db.prepare('UPDATE qe_files SET encoding=?,content=?,size=? WHERE path=?')
      .run('base64', '!!!!', 1, '.qe/evidence/encoding.bin');
    db.close();
    code = null;
    try { fs.readFileBoundedSync(ROOT + '/.qe/evidence/encoding.bin', 10); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_FILE_CORRUPT');
  `);
  assert.equal(r.ok, true, r.err || r.out);
});

test('bounded reads validate limits first and use metadata-only stat and exists queries', () => {
  const r = runInSandbox(`
    const p = ROOT + '/.qe/evidence/a.txt';
    fs.writeFileSync(p, 'a');
    for (const invalid of [-1, 1.5, 1_048_577, NaN, Infinity, '1', null]) {
      let code = null;
      try { fs.readFileBoundedSync(ROOT + '/missing', invalid); } catch (error) { code = error.code; }
      assert.equal(code, 'ERR_INVALID_ARG_VALUE');
    }
    let pathCode = null;
    try { fs.readFileBoundedSync(Buffer.from('x'), 1); } catch (error) { pathCode = error.code; }
    assert.equal(pathCode, 'ERR_INVALID_ARG_TYPE');
    const empty = ROOT + '/.qe/evidence/empty';
    fs.writeFileSync(empty, '');
    assert.deepEqual(fs.readFileBoundedSync(empty, -0), Buffer.alloc(0));
    const sqlite = await import('node:sqlite');
    const originalPrepare = sqlite.DatabaseSync.prototype.prepare;
    const queries = [];
    sqlite.DatabaseSync.prototype.prepare = function (sql) {
      queries.push(String(sql));
      return originalPrepare.call(this, sql);
    };
    assert.equal(fs.existsSync(p), true);
    assert.equal(fs.statSync(p).size, 1);
    const unsafe = ROOT + '/.qe/evidence/unsafe-size';
    fs.writeFileSync(unsafe, 'x');
    const direct = new sqlite.DatabaseSync(ROOT + '/.qe/qe.db');
    direct.prepare('UPDATE qe_files SET size=? WHERE path=?')
      .run(9_007_199_254_740_992n, '.qe/evidence/unsafe-size');
    direct.close();
    let corruptCode = null;
    try { fs.readFileBoundedSync(unsafe, 10); } catch (error) { corruptCode = error.code; }
    assert.equal(corruptCode, 'ERR_QE_FILE_CORRUPT');
    assert.equal(queries.some(sql => /select\\s+\\*/i.test(sql) || /select[^;]*\\bcontent\\b/i.test(sql)), false, queries.join('\\n'));
  `);
  assert.equal(r.ok, true, r.err || r.out);
});

test('bounded disk reads reject races and non-regular files without blocking', () => {
  const r = runInSandbox(`
    const realModule = await import('node:fs');
    const real = realModule.default;
    const { syncBuiltinESMExports } = await import('node:module');
    const child = await import('node:child_process');
    const file = ROOT + '/outside.txt';
    real.writeFileSync(file, 'plain');
    assert.equal(fs.readFileBoundedSync(file, 5, 'utf8'), 'plain');
    const originalRead = real.readSync;
    let truncated = false;
    real.readSync = (...args) => {
      if (!truncated) { truncated = true; real.truncateSync(file, 1); }
      return originalRead(...args);
    };
    syncBuiltinESMExports();
    let raceCode = null;
    try { fs.readFileBoundedSync(file, 5, 'utf8'); } catch (error) { raceCode = error.code; }
    finally { real.readSync = originalRead; syncBuiltinESMExports(); }
    assert.equal(raceCode, 'ERR_QE_FILE_CHANGED_DURING_READ');
    const dir = ROOT + '/directory';
    real.mkdirSync(dir);
    let code = null;
    try { fs.readFileBoundedSync(dir, 10); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_UNSUPPORTED_FILE_TYPE');
    const fifo = ROOT + '/pipe';
    const made = child.spawnSync('mkfifo', [fifo]);
    assert.equal(made.status, 0);
    const started = Date.now();
    code = null;
    try { fs.readFileBoundedSync(fifo, 10); } catch (error) { code = error.code; }
    assert.equal(code, 'ERR_QE_UNSUPPORTED_FILE_TYPE');
    assert.ok(Date.now() - started < 1_000);
  `);
  assert.equal(r.ok, true, r.err || r.out);
});
