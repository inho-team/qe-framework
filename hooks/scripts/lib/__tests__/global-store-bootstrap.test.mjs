#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GLOBAL_STORE_APPLICATION_ID,
  createGlobalStoreBootstrap,
  isSafeQeEntryMetadata,
  openGlobalQeStore,
} from '../global-store-bootstrap.mjs';
import { SCHEMA_VERSION } from '../store-sqlite.mjs';

const bootstrapUrl = new URL('../global-store-bootstrap.mjs', import.meta.url).href;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const resolverPath = path.resolve(testDir, '../global-store-path.mjs');
const resolverTestPath = path.resolve(testDir, '../../../../scripts/__tests__/global-store-path.test.mjs');
const EXPECTED_HASHES = new Map([
  [resolverPath, '469ceb9be664495d2a1a16610d2d6d4b0263b856388d6b552ae8433e3c01ded7'],
  [resolverTestPath, '889d7dca8aa27d65f335b04cdac71979eb4eba639cd3dede2b3c090864e739e5'],
]);

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runInHome(home, source, cwd = home) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function assertChildOk(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function sqlite() {
  return process.getBuiltinModule('node:sqlite');
}

test('creates and reopens one home-global WAL store without a cwd-local DB', () => {
  const home = tempRoot('qe-global-home-');
  const cwd = tempRoot('qe-global-cwd-');
  const before = new Map([...EXPECTED_HASHES].map(([file]) => [file, sha256(file)]));
  try {
    const source = `
      import assert from 'node:assert/strict';
      import { openGlobalQeStore, GLOBAL_STORE_APPLICATION_ID } from ${JSON.stringify(bootstrapUrl)};
      import { resolveGlobalQeStorePath } from ${JSON.stringify(new URL('../global-store-path.mjs', import.meta.url).href)};
      const first = openGlobalQeStore();
      assert.equal(first.created, true);
      assert.equal(first.path, process.env.HOME + '/.qe/qe.db');
      assert.equal(first.path, resolveGlobalQeStorePath());
      const firstIdentity = await import('node:fs').then(({statSync}) => statSync(first.path));
      first.db.exec('CREATE TABLE IF NOT EXISTS bootstrap_seed(v TEXT); DELETE FROM bootstrap_seed');
      first.db.prepare('INSERT INTO bootstrap_seed VALUES (?)').run('kept');
      first.db.close();
      const legacy = new (process.getBuiltinModule('node:sqlite').DatabaseSync)(first.path);
      legacy.exec('PRAGMA journal_mode=DELETE; PRAGMA user_version=3');
      legacy.close();
      const second = openGlobalQeStore();
      assert.equal(second.created, false);
      assert.equal(second.db.prepare('PRAGMA application_id').get().application_id, GLOBAL_STORE_APPLICATION_ID);
      assert.equal(second.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
      assert.equal(second.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(second.db.prepare('PRAGMA user_version').get().user_version, ${SCHEMA_VERSION});
      assert.equal(second.db.prepare("SELECT v FROM schema_meta WHERE k='store_scope'").get().v, 'global');
      assert.equal(second.db.prepare('SELECT v FROM bootstrap_seed').get().v, 'kept');
      const secondIdentity = await import('node:fs').then(({statSync}) => statSync(second.path));
      assert.equal(secondIdentity.dev, firstIdentity.dev);
      assert.equal(secondIdentity.ino, firstIdentity.ino);
      second.db.close();
    `;
    assertChildOk(runInHome(home, source, cwd));
    assert.equal(fs.existsSync(path.join(cwd, '.qe', 'qe.db')), false);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(home, '.qe')).mode & 0o777, 0o700);
    }
    for (const [file, digest] of before) assert.equal(sha256(file), digest);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('rejects arguments and applies the same POSIX metadata policy used by production', () => {
  assert.throws(() => openGlobalQeStore(undefined), { code: 'GLOBAL_STORE_ARGUMENTS' });
  assert.equal(isSafeQeEntryMetadata({ uid: 501, mode: 0o100600 }, 501), true);
  assert.equal(isSafeQeEntryMetadata({ uid: 502, mode: 0o100600 }, 501), false);
  assert.equal(isSafeQeEntryMetadata({ uid: 501, mode: 0o100620 }, 501), false);
});

test('path resolution fails first and is normalized to the public error contract', () => {
  const cwd = tempRoot('qe-global-relative-home-');
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      process.getBuiltinModule=()=>null;
      const {openGlobalQeStore,GlobalStoreBootstrapError}=await import(${JSON.stringify(bootstrapUrl)});
      try { openGlobalQeStore(); process.exitCode=2; }
      catch (e) { process.exitCode=e instanceof GlobalStoreBootstrapError && e.code==='GLOBAL_STORE_UNSAFE_PATH'?0:3; }
    `], {
      cwd, env: { ...process.env, HOME: 'relative-home', USERPROFILE: 'relative-home' }, encoding: 'utf8',
    });
    assertChildOk(result);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects an unmarked database before writable open and preserves its bytes', () => {
  const home = tempRoot('qe-global-unmarked-');
  const qeDir = path.join(home, '.qe');
  fs.mkdirSync(qeDir, { mode: 0o700 });
  const dbPath = path.join(qeDir, 'qe.db');
  const db = new (sqlite().DatabaseSync)(dbPath);
  db.exec('CREATE TABLE foreign_data(v TEXT); INSERT INTO foreign_data VALUES (\'untouched\')');
  db.close();
  const before = fs.readFileSync(dbPath);
  try {
    const source = `
      import { createGlobalStoreBootstrap } from ${JSON.stringify(bootstrapUrl)};
      let writable = 0;
      const open = createGlobalStoreBootstrap({ onTransition(p) { if (p === 'before-writable-open') writable += 1; } });
      try { open(); process.exitCode = 2; }
      catch (error) { process.exitCode = error.code === 'GLOBAL_STORE_IDENTITY_MISMATCH' && writable === 0 ? 0 : 3; }
    `;
    assertChildOk(runInHome(home, source));
    assert.deepEqual(fs.readFileSync(dbPath), before);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('rejects DB symlinks, orphan sidecars, rollback journals, and unsafe modes', () => {
  if (process.platform === 'win32') return;
  const cases = ['db-symlink', 'orphan-wal', 'journal', 'unsafe-mode'];
  for (const name of cases) {
    const home = tempRoot(`qe-global-${name}-`);
    const qeDir = path.join(home, '.qe');
    fs.mkdirSync(qeDir, { mode: 0o700 });
    const dbPath = path.join(qeDir, 'qe.db');
    const outside = path.join(home, 'outside.db');
    fs.writeFileSync(outside, 'outside');
    if (name === 'db-symlink') fs.symlinkSync(outside, dbPath);
    if (name === 'orphan-wal') fs.writeFileSync(`${dbPath}-wal`, 'orphan');
    if (name === 'journal') {
      const first = runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`);
      assertChildOk(first);
      fs.writeFileSync(`${dbPath}-journal`, 'journal');
    }
    if (name === 'unsafe-mode') fs.chmodSync(qeDir, 0o777);
    const outsideBefore = fs.readFileSync(outside);
    const result = runInHome(home, `
      import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
      try { openGlobalQeStore(); process.exitCode=2; }
      catch (e) { process.exitCode=['GLOBAL_STORE_UNSAFE_PATH','GLOBAL_STORE_UNSAFE_PERMISSIONS'].includes(e.code)?0:3; }
    `);
    assertChildOk(result);
    assert.deepEqual(fs.readFileSync(outside), outsideBefore);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('enforces the complete allowed and rejected SQLite sidecar matrix', () => {
  const states = [
    { name: 'none', suffixes: [], allowed: true },
    { name: 'wal-only', suffixes: ['-wal'], allowed: true },
    { name: 'wal-shm', suffixes: ['-wal', '-shm'], allowed: true },
    { name: 'shm-only', suffixes: ['-shm'], allowed: false },
    { name: 'journal-only', suffixes: ['-journal'], allowed: false },
    { name: 'shm-journal', suffixes: ['-shm', '-journal'], allowed: false },
    { name: 'wal-journal', suffixes: ['-wal', '-journal'], allowed: false },
    { name: 'wal-shm-journal', suffixes: ['-wal', '-shm', '-journal'], allowed: false },
  ];
  for (const { name, suffixes, allowed } of states) {
    const home = tempRoot(`qe-global-sidecar-${name}-`);
    try {
      assertChildOk(runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
      const dbPath = path.join(home, '.qe', 'qe.db');
      for (const suffix of suffixes) fs.writeFileSync(`${dbPath}${suffix}`, '');
      const before = fs.readFileSync(dbPath);
      const result = runInHome(home, `
        import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
        try { const r=openGlobalQeStore(); r.db.close(); process.exitCode=${allowed ? 0 : 2}; }
        catch (e) { process.exitCode=${allowed ? 3 : "e.code==='GLOBAL_STORE_UNSAFE_PATH'?0:4"}; }
      `);
      assertChildOk(result);
      if (!allowed) assert.deepEqual(fs.readFileSync(dbPath), before);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});

test('rejects every non-empty orphan sidecar subset when the main DB is absent', () => {
  const subsets = [
    ['-wal'], ['-shm'], ['-journal'], ['-wal', '-shm'],
    ['-wal', '-journal'], ['-shm', '-journal'], ['-wal', '-shm', '-journal'],
  ];
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  try {
    for (const suffixes of subsets) {
      const home = tempRoot('qe-global-orphan-subset-');
      process.env.HOME = home; process.env.USERPROFILE = home;
      const qeDir = path.join(home, '.qe');
      fs.mkdirSync(qeDir, { mode: 0o700 });
      for (const suffix of suffixes) fs.writeFileSync(path.join(qeDir, `qe.db${suffix}`), 'orphan');
      assert.throws(() => openGlobalQeStore(), { code: 'GLOBAL_STORE_UNSAFE_PATH' });
      for (const suffix of suffixes) assert.equal(fs.readFileSync(path.join(qeDir, `qe.db${suffix}`), 'utf8'), 'orphan');
      fs.rmSync(home, { recursive: true, force: true });
    }
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
  }
});

test('rejects corrupt databases and symlinked lock or sidecar entries without touching targets', () => {
  const corruptHome = tempRoot('qe-global-corrupt-');
  try {
    const qeDir = path.join(corruptHome, '.qe');
    fs.mkdirSync(qeDir, { mode: 0o700 });
    const dbPath = path.join(qeDir, 'qe.db');
    fs.writeFileSync(dbPath, 'not sqlite');
    const before = fs.readFileSync(dbPath);
    const result = runInHome(corruptHome, `
      import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
      try { openGlobalQeStore(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_IDENTITY_MISMATCH'?0:3; }
    `);
    assertChildOk(result);
    assert.deepEqual(fs.readFileSync(dbPath), before);
  } finally { fs.rmSync(corruptHome, { recursive: true, force: true }); }

  if (process.platform === 'win32') return;
  for (const entry of ['lock', 'wal', 'broken-shm']) {
    const home = tempRoot(`qe-global-link-${entry}-`);
    const outside = path.join(home, 'outside');
    fs.writeFileSync(outside, 'outside');
    try {
      assertChildOk(runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
      const dbPath = path.join(home, '.qe', 'qe.db');
      const target = entry === 'lock' ? path.join(home, '.qe', 'qe.bootstrap.lock')
        : `${dbPath}-${entry === 'wal' ? 'wal' : 'shm'}`;
      fs.symlinkSync(entry === 'broken-shm' ? path.join(home, 'missing') : outside, target);
      const before = fs.readFileSync(outside);
      const result = runInHome(home, `
        import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
        try { openGlobalQeStore(); process.exitCode=2; }
        catch (e) { process.exitCode=e.code==='GLOBAL_STORE_UNSAFE_PATH'?0:3; }
      `);
      assertChildOk(result);
      assert.deepEqual(fs.readFileSync(outside), before);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});

test('rejects unsafe modes and non-regular entries for every writable-store role', () => {
  if (process.platform === 'win32') return;
  const cases = ['main-mode', 'wal-mode', 'shm-mode', 'lock-mode', 'wal-directory', 'lock-file'];
  for (const name of cases) {
    const home = tempRoot(`qe-global-entry-${name}-`);
    try {
      assertChildOk(runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
      const dbPath = path.join(home, '.qe', 'qe.db');
      const lockPath = path.join(home, '.qe', 'qe.bootstrap.lock');
      if (name === 'main-mode') fs.chmodSync(dbPath, 0o622);
      if (name === 'wal-mode') { fs.writeFileSync(`${dbPath}-wal`, ''); fs.chmodSync(`${dbPath}-wal`, 0o622); }
      if (name === 'shm-mode') {
        fs.writeFileSync(`${dbPath}-wal`, ''); fs.writeFileSync(`${dbPath}-shm`, ''); fs.chmodSync(`${dbPath}-shm`, 0o622);
      }
      if (name === 'lock-mode') { fs.mkdirSync(lockPath, { mode: 0o700 }); fs.chmodSync(lockPath, 0o722); }
      if (name === 'wal-directory') fs.mkdirSync(`${dbPath}-wal`);
      if (name === 'lock-file') fs.writeFileSync(lockPath, 'not a directory');
      const expected = name.endsWith('-mode') ? 'GLOBAL_STORE_UNSAFE_PERMISSIONS' : 'GLOBAL_STORE_UNSAFE_PATH';
      const result = runInHome(home, `
        import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
        try { openGlobalQeStore(); process.exitCode=2; }
        catch (e) { process.exitCode=e.code===${JSON.stringify(expected)}?0:3; }
      `);
      assertChildOk(result);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});

test('rejects a future marked global schema without changing the main database', () => {
  const home = tempRoot('qe-global-future-');
  try {
    assertChildOk(runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
    const dbPath = path.join(home, '.qe', 'qe.db');
    const db = new (sqlite().DatabaseSync)(dbPath);
    db.exec('PRAGMA user_version=999; PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    const before = fs.readFileSync(dbPath);
    const result = runInHome(home, `
      import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
      try { openGlobalQeStore(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_FUTURE_SCHEMA'?0:3; }
    `);
    assertChildOk(result);
    assert.deepEqual(fs.readFileSync(dbPath), before);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('rejects conflicting or missing scope markers before writable open', () => {
  for (const marker of ['project', null]) {
    const home = tempRoot('qe-global-scope-');
    try {
      assertChildOk(runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
      const dbPath = path.join(home, '.qe', 'qe.db');
      const db = new (sqlite().DatabaseSync)(dbPath);
      if (marker === null) db.exec("DELETE FROM schema_meta WHERE k='store_scope'");
      else db.prepare("UPDATE schema_meta SET v=? WHERE k='store_scope'").run(marker);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      const before = fs.readFileSync(dbPath);
      const result = runInHome(home, `
        import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
        let writable=0;
        const open=createGlobalStoreBootstrap({onTransition(p){if(p==='before-writable-open') writable+=1;}});
        try { open(); process.exitCode=2; }
        catch (e) { process.exitCode=e.code==='GLOBAL_STORE_IDENTITY_MISMATCH'&&writable===0?0:3; }
      `);
      assertChildOk(result);
      assert.deepEqual(fs.readFileSync(dbPath), before);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});

test('rejects structurally ambiguous duplicate scope markers before writable open', () => {
  const home = tempRoot('qe-global-duplicate-scope-');
  const qeDir = path.join(home, '.qe');
  fs.mkdirSync(qeDir, { mode: 0o700 });
  const dbPath = path.join(qeDir, 'qe.db');
  const db = new (sqlite().DatabaseSync)(dbPath);
  db.exec(`
    PRAGMA application_id=${GLOBAL_STORE_APPLICATION_ID};
    CREATE TABLE schema_meta(k TEXT, v TEXT);
    INSERT INTO schema_meta VALUES('store_scope','global'),('store_scope','project');
  `);
  db.close();
  const before = fs.readFileSync(dbPath);
  try {
    const result = runInHome(home, `
      import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
      let writable=0;
      const open=createGlobalStoreBootstrap({onTransition(p){if(p==='before-writable-open') writable+=1;}});
      try { open(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_IDENTITY_MISMATCH'&&writable===0?0:3; }
    `);
    assertChildOk(result);
    assert.deepEqual(fs.readFileSync(dbPath), before);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('rejects a composite schema_meta key that cannot support ON CONFLICT(k)', () => {
  const home = tempRoot('qe-global-composite-scope-');
  const qeDir = path.join(home, '.qe');
  fs.mkdirSync(qeDir, { mode: 0o700 });
  const dbPath = path.join(qeDir, 'qe.db');
  const db = new (sqlite().DatabaseSync)(dbPath);
  db.exec(`
    PRAGMA application_id=${GLOBAL_STORE_APPLICATION_ID};
    CREATE TABLE schema_meta(k TEXT, v TEXT, tenant TEXT, PRIMARY KEY(k,tenant));
    INSERT INTO schema_meta VALUES('store_scope','global','default');
  `);
  db.close();
  const before = fs.readFileSync(dbPath);
  try {
    const result = runInHome(home, `
      import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
      let writable=0;
      const open=createGlobalStoreBootstrap({onTransition(p){if(p==='before-writable-open') writable+=1;}});
      try { open(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_IDENTITY_MISMATCH'&&writable===0?0:3; }
    `);
    assertChildOk(result);
    assert.deepEqual(fs.readFileSync(dbPath), before);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('rejects schema_meta extensions that make the marker upsert unsafe', () => {
  for (const variant of ['required-column', 'trigger']) {
    const home = tempRoot(`qe-global-scope-${variant}-`);
    const qeDir = path.join(home, '.qe');
    fs.mkdirSync(qeDir, { mode: 0o700 });
    const dbPath = path.join(qeDir, 'qe.db');
    const db = new (sqlite().DatabaseSync)(dbPath);
    if (variant === 'required-column') {
      db.exec(`
        PRAGMA application_id=${GLOBAL_STORE_APPLICATION_ID};
        CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT, required TEXT NOT NULL);
        INSERT INTO schema_meta VALUES('store_scope','global','present');
      `);
    } else {
      db.exec(`
        PRAGMA application_id=${GLOBAL_STORE_APPLICATION_ID};
        CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT);
        INSERT INTO schema_meta VALUES('store_scope','global');
        CREATE TRIGGER reject_scope BEFORE INSERT ON schema_meta
        BEGIN SELECT RAISE(ABORT,'marker writes disabled'); END;
      `);
    }
    db.close();
    const before = fs.readFileSync(dbPath);
    try {
      const result = runInHome(home, `
        import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
        let writable=0;
        const open=createGlobalStoreBootstrap({onTransition(p){if(p==='before-writable-open') writable+=1;}});
        try { open(); process.exitCode=2; }
        catch (e) { process.exitCode=e.code==='GLOBAL_STORE_IDENTITY_MISMATCH'&&writable===0?0:3; }
      `);
      assertChildOk(result);
      assert.deepEqual(fs.readFileSync(dbPath), before);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});

test('the final snapshot catches a same-inode scope mutation before writable open', () => {
  const home = tempRoot('qe-global-final-snapshot-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    const seeded = openGlobalQeStore();
    seeded.db.close();
    const dbPath = path.join(home, '.qe', 'qe.db');
    const identity = fs.statSync(dbPath);
    let mutatedBytes;
    let writable = 0;
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-final-snapshot') {
        const db = new (sqlite().DatabaseSync)(dbPath);
        db.prepare("UPDATE schema_meta SET v='project' WHERE k='store_scope'").run();
        db.close();
        mutatedBytes = fs.readFileSync(dbPath);
      }
      if (point === 'before-writable-open') writable += 1;
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_IDENTITY_MISMATCH' });
    assert.equal(writable, 0);
    assert.equal(fs.statSync(dbPath).ino, identity.ino);
    assert.deepEqual(fs.readFileSync(dbPath), mutatedBytes);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the final snapshot rejects header, version, sidecar, and mode mutations', () => {
  const variants = process.platform === 'win32'
    ? ['application-id', 'future-version', 'journal']
    : ['application-id', 'future-version', 'journal', 'mode'];
  for (const variant of variants) {
    const home = tempRoot(`qe-global-final-${variant}-`);
    const oldHome = process.env.HOME;
    const oldProfile = process.env.USERPROFILE;
    process.env.HOME = home; process.env.USERPROFILE = home;
    try {
      const seeded = openGlobalQeStore();
      seeded.db.close();
      const dbPath = path.join(home, '.qe', 'qe.db');
      let writable = 0;
      const open = createGlobalStoreBootstrap({ onTransition(point) {
        if (point === 'before-final-snapshot') {
          if (variant === 'journal') fs.writeFileSync(`${dbPath}-journal`, 'journal');
          else if (variant === 'mode') fs.chmodSync(dbPath, 0o622);
          else {
            const db = new (sqlite().DatabaseSync)(dbPath);
            db.exec(variant === 'application-id' ? 'PRAGMA application_id=0' : 'PRAGMA user_version=999');
            db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
            db.close();
          }
        }
        if (point === 'before-writable-open') writable += 1;
      } });
      const expected = variant === 'future-version' ? 'GLOBAL_STORE_FUTURE_SCHEMA'
        : variant === 'mode' ? 'GLOBAL_STORE_UNSAFE_PERMISSIONS'
          : variant === 'journal' ? 'GLOBAL_STORE_UNSAFE_PATH' : 'GLOBAL_STORE_IDENTITY_MISMATCH';
      assert.throws(() => open(), { code: expected });
      assert.equal(writable, 0);
    } finally {
      try { fs.chmodSync(path.join(home, '.qe', 'qe.db'), 0o600); } catch { /* fixture may not exist */ }
      if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
      if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test('the final snapshot rejects replaced main or creator-lock inodes', () => {
  const mainHome = tempRoot('qe-global-main-replaced-');
  const replacementHome = tempRoot('qe-global-main-replacement-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  try {
    assertChildOk(runInHome(mainHome, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
    assertChildOk(runInHome(replacementHome, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
    process.env.HOME = mainHome; process.env.USERPROFILE = mainHome;
    const dbPath = path.join(mainHome, '.qe', 'qe.db');
    const replacement = fs.readFileSync(path.join(replacementHome, '.qe', 'qe.db'));
    let writable = 0;
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-final-snapshot') {
        fs.renameSync(dbPath, `${dbPath}.old`);
        fs.writeFileSync(dbPath, replacement, { mode: 0o600 });
      }
      if (point === 'before-writable-open') writable += 1;
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_UNSAFE_PATH' });
    assert.equal(writable, 0);
    assert.deepEqual(fs.readFileSync(dbPath), replacement);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(mainHome, { recursive: true, force: true });
    fs.rmSync(replacementHome, { recursive: true, force: true });
  }

  const lockHome = tempRoot('qe-global-lock-replaced-');
  const priorHome = process.env.HOME;
  const priorProfile = process.env.USERPROFILE;
  process.env.HOME = lockHome; process.env.USERPROFILE = lockHome;
  const lockPath = path.join(lockHome, '.qe', 'qe.bootstrap.lock');
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-final-snapshot') {
        fs.rmdirSync(lockPath);
        fs.mkdirSync(lockPath, { mode: 0o700 });
      }
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_UNSAFE_PATH' });
    assert.equal(fs.statSync(lockPath).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(lockHome, '.qe', 'qe.db')), false);
  } finally {
    if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
    if (priorProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = priorProfile;
    fs.rmSync(lockHome, { recursive: true, force: true });
  }
});

test('an owned empty lock is cleaned when pre-open validation fails', () => {
  const home = tempRoot('qe-global-preopen-failure-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-final-snapshot') throw new Error('pre-open fault');
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_OPEN_FAILED' });
    assert.equal(fs.existsSync(path.join(home, '.qe', 'qe.bootstrap.lock')), false);
    assert.equal(fs.existsSync(path.join(home, '.qe', 'qe.db')), false);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('early transition failures are normalized and clean only an owned empty lock', () => {
  const ownerHome = tempRoot('qe-global-lock-observer-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  process.env.HOME = ownerHome; process.env.USERPROFILE = ownerHome;
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'lock-acquired') throw new Error('observer fault');
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_OPEN_FAILED' });
    assert.equal(fs.existsSync(path.join(ownerHome, '.qe', 'qe.bootstrap.lock')), false);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(ownerHome, { recursive: true, force: true });
  }

  const waiterHome = tempRoot('qe-global-wait-observer-');
  const lock = path.join(waiterHome, '.qe', 'qe.bootstrap.lock');
  fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = waiterHome; process.env.USERPROFILE = waiterHome;
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'waiting-for-creator') throw new Error('observer fault');
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_OPEN_FAILED' });
    assert.equal(fs.statSync(lock).isDirectory(), true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    fs.rmSync(waiterHome, { recursive: true, force: true });
  }
});

test('a stale creator lock times out without being removed', () => {
  const home = tempRoot('qe-global-stale-lock-');
  const lock = path.join(home, '.qe', 'qe.bootstrap.lock');
  fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
  try {
    const result = runInHome(home, `
      import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
      const open=createGlobalStoreBootstrap({waitTimeoutMs:30,pollMs:5});
      try { open(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_BOOTSTRAP_BUSY'?0:3; }
    `);
    assertChildOk(result);
    assert.equal(fs.statSync(lock).isDirectory(), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a lock never masks an orphan sidecar path violation', () => {
  const home = tempRoot('qe-global-lock-orphan-');
  const qeDir = path.join(home, '.qe');
  const lock = path.join(qeDir, 'qe.bootstrap.lock');
  fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(qeDir, 'qe.db-wal'), 'orphan');
  try {
    const result = runInHome(home, `
      import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
      const open=createGlobalStoreBootstrap({waitTimeoutMs:20,pollMs:1});
      try { open(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_UNSAFE_PATH'?0:3; }
    `);
    assertChildOk(result);
    assert.equal(fs.statSync(lock).isDirectory(), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('partial creator output remains fail-closed, while a marked DB ignores a stale lock', () => {
  const partialHome = tempRoot('qe-global-partial-');
  const partialLock = path.join(partialHome, '.qe', 'qe.bootstrap.lock');
  const partialDb = path.join(partialHome, '.qe', 'qe.db');
  fs.mkdirSync(partialLock, { recursive: true, mode: 0o700 });
  fs.writeFileSync(partialDb, 'partial creator bytes');
  const before = fs.readFileSync(partialDb);
  try {
    const result = runInHome(partialHome, `
      import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
      const open=createGlobalStoreBootstrap({waitTimeoutMs:30,pollMs:5});
      try { open(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_BOOTSTRAP_BUSY'?0:3; }
    `);
    assertChildOk(result);
    assert.deepEqual(fs.readFileSync(partialDb), before);
    assert.equal(fs.statSync(partialLock).isDirectory(), true);
  } finally { fs.rmSync(partialHome, { recursive: true, force: true }); }

  const markedHome = tempRoot('qe-global-marked-stale-');
  try {
    assertChildOk(runInHome(markedHome, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
    const lock = path.join(markedHome, '.qe', 'qe.bootstrap.lock');
    fs.mkdirSync(lock, { mode: 0o700 });
    const result = runInHome(markedHome, `
      import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
      const r=openGlobalQeStore();
      const ok=!r.created && r.db.prepare('PRAGMA integrity_check').get().integrity_check==='ok';
      r.db.close(); process.exitCode=ok?0:2;
    `);
    assertChildOk(result);
    assert.equal(fs.statSync(lock).isDirectory(), true);
  } finally { fs.rmSync(markedHome, { recursive: true, force: true }); }
});

function concurrentChild(home, cwd, role, release) {
  const source = `
    import fs from 'node:fs';
    import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
    const role=${JSON.stringify(role)};
    const open=createGlobalStoreBootstrap({onTransition(point){
      if (role==='creator' && point==='lock-acquired') {
        process.stdout.write('ACK lock-acquired\\n');
        while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
      }
      if (role==='loser' && point==='waiting-for-creator') {
        process.stdout.write('ACK waiting-for-creator\\n');
      }
    }});
    const r=open();
    const out={
      created:r.created,path:r.path,
      integrity:r.db.prepare('PRAGMA integrity_check').get().integrity_check,
      version:r.db.prepare('PRAGMA user_version').get().user_version,
      applicationId:r.db.prepare('PRAGMA application_id').get().application_id,
      scope:r.db.prepare("SELECT v FROM schema_meta WHERE k='store_scope'").get().v,
      journal:r.db.prepare('PRAGMA journal_mode').get().journal_mode,
    };
    r.db.close();
    process.stdout.write(JSON.stringify(out)+'\\n');
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function crashWindowChild(home, point) {
  const source = `
    import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
    const target=${JSON.stringify(point)};
    const open=createGlobalStoreBootstrap({onTransition(current){
      if (current===target) {
        process.stdout.write('ACK '+current+'\\n');
        while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
      }
    }});
    open();
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${code}\n${stdout}\n${stderr}`)));
  });
}

function waitForLine(child, expected) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error(`line timeout: ${expected}`));
    }, 10_000);
    function onData(chunk) {
      buffered += String(chunk);
      if (!buffered.includes('\n')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      assert.equal(buffered.slice(0, buffered.indexOf('\n')), expected);
      resolve();
    }
    child.stdout.on('data', onData);
  });
}

async function killAndReap(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGKILL');
  await closed;
}

test('transition ACKs make creator/loser convergence deterministic', async () => {
  const home = tempRoot('qe-global-race-home-');
  const cwdA = tempRoot('qe-global-race-a-');
  const cwdB = tempRoot('qe-global-race-b-');
  const release = path.join(home, 'release');
  const a = concurrentChild(home, cwdA, 'creator', release);
  let b;
  try {
    await waitForLine(a, 'ACK lock-acquired');
    b = concurrentChild(home, cwdB, 'loser', release);
    await waitForLine(b, 'ACK waiting-for-creator');
    fs.writeFileSync(release, 'go');
    const results = await Promise.all([collectChild(a), collectChild(b)]);
    const parsed = results.map(({ stdout }) => JSON.parse(stdout.trim().split('\n').at(-1)));
    assert.equal(parsed.filter(item => item.created).length, 1);
    assert.equal(parsed[0].path, parsed[1].path);
    assert.deepEqual(parsed.map(item => item.integrity), ['ok', 'ok']);
    assert.deepEqual(parsed.map(item => item.version), [SCHEMA_VERSION, SCHEMA_VERSION]);
    assert.deepEqual(parsed.map(item => item.applicationId), [GLOBAL_STORE_APPLICATION_ID, GLOBAL_STORE_APPLICATION_ID]);
    assert.deepEqual(parsed.map(item => item.scope), ['global', 'global']);
    assert.deepEqual(parsed.map(item => item.journal), ['wal', 'wal']);
    assert.equal(fs.existsSync(path.join(cwdA, '.qe', 'qe.db')), false);
    assert.equal(fs.existsSync(path.join(cwdB, '.qe', 'qe.db')), false);
  } finally {
    for (const child of [a, b]) await killAndReap(child);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwdA, { recursive: true, force: true });
    fs.rmSync(cwdB, { recursive: true, force: true });
  }
});

test('real creator crashes preserve partial state and publish only checkpointed identity', async () => {
  for (const point of [
    'lock-acquired', 'before-writable-open', 'marker-committed', 'before-checkpoint', 'before-lock-cleanup',
  ]) {
    const home = tempRoot(`qe-global-crash-${point}-`);
    const child = crashWindowChild(home, point);
    try {
      await waitForLine(child, `ACK ${point}`);
      const reaped = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
      child.kill('SIGKILL');
      const exit = await reaped;
      assert.equal(exit.signal, 'SIGKILL');
      const lock = path.join(home, '.qe', 'qe.bootstrap.lock');
      assert.equal(fs.statSync(lock).isDirectory(), true);
      const result = runInHome(home, `
        import {createGlobalStoreBootstrap} from ${JSON.stringify(bootstrapUrl)};
        const open=createGlobalStoreBootstrap({waitTimeoutMs:30,pollMs:5});
        try {
          const r=open();
          const valid=!r.created && r.db.prepare('PRAGMA integrity_check').get().integrity_check==='ok';
          r.db.close(); process.exitCode=${point === 'before-lock-cleanup' ? 'valid?0:4' : '5'};
        } catch (e) {
          process.exitCode=${point === 'before-lock-cleanup' ? '3' : "e.code==='GLOBAL_STORE_BOOTSTRAP_BUSY'?0:4"};
        }
      `);
      assertChildOk(result);
      assert.equal(fs.statSync(lock).isDirectory(), true);
    } finally {
      await killAndReap(child);
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test('post-open marker failure closes the handle before removing the owned lock', () => {
  const home = tempRoot('qe-global-close-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const proto = sqlite().DatabaseSync.prototype;
  const originalClose = proto.close;
  let closes = 0;
  proto.close = function patchedClose(...args) { closes += 1; return originalClose.apply(this, args); };
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'marker-committed') throw new Error('fault');
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_MARKER_FAILED' });
    assert.equal(closes > 0, true);
    assert.equal(fs.existsSync(path.join(home, '.qe', 'qe.bootstrap.lock')), false);
  } finally {
    proto.close = originalClose;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkpoint transition failure closes the handle and returns the checkpoint code', () => {
  const home = tempRoot('qe-global-checkpoint-failure-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const proto = sqlite().DatabaseSync.prototype;
  const originalClose = proto.close;
  let closes = 0;
  proto.close = function patchedClose(...args) { closes += 1; return originalClose.apply(this, args); };
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-checkpoint') throw new Error('checkpoint fault');
    } });
    assert.throws(() => open(), { code: 'GLOBAL_STORE_CHECKPOINT_FAILED' });
    assert.equal(closes > 0, true);
    assert.equal(fs.existsSync(path.join(home, '.qe', 'qe.bootstrap.lock')), false);
  } finally {
    proto.close = originalClose;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('checkpoint busy result closes the handle and returns the checkpoint code', () => {
  const home = tempRoot('qe-global-checkpoint-busy-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const proto = sqlite().DatabaseSync.prototype;
  const originalPrepare = proto.prepare;
  process.env.HOME = home; process.env.USERPROFILE = home;
  proto.prepare = function patchedPrepare(source, ...args) {
    if (String(source).trim().toUpperCase() === 'PRAGMA WAL_CHECKPOINT(TRUNCATE)') {
      return { get() { return { busy: 1, log: 1, checkpointed: 0 }; } };
    }
    return originalPrepare.call(this, source, ...args);
  };
  try {
    assert.throws(() => openGlobalQeStore(), { code: 'GLOBAL_STORE_CHECKPOINT_FAILED' });
    assert.equal(fs.existsSync(path.join(home, '.qe', 'qe.bootstrap.lock')), false);
  } finally {
    proto.prepare = originalPrepare;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('raw-header read failure after checkpoint is normalized to the checkpoint code', () => {
  const home = tempRoot('qe-global-checkpoint-header-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const originalOpen = fs.openSync;
  let inject = false;
  process.env.HOME = home; process.env.USERPROFILE = home;
  fs.openSync = function patchedOpen(entry, ...args) {
    if (inject && entry === path.join(home, '.qe', 'qe.db')) {
      const error = new Error('header read fault');
      error.code = 'EIO';
      throw error;
    }
    return originalOpen.call(this, entry, ...args);
  };
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-checkpoint') inject = true;
    } });
    assert.throws(() => open(), error => {
      assert.equal(error.code, 'GLOBAL_STORE_CHECKPOINT_FAILED');
      assert.equal(error.cause?.code, 'GLOBAL_STORE_IDENTITY_MISMATCH');
      return true;
    });
  } finally {
    fs.openSync = originalOpen;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a non-WAL journal result closes the handle and returns the WAL code', () => {
  const home = tempRoot('qe-global-wal-failure-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const proto = sqlite().DatabaseSync.prototype;
  const originalPrepare = proto.prepare;
  process.env.HOME = home; process.env.USERPROFILE = home;
  proto.prepare = function patchedPrepare(source, ...args) {
    if (String(source).trim().toUpperCase() === 'PRAGMA JOURNAL_MODE=WAL') {
      return { get() { return { journal_mode: 'delete' }; } };
    }
    return originalPrepare.call(this, source, ...args);
  };
  try {
    assert.throws(() => openGlobalQeStore(), { code: 'GLOBAL_STORE_WAL_FAILED' });
    assert.equal(fs.existsSync(path.join(home, '.qe', 'qe.bootstrap.lock')), false);
  } finally {
    proto.prepare = originalPrepare;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('busy WAL errors are retried before bootstrap succeeds', () => {
  const home = tempRoot('qe-global-wal-busy-retry-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const proto = sqlite().DatabaseSync.prototype;
  const originalPrepare = proto.prepare;
  let attempts = 0;
  process.env.HOME = home; process.env.USERPROFILE = home;
  proto.prepare = function patchedPrepare(source, ...args) {
    if (String(source).trim().toUpperCase() === 'PRAGMA JOURNAL_MODE=WAL' && attempts++ < 2) {
      const error = new Error('database is locked');
      error.code = 'SQLITE_BUSY';
      throw error;
    }
    return originalPrepare.call(this, source, ...args);
  };
  try {
    const result = createGlobalStoreBootstrap({ pollMs: 1 })();
    assert.equal(attempts, 3);
    assert.equal(result.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    result.db.close();
  } finally {
    proto.prepare = originalPrepare;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('busy retry exhaustion maps to the active WAL, marker, or checkpoint stage', () => {
  for (const stage of ['wal', 'marker', 'checkpoint']) {
    const home = tempRoot(`qe-global-${stage}-busy-exhausted-`);
    assertChildOk(runInHome(home, `import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)}; const r=openGlobalQeStore(); r.db.close();`));
    const oldHome = process.env.HOME;
    const oldProfile = process.env.USERPROFILE;
    const proto = sqlite().DatabaseSync.prototype;
    const originalPrepare = proto.prepare;
    const originalExec = proto.exec;
    let attempts = 0;
    process.env.HOME = home; process.env.USERPROFILE = home;
    proto.prepare = function patchedPrepare(source, ...args) {
      const normalized = String(source).trim().toUpperCase();
      if ((stage === 'wal' && normalized === 'PRAGMA JOURNAL_MODE=WAL')
        || (stage === 'checkpoint' && normalized === 'PRAGMA WAL_CHECKPOINT(TRUNCATE)')) {
        attempts += 1;
        const error = new Error('database is locked'); error.code = 'SQLITE_BUSY'; throw error;
      }
      return originalPrepare.call(this, source, ...args);
    };
    proto.exec = function patchedExec(source, ...args) {
      if (stage === 'marker' && String(source).trim().toUpperCase() === 'BEGIN IMMEDIATE') {
        attempts += 1;
        const error = new Error('database table is locked'); error.code = 'SQLITE_LOCKED'; throw error;
      }
      return originalExec.call(this, source, ...args);
    };
    try {
      const expected = `GLOBAL_STORE_${stage.toUpperCase()}_FAILED`;
      assert.throws(() => createGlobalStoreBootstrap({ pollMs: 1 })(), { code: expected });
      assert.equal(attempts, 4);
    } finally {
      proto.prepare = originalPrepare;
      proto.exec = originalExec;
      if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
      if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test('a replaced creator lock is never removed during cleanup', () => {
  const home = tempRoot('qe-global-replaced-lock-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  const lockPath = path.join(home, '.qe', 'qe.bootstrap.lock');
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'before-lock-cleanup') {
        fs.rmdirSync(lockPath);
        fs.mkdirSync(lockPath, { mode: 0o700 });
      }
    } });
    const result = open();
    result.db.close();
    assert.equal(result.created, true);
    assert.equal(fs.statSync(lockPath).isDirectory(), true);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a lock replaced inside cleanup is restored and never deleted', () => {
  const home = tempRoot('qe-global-cleanup-race-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const originalReadDir = fs.readdirSync;
  process.env.HOME = home; process.env.USERPROFILE = home;
  const lockPath = path.join(home, '.qe', 'qe.bootstrap.lock');
  let replacementIdentity;
  let injected = false;
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point !== 'before-lock-cleanup') return;
      fs.readdirSync = function patchedReadDir(entry, ...args) {
        const value = originalReadDir.call(this, entry, ...args);
        if (!injected && entry === lockPath) {
          injected = true;
          fs.rmdirSync(lockPath);
          fs.mkdirSync(lockPath, { mode: 0o700 });
          replacementIdentity = fs.statSync(lockPath);
        }
        return value;
      };
    } });
    const result = open();
    result.db.close();
    const after = fs.statSync(lockPath);
    assert.equal(after.dev, replacementIdentity.dev);
    assert.equal(after.ino, replacementIdentity.ino);
  } finally {
    fs.readdirSync = originalReadDir;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a non-empty owned lock and its foreign sentinel survive cleanup', () => {
  const home = tempRoot('qe-global-nonempty-lock-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  const lockPath = path.join(home, '.qe', 'qe.bootstrap.lock');
  const sentinel = path.join(lockPath, 'foreign-sentinel');
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'lock-acquired' && process.platform !== 'win32') {
        assert.equal(fs.statSync(lockPath).mode & 0o777, 0o700);
      }
      if (point === 'before-lock-cleanup') fs.writeFileSync(sentinel, 'preserve');
    } });
    const result = open();
    result.db.close();
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
    assert.equal(fs.statSync(lockPath).isDirectory(), true);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('close failure wins, preserves the primary error as cause, and keeps the creator lock', () => {
  const home = tempRoot('qe-global-close-failure-');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const proto = sqlite().DatabaseSync.prototype;
  const originalClose = proto.close;
  process.env.HOME = home; process.env.USERPROFILE = home;
  proto.close = function patchedClose() { throw new Error('close fault'); };
  try {
    const open = createGlobalStoreBootstrap({ onTransition(point) {
      if (point === 'marker-committed') throw new Error('marker fault');
    } });
    assert.throws(() => open(), error => {
      assert.equal(error.code, 'GLOBAL_STORE_CLOSE_FAILED');
      assert.equal(error.cause?.code, 'GLOBAL_STORE_MARKER_FAILED');
      return true;
    });
    assert.equal(fs.statSync(path.join(home, '.qe', 'qe.bootstrap.lock')).isDirectory(), true);
  } finally {
    proto.close = originalClose;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('reports unavailable SQLite and open/migration failure with stable codes', () => {
  const unavailableHome = tempRoot('qe-global-no-sqlite-');
  const unavailable = runInHome(unavailableHome, `
    process.getBuiltinModule=()=>null;
    const {openGlobalQeStore}=await import(${JSON.stringify(bootstrapUrl)});
    try { openGlobalQeStore(); process.exitCode=2; }
    catch (e) { process.exitCode=e.code==='GLOBAL_STORE_SQLITE_UNAVAILABLE'?0:3; }
  `);
  assertChildOk(unavailable);
  assert.equal(fs.existsSync(path.join(unavailableHome, '.qe')), false);
  fs.rmSync(unavailableHome, { recursive: true, force: true });

  if (process.platform === 'win32') return;
  const home = tempRoot('qe-global-open-failure-');
  try {
    const qeDir = path.join(home, '.qe');
    fs.mkdirSync(qeDir, { mode: 0o700 });
    const dbPath = path.join(qeDir, 'qe.db');
    const db = new (sqlite().DatabaseSync)(dbPath);
    db.exec(`
      PRAGMA application_id=${GLOBAL_STORE_APPLICATION_ID};
      CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT);
      INSERT INTO schema_meta VALUES('store_scope','global');
      CREATE VIEW state_kv AS SELECT 'conflict' AS bad;
    `);
    db.close();
    fs.chmodSync(dbPath, 0o400);
    fs.chmodSync(qeDir, 0o500);
    const result = runInHome(home, `
      import {openGlobalQeStore} from ${JSON.stringify(bootstrapUrl)};
      try { openGlobalQeStore(); process.exitCode=2; }
      catch (e) { process.exitCode=e.code==='GLOBAL_STORE_OPEN_FAILED'?0:3; }
    `);
    assertChildOk(result);
  } finally {
    try { fs.chmodSync(path.join(home, '.qe'), 0o700); } catch { /* fixture may not exist */ }
    try { fs.chmodSync(path.join(home, '.qe', 'qe.db'), 0o600); } catch { /* fixture may not exist */ }
    fs.rmSync(home, { recursive: true, force: true });
  }
});
