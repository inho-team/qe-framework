import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  createGlobalProjectRecordStore,
  GlobalProjectRecordError,
} from '../global-project-records.mjs';
import { createProjectIdentityRegistry } from '../global-project-identity.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qe-project-records-')));
  const home = join(root, 'home'); const a = join(root, 'a'); const b = join(root, 'b');
  mkdirSync(home); mkdirSync(a); mkdirSync(b);
  const openGlobalStore = () => ({ db: openSqlite(home), path: join(home, '.qe', 'qe.db') });
  createProjectIdentityRegistry({ openGlobalStore, uuidFactory: () => A, now: () => 1 })(a);
  createProjectIdentityRegistry({ openGlobalStore, uuidFactory: () => B, now: () => 2 })(b);
  const db = openSqlite(home);
  db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
    VALUES('.qe/legacy.md','legacy','utf8',6,420,1,
      'c49fea7425fa7f8699897a97c159c6690267d9003bb78c53ff8746c5a099dcbf',1)`).run();
  closeSqlite(db);
  return { root, home, a, b, openGlobalStore };
}

function opener(f, overrides = {}) {
  return createGlobalProjectRecordStore({
    openGlobalStore: f.openGlobalStore, onTransition: () => {}, now: () => 100,
    busyAttempts: 2, pollMs: 0, ...overrides,
  });
}

function legacy(f) {
  const db = openSqlite(f.home, { readOnly: true });
  const rows = db.prepare('SELECT * FROM qe_files ORDER BY path').all(); closeSqlite(db); return rows;
}

function existingDatabaseSnapshot(f) {
  const db = openSqlite(f.home, { readOnly: true });
  const schema = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name<>'project_qe_files' AND name NOT LIKE 'sqlite_autoindex_project_qe_files%'
    ORDER BY type,name`).all();
  const rows = {};
  for (const table of schema.filter(row => row.type === 'table').map(row => row.name)) {
    const safe = table.replaceAll('"', '""');
    const values = db.prepare(`SELECT * FROM "${safe}"`).all()
      .filter(row => table !== 'schema_meta' || row.k !== 'project_records_version')
      .map(row => JSON.stringify(row)).sort();
    rows[table] = values;
  }
  closeSqlite(db); return { schema, rows };
}

function child(source, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, 5000);
    proc.stdout.on('data', chunk => { stdout += chunk; }); proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.on('error', reject); proc.on('close', (status, signal) => {
      clearTimeout(timer); resolve({ status, signal, stdout, stderr, timedOut });
    });
  });
}

