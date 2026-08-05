import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { createProcessController } from '../process-controller.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

function fixture() { return mkdtempSync(join(tmpdir(), 'qe-process-controller-')); }
function goal(cwd, extra = {}) {
  return createProcessController({ cwd, layer: 'goal', authority: 'goal-controller', ...extra });
}
function initialize(controller, processId = 'goal-1', requestId = 'init-1') {
  return controller.initialize({ processId, requestId });
}

function childResult(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('initializes, applies a kernel transition, and survives reopen', () => {
  const cwd = fixture();
  try {
    let controller = goal(cwd);
    assert.equal(initialize(controller).code, 'INITIALIZED');
    const result = controller.transition({ processId: 'goal-1', requestId: 'start-1', to: 'active', expectedRevision: 0 });
    assert.equal(result.code, 'ALLOWED');
    assert.equal(result.auditSeq, 1);
    controller.close();
    controller = goal(cwd);
    assert.deepEqual(controller.read('goal-1').snapshot, { revision: 1, state: 'active' });
    assert.equal(controller.audit('goal-1').length, 2);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('derives exactly-once replay from immutable audit and rejects requestId conflicts', () => {
  const cwd = fixture();
  try {
    const controller = goal(cwd);
    initialize(controller);
    const request = { processId: 'goal-1', requestId: 'start-1', to: 'active', expectedRevision: 0 };
    assert.equal(controller.transition(request).code, 'ALLOWED');
    const replay = controller.transition(request);
    assert.equal(replay.code, 'ALLOWED');
    assert.equal(replay.replayed, true);
    assert.equal(controller.audit('goal-1').length, 2);
    const conflict = controller.transition({ ...request, to: 'blocked' });
    assert.equal(conflict.code, 'REQUEST_ID_CONFLICT');
    assert.equal(controller.read('goal-1').snapshot.revision, 1);
    assert.equal(controller.audit('goal-1').length, 3);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('checks immutable layer before replay and never trusts request authority or snapshot', () => {
  const cwd = fixture();
  try {
    const valid = goal(cwd);
    initialize(valid, 'shared', 'same-id');
    const plan = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
    const mismatch = plan.initialize({ processId: 'shared', requestId: 'same-id' });
    assert.equal(mismatch.code, 'LAYER_MISMATCH');
    assert.equal(mismatch.replayed, false);
    const injected = valid.transition({
      processId: 'shared', requestId: 'bad-envelope', to: 'active', expectedRevision: 0,
      authority: 'goal-controller', snapshot: { state: 'pending', revision: 0 },
    });
    assert.equal(injected.code, 'INVALID_CONTROLLER_REQUEST');
    assert.equal(valid.read('shared').snapshot.revision, 0);
    const unauthorized = createProcessController({ cwd, layer: 'goal', authority: 'forged-controller' });
    const denied = unauthorized.transition({ processId: 'shared', requestId: 'forged', to: 'active', expectedRevision: 0 });
    assert.equal(denied.code, 'AUTHORITY_DENIED');
    assert.equal(valid.read('shared').snapshot.revision, 0);
    const deniedInit = unauthorized.initialize({ processId: 'new-goal', requestId: 'forged-init' });
    assert.equal(deniedInit.code, 'AUTHORITY_DENIED');
    assert.equal(unauthorized.read('new-goal').code, 'PROCESS_NOT_FOUND');
    unauthorized.close(); plan.close(); valid.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('serializes competing writers with revision CAS', () => {
  const cwd = fixture();
  try {
    const first = goal(cwd); const second = goal(cwd);
    initialize(first);
    assert.equal(first.transition({ processId: 'goal-1', requestId: 'a', to: 'active', expectedRevision: 0 }).code, 'ALLOWED');
    assert.equal(second.transition({ processId: 'goal-1', requestId: 'b', to: 'active', expectedRevision: 0 }).code, 'STALE_SNAPSHOT');
    assert.equal(first.read('goal-1').snapshot.revision, 1);
    first.close(); second.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('serializes two simultaneous subprocess writers at the same revision', async () => {
  const cwd = fixture();
  try {
    const controller = goal(cwd); initialize(controller); controller.close();
    const moduleUrl = new URL('../process-controller.mjs', import.meta.url).href;
    const source = `
      import { createProcessController } from ${JSON.stringify(moduleUrl)};
      const c=createProcessController({cwd:process.env.PC_CWD,layer:'goal',authority:'goal-controller'});
      const r=c.transition({processId:'goal-1',requestId:process.env.PC_ID,to:'active',expectedRevision:0});
      c.close(); process.stdout.write(JSON.stringify({code:r.code}));
    `;
    const results = await Promise.all([
      childResult(source, { PC_CWD: cwd, PC_ID: 'race-a' }),
      childResult(source, { PC_CWD: cwd, PC_ID: 'race-b' }),
    ]);
    assert.deepEqual(results.map(result => result.status), [0, 0]);
    const codes = results.map(result => JSON.parse(result.stdout).code).sort();
    assert.deepEqual(codes, ['ALLOWED', 'STALE_SNAPSHOT']);
    const reopened = goal(cwd);
    assert.equal(reopened.read('goal-1').snapshot.revision, 1);
    assert.equal(reopened.audit('goal-1').length, 3);
    reopened.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('audits repeated denials and idempotency without increasing state revision', () => {
  const cwd = fixture();
  try {
    const controller = goal(cwd); initialize(controller);
    assert.equal(controller.transition({ processId: 'goal-1', requestId: 'id-1', to: 'pending', expectedRevision: 0 }).code, 'IDEMPOTENT');
    assert.equal(controller.transition({ processId: 'goal-1', requestId: 'stale-1', to: 'active', expectedRevision: 9 }).code, 'STALE_SNAPSHOT');
    assert.equal(controller.transition({ processId: 'goal-1', requestId: 'stale-2', to: 'active', expectedRevision: 9 }).code, 'STALE_SNAPSHOT');
    const read = controller.read('goal-1');
    assert.equal(read.snapshot.revision, 0);
    assert.equal(read.auditSeq, 3);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects throwing hostile envelopes through the global audit', () => {
  const cwd = fixture();
  try {
    const controller = goal(cwd);
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    const result = controller.initialize(hostile);
    assert.equal(result.code, 'INVALID_CONTROLLER_REQUEST');
    assert.equal(result.audited, true);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('returns deterministic last-good snapshots for audit and state corruption', () => {
  const cwd = fixture();
  try {
    let controller = goal(cwd); initialize(controller);
    controller.transition({ processId: 'goal-1', requestId: 'start', to: 'active', expectedRevision: 0 });
    controller.transition({ processId: 'goal-1', requestId: 'block', to: 'blocked', expectedRevision: 1 });
    controller.close();
    let db = openSqlite(cwd);
    db.exec('DROP TRIGGER process_controller_audit_no_delete');
    db.prepare('DELETE FROM process_controller_audit WHERE process_id=? AND audit_seq=?').run('goal-1', 1);
    closeSqlite(db);
    controller = goal(cwd);
    let read = controller.read('goal-1');
    assert.equal(read.code, 'CONTROLLER_CORRUPT');
    assert.deepEqual(read.lastGoodSnapshot, { revision: 0, state: 'pending' });
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }

  const cwd2 = fixture();
  try {
    let controller = goal(cwd2); initialize(controller); controller.close();
    const db = openSqlite(cwd2);
    db.prepare('UPDATE process_controller_state SET snapshot_json=? WHERE process_id=?').run('{bad', 'goal-1');
    closeSqlite(db);
    controller = goal(cwd2);
    const read = controller.read('goal-1');
    assert.equal(read.code, 'CONTROLLER_CORRUPT');
    assert.deepEqual(read.lastGoodSnapshot, { revision: 0, state: 'pending' });
    controller.close();
  } finally { rmSync(cwd2, { recursive: true, force: true }); }

  const cwd3 = fixture();
  try {
    let controller = goal(cwd3); initialize(controller); controller.close();
    const db = openSqlite(cwd3);
    db.prepare('UPDATE process_controller_state SET layer=?,last_audit_hash=? WHERE process_id=?')
      .run('plan', 'f'.repeat(64), 'goal-1');
    closeSqlite(db);
    controller = goal(cwd3);
    const read = controller.read('goal-1');
    assert.equal(read.code, 'CONTROLLER_CORRUPT');
    assert.deepEqual(read.lastGoodSnapshot, { revision: 0, state: 'pending' });
    controller.close();
  } finally { rmSync(cwd3, { recursive: true, force: true }); }
});

test('returns null last-good snapshot when genesis is corrupt', () => {
  const cwd = fixture();
  try {
    let controller = goal(cwd); initialize(controller); controller.close();
    const db = openSqlite(cwd);
    db.exec('DROP TRIGGER process_controller_audit_no_update');
    db.prepare('UPDATE process_controller_audit SET event_json=? WHERE process_id=? AND audit_seq=0').run('{}', 'goal-1');
    closeSqlite(db);
    controller = goal(cwd);
    const read = controller.read('goal-1');
    assert.equal(read.code, 'CONTROLLER_CORRUPT');
    assert.equal(read.lastGoodSnapshot, null);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('detects a corrupt global rejection genesis/head and refuses to claim an audit', () => {
  const cwd = fixture();
  try {
    let controller = goal(cwd); controller.close();
    const db = openSqlite(cwd);
    db.exec('DROP TRIGGER process_controller_rejection_no_delete');
    db.prepare('DELETE FROM process_controller_rejection_audit WHERE audit_seq=0').run();
    closeSqlite(db);
    controller = goal(cwd);
    const result = controller.initialize(Object.create(null));
    assert.equal(result.code, 'CONTROLLER_AUDIT_CORRUPT');
    assert.equal(result.audited, false);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('detects an orphan rejection-audit suffix beyond the durable head', () => {
  const cwd = fixture();
  try {
    let controller = goal(cwd); controller.close();
    const db = openSqlite(cwd);
    db.prepare('INSERT INTO process_controller_rejection_audit VALUES(?,?,?,?,?)')
      .run(1, '{}', '0'.repeat(64), 'f'.repeat(64), Date.now());
    closeSqlite(db);
    controller = goal(cwd);
    const result = controller.initialize(Object.create(null));
    assert.equal(result.code, 'CONTROLLER_AUDIT_CORRUPT');
    assert.equal(result.audited, false);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('crash cut points rollback before commit and preserve a committed result after commit', () => {
  for (const checkpoint of ['before-write', 'between-write-and-audit', 'before-commit', 'after-commit']) {
    const cwd = fixture();
    try {
      let controller = goal(cwd); initialize(controller); controller.close();
      const source = `
        import { createProcessController } from ${JSON.stringify(new URL('../process-controller.mjs', import.meta.url).href)};
        const c=createProcessController({cwd:process.env.PC_CWD,layer:'goal',authority:'goal-controller',faultInjector:p=>{if(p===process.env.PC_POINT)process.exit(91)}});
        c.transition({processId:'goal-1',requestId:'crash',to:'active',expectedRevision:0});
      `;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        env: { ...process.env, PC_CWD: cwd, PC_POINT: checkpoint }, timeout: 10_000,
      });
      assert.equal(child.status, 91, `${checkpoint}: ${child.stderr}`);
      controller = goal(cwd);
      const committed = checkpoint === 'after-commit';
      assert.equal(controller.read('goal-1').snapshot.revision, committed ? 1 : 0);
      const retry = controller.transition({ processId: 'goal-1', requestId: 'crash', to: 'active', expectedRevision: 0 });
      assert.equal(retry.code, 'ALLOWED');
      assert.equal(retry.replayed, committed);
      controller.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});
