import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import {
  claimLifecycleChild,
  createLifecycleOperation,
  getLifecycleOperation,
  reconcileLifecycleOperation,
  settleLifecycleChild,
} from '../ledger.mjs';
import { createProcessController } from '../process-controller.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const SLUG = 'journal-test';
const OP1 = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';

function fixture() { return mkdtempSync(join(tmpdir(), 'qe-lifecycle-journal-')); }
function initChild(processId) { return { layer: 'goal', operation: 'initialize', processId }; }
function transitionChild(processId, to, expectedRevision = 0) {
  return { layer: 'goal', operation: 'transition', processId, to, expectedRevision, attestations: null, humanAcceptance: null };
}
function create(cwd, { operationId = OP1, semanticKey = 'semantic-1', children = [initChild('goal-a')], payload = { action: 'test' }, kind = 'test' } = {}) {
  return createLifecycleOperation(cwd, SLUG, { operationId, semanticKey, kind, payload, children });
}
function goal(cwd) { return createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' }); }

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

test('persists the complete roster before claim and replays semantic intent across proposed operation IDs', () => {
  const cwd = fixture();
  try {
    const first = create(cwd, { children: [initChild('goal-a'), initChild('goal-b')] });
    assert.equal(first.code, 'CREATED');
    assert.equal(first.operation.children.length, 2);
    assert.deepEqual(first.operation.children.map(child => child.status), ['pending', 'pending']);
    const replay = create(cwd, { operationId: OP2, children: [initChild('goal-a'), initChild('goal-b')] });
    assert.equal(replay.code, 'REPLAYED');
    assert.equal(replay.operation.operationId, OP1);
    assert.equal(create(cwd, { operationId: OP2, payload: { action: 'changed' }, children: [initChild('goal-a'), initChild('goal-b')] }).code, 'PAYLOAD_CONFLICT');
    assert.equal(create(cwd, { operationId: OP2, children: [initChild('goal-b'), initChild('goal-a')] }).code, 'PAYLOAD_CONFLICT');
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).operation.intentDigest, first.operation.intentDigest);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects hostile, deep, per-request oversized, and aggregate oversized inputs before insertion', () => {
  const cwd = fixture();
  try {
    assert.equal(createLifecycleOperation(cwd, SLUG, { operationId: OP1, semanticKey: 'x', kind: 'x', payload: {}, children: [] }).code, 'INVALID_INPUT');
    assert.equal(create(cwd, { children: [{ ...initChild('bad process') }] }).code, 'INVALID_INPUT');
    let deep = 'leaf';
    for (let index = 0; index < 14; index += 1) deep = { next: deep };
    assert.equal(create(cwd, { children: [{ ...transitionChild('goal-a', 'active'), attestations: deep }] }).code, 'INVALID_INPUT');
    assert.equal(create(cwd, { children: [{ ...transitionChild('goal-a', 'active'), attestations: ['x'.repeat(70 * 1024)] }] }).code, 'INVALID_INPUT');
    const aggregate = Array.from({ length: 20 }, (_, index) => ({
      ...transitionChild(`goal-${index}`, 'active'), attestations: ['x'.repeat(55 * 1024)],
    }));
    assert.equal(create(cwd, { children: aggregate }).code, 'INVALID_INPUT');
    const hostile = Object.create(null);
    Object.defineProperty(hostile, 'action', { enumerable: true, get() { throw new Error('getter'); } });
    assert.equal(create(cwd, { payload: hostile }).code, 'INVALID_INPUT');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('serializes semantic create races from separate processes', async () => {
  const cwd = fixture();
  try {
    const moduleUrl = new URL('../ledger.mjs', import.meta.url).href;
    const source = `
      import { createLifecycleOperation } from ${JSON.stringify(moduleUrl)};
      const r=createLifecycleOperation(process.env.CWD,'journal-test',{
        operationId:process.env.OP,semanticKey:'race',kind:'test',payload:{x:1},
        children:[{layer:'goal',operation:'initialize',processId:'goal-race'}]
      });
      process.stdout.write(JSON.stringify({code:r.code,id:r.operation?.operationId}));
    `;
    const results = await Promise.all([
      childProcess(source, { CWD: cwd, OP: OP1 }),
      childProcess(source, { CWD: cwd, OP: OP2 }),
    ]);
    assert.deepEqual(results.map(result => result.status), [0, 0]);
    const parsed = results.map(result => JSON.parse(result.stdout));
    assert.deepEqual(parsed.map(item => item.code).sort(), ['CREATED', 'REPLAYED']);
    assert.equal(parsed[0].id, parsed[1].id);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('fences ordered claims, replays the owner token, and rejects competitors', () => {
  const cwd = fixture();
  try {
    create(cwd, { children: [initChild('goal-a'), initChild('goal-b')] });
    assert.equal(claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 1, owner: 'worker-b', leaseMs: 1000 }).code, 'ORDER_VIOLATION');
    const claimed = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker-a', leaseMs: 300000 });
    assert.equal(claimed.code, 'CLAIMED');
    const replay = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker-a', leaseMs: 300000 });
    assert.equal(replay.code, 'REPLAYED');
    assert.equal(replay.child.claim.token, claimed.child.claim.token);
    assert.equal(claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker-b', leaseMs: 300000 }).code, 'CHILD_CAS_CONFLICT');
    assert.equal(claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker-b', leaseMs: 999 }).code, 'INVALID_INPUT');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('reclaims an expired lease with a new fence and rejects the delayed old worker', () => {
  const cwd = fixture();
  try {
    const created = create(cwd);
    const first = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'old', leaseMs: 1000 });
    const db = openSqlite(cwd);
    db.prepare('UPDATE lifecycle_operation_children SET lease_until=0 WHERE operation_id=? AND ordinal=0').run(OP1);
    closeSqlite(db);
    const second = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'new', leaseMs: 1000 });
    assert.equal(second.code, 'CLAIMED');
    assert.notEqual(second.child.claim.token, first.child.claim.token);
    const controller = goal(cwd);
    assert.equal(controller.initialize(created.operation.children[0].request).code, 'INITIALIZED');
    controller.close();
    assert.equal(settleLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, claimToken: first.child.claim.token }).code, 'CHILD_CAS_CONFLICT');
    assert.equal(settleLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, claimToken: second.child.claim.token }).operation.status, 'committed');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('reconciles controller response loss from a historical audit row after the head advances', () => {
  const cwd = fixture();
  try {
    const created = create(cwd);
    claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker', leaseMs: 1000 });
    const controller = goal(cwd);
    assert.equal(controller.initialize(created.operation.children[0].request).code, 'INITIALIZED');
    assert.equal(controller.transition({ processId: 'goal-a', requestId: 'later-head', to: 'active', expectedRevision: 0 }).code, 'ALLOWED');
    controller.close();
    const reconciled = reconcileLifecycleOperation(cwd, SLUG, { operationId: OP1 });
    assert.equal(reconciled.code, 'RECONCILED');
    assert.equal(reconciled.operation.status, 'committed');
    assert.equal(reconciled.operation.children[0].resultRef.auditSeq, 0);
    assert.equal(reconcileLifecycleOperation(cwd, SLUG, { operationId: OP1 }).code, 'UNCHANGED');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('reopens after a real subprocess dies between a middle controller commit and journal settlement', async () => {
  const cwd = fixture();
  try {
    const created = create(cwd, { children: [initChild('goal-a'), initChild('goal-b'), initChild('goal-c')] });
    const first = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'lead', leaseMs: 1000 });
    const controller = goal(cwd);
    controller.initialize(created.operation.children[0].request);
    assert.equal(settleLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, claimToken: first.child.claim.token }).code, 'RECORDED');
    controller.close();

    const ledgerUrl = new URL('../ledger.mjs', import.meta.url).href;
    const controllerUrl = new URL('../process-controller.mjs', import.meta.url).href;
    const source = `
      import { claimLifecycleChild } from ${JSON.stringify(ledgerUrl)};
      import { createProcessController } from ${JSON.stringify(controllerUrl)};
      const claim=claimLifecycleChild(process.env.CWD,'journal-test',{operationId:${JSON.stringify(OP1)},ordinal:1,owner:'crashing-worker',leaseMs:1000});
      const c=createProcessController({cwd:process.env.CWD,layer:'goal',authority:'goal-controller'});
      c.initialize(claim.child.request); c.close();
      process.exit(91);
    `;
    const crashed = await childProcess(source, { CWD: cwd });
    assert.equal(crashed.status, 91);
    const before = getLifecycleOperation(cwd, SLUG, OP1).operation;
    assert.equal(before.children[1].status, 'claimed');
    const recovered = reconcileLifecycleOperation(cwd, SLUG, { operationId: OP1 });
    assert.equal(recovered.code, 'RECONCILED');
    assert.equal(recovered.operation.currentOrdinal, 2);
    assert.deepEqual(recovered.operation.children.map(child => child.status), ['committed', 'committed', 'pending']);
    assert.equal(claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 2, owner: 'replacement', leaseMs: 1000 }).code, 'CLAIMED');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('SQLite rollback and reopen cover create, claim, and settle crash cuts', async () => {
  const cwd = fixture();
  const ledgerUrl = new URL('../ledger.mjs', import.meta.url).href;
  try {
    const createSource = `
      const m=await import(${JSON.stringify(ledgerUrl)});
      globalThis[Symbol.for('qe.lifecycle-journal.fault-injector')]=p=>{if(p===process.env.POINT)process.exit(92)};
      m.createLifecycleOperation(process.env.CWD,'journal-test',{operationId:${JSON.stringify(OP1)},semanticKey:'semantic-1',kind:'test',payload:{action:'test'},children:[{layer:'goal',operation:'initialize',processId:'goal-a'}]});
    `;
    assert.equal((await childProcess(createSource, { CWD: cwd, POINT: 'create-after-parent' })).status, 92);
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).code, 'NOT_FOUND');
    assert.equal((await childProcess(createSource, { CWD: cwd, POINT: 'create-after-commit' })).status, 92);
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).code, 'FOUND');

    const claimSource = `
      const m=await import(${JSON.stringify(ledgerUrl)});
      globalThis[Symbol.for('qe.lifecycle-journal.fault-injector')]=p=>{if(p===process.env.POINT)process.exit(93)};
      m.claimLifecycleChild(process.env.CWD,'journal-test',{operationId:${JSON.stringify(OP1)},ordinal:0,owner:'worker',leaseMs:1000});
    `;
    assert.equal((await childProcess(claimSource, { CWD: cwd, POINT: 'claim-after-child' })).status, 93);
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).operation.children[0].status, 'pending');
    const claimed = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker', leaseMs: 1000 });
    const controller = goal(cwd);
    controller.initialize(claimed.child.request); controller.close();

    const settleSource = `
      const m=await import(${JSON.stringify(ledgerUrl)});
      globalThis[Symbol.for('qe.lifecycle-journal.fault-injector')]=p=>{if(p===process.env.POINT)process.exit(94)};
      m.settleLifecycleChild(process.env.CWD,'journal-test',{operationId:${JSON.stringify(OP1)},ordinal:0,claimToken:process.env.TOKEN});
    `;
    assert.equal((await childProcess(settleSource, { CWD: cwd, TOKEN: claimed.child.claim.token, POINT: 'settle-after-child' })).status, 94);
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).operation.children[0].status, 'claimed');
    assert.equal((await childProcess(settleSource, { CWD: cwd, TOKEN: claimed.child.claim.token, POINT: 'settle-after-commit' })).status, 94);
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).operation.status, 'committed');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('keeps unmatched global rejection and store absence non-authoritative and retryable', () => {
  const cwd = fixture();
  try {
    create(cwd);
    const claimed = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker', leaseMs: 1000 });
    const settled = settleLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, claimToken: claimed.child.claim.token });
    assert.equal(settled.child.status, 'unavailable');
    assert.equal(settled.operation.status, 'running');
    assert.equal(claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'retry', leaseMs: 1000 }).code, 'CLAIMED');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('authoritative denial at first, middle, and last ordinal fences exactly the suffix', () => {
  for (const deniedOrdinal of [0, 1, 2]) {
    const cwd = fixture();
    try {
      const controller = goal(cwd);
      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        assert.equal(controller.initialize({ processId: `goal-${ordinal}`, requestId: `pre-${ordinal}` }).code, 'INITIALIZED');
      }
      const children = Array.from({ length: 3 }, (_, ordinal) => transitionChild(`goal-${ordinal}`, ordinal === deniedOrdinal ? 'complete' : 'active'));
      const created = create(cwd, { children });
      for (let ordinal = 0; ordinal <= deniedOrdinal; ordinal += 1) {
        const claimed = claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal, owner: `worker-${ordinal}`, leaseMs: 1000 });
        assert.equal(claimed.code, 'CLAIMED');
        const result = controller.transition(created.operation.children[ordinal].request);
        assert.equal(result.allowed, ordinal !== deniedOrdinal);
        const settled = settleLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal, claimToken: claimed.child.claim.token });
        assert.equal(settled.code, 'RECORDED');
      }
      controller.close();
      const operation = getLifecycleOperation(cwd, SLUG, OP1).operation;
      assert.equal(operation.status, 'denied');
      assert.deepEqual(operation.children.map(child => child.status), [0, 1, 2].map(ordinal => (
        ordinal < deniedOrdinal ? 'committed' : ordinal === deniedOrdinal ? 'denied' : 'cancelled'
      )));
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('fails closed when the controller audit chain is corrupted', () => {
  const cwd = fixture();
  try {
    const created = create(cwd);
    claimLifecycleChild(cwd, SLUG, { operationId: OP1, ordinal: 0, owner: 'worker', leaseMs: 1000 });
    const controller = goal(cwd);
    controller.initialize(created.operation.children[0].request);
    controller.close();
    const db = openSqlite(cwd);
    db.exec('DROP TRIGGER process_controller_audit_no_delete');
    db.prepare('DELETE FROM process_controller_audit WHERE process_id=? AND audit_seq=0').run('goal-a');
    closeSqlite(db);
    assert.equal(reconcileLifecycleOperation(cwd, SLUG, { operationId: OP1 }).code, 'CONTROLLER_AUDIT_INVALID');
    assert.equal(getLifecycleOperation(cwd, SLUG, OP1).operation.status, 'running');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