test('creates only the namespaced schema marker and preserves legacy qe_files', () => {
  const f = fixture();
  try {
    const before = legacy(f); const fullBefore = existingDatabaseSnapshot(f); const store = opener(f)();
    assert.deepEqual(legacy(f), before);
    assert.deepEqual(existingDatabaseSnapshot(f), fullBefore);
    const db = openSqlite(f.home, { readOnly: true });
    assert.equal(db.prepare("SELECT v FROM schema_meta WHERE k='project_records_version'").get().v, '1');
    assert.equal(db.prepare("SELECT wr FROM pragma_table_list WHERE name='project_qe_files'").get().wr, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    closeSqlite(db); assert.equal(store.close(), true); assert.equal(store.close(), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('isolates identical logical paths by project UUID for put/get/list', () => {
  const f = fixture();
  try {
    const store = opener(f)();
    const ra = store.put(A, '.qe/TASK_LOG.md', 'alpha');
    const rb = store.put(B, '.qe/TASK_LOG.md', 'beta');
    assert.deepEqual([ra.created, rb.created, ra.revision, rb.revision], [true, true, 1, 1]);
    assert.equal(store.get(A, '.qe/TASK_LOG.md').bytes.toString(), 'alpha');
    assert.equal(store.get(B, '.qe/TASK_LOG.md').bytes.toString(), 'beta');
    assert.deepEqual(store.list(A).map(row => [row.projectId, row.path]), [[A, '.qe/TASK_LOG.md']]);
    assert.deepEqual(store.list(B).map(row => [row.projectId, row.path]), [[B, '.qe/TASK_LOG.md']]);
    const listed = store.list(A);
    assert.ok(Object.isFrozen(listed));
    assert.ok(Object.isFrozen(listed[0]));
    store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('enforces insert replay update revision CAS including metadata-only updates', () => {
  const f = fixture();
  try {
    const store = opener(f)();
    const created = store.put(A, '.qe/a.md', 'one');
    assert.deepEqual({ created: created.created, updated: created.updated, replayed: created.replayed },
      { created: true, updated: false, replayed: false });
    const replay = store.put(A, '.qe/a.md', 'one');
    assert.deepEqual({ revision: replay.revision, created: replay.created, updated: replay.updated, replayed: replay.replayed },
      { revision: 1, created: false, updated: false, replayed: true });
    assert.throws(() => store.put(A, '.qe/a.md', 'two'), e => e.code === 'GLOBAL_PROJECT_RECORD_CONFLICT');
    const updated = store.put(A, '.qe/a.md', 'two', { expectedRevision: 1, mode: 0o600 });
    assert.deepEqual({ revision: updated.revision, updated: updated.updated }, { revision: 2, updated: true });
    assert.throws(() => store.put(A, '.qe/a.md', 'three', { expectedRevision: 1 }),
      e => e.code === 'GLOBAL_PROJECT_RECORD_CONFLICT');
    const metadata = store.put(A, '.qe/a.md', 'two', { expectedRevision: 2, mode: 0o640 });
    assert.equal(metadata.revision, 3); assert.equal(store.get(A, '.qe/a.md').mode, 0o640);
    store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('round-trips UTF-8 and binary content using defensive Buffer copies', () => {
  const f = fixture();
  try {
    const store = opener(f)(); const input = new Uint8Array([0, 255, 1]);
    store.put(A, '.qe/bin.dat', input); input[1] = 0;
    store.put(A, '.qe/한글.md', '문서');
    const first = store.get(A, '.qe/bin.dat'); assert.deepEqual([...first.bytes], [0, 255, 1]);
    first.bytes[0] = 9; assert.deepEqual([...store.get(A, '.qe/bin.dat').bytes], [0, 255, 1]);
    assert.equal(store.get(A, '.qe/한글.md').encoding, 'utf8'); store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('accepts exact content limits and rejects invalid UTF-8 strings', () => {
  const f = fixture();
  try {
    const store = opener(f)();
    assert.equal(store.put(A, '.qe/empty', Buffer.alloc(0)).created, true);
    assert.equal(store.put(A, '.qe/max', Buffer.alloc(1024 * 1024)).created, true);
    assert.throws(() => store.put(A, '.qe/surrogate', '\ud800'), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects unsafe logical paths, prefixes, content and unregistered projects', () => {
  const f = fixture();
  try {
    const store = opener(f)();
    for (const p of ['../x', '.qe/../x', '/.qe/x', '.qe//x', '.qe/x\\y', '.qe/qe.db',
      '.qe/qe.db-wal', '.qe/project.json', '.qe/x/']) {
      assert.throws(() => store.put(A, p, 'x'), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT', p);
    }
    store.put(A, '.qe/%/literal.md', 'literal');
    assert.deepEqual(store.list(A, { prefix: '.qe/%/' }).map(row => row.path), ['.qe/%/literal.md']);
    assert.throws(() => store.put(UNKNOWN, '.qe/x.md', 'x'), e => e.code === 'GLOBAL_PROJECT_RECORD_PROJECT_UNKNOWN');
    assert.throws(() => store.get(UNKNOWN, '.qe/x.md'), e => e.code === 'GLOBAL_PROJECT_RECORD_PROJECT_UNKNOWN');
    assert.throws(() => store.list(UNKNOWN), e => e.code === 'GLOBAL_PROJECT_RECORD_PROJECT_UNKNOWN');
    assert.throws(() => store.put(A, '.qe/large', Buffer.alloc(1024 * 1024 + 1)),
      e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects changed updates at MAX_SAFE_INTEGER revision without mutation', () => {
  const f = fixture();
  try {
    const store = opener(f)(); store.put(A, '.qe/a.md', 'v1');
    const db = openSqlite(f.home); db.prepare('UPDATE project_qe_files SET revision=? WHERE project_id=? AND path=?')
      .run(Number.MAX_SAFE_INTEGER, A, '.qe/a.md'); closeSqlite(db);
    assert.throws(() => store.put(A, '.qe/a.md', 'v2', { expectedRevision: Number.MAX_SAFE_INTEGER }),
      e => e.code === 'GLOBAL_PROJECT_RECORD_CONFLICT');
    assert.equal(store.get(A, '.qe/a.md').bytes.toString(), 'v1'); store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('detects stale revisions across two open stores without cross-project conflicts', () => {
  const f = fixture();
  try {
    const one = opener(f)(); const two = opener(f)();
    one.put(A, '.qe/a.md', 'v1');
    assert.equal(one.put(A, '.qe/a.md', 'v2', { expectedRevision: 1 }).revision, 2);
    assert.throws(() => two.put(A, '.qe/a.md', 'v3', { expectedRevision: 1 }),
      e => e.code === 'GLOBAL_PROJECT_RECORD_CONFLICT');
    assert.equal(two.put(B, '.qe/a.md', 'other').created, true);
    assert.equal(one.get(A, '.qe/a.md').bytes.toString(), 'v2');
    one.close(); two.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('concurrent same-key writers yield one update and one revision conflict', async () => {
  const f = fixture();
  try {
    const seed = opener(f)(); seed.put(A, '.qe/race.md', 'v1'); seed.close();
    const recordsUrl = new URL('../global-project-records.mjs', import.meta.url).href;
    const sqliteUrl = new URL('../store-sqlite.mjs', import.meta.url).href;
    const source = `
      const fs=await import('node:fs'); const records=await import(${JSON.stringify(recordsUrl)}); const sqlite=await import(${JSON.stringify(sqliteUrl)});
      const open=records.createGlobalProjectRecordStore({openGlobalStore(){return {db:sqlite.openSqlite(process.env.HOME_DIR)}},busyAttempts:8,pollMs:10});
      const store=open(); const observed=store.get(process.env.PROJECT_ID,'.qe/race.md').revision;
      fs.writeFileSync(process.env.READY,String(observed)); while(!fs.existsSync(process.env.BARRIER)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);
      let out; try { out={code:'OK',value:store.put(process.env.PROJECT_ID,'.qe/race.md',process.env.VALUE,{expectedRevision:observed})}; }
      catch(error){out={code:error.code};} try{store.close();}catch{} process.stdout.write(JSON.stringify(out));
    `;
    const barrier = join(f.root, 'barrier'); const readyA = join(f.root, 'ready-a'); const readyB = join(f.root, 'ready-b');
    const env = { HOME_DIR: f.home, PROJECT_ID: A, BARRIER: barrier };
    const pending = [child(source, { ...env, READY: readyA, VALUE: 'left' }),
      child(source, { ...env, READY: readyB, VALUE: 'right' })];
    for (let attempt = 0; attempt < 100 && (!fs.existsSync(readyA) || !fs.existsSync(readyB)); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(fs.readFileSync(readyA, 'utf8'), '1'); assert.equal(fs.readFileSync(readyB, 'utf8'), '1');
    fs.writeFileSync(barrier, 'go'); const runs = await Promise.all(pending);
    assert.ok(runs.every(run => !run.timedOut && run.status === 0), runs.map(run => run.stderr).join('\n'));
    assert.deepEqual(runs.map(run => JSON.parse(run.stdout).code).sort(), ['GLOBAL_PROJECT_RECORD_CONFLICT', 'OK']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('concurrent distinct-project same-path writers both succeed within retry budget', async () => {
  const f = fixture();
  try {
    const seed = opener(f)(); seed.close();
    const recordsUrl = new URL('../global-project-records.mjs', import.meta.url).href;
    const sqliteUrl = new URL('../store-sqlite.mjs', import.meta.url).href;
    const source = `
      const records=await import(${JSON.stringify(recordsUrl)}); const sqlite=await import(${JSON.stringify(sqliteUrl)});
      const open=records.createGlobalProjectRecordStore({openGlobalStore(){return {db:sqlite.openSqlite(process.env.HOME_DIR)}},busyAttempts:8,pollMs:10});
      const store=open(); let out; try { out={code:'OK',value:store.put(process.env.PROJECT_ID,'.qe/shared.md',process.env.VALUE)}; }
      catch(error){out={code:error.code};} try{store.close();}catch{} process.stdout.write(JSON.stringify(out));
    `;
    const runs = await Promise.all([child(source, { HOME_DIR: f.home, PROJECT_ID: A, VALUE: 'a' }),
      child(source, { HOME_DIR: f.home, PROJECT_ID: B, VALUE: 'b' })]);
    assert.ok(runs.every(run => !run.timedOut && run.status === 0), runs.map(run => run.stderr).join('\n'));
    assert.deepEqual(runs.map(run => JSON.parse(run.stdout).code), ['OK', 'OK']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects partial/future schema and poisoned rows without changing legacy data', () => {
  for (const kind of ['partial', 'future', 'row']) {
    const f = fixture();
    try {
      const before = legacy(f);
      if (kind === 'partial') {
        const db = openSqlite(f.home); db.exec('CREATE TABLE project_qe_files(project_id TEXT,path TEXT)'); closeSqlite(db);
      } else {
        const store = opener(f)(); store.put(A, '.qe/a.md', 'ok'); store.close();
        const db = openSqlite(f.home);
        if (kind === 'future') db.prepare("UPDATE schema_meta SET v='2' WHERE k='project_records_version'").run();
        else db.prepare("UPDATE project_qe_files SET sha256='bad'").run();
        closeSqlite(db);
      }
      assert.throws(() => opener(f)(), e => e.code === 'GLOBAL_PROJECT_RECORD_SCHEMA', kind);
      assert.deepEqual(legacy(f), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('rejects a same-name view and poisoned relative registry paths as schema errors', () => {
  for (const kind of ['view', 'relative']) {
    const f = fixture();
    try {
      if (kind === 'view') {
        const db = openSqlite(f.home); db.exec('CREATE VIEW project_qe_files AS SELECT 1 value'); closeSqlite(db);
        assert.throws(() => opener(f)(), e => e.code === 'GLOBAL_PROJECT_RECORD_SCHEMA');
      } else {
        const seed = opener(f)(); seed.close(); const db = openSqlite(f.home);
        db.exec('PRAGMA foreign_keys=OFF');
        db.prepare('UPDATE projects SET current_path=? WHERE project_id=?').run('relative', A);
        db.prepare('UPDATE project_paths SET path=? WHERE project_id=?').run('relative', A);
        closeSqlite(db);
        assert.throws(() => opener(f)(), e => e.code === 'GLOBAL_PROJECT_RECORD_SCHEMA');
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('locks exact arity and rejects undeclared option keys', () => {
  const f = fixture();
  try {
    assert.throws(() => createGlobalProjectRecordStore({}, {}), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    const store = opener(f)();
    assert.throws(() => store.put(A, '.qe/a.md'), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    assert.throws(() => store.put(A, '.qe/a.md', 'x', { unknown: true }), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    assert.throws(() => store.get(A), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    assert.throws(() => store.list(A, { unknown: true }), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    assert.throws(() => store.close('x'), e => e.code === 'GLOBAL_PROJECT_RECORD_ARGUMENT');
    store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rolls back every observer cut and keeps legacy rows unchanged', () => {
  for (const point of ['after-table', 'after-marker', 'before-put', 'after-row', 'before-commit']) {
    const f = fixture();
    try {
      const before = legacy(f); const open = opener(f, { onTransition(name) { if (name === point) throw new Error(point); } });
      if (point === 'after-table' || point === 'after-marker') {
        assert.throws(() => open(), e => e.code === 'GLOBAL_PROJECT_RECORD_WRITE', point);
      } else {
        const store = open(); assert.throws(() => store.put(A, '.qe/a.md', 'x'),
          e => e.code === 'GLOBAL_PROJECT_RECORD_WRITE', point); store.close();
      }
      assert.deepEqual(legacy(f), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('returns bounded BUSY and succeeds on explicit retry after lock release', () => {
  const f = fixture();
  try {
    const seed = opener(f)(); seed.close();
    const db = openSqlite(f.home); let locked = true;
    const open = opener(f, { busyAttempts: 2, pollMs: 1, openGlobalStore() { return { db: {
      prepare: db.prepare.bind(db), close: db.close.bind(db),
      exec(sql) { if (locked && sql === 'BEGIN IMMEDIATE') throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); return db.exec(sql); },
    } }; } });
    assert.throws(() => open(), e => e.code === 'GLOBAL_PROJECT_RECORD_BUSY');
    locked = false; const retry = opener(f)(); assert.equal(retry.put(A, '.qe/retry.md', 'ok').created, true); retry.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('retries raw busy errors from the injected global opener and normalizes exhaustion', () => {
  const f = fixture(); let calls = 0;
  try {
    const open = opener(f, { busyAttempts: 3, pollMs: 1, openGlobalStore() {
      calls += 1; throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    } });
    assert.throws(() => open(), e => e.code === 'GLOBAL_PROJECT_RECORD_BUSY');
    assert.equal(calls, 3);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('real held SQLite writer lock yields BUSY then succeeds after release', () => {
  const f = fixture();
  try {
    const store = opener(f, { busyAttempts: 2, pollMs: 1 })();
    const locker = openSqlite(f.home); locker.exec('BEGIN IMMEDIATE');
    assert.throws(() => store.put(A, '.qe/locked.md', 'x'), e => e.code === 'GLOBAL_PROJECT_RECORD_BUSY');
    locker.exec('ROLLBACK'); closeSqlite(locker);
    assert.equal(store.put(A, '.qe/locked.md', 'x').created, true); store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rollback plus close failure preserves the complete priorError chain and terminal state', () => {
  const f = fixture();
  try {
    const seed = opener(f)(); seed.close();
    const db = openSqlite(f.home); let closeCalls = 0;
    const open = opener(f, { onTransition(name) { if (name === 'after-row') throw new Error('write cut'); },
      openGlobalStore() { return { db: {
        prepare: db.prepare.bind(db),
        exec(sql) { if (sql === 'ROLLBACK') { db.exec(sql); throw new Error('rollback cut'); } return db.exec(sql); },
        close() { closeCalls += 1; db.close(); throw new Error('close cut'); },
      } }; } });
    const store = open();
    assert.throws(() => store.put(A, '.qe/fail.md', 'x'), e =>
      e.code === 'GLOBAL_PROJECT_RECORD_CLOSE_FAILED' && e.cause?.message === 'close cut'
      && e.priorError?.code === 'GLOBAL_PROJECT_RECORD_WRITE'
      && e.priorError?.cause?.message === 'rollback cut'
      && e.priorError?.priorError?.message === 'write cut');
    assert.equal(closeCalls, 1); assert.equal(store.close(), false);
    assert.throws(() => store.list(A), e => e.code === 'GLOBAL_PROJECT_RECORD_CLOSED');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('COMMIT failure-before-apply rolls back the candidate row', () => {
  const f = fixture();
  try {
    const seed = opener(f)(); seed.close(); const db = openSqlite(f.home); let commits = 0;
    const open = opener(f, { openGlobalStore() { return { db: {
      prepare: db.prepare.bind(db), close: db.close.bind(db),
      exec(sql) { if (sql === 'COMMIT' && commits++ >= 1) throw new Error('commit cut'); return db.exec(sql); },
    } }; } });
    const store = open(); assert.throws(() => store.put(A, '.qe/commit.md', 'x'),
      e => e.code === 'GLOBAL_PROJECT_RECORD_WRITE');
    assert.equal(store.get(A, '.qe/commit.md'), null); store.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('default production opener uses the isolated HOME global store and G002 registry', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qe-project-records-default-')));
  const home = join(root, 'home'); const project = join(root, 'project'); mkdirSync(home); mkdirSync(project);
  try {
    const recordsUrl = new URL('../global-project-records.mjs', import.meta.url).href;
    const identityUrl = new URL('../global-project-identity.mjs', import.meta.url).href;
    const source = `
      const identity=await import(${JSON.stringify(identityUrl)}); const records=await import(${JSON.stringify(recordsUrl)});
      const registered=identity.registerProjectIdentity(process.env.PROJECT_ROOT); const store=records.openGlobalProjectRecordStore();
      const put=store.put(registered.projectId,'.qe/TASK_LOG.md','default'); const got=store.get(registered.projectId,'.qe/TASK_LOG.md');
      store.close(); process.stdout.write(JSON.stringify({put,text:got.bytes.toString()}));
    `;
    const run = await child(source, { HOME: home, USERPROFILE: home, PROJECT_ROOT: project });
    assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).text, 'default');
    assert.equal(fs.existsSync(join(project, '.qe', 'qe.db')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit close failure is terminal and preserves stable close semantics', () => {
  const f = fixture(); let calls = 0;
  try {
    const open = opener(f, { openGlobalStore() { const db = openSqlite(f.home); return { db: {
      exec: db.exec.bind(db), prepare: db.prepare.bind(db),
      close() { calls += 1; db.close(); throw new Error('close cut'); },
    } }; } });
    const store = open();
    assert.throws(() => store.close(), e => e instanceof GlobalProjectRecordError
      && e.code === 'GLOBAL_PROJECT_RECORD_CLOSE_FAILED');
    assert.equal(store.close(), false); assert.equal(calls, 1);
    assert.throws(() => store.get(A, '.qe/a.md'), e => e.code === 'GLOBAL_PROJECT_RECORD_CLOSED');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
