import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { createProcessController } from '../process-controller.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const encoder = new TextEncoder();
const uuid = 'cccccccc';

function fixture() { return mkdtempSync(join(tmpdir(), 'qe-pse-guarded-')); }
function goal(cwd, extra = {}) {
  return createProcessController({ cwd, layer: 'goal', authority: 'goal-controller', ...extra });
}

function pair({ lane = 'in-progress', status = lane === 'on-hold' ? 'in-progress' : lane,
  taskChecks = [true], checklistChecks = [true, true] } = {}) {
  const taskPath = `.qe/tasks/${lane}/TASK_REQUEST_${uuid}.md`;
  const checklistPath = `.qe/checklists/${lane}/VERIFY_CHECKLIST_${uuid}.md`;
  const mark = value => value ? 'x' : ' ';
  const taskText = `# TASK_REQUEST_${uuid}.md — T\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${uuid}\nplan: p\nphase: "P"\ncreated: "2026-08-07"\nstatus: ${status}\nlinks:\n  - "[[${checklistPath}]]"\n-->\n\n## 체크리스트\n${taskChecks.map((v, i) => `- [${mark(v)}] task-${i}`).join('\n')}\n`;
  const checklistText = `# VERIFY_CHECKLIST_${uuid}.md — V\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${uuid}\nplan: p\nphase: "P"\ncreated: "2026-08-07"\nstatus: ${status}\nlinks:\n  - "[[${taskPath}]]"\n-->\n\n## 검증 기준\n- [${mark(checklistChecks[0])}] verify-0\n\n## 프레임워크 무결성 체크\n${checklistChecks.slice(1).map((v, i) => `- [${mark(v)}] wire-${i}`).join('\n')}\n`;
  return { taskPath, taskText, taskBytes: encoder.encode(taskText), checklistPath, checklistText,
    checklistBytes: encoder.encode(checklistText) };
}

function seedPair(cwd, value) {
  const db = openSqlite(cwd); const now = Date.now();
  const put = db.prepare(`INSERT INTO qe_files VALUES(?,?, 'utf8', ?,420,?,?,?)`);
  for (const [path, text] of [[value.taskPath, value.taskText], [value.checklistPath, value.checklistText]]) {
    const bytes = Buffer.from(text);
    put.run(path, text, bytes.length, now, createHash('sha256').update(bytes).digest('hex'), now);
  }
  closeSqlite(db);
}

function initializeActive(cwd) {
  const controller = goal(cwd);
  assert.equal(controller.initialize({ processId: 'goal-1', requestId: 'init' }).code, 'INITIALIZED');
  assert.equal(controller.transition({ processId: 'goal-1', requestId: 'activate', to: 'active', expectedRevision: 0 }).code, 'ALLOWED');
  return controller;
}

function completionEvidence(revision = 1) {
  const entry = (issuedBy, sessionId) => ({ status: 'valid', subject: 'goal', revision,
    proofRef: `proof-${issuedBy}`, issuedBy, sessionId, digest: `digest-${issuedBy}` });
  return {
    attestations: {
      acceptance: entry('acceptor', 'a'), implementation: entry('implementer', 'impl'),
      machineVerification: entry('machine', 'm'), independentVerification: entry('independent', 'verify'),
      goalAlignment: entry('independent', 'align'),
    },
    humanAcceptance: { required: true, status: 'passed', proofRef: 'user-approved-uninterrupted-completion' },
  };
}

function prepare(controller, source, requestId = 'prepare-1') {
  assert.equal(typeof controller.preparePseTransition, 'function', 'ABSENT_PREPARE_METHOD');
  return controller.preparePseTransition({ processId: 'goal-1', requestId,
    taskPath: source.taskPath, checklistPath: source.checklistPath });
}

function guarded(controller, prepared, after, overrides = {}) {
  assert.equal(typeof controller.guardedPseTransition, 'function', 'ABSENT_GUARDED_METHOD');
  const evidence = completionEvidence();
  return controller.guardedPseTransition({
    processId: 'goal-1', requestId: 'guard-1', to: 'complete', expectedRevision: 1,
    receipt: prepared.receipt, taskPath: after.taskPath, taskBytes: after.taskBytes,
    checklistPath: after.checklistPath, checklistBytes: after.checklistBytes, resume: null,
    attestations: evidence.attestations, humanAcceptance: evidence.humanAcceptance, ...overrides,
  });
}

