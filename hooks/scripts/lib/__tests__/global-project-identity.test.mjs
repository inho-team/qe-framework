import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  createProjectIdentityRegistry,
  GlobalProjectIdentityError,
  readProjectIdentity,
} from '../global-project-identity.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qe-project-identity-')));
  const home = join(root, 'home');
  const project = join(root, 'project-a');
  mkdirSync(home); mkdirSync(project);
  const openGlobalStore = () => {
    const db = openSqlite(home);
    if (!db) throw new Error('fixture sqlite unavailable');
    return { db, path: join(home, '.qe', 'qe.db'), created: false };
  };
  return { root, home, project, openGlobalStore };
}

function registry(f, overrides = {}) {
  return createProjectIdentityRegistry({
    openGlobalStore: f.openGlobalStore,
    uuidFactory: () => UUID_A,
    now: () => 1000,
    onTransition: () => {},
    busyAttempts: 2,
    pollMs: 0,
    ...overrides,
  });
}

function marker(project, uuid = UUID_A) {
  mkdirSync(join(project, '.qe'), { recursive: true, mode: 0o700 });
  writeFileSync(join(project, '.qe', 'project.json'),
    `${JSON.stringify({ schema: 1, projectId: uuid })}\n`, { mode: 0o600 });
}

function snapshot(f) {
  const db = openSqlite(f.home, { readOnly: true });
  const projects = db.prepare('SELECT * FROM projects ORDER BY project_id').all();
  const paths = db.prepare('SELECT * FROM project_paths ORDER BY project_id,path').all();
  closeSqlite(db);
  return { projects, paths };
}

function child(source, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, 5000);
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (status, signal) => {
      clearTimeout(timer); resolve({ status, signal, stdout, stderr, timedOut });
    });
  });
}

