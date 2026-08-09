import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import * as ledger from '../ledger.mjs';
import { createProcessController } from '../process-controller.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';
import { canonicalJson, sha256 } from '../process-controller-store.mjs';

const SLUG = 'demo-plan';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-compact-projection-'));
  mkdirSync(join(dir, '.qe', 'planning', 'plans', SLUG), { recursive: true });
  return dir;
}

function withRoot(cwd, callback) {
  const prior = process.env.QE_ROOT;
  process.env.QE_ROOT = cwd;
  try { return callback(); }
  finally { if (prior === undefined) delete process.env.QE_ROOT; else process.env.QE_ROOT = prior; }
}

function transition(processId, to = 'active', expectedRevision = 0) {
  return { layer: 'goal', operation: 'transition', processId, to, expectedRevision,
    attestations: null, humanAcceptance: null };
}

function childProcess(source, env) {
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

function stageFixture(cwd, { operationId, expectedRevision = 0 } = {}) {
  const processId = `qe-plan:${SLUG}:goal:G001`;
  ledger.createGoals(cwd, SLUG, ['First::first objective']);
  ledger.renderState(cwd, SLUG);
  const controller = createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' });
  assert.equal(controller.initialize({ processId, requestId: `init-${operationId}` }).code, 'INITIALIZED');
  const created = ledger.createLifecycleOperation(cwd, SLUG, {
    operationId, semanticKey: `semantic-${operationId}`, kind: 'controller-projected', payload: { action: 'advance' },
    children: [transition(processId, 'active', expectedRevision)],
  });
  assert.equal(created.code, 'CREATED');
  const db = openSqlite(cwd, { readOnly: true });
  const prefix = `.qe/planning/plans/${SLUG}/`;
  const rows = Object.fromEntries(['goals.json', 'ledger.jsonl', 'STATE.md'].map(name => [name,
    db.prepare('SELECT content,sha256 FROM qe_files WHERE path=?').get(prefix + name)]));
  closeSqlite(db);
  const goal = JSON.parse(rows['goals.json'].content).goals[0];
  const recipe = {
    schema: 1, baseGoalsSha256: rows['goals.json'].sha256, baseLedgerSha256: rows['ledger.jsonl'].sha256,
    baseStateSha256: rows['STATE.md'].sha256,
    children: [{ ordinal: 0, goalId: 'G001', expectedTargetSha256: sha256(canonicalJson(goal)),
      set: { status: 'active', attempts: 1 }, event: { event: 'started', status: 'active', evidence: 'controller allowed' } }],
  };
  return { controller, created, recipe, rows };
}

test('compact lifecycle projection API is exported', { concurrency: false }, () => {
  assert.equal(typeof ledger.stageLifecycleProjection, 'function');
  assert.equal(typeof ledger.applyLifecycleOutcomeProjection, 'function');
  assert.equal(typeof ledger.getLifecycleProjection, 'function');
});

test('stageLifecycleProjection rejects invalid envelopes', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    const result = ledger.stageLifecycleProjection(cwd, SLUG, {});
    assert.deepEqual(result, { ok: false, code: 'INVALID_INPUT' });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyLifecycleOutcomeProjection fails closed before staging', { concurrency: false }, () => {
  const cwd = makeProject();
  const priorRoot = process.env.QE_ROOT;
  process.env.QE_ROOT = cwd;
  try {
    const result = ledger.applyLifecycleOutcomeProjection(cwd, SLUG, {
      operationId: '11111111-1111-4111-8111-111111111111',
    });
    assert.deepEqual(result, { ok: false, code: 'PROJECTION_NOT_READY' });
  } finally {
    if (priorRoot === undefined) delete process.env.QE_ROOT; else process.env.QE_ROOT = priorRoot;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('getLifecycleProjection reports missing operations as not found', { concurrency: false }, () => {
  const cwd = makeProject();
  const priorRoot = process.env.QE_ROOT;
  process.env.QE_ROOT = cwd;
  try {
    const result = ledger.getLifecycleProjection(cwd, SLUG, {
      operationId: '11111111-1111-4111-8111-111111111111',
    });
    assert.deepEqual(result, { ok: false, code: 'NOT_FOUND' });
  } finally {
    if (priorRoot === undefined) delete process.env.QE_ROOT; else process.env.QE_ROOT = priorRoot;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('committed terminal outcome projects canonical rows exactly once', { concurrency: false }, () => {
  const cwd = makeProject();
  const operationId = '22222222-2222-4222-8222-222222222222';
  try {
    withRoot(cwd, () => {
      const fixture = stageFixture(cwd, { operationId });
      assert.equal(ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 }).code,
        'PROJECTION_NOT_STAGED');
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'STAGED');
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'REPLAYED');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 });
      assert.equal(claim.code, 'CLAIMED');
      assert.equal(fixture.controller.transition(claim.child.request).code, 'ALLOWED');
      const settled = ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, claimToken: claim.child.claim.token });
      assert.equal(settled.operation.status, 'committed');
      fixture.controller.close();
      const projected = ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId });
      assert.equal(projected.code, 'PROJECTED');
      assert.equal(projected.receipt.eventCount, 1);
      const replay = ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId });
      assert.equal(replay.code, 'REPLAYED');
      assert.deepEqual(replay.receipt.postHashes, projected.receipt.postHashes);
      const db = openSqlite(cwd, { readOnly: true });
      const prefix = `.qe/planning/plans/${SLUG}/`;
      const goals = JSON.parse(db.prepare('SELECT content FROM qe_files WHERE path=?').get(prefix + 'goals.json').content);
      const lines = db.prepare('SELECT content FROM qe_files WHERE path=?').get(prefix + 'ledger.jsonl').content.trim().split('\n');
      const state = db.prepare('SELECT content FROM qe_files WHERE path=?').get(prefix + 'STATE.md').content;
      assert.equal(db.prepare('SELECT 1 FROM lifecycle_projection_heads WHERE slug=?').get(SLUG), undefined);
      assert.equal(db.prepare('SELECT consumed FROM lifecycle_projection_event_reservations WHERE operation_id=?').get(operationId).consumed, 1);
      closeSqlite(db);
      assert.equal(goals.goals[0].status, 'active');
      assert.equal(goals.goals[0].attempts, 1);
      assert.equal(JSON.parse(lines.at(-1)).operationId, operationId);
      assert.match(state, /- \[>\] G001/);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('denied outcome emits one checkpoint without mutating the goal', { concurrency: false }, () => {
  const cwd = makeProject();
  const operationId = '33333333-3333-4333-8333-333333333333';
  try {
    withRoot(cwd, () => {
      const fixture = stageFixture(cwd, { operationId, expectedRevision: 7 });
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'STAGED');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 });
      assert.equal(fixture.controller.transition(claim.child.request).allowed, false);
      const settled = ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, claimToken: claim.child.claim.token });
      fixture.controller.close();
      assert.equal(settled.operation.status, 'denied');
      const projected = ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId });
      assert.equal(projected.code, 'PROJECTED');
      assert.equal(projected.receipt.outcome, 'denied');
      const db = openSqlite(cwd, { readOnly: true });
      const prefix = `.qe/planning/plans/${SLUG}/`;
      const goals = JSON.parse(db.prepare('SELECT content FROM qe_files WHERE path=?').get(prefix + 'goals.json').content);
      const event = JSON.parse(db.prepare('SELECT content FROM qe_files WHERE path=?').get(prefix + 'ledger.jsonl').content.trim().split('\n').at(-1));
      closeSqlite(db);
      assert.equal(goals.goals[0].status, 'pending');
      assert.equal(goals.goals[0].attempts, 0);
      assert.equal(event.event, 'checkpoint');
      assert.equal(event.status, 'pending');
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('canonical base drift returns a stable no-write conflict and retains the head', { concurrency: false }, () => {
  const cwd = makeProject();
  const operationId = '44444444-4444-4444-8444-444444444444';
  try {
    withRoot(cwd, () => {
      const fixture = stageFixture(cwd, { operationId });
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'STAGED');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 });
      fixture.controller.transition(claim.child.request);
      ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, claimToken: claim.child.claim.token });
      fixture.controller.close();
      const db = openSqlite(cwd);
      const path = `.qe/planning/plans/${SLUG}/goals.json`;
      const row = db.prepare('SELECT content FROM qe_files WHERE path=?').get(path);
      const changed = `${row.content}\n`;
      db.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?').run(changed, Buffer.byteLength(changed), sha256(changed), path);
      closeSqlite(db);
      assert.equal(ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId }).code, 'TARGET_CONFLICT');
      const check = openSqlite(cwd, { readOnly: true });
      assert.equal(check.prepare('SELECT operation_id FROM lifecycle_projection_heads WHERE slug=?').get(SLUG).operation_id, operationId);
      assert.equal(check.prepare('SELECT COUNT(*) AS count FROM lifecycle_projection_receipts').get().count, 0);
      closeSqlite(check);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('recipe changes conflict and a pre-commit apply fault rolls back every canonical write', { concurrency: false }, () => {
  const cwd = makeProject();
  const operationId = '55555555-5555-4555-8555-555555555555';
  try {
    withRoot(cwd, () => {
      const fixture = stageFixture(cwd, { operationId });
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'STAGED');
      const raw = openSqlite(cwd);
      assert.throws(() => raw.prepare('DELETE FROM lifecycle_projection_heads WHERE slug=?').run(SLUG),
        /qe_lifecycle_projection_write_v1|PROJECTION_IMMUTABLE/);
      closeSqlite(raw);
      const changed = structuredClone(fixture.recipe);
      changed.children[0].event.evidence = 'changed evidence';
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: changed }).code, 'RECIPE_CONFLICT');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 });
      fixture.controller.transition(claim.child.request);
      ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, claimToken: claim.child.claim.token });
      fixture.controller.close();
      globalThis[Symbol.for('qe.lifecycle-projection.fault-injector')] = point => {
        if (point === 'receipt') throw new Error('crash cut');
      };
      assert.equal(ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId }).code, 'STORE_UNAVAILABLE');
      delete globalThis[Symbol.for('qe.lifecycle-projection.fault-injector')];
      const db = openSqlite(cwd, { readOnly: true });
      const prefix = `.qe/planning/plans/${SLUG}/`;
      assert.equal(db.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(prefix + 'goals.json').sha256, fixture.rows['goals.json'].sha256);
      assert.equal(db.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(prefix + 'ledger.jsonl').sha256, fixture.rows['ledger.jsonl'].sha256);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lifecycle_projection_receipts').get().count, 0);
      assert.equal(db.prepare('SELECT consumed FROM lifecycle_projection_event_reservations WHERE operation_id=?').get(operationId).consumed, 0);
      closeSqlite(db);
      assert.equal(ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId }).code, 'PROJECTED');
    });
  } finally {
    delete globalThis[Symbol.for('qe.lifecycle-projection.fault-injector')];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('projection schema tamper fails closed without auto-repair', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      assert.equal(ledger.getLifecycleProjection(cwd, SLUG, {
        operationId: '66666666-6666-4666-8666-666666666666',
      }).code, 'NOT_FOUND');
      const db = openSqlite(cwd);
      db.exec('DROP TRIGGER lifecycle_projection_receipts_no_update');
      closeSqlite(db);
      assert.equal(ledger.getLifecycleProjection(cwd, SLUG, {
        operationId: '66666666-6666-4666-8666-666666666666',
      }).code, 'PROJECTION_STORE_CORRUPT');
      const check = openSqlite(cwd, { readOnly: true });
      assert.equal(check.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='trigger' AND name='lifecycle_projection_receipts_no_update'").get().count, 0);
      closeSqlite(check);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('two-process apply race converges to one projection and one immutable replay', { concurrency: false }, async () => {
  const cwd = makeProject();
  const operationId = '77777777-7777-4777-8777-777777777777';
  try {
    withRoot(cwd, () => {
      const fixture = stageFixture(cwd, { operationId });
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'STAGED');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 });
      fixture.controller.transition(claim.child.request);
      ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, claimToken: claim.child.claim.token });
      fixture.controller.close();
    });
    const moduleUrl = new URL('../ledger.mjs', import.meta.url).href;
    const source = `
      process.env.QE_ROOT=process.env.CWD;
      const m=await import(${JSON.stringify(moduleUrl)});
      process.stdout.write(JSON.stringify(m.applyLifecycleOutcomeProjection(process.env.CWD,${JSON.stringify(SLUG)},{operationId:${JSON.stringify(operationId)}})));
    `;
    const results = await Promise.all([childProcess(source, { CWD: cwd }), childProcess(source, { CWD: cwd })]);
    assert.deepEqual(results.map(result => result.status), [0, 0]);
    const parsed = results.map(result => JSON.parse(result.stdout));
    assert.deepEqual(parsed.map(item => item.code).sort(), ['PROJECTED', 'REPLAYED']);
    assert.deepEqual(parsed[0].receipt.postHashes, parsed[1].receipt.postHashes);
    const db = openSqlite(cwd, { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lifecycle_projection_receipts WHERE operation_id=?').get(operationId).count, 1);
    closeSqlite(db);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('reserved identity collision and completion recipe are rejected without canonical writes', { concurrency: false }, () => {
  const collisionRoot = makeProject();
  const completionRoot = makeProject();
  try {
    withRoot(collisionRoot, () => {
      const operationId = '88888888-8888-4888-8888-888888888888';
      const fixture = stageFixture(collisionRoot, { operationId });
      const child = fixture.created.operation.children[0];
      const reservationId = sha256(canonicalJson(['qe-lifecycle-projection-event-v1', SLUG, operationId, 0, child.requestId]));
      const raw = openSqlite(collisionRoot);
      raw.function('qe_lifecycle_projection_write_v1', () => 1);
      raw.prepare(`INSERT INTO lifecycle_projection_event_reservations
        (reservation_id,slug,operation_id,ordinal,request_id,event_digest,consumed) VALUES(?,?,?,?,?,?,0)`)
        .run(reservationId, SLUG, operationId, 0, child.requestId, '0'.repeat(64));
      closeSqlite(raw);
      assert.equal(ledger.stageLifecycleProjection(collisionRoot, SLUG, { operationId, recipe: fixture.recipe }).code, 'RECIPE_CONFLICT');
      fixture.controller.close();
      const check = openSqlite(collisionRoot, { readOnly: true });
      assert.equal(check.prepare('SELECT COUNT(*) AS count FROM lifecycle_projection_recipes').get().count, 0);
      assert.equal(check.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(`.qe/planning/plans/${SLUG}/goals.json`).sha256,
        fixture.rows['goals.json'].sha256);
      closeSqlite(check);
    });
    withRoot(completionRoot, () => {
      const operationId = '99999999-9999-4999-8999-999999999999';
      const fixture = stageFixture(completionRoot, { operationId });
      const hostile = structuredClone(fixture.recipe);
      hostile.children[0].set = { status: 'complete' };
      hostile.children[0].event = { event: 'verified', status: 'complete', evidence: 'bypass' };
      assert.equal(ledger.stageLifecycleProjection(completionRoot, SLUG, { operationId, recipe: hostile }).code, 'INVALID_RECIPE');
      fixture.controller.close();
      const check = openSqlite(completionRoot, { readOnly: true });
      assert.equal(check.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(`.qe/planning/plans/${SLUG}/goals.json`).sha256,
        fixture.rows['goals.json'].sha256);
      assert.equal(check.prepare('SELECT COUNT(*) AS count FROM lifecycle_projection_heads').get().count, 0);
      closeSqlite(check);
    });
  } finally {
    rmSync(collisionRoot, { recursive: true, force: true });
    rmSync(completionRoot, { recursive: true, force: true });
  }
});