function dbRows(cwd) {
  const db = openSqlite(cwd, { readOnly: true });
  const result = {
    files: db.prepare('SELECT path,content,sha256 FROM qe_files WHERE path LIKE ? ORDER BY path').all(`%.qe/%`),
    state: db.prepare('SELECT * FROM process_controller_state WHERE process_id=?').get('goal-1'),
    audit: db.prepare('SELECT * FROM process_controller_audit WHERE process_id=? ORDER BY audit_seq').all('goal-1'),
    preparation: db.prepare('SELECT * FROM process_controller_pse_preparation').all(),
  };
  closeSqlite(db); return result;
}

test('exposes a consistent facade and issues/replays an opaque DB receipt', async () => {
  const cwd = fixture();
  try {
    const source = pair();
    const controller = initializeActive(cwd);
    const { createHash } = await import('node:crypto');
    const db = openSqlite(cwd);
    const put = db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
      VALUES(?,?, 'utf8', ?, 420, ?, ?, ?)`);
    for (const [path, text] of [[source.taskPath, source.taskText], [source.checklistPath, source.checklistText]]) {
      const bytes = Buffer.from(text); const now = Date.now();
      put.run(path, text, bytes.length, now, createHash('sha256').update(bytes).digest('hex'), now);
    }
    closeSqlite(db);

    const prepared = prepare(controller, source);
    assert.equal(prepared.code, 'PSE_PREPARED');
    assert.match(prepared.receipt, /^[0-9a-f]{64}$/);
    assert.equal(Object.isFrozen(prepared), true);
    assert.deepEqual(prepare(controller, source), prepared);
    assert.equal(prepare(controller, source, 'prepare-1').receipt, prepared.receipt);
    const conflict = controller.preparePseTransition({ processId: 'goal-1', requestId: 'prepare-1',
      taskPath: source.checklistPath, checklistPath: source.taskPath });
    assert.equal(conflict.code, 'REQUEST_ID_CONFLICT');

    const wrong = createProcessController({ cwd, layer: 'goal', authority: 'forged-controller' });
    assert.equal(typeof wrong.preparePseTransition, 'function');
    assert.equal(wrong.preparePseTransition({ processId: 'goal-1', requestId: 'wrong',
      taskPath: source.taskPath, checklistPath: source.checklistPath }).code, 'AUTHORITY_DENIED');
    const plan = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
    assert.equal(typeof plan.preparePseTransition, 'function');
    assert.equal(plan.preparePseTransition({ processId: 'goal-1', requestId: 'plan',
      taskPath: source.taskPath, checklistPath: source.checklistPath }).code, 'PSE_LAYER_UNSUPPORTED');
    wrong.close(); plan.close(); controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('commits completed artifact rows, Goal state, preparation and bounded audit once', async () => {
  const cwd = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd);
    const { createHash } = await import('node:crypto');
    const db = openSqlite(cwd); const now = Date.now();
    const put = db.prepare(`INSERT INTO qe_files VALUES(?,?, 'utf8', ?,420,?,?,?)`);
    for (const [path, text] of [[source.taskPath, source.taskText], [source.checklistPath, source.checklistText]]) {
      const bytes = Buffer.from(text); put.run(path, text, bytes.length, now, createHash('sha256').update(bytes).digest('hex'), now);
    }
    closeSqlite(db);
    const prepared = prepare(controller, source);
    const result = guarded(controller, prepared, after);
    assert.equal(result.code, 'PSE_TRANSITION_COMMITTED');
    assert.equal(result.consistency.transition, 'COMPLETE');
    assert.equal(result.consistency.authoritative, true);
    assert.equal(Object.isFrozen(result), true);
    const replay = guarded(controller, prepared, after);
    assert.equal(replay.code, 'PSE_TRANSITION_COMMITTED');
    assert.equal(replay.replayed, true);
    const rows = dbRows(cwd);
    assert.equal(rows.state.revision, 2);
    assert.equal(JSON.parse(rows.state.snapshot_json).state, 'complete');
    assert.equal(rows.audit.length, 3);
    assert.deepEqual(rows.files.map(row => row.path), [after.checklistPath, after.taskPath].sort());
    assert.equal(rows.preparation[0].consumed_audit_seq, 2);
    const event = JSON.parse(rows.audit[2].event_json);
    assert.equal(event.request.receiptSha256.length, 64);
    assert.equal(JSON.stringify(event).includes(prepared.receipt), false);
    assert.equal(JSON.stringify(event).includes(Buffer.from(after.taskBytes).toString('hex')), false);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects forged/stale receipts, mapping errors, and destination collisions without mutation', async () => {
  const cwd = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd); const { createHash } = await import('node:crypto');
    let db = openSqlite(cwd); const now = Date.now();
    const put = db.prepare(`INSERT INTO qe_files VALUES(?,?, 'utf8', ?,420,?,?,?)`);
    for (const [path, text] of [[source.taskPath, source.taskText], [source.checklistPath, source.checklistText]]) {
      const bytes = Buffer.from(text); put.run(path, text, bytes.length, now, createHash('sha256').update(bytes).digest('hex'), now);
    }
    closeSqlite(db);
    const prepared = prepare(controller, source);
    assert.equal(guarded(controller, { ...prepared, receipt: 'f'.repeat(64) }, after).code, 'PSE_PROVENANCE_INVALID');
    assert.equal(guarded(controller, prepared, after, { to: 'blocked' }).code, 'PSE_CONTROLLER_MISMATCH');

    db = openSqlite(cwd);
    db.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?')
      .run(source.taskText + '\n', Buffer.byteLength(source.taskText + '\n'),
        createHash('sha256').update(source.taskText + '\n').digest('hex'), source.taskPath);
    closeSqlite(db);
    assert.equal(guarded(controller, prepared, after).code, 'PSE_PROVENANCE_STALE');
    assert.equal(controller.read('goal-1').snapshot.revision, 1);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('binds successful replay to the exact receipt digest and rejects destination collisions', () => {
  const cwd = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd); seedPair(cwd, source);
    const prepared = prepare(controller, source);
    assert.equal(guarded(controller, prepared, after).code, 'PSE_TRANSITION_COMMITTED');
    const altered = guarded(controller, prepared, after, { receipt: 'e'.repeat(64) });
    assert.equal(altered.code, 'REQUEST_ID_CONFLICT');
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }

  const cwd2 = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd2); seedPair(cwd2, source); seedPair(cwd2, after);
    const prepared = prepare(controller, source);
    const result = guarded(controller, prepared, after);
    assert.equal(result.code, 'PSE_DESTINATION_COLLISION');
    assert.equal(result.audited, false);
    assert.equal(controller.read('goal-1').snapshot.revision, 1);
    assert.equal(dbRows(cwd2).preparation[0].consumed_audit_seq, null);
    controller.close();
  } finally { rmSync(cwd2, { recursive: true, force: true }); }
});

test('enforces binary/metadata bounds and deterministic corruption codes', () => {
  const cwd = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd); seedPair(cwd, source);
    const prepared = prepare(controller, source);
    const oversized = new Uint8Array(1024 * 1024 + 1);
    const invalid = guarded(controller, prepared, after, { taskBytes: oversized, requestId: 'oversized' });
    assert.equal(invalid.code, 'INVALID_CONTROLLER_REQUEST');
    assert.equal(invalid.audited, true);

    let db = openSqlite(cwd);
    db.prepare('UPDATE process_controller_pse_preparation SET payload_json=?').run('{}');
    closeSqlite(db);
    assert.equal(guarded(controller, prepared, after, { requestId: 'corrupt-preparation' }).code, 'PSE_PROVENANCE_INVALID');
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }

  const cwd2 = fixture();
  try {
    const source = pair(); const controller = initializeActive(cwd2); seedPair(cwd2, source);
    let db = openSqlite(cwd2);
    db.prepare('UPDATE qe_files SET sha256=? WHERE path=?').run('0'.repeat(64), source.taskPath);
    closeSqlite(db);
    assert.equal(prepare(controller, source).code, 'PSE_ARTIFACT_CORRUPT');
    controller.close();
  } finally { rmSync(cwd2, { recursive: true, force: true }); }
});

test('maps pending, active, held, resume, stay, and completion to the Goal kernel exactly', () => {
  const cwd = fixture();
  try {
    const pending = pair({ lane: 'pending', status: 'pending', taskChecks: [false], checklistChecks: [false, false] });
    const active = pair({ taskChecks: [false], checklistChecks: [false, false] });
    const held = pair({ lane: 'on-hold', status: 'in-progress', taskChecks: [false], checklistChecks: [false, false] });
    const checked = pair({ taskChecks: [true], checklistChecks: [true, true] });
    const completed = pair({ lane: 'completed', status: 'completed', taskChecks: [true], checklistChecks: [true, true] });
    const controller = goal(cwd);
    assert.equal(controller.initialize({ processId: 'goal-1', requestId: 'init' }).code, 'INITIALIZED');
    seedPair(cwd, pending);

    let prepared = prepare(controller, pending, 'prep-pending');
    let result = guarded(controller, prepared, active, { requestId: 'to-active', to: 'active', expectedRevision: 0,
      attestations: null, humanAcceptance: null });
    assert.equal(result.consistency.transition, 'ADVANCE_TO_ACTIVE');

    prepared = prepare(controller, active, 'prep-active');
    result = guarded(controller, prepared, held, { requestId: 'to-held', to: 'blocked', expectedRevision: 1,
      attestations: null, humanAcceptance: null });
    assert.equal(result.consistency.transition, 'HOLD');

    prepared = prepare(controller, held, 'prep-held');
    result = guarded(controller, prepared, active, { requestId: 'resume', to: 'active', expectedRevision: 2,
      resume: { class: 'on-hold', taskChecks: [false], checklistChecks: [false, false] },
      attestations: null, humanAcceptance: null });
    assert.equal(result.consistency.transition, 'RESUME');

    prepared = prepare(controller, active, 'prep-stay');
    result = guarded(controller, prepared, checked, { requestId: 'stay', to: 'active', expectedRevision: 3,
      attestations: null, humanAcceptance: null });
    assert.equal(result.consistency.transition, 'STAY_ACTIVE');
    assert.equal(controller.read('goal-1').snapshot.revision, 3);

    prepared = prepare(controller, checked, 'prep-complete');
    const evidence = completionEvidence(3);
    result = guarded(controller, prepared, completed, { requestId: 'complete', to: 'complete', expectedRevision: 3,
      attestations: evidence.attestations, humanAcceptance: evidence.humanAcceptance });
    assert.equal(result.consistency.transition, 'COMPLETE');
    assert.equal(controller.read('goal-1').snapshot.state, 'complete');
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rolls back every pre-commit fault and recovers after-commit success', async () => {
  const points = ['before-artifact-write', 'between-artifact-writes', 'between-artifact-and-state',
    'between-state-and-audit', 'before-commit', 'after-commit'];
  const { createHash } = await import('node:crypto');
  for (const point of points) {
    const cwd = fixture();
    try {
      const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
      let controller = initializeActive(cwd); let db = openSqlite(cwd); const now = Date.now();
      const put = db.prepare(`INSERT INTO qe_files VALUES(?,?, 'utf8', ?,420,?,?,?)`);
      for (const [path, text] of [[source.taskPath, source.taskText], [source.checklistPath, source.checklistText]]) {
        const bytes = Buffer.from(text); put.run(path, text, bytes.length, now, createHash('sha256').update(bytes).digest('hex'), now);
      }
      closeSqlite(db);
      const prepared = prepare(controller, source); controller.close();
      let fired = false;
      controller = goal(cwd, { faultInjector(current) { if (!fired && current === point) { fired = true; throw new Error(point); } } });
      const result = guarded(controller, prepared, after);
      const committed = point === 'after-commit';
      assert.equal(result.code, committed ? 'PSE_TRANSITION_COMMITTED' : 'STORE_UNAVAILABLE', point);
      assert.equal(controller.read('goal-1').snapshot.revision, committed ? 2 : 1, point);
      const paths = dbRows(cwd).files.map(row => row.path);
      assert.equal(paths.includes(after.taskPath), committed, point);
      controller.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

function childResult(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('serializes distinct request writers to one commit and one stale result', async () => {
  const cwd = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd); const { createHash } = await import('node:crypto');
    const db = openSqlite(cwd); const now = Date.now();
    const put = db.prepare(`INSERT INTO qe_files VALUES(?,?, 'utf8', ?,420,?,?,?)`);
    for (const [path, text] of [[source.taskPath, source.taskText], [source.checklistPath, source.checklistText]]) {
      const bytes = Buffer.from(text); put.run(path, text, bytes.length, now, createHash('sha256').update(bytes).digest('hex'), now);
    }
    closeSqlite(db); const prepared = prepare(controller, source); controller.close();
    const moduleUrl = new URL('../process-controller.mjs', import.meta.url).href;
    const encoded = JSON.stringify({ prepared, after: { ...after, taskBytes: [...after.taskBytes], checklistBytes: [...after.checklistBytes] }, evidence: completionEvidence() });
    const child = `import {createProcessController} from ${JSON.stringify(moduleUrl)};const x=JSON.parse(process.env.DATA);const c=createProcessController({cwd:process.env.PC_CWD,layer:'goal',authority:'goal-controller'});const r=c.guardedPseTransition({processId:'goal-1',requestId:process.env.ID,to:'complete',expectedRevision:1,receipt:x.prepared.receipt,taskPath:x.after.taskPath,taskBytes:new Uint8Array(x.after.taskBytes),checklistPath:x.after.checklistPath,checklistBytes:new Uint8Array(x.after.checklistBytes),resume:null,attestations:x.evidence.attestations,humanAcceptance:x.evidence.humanAcceptance});c.close();process.stdout.write(JSON.stringify({code:r.code,replayed:r.replayed}));`;
    const results = await Promise.all([childResult(child, { PC_CWD: cwd, ID: 'race-a', DATA: encoded }), childResult(child, { PC_CWD: cwd, ID: 'race-b', DATA: encoded })]);
    assert.deepEqual(results.map(r => r.status), [0, 0]);
    assert.deepEqual(results.map(r => JSON.parse(r.stdout).code).sort(), ['PSE_PROVENANCE_STALE', 'PSE_TRANSITION_COMMITTED']);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('serializes the same request to one commit and one exact replay', async () => {
  const cwd = fixture();
  try {
    const source = pair(); const after = pair({ lane: 'completed', status: 'completed' });
    const controller = initializeActive(cwd); seedPair(cwd, source);
    const prepared = prepare(controller, source); controller.close();
    const moduleUrl = new URL('../process-controller.mjs', import.meta.url).href;
    const encoded = JSON.stringify({ prepared,
      after: { ...after, taskBytes: [...after.taskBytes], checklistBytes: [...after.checklistBytes] },
      evidence: completionEvidence() });
    const child = `import {createProcessController} from ${JSON.stringify(moduleUrl)};const x=JSON.parse(process.env.DATA);const c=createProcessController({cwd:process.env.PC_CWD,layer:'goal',authority:'goal-controller'});const r=c.guardedPseTransition({processId:'goal-1',requestId:'same-race',to:'complete',expectedRevision:1,receipt:x.prepared.receipt,taskPath:x.after.taskPath,taskBytes:new Uint8Array(x.after.taskBytes),checklistPath:x.after.checklistPath,checklistBytes:new Uint8Array(x.after.checklistBytes),resume:null,attestations:x.evidence.attestations,humanAcceptance:x.evidence.humanAcceptance});c.close();process.stdout.write(JSON.stringify({code:r.code,replayed:r.replayed}));`;
    const results = await Promise.all([childResult(child, { PC_CWD: cwd, DATA: encoded }), childResult(child, { PC_CWD: cwd, DATA: encoded })]);
    assert.deepEqual(results.map(r => r.status), [0, 0]);
    const parsed = results.map(r => JSON.parse(r.stdout));
    assert.deepEqual(parsed.map(r => r.code), ['PSE_TRANSITION_COMMITTED', 'PSE_TRANSITION_COMMITTED']);
    assert.deepEqual(parsed.map(r => r.replayed).sort(), [false, true]);
    assert.equal(dbRows(cwd).audit.length, 3);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('reports controller corruption before preparation mutation', () => {
  const cwd = fixture();
  try {
    const source = pair(); const controller = initializeActive(cwd); seedPair(cwd, source);
    const db = openSqlite(cwd);
    db.prepare('UPDATE process_controller_state SET snapshot_json=? WHERE process_id=?').run('{}', 'goal-1');
    closeSqlite(db);
    const result = prepare(controller, source);
    assert.equal(result.code, 'CONTROLLER_CORRUPT');
    assert.equal(result.audited, false);
    controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