test('publishes one exact marker and reopens idempotently without a local qe.db', () => {
  const f = fixture();
  try {
    const register = registry(f);
    const first = register(f.project);
    assert.deepEqual(first, { projectId: UUID_A, currentPath: f.project,
      previousPaths: [], created: true, moved: false });
    assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.previousPaths));
    assert.equal(readFileSync(join(f.project, '.qe', 'project.json'), 'utf8'),
      `${JSON.stringify({ schema: 1, projectId: UUID_A })}\n`);
    assert.equal(fs.existsSync(join(f.project, '.qe', 'qe.db')), false);
    const second = register(f.project);
    assert.deepEqual(second, { ...first, created: false });
    assert.deepEqual(readProjectIdentity(f.project), { schema: 1, projectId: UUID_A });
    assert.deepEqual(snapshot(f).paths.map(row => row.path), [f.project]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('preserves UUID and append-only deduplicated path history across A to B to A moves', () => {
  const f = fixture();
  try {
    const register = registry(f, { now: (() => { let n = 1000; return () => n++; })() });
    register(f.project);
    const moved = join(f.root, 'project-b'); renameSync(f.project, moved);
    assert.deepEqual(register(moved), { projectId: UUID_A, currentPath: moved,
      previousPaths: [f.project], created: false, moved: true });
    renameSync(moved, f.project);
    assert.deepEqual(register(f.project), { projectId: UUID_A, currentPath: f.project,
      previousPaths: [moved], created: false, moved: true });
    assert.deepEqual(snapshot(f).paths.map(row => row.path), [f.project, moved].sort());
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects a simultaneously live copy with the same UUID without registry mutation', () => {
  const f = fixture();
  try {
    const register = registry(f); register(f.project);
    const copy = join(f.root, 'copy'); mkdirSync(copy); marker(copy);
    const before = snapshot(f); const bytes = readFileSync(join(copy, '.qe', 'project.json'));
    assert.throws(() => register(copy), error =>
      error instanceof GlobalProjectIdentityError
      && error.code === 'GLOBAL_PROJECT_DUPLICATE_IDENTITY');
    assert.deepEqual(snapshot(f), before);
    assert.deepEqual(readFileSync(join(copy, '.qe', 'project.json')), bytes);
    rmSync(f.project, { recursive: true });
    assert.equal(register(copy).moved, true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('keeps a published marker after DB failure and adopts it on retry', () => {
  const f = fixture(); let fail = true;
  try {
    const register = registry(f, { openGlobalStore() {
      if (fail) { fail = false; throw new Error('cut after marker'); }
      return f.openGlobalStore();
    } });
    assert.throws(() => register(f.project), error =>
      error.code === 'GLOBAL_PROJECT_REGISTRY_WRITE');
    assert.equal(readProjectIdentity(f.project).projectId, UUID_A);
    const retried = register(f.project);
    assert.deepEqual({ created: retried.created, moved: retried.moved },
      { created: false, moved: false });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('repairs one exact same-inode orphan temp left after hard-link publication', () => {
  const f = fixture();
  try {
    marker(f.project);
    const final = join(f.project, '.qe', 'project.json');
    const companion = join(f.project, '.qe', `project.json.tmp-123-${UUID_B}`);
    fs.linkSync(final, companion);
    assert.equal(fs.lstatSync(final).nlink, 2);
    assert.equal(readProjectIdentity(f.project).projectId, UUID_A);
    assert.equal(fs.existsSync(companion), false);
    assert.equal(fs.lstatSync(final).nlink, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('recovers after a real publisher SIGKILL between link and temp unlink', async () => {
  const f = fixture();
  try {
    const moduleUrl = new URL('../global-project-identity.mjs', import.meta.url).href;
    const source = `
      const api = await import(${JSON.stringify(moduleUrl)});
      const register = api.createProjectIdentityRegistry({
        uuidFactory: () => ${JSON.stringify(UUID_A)}, now: () => 1000,
        openGlobalStore() { throw new Error('must not open'); },
        onTransition(name) { if (name === 'marker-published') process.kill(process.pid, 'SIGKILL'); }
      });
      register(process.env.PROJECT_ROOT);
    `;
    const run = await child(source, { PROJECT_ROOT: f.project });
    assert.equal(run.timedOut, false); assert.equal(run.signal, 'SIGKILL');
    assert.equal(readProjectIdentity(f.project).projectId, UUID_A);
    assert.deepEqual(fs.readdirSync(join(f.project, '.qe')), ['project.json']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('does not delete ambiguous hard-link companions', () => {
  const f = fixture();
  try {
    marker(f.project); const qe = join(f.project, '.qe'); const final = join(qe, 'project.json');
    const names = [`project.json.tmp-10-${UUID_A}`, `project.json.tmp-11-${UUID_B}`];
    for (const name of names) fs.linkSync(final, join(qe, name));
    assert.throws(() => readProjectIdentity(f.project), error => error.code === 'GLOBAL_PROJECT_UNSAFE_PATH');
    assert.ok(names.every(name => fs.existsSync(join(qe, name))));
    assert.equal(fs.lstatSync(final).nlink, 3);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('fails closed on malformed, oversized, linked, and unsafe marker inputs', () => {
  for (const [name, setup, code] of [
    ['malformed', p => { marker(p); writeFileSync(join(p, '.qe', 'project.json'), '{}\n'); }, 'GLOBAL_PROJECT_IDENTITY_CORRUPT'],
    ['oversized', p => { marker(p); writeFileSync(join(p, '.qe', 'project.json'), 'x'.repeat(129)); }, 'GLOBAL_PROJECT_IDENTITY_CORRUPT'],
    ['symlink', p => { mkdirSync(join(p, '.qe')); fs.symlinkSync('/dev/null', join(p, '.qe', 'project.json')); }, 'GLOBAL_PROJECT_UNSAFE_PATH'],
  ]) {
    const f = fixture();
    try { setup(f.project); assert.throws(() => readProjectIdentity(f.project), e => e.code === code, name); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('rejects group or other writable .qe and marker metadata on POSIX', () => {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
  for (const target of ['qe', 'marker']) {
    const f = fixture();
    try {
      marker(f.project);
      fs.chmodSync(target === 'qe' ? join(f.project, '.qe') : join(f.project, '.qe', 'project.json'), 0o777);
      assert.throws(() => readProjectIdentity(f.project), error => error.code === 'GLOBAL_PROJECT_UNSAFE_PATH');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('rejects partial or poisoned registry schema before writing project rows', () => {
  const f = fixture();
  try {
    marker(f.project);
    const db = openSqlite(f.home);
    db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY)');
    closeSqlite(db);
    assert.throws(() => registry(f)(f.project), error =>
      error.code === 'GLOBAL_PROJECT_REGISTRY_SCHEMA');
    const check = openSqlite(f.home, { readOnly: true });
    assert.equal(check.prepare('SELECT COUNT(*) count FROM projects').get().count, 0);
    closeSqlite(check);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects malformed existing rows and future registry markers', () => {
  for (const poison of ['row', 'future']) {
    const f = fixture();
    try {
      registry(f)(f.project);
      const db = openSqlite(f.home);
      if (poison === 'row') {
        db.exec('PRAGMA foreign_keys=OFF');
        db.prepare('UPDATE project_paths SET project_id=?').run('not-a-uuid');
        db.prepare('UPDATE projects SET project_id=?').run('not-a-uuid');
      } else {
        db.prepare("UPDATE schema_meta SET v='2' WHERE k='project_registry_version'").run();
      }
      closeSqlite(db);
      assert.throws(() => registry(f)(f.project), error =>
        error.code === 'GLOBAL_PROJECT_REGISTRY_SCHEMA', poison);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('rejects current-path ownership collision without rewriting an external marker', () => {
  const f = fixture();
  try {
    registry(f)(f.project);
    const markerPath = join(f.project, '.qe', 'project.json');
    writeFileSync(markerPath, `${JSON.stringify({ schema: 1, projectId: UUID_B })}\n`);
    const bytes = readFileSync(markerPath); const before = snapshot(f);
    assert.throws(() => registry(f, { uuidFactory: () => UUID_B })(f.project), error =>
      error.code === 'GLOBAL_PROJECT_PATH_COLLISION');
    assert.deepEqual(snapshot(f), before); assert.deepEqual(readFileSync(markerPath), bytes);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('fails closed when an existing old root has a corrupt marker', () => {
  const f = fixture();
  try {
    const register = registry(f); register(f.project);
    const moved = join(f.root, 'moved'); mkdirSync(moved); marker(moved);
    writeFileSync(join(f.project, '.qe', 'project.json'), '{}\n');
    const before = snapshot(f);
    assert.throws(() => register(moved), error => error.code === 'GLOBAL_PROJECT_IDENTITY_CORRUPT');
    assert.deepEqual(snapshot(f), before);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('passes through G001 errors and gives close failure precedence with retry convergence', () => {
  const f = fixture();
  try {
    const upstream = Object.assign(new Error('unsafe global store'), { code: 'GLOBAL_STORE_UNSAFE_PATH' });
    assert.throws(() => registry(f, { openGlobalStore() { throw upstream; } })(f.project),
      error => error === upstream);
    const closeRegister = registry(f, { openGlobalStore() {
      const db = openSqlite(f.home);
      return { db: {
        exec: db.exec.bind(db), prepare: db.prepare.bind(db),
        close() { db.close(); throw new Error('close cut'); },
      } };
    } });
    assert.throws(() => closeRegister(f.project), error =>
      error.code === 'GLOBAL_PROJECT_CLOSE_FAILED' && error.cause?.message === 'close cut'
      && error.priorError === null);
    assert.equal(registry(f)(f.project).projectId, UUID_A);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('bounds busy retries and preserves close failure priorError', () => {
  const f = fixture();
  try {
    const busyDb = openSqlite(f.home);
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    const busyRegister = registry(f, { busyAttempts: 2, pollMs: 1, openGlobalStore() {
      return { db: { prepare: busyDb.prepare.bind(busyDb), close: busyDb.close.bind(busyDb),
        exec(sql) { if (sql === 'BEGIN IMMEDIATE') throw busy; return busyDb.exec(sql); } } };
    } });
    const started = Date.now();
    assert.throws(() => busyRegister(f.project), error => error.code === 'GLOBAL_PROJECT_REGISTRY_BUSY');
    assert.ok(Date.now() - started < 1000);

    const closeDb = openSqlite(f.home);
    const closeRegister = registry(f, { openGlobalStore() { return { db: {
      prepare: closeDb.prepare.bind(closeDb),
      exec(sql) { if (sql === 'BEGIN IMMEDIATE') throw new Error('statement cut'); return closeDb.exec(sql); },
      close() { closeDb.close(); throw new Error('close cut'); },
    } }; } });
    assert.throws(() => closeRegister(f.project), error =>
      error.code === 'GLOBAL_PROJECT_CLOSE_FAILED'
      && error.priorError?.code === 'GLOBAL_PROJECT_REGISTRY_WRITE');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rolls back a COMMIT failure without publishing registry rows', () => {
  const f = fixture();
  try {
    const db = openSqlite(f.home); let failed = false;
    const register = registry(f, { openGlobalStore() { return { db: {
      prepare: db.prepare.bind(db), close: db.close.bind(db),
      exec(sql) { if (sql === 'COMMIT' && !failed) { failed = true; throw new Error('commit cut'); }
        return db.exec(sql); },
    } }; } });
    assert.throws(() => register(f.project), error => error.code === 'GLOBAL_PROJECT_REGISTRY_WRITE');
    const check = openSqlite(f.home, { readOnly: true });
    assert.equal(check.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE name IN ('projects','project_paths')").get().count, 0);
    closeSqlite(check);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('preserves the triggering error when ROLLBACK itself reports failure', () => {
  const f = fixture();
  try {
    const db = openSqlite(f.home);
    const register = registry(f, {
      onTransition(name) { if (name === 'after-project-row') throw new Error('write cut'); },
      openGlobalStore() { return { db: {
        prepare: db.prepare.bind(db), close: db.close.bind(db),
        exec(sql) {
          if (sql === 'ROLLBACK') { db.exec(sql); throw new Error('rollback cut'); }
          return db.exec(sql);
        },
      } }; },
    });
    assert.throws(() => register(f.project), error =>
      error.code === 'GLOBAL_PROJECT_REGISTRY_WRITE'
      && error.cause?.message === 'rollback cut' && error.priorError?.message === 'write cut');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('default production API uses isolated HOME global DB and never creates project-local qe.db', () => {
  const f = fixture();
  try {
    const moduleUrl = new URL('../global-project-identity.mjs', import.meta.url).href;
    const source = `
      const api = await import(${JSON.stringify(moduleUrl)});
      process.stdout.write(JSON.stringify(api.registerProjectIdentity(process.env.PROJECT_ROOT)));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, HOME: f.home, USERPROFILE: f.home, PROJECT_ROOT: f.project },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).currentPath, f.project);
    assert.equal(fs.existsSync(join(f.home, '.qe', 'qe.db')), true);
    assert.equal(fs.existsSync(join(f.project, '.qe', 'qe.db')), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('four default subprocesses converge on one marker and one global registry row', async () => {
  const f = fixture();
  try {
    const moduleUrl = new URL('../global-project-identity.mjs', import.meta.url).href;
    const source = `
      const api = await import(${JSON.stringify(moduleUrl)});
      process.stdout.write(JSON.stringify(api.registerProjectIdentity(process.env.PROJECT_ROOT)));
    `;
    const env = { HOME: f.home, USERPROFILE: f.home, PROJECT_ROOT: f.project };
    const runs = await Promise.all(Array.from({ length: 4 }, () => child(source, env)));
    assert.ok(runs.every(run => !run.timedOut));
    assert.deepEqual(runs.map(run => run.status), [0, 0, 0, 0], runs.map(run => run.stderr).join('\n'));
    const values = runs.map(run => JSON.parse(run.stdout));
    assert.equal(new Set(values.map(value => value.projectId)).size, 1);
    const db = openSqlite(f.home, { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM projects').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM project_paths').get().count, 1);
    closeSqlite(db);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('two live roots with one UUID converge to one success and one duplicate rejection', async () => {
  const f = fixture();
  try {
    const other = join(f.root, 'project-b'); mkdirSync(other); marker(f.project); marker(other);
    const moduleUrl = new URL('../global-project-identity.mjs', import.meta.url).href;
    const source = `
      const api = await import(${JSON.stringify(moduleUrl)});
      process.stdout.write(JSON.stringify(api.registerProjectIdentity(process.env.PROJECT_ROOT)));
    `;
    const env = { HOME: f.home, USERPROFILE: f.home };
    const runs = await Promise.all([child(source, { ...env, PROJECT_ROOT: f.project }),
      child(source, { ...env, PROJECT_ROOT: other })]);
    assert.ok(runs.every(run => !run.timedOut));
    assert.deepEqual(runs.map(run => run.status).sort(), [0, 1]);
    const db = openSqlite(f.home, { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM projects').get().count, 1);
    closeSqlite(db);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('rolls back every injected registry cut and preserves the marker', () => {
  for (const point of ['after-projects-ddl', 'after-paths-ddl', 'after-registry-marker',
    'after-project-row', 'after-path-row', 'before-registry-commit']) {
    const f = fixture();
    try {
      const register = registry(f, { onTransition(name) { if (name === point) throw new Error(point); } });
      assert.throws(() => register(f.project), error => error.code === 'GLOBAL_PROJECT_REGISTRY_WRITE', point);
      assert.equal(readProjectIdentity(f.project).projectId, UUID_A);
      const db = openSqlite(f.home, { readOnly: true });
      assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE name IN ('projects','project_paths')").get().count, 0);
      closeSqlite(db);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('validates arguments and factory outputs before project mutation', () => {
  const f = fixture();
  try {
    assert.throws(() => readProjectIdentity(), error => error.code === 'GLOBAL_PROJECT_ARGUMENT');
    assert.throws(() => readProjectIdentity('relative'), error => error.code === 'GLOBAL_PROJECT_ARGUMENT');
    assert.throws(() => readProjectIdentity(f.project), error => error.code === 'GLOBAL_PROJECT_IDENTITY_MISSING');
    assert.throws(() => createProjectIdentityRegistry({ unknown: true }),
      error => error.code === 'GLOBAL_PROJECT_ARGUMENT');
    assert.throws(() => registry(f, { uuidFactory: () => 'bad' })(f.project),
      error => error.code === 'GLOBAL_PROJECT_ARGUMENT');
    assert.equal(fs.existsSync(join(f.project, '.qe')), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
