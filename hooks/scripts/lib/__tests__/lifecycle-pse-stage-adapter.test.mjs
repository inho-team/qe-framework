import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { createProcessController } from '../process-controller.mjs';
import { projectPseImmutableGeneration } from '../pse-artifact-identity.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const encoder = new TextEncoder();
const uuid = 'dddddddd';

function fixture() { return mkdtempSync(join(tmpdir(), 'qe-pse-stage-')); }
function controller(cwd, extra = {}) {
  return createProcessController({ cwd, layer: 'pse', authority: 'pse-controller', ...extra });
}
function pair({ lane = 'in-progress', status = lane === 'pending' ? 'pending'
  : lane === 'completed' ? 'completed' : 'in-progress', checked = false } = {}) {
  const taskPath = `.qe/tasks/${lane}/TASK_REQUEST_${uuid}.md`;
  const checklistPath = `.qe/checklists/${lane}/VERIFY_CHECKLIST_${uuid}.md`;
  const mark = checked ? 'x' : ' ';
  const taskText = `# TASK_REQUEST_${uuid}.md — T\n<!-- qe-doc-frontmatter\nkind: spec\nuuid: ${uuid}\nplan: p\nphase: "P"\ncreated: "2026-08-07"\nstatus: ${status}\nlinks:\n  - "[[${checklistPath}]]"\n-->\n\n## 체크리스트\n- [${mark}] task\n`;
  const checklistText = `# VERIFY_CHECKLIST_${uuid}.md — V\n<!-- qe-doc-frontmatter\nkind: verify\nuuid: ${uuid}\nplan: p\nphase: "P"\ncreated: "2026-08-07"\nstatus: ${status}\nlinks:\n  - "[[${taskPath}]]"\n-->\n\n## 검증 기준\n- [${mark}] verify\n\n## 프레임워크 무결성 체크\n- [${mark}] wire\n`;
  return { taskPath, taskText, taskBytes: encoder.encode(taskText), checklistPath,
    checklistText, checklistBytes: encoder.encode(checklistText) };
}

function putPair(cwd, value, { clear = false } = {}) {
  const db = openSqlite(cwd); const now = Date.now();
  if (clear) db.prepare("DELETE FROM qe_files WHERE path LIKE ? OR path LIKE ?")
    .run(`.qe/tasks/%/TASK_REQUEST_${uuid}.md`, `.qe/checklists/%/VERIFY_CHECKLIST_${uuid}.md`);
  const put = db.prepare(`INSERT OR REPLACE INTO qe_files
    (path,content,encoding,size,mode,mtime_ms,sha256,migrated_at) VALUES(?,?,'utf8',?,420,?,?,?)`);
  for (const [path, text] of [[value.taskPath, value.taskText], [value.checklistPath, value.checklistText]]) {
    const bytes = Buffer.from(text); put.run(path, text, bytes.length, now,
      createHash('sha256').update(bytes).digest('hex'), now);
  }
  closeSqlite(db);
}

function initialize(cwd, processId = 'pse-1') {
  const value = controller(cwd);
  assert.equal(value.initialize({ processId, requestId: 'init' }).code, 'INITIALIZED');
  return value;
}

function bind(value, source, overrides = {}) {
  return value.bindPseTask({ processId: 'pse-1', requestId: 'bind-1',
    taskPath: source.taskPath, checklistPath: source.checklistPath, ...overrides });
}

function stage(value, bound, source, overrides = {}) {
  return value.transitionPseStage({ processId: 'pse-1', requestId: 'stage-1',
    action: 'forward', binding: bound.binding, expectedRevision: 0,
    taskPath: source.taskPath, checklistPath: source.checklistPath, ...overrides });
}

test('projects one exact frozen immutable generation without changing legacy identity behavior', () => {
  const before = pair({ lane: 'pending', checked: false });
  const after = pair({ lane: 'completed', checked: true });
  const input = value => ({ taskPath: value.taskPath, taskBytes: value.taskBytes,
    checklistPath: value.checklistPath, checklistBytes: value.checklistBytes });
  const first = projectPseImmutableGeneration(input(before));
  const second = projectPseImmutableGeneration(input(after));
  assert.equal(first.code, 'IMMUTABLE_PROJECTED');
  assert.equal(first.projection.immutableDigest, second.projection.immutableDigest);
  assert.match(first.projection.immutableDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.projection.taskItems), true);
  assert.deepEqual(Object.keys(first), ['ok', 'code', 'projection']);
});

test('exposes methods on every facade and globally rejects invalid layer and authority', () => {
  const cwd = fixture();
  try {
    const pse = controller(cwd); const source = pair();
    assert.equal(typeof pse.bindPseTask, 'function');
    assert.equal(typeof pse.transitionPseStage, 'function');
    assert.equal(pse.bindPseTask({}).code, 'INVALID_CONTROLLER_REQUEST');
    const goal = createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' });
    assert.equal(goal.bindPseTask({ processId: 'x', requestId: 'x', taskPath: source.taskPath,
      checklistPath: source.checklistPath }).code, 'PSE_LAYER_UNSUPPORTED');
    const wrong = createProcessController({ cwd, layer: 'pse', authority: 'forged' });
    assert.equal(wrong.bindPseTask({ processId: 'x', requestId: 'x', taskPath: source.taskPath,
      checklistPath: source.checklistPath }).code, 'AUTHORITY_DENIED');
    pse.close(); goal.close(); wrong.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('seals one binding and separates original retry from fresh current-lane rebinding', () => {
  const cwd = fixture();
  try {
    const pending = pair({ lane: 'pending' }); const active = pair();
    const value = initialize(cwd); putPair(cwd, pending);
    const issued = bind(value, pending);
    assert.equal(issued.code, 'PSE_TASK_BOUND'); assert.equal(issued.replayed, false);
    assert.match(issued.binding, /^[0-9a-f]{64}$/); assert.equal(Object.isFrozen(issued), true);
    putPair(cwd, active, { clear: true });
    assert.equal(bind(value, pending).binding, issued.binding);
    const fresh = bind(value, active, { requestId: 'bind-fresh' });
    assert.equal(fresh.binding, issued.binding); assert.equal(fresh.replayed, true);
    const conflict = bind(value, active, { requestId: 'bind-1' });
    assert.equal(conflict.code, 'REQUEST_ID_CONFLICT');
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rejects duplicate lineage, foreign tokens, and immutable drift without audit mutation', () => {
  const cwd = fixture();
  try {
    const source = pair(); const duplicate = pair({ lane: 'pending' });
    const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source);
    putPair(cwd, duplicate);
    assert.equal(stage(value, issued, source).code, 'PSE_TASK_BINDING_MISMATCH');
    assert.equal(stage(value, { binding: 'f'.repeat(64) }, source).code, 'PSE_TASK_BINDING_INVALID');
    assert.equal(value.audit('pse-1').length, 1);
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('advances, blocks, resumes, and never exposes completion through the adapter', () => {
  const cwd = fixture();
  try {
    const source = pair(); const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source);
    let result = stage(value, issued, source);
    assert.deepEqual([result.code, result.to, result.replayed], ['PSE_STAGE_TRANSITION_COMMITTED', 'knowledge', false]);
    assert.equal(stage(value, issued, source).replayed, true);
    result = stage(value, issued, source, { requestId: 'block', action: 'block', expectedRevision: 1 });
    assert.equal(result.to, 'blocked');
    assert.deepEqual(value.read('pse-1').snapshot, { state: 'blocked', revision: 2, resumeState: 'knowledge' });
    result = stage(value, issued, source, { requestId: 'resume', action: 'resume', expectedRevision: 2 });
    assert.equal(result.to, 'knowledge');
    for (const [requestId, expectedRevision, to] of [['f2', 3, 'spec'], ['f3', 4, 'execute'], ['f4', 5, 'verify']]) {
      result = stage(value, issued, source, { requestId, expectedRevision }); assert.equal(result.to, to);
    }
    assert.equal(stage(value, issued, source, { requestId: 'no-complete', expectedRevision: 6 }).code,
      'PSE_STAGE_COMPLETION_UNSUPPORTED');
    assert.equal(value.read('pse-1').snapshot.state, 'verify');
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('denies every action without a defined target while preserving revision', () => {
  const cwd = fixture();
  try {
    const source = pair(); const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source);
    assert.equal(stage(value, issued, source, { requestId: 'resume-plan', action: 'resume' }).code,
      'PSE_STAGE_ACTION_DENIED');
    assert.equal(stage(value, issued, source, { requestId: 'block-plan', action: 'block' }).code,
      'PSE_STAGE_TRANSITION_COMMITTED');
    assert.equal(stage(value, issued, source, { requestId: 'forward-blocked', expectedRevision: 1 }).code,
      'PSE_STAGE_ACTION_DENIED');
    assert.equal(stage(value, issued, source, { requestId: 'block-blocked', action: 'block', expectedRevision: 1 }).code,
      'PSE_STAGE_ACTION_DENIED');
    assert.equal(value.read('pse-1').snapshot.revision, 1);
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('partitions evidence stale, request conflict, and replay stale in fixed order', () => {
  const cwd = fixture();
  try {
    const source = pair(); const changed = pair({ checked: true });
    const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source);
    assert.equal(stage(value, issued, source).code, 'PSE_STAGE_TRANSITION_COMMITTED');
    assert.equal(stage(value, issued, source, { action: 'block' }).code, 'REQUEST_ID_CONFLICT');
    assert.equal(stage(value, issued, source, { requestId: 'next', expectedRevision: 1 }).code,
      'PSE_STAGE_TRANSITION_COMMITTED');
    assert.equal(stage(value, issued, source).code, 'PSE_STAGE_REPLAY_STALE');
    putPair(cwd, changed, { clear: true });
    assert.equal(stage(value, issued, changed).code, 'PSE_STAGE_EVIDENCE_STALE');
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('keeps bearer and artifact bytes out of the bounded audit request', () => {
  const cwd = fixture();
  try {
    const source = pair(); const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source);
    const result = stage(value, issued, source); const event = JSON.parse(value.audit('pse-1').at(-1).event_json);
    assert.equal(result.evidenceDigest, event.request.evidenceDigest);
    assert.equal(event.request.bindingSha256, createHash('sha256').update(issued.binding).digest('hex'));
    assert.equal(JSON.stringify(event).includes(issued.binding), false);
    assert.equal(JSON.stringify(event).includes(Buffer.from(source.taskBytes).toString('hex')), false);
    value.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('rolls back pre-commit faults and recovers a durable after-commit result', () => {
  for (const point of ['before-state', 'between-state-and-audit', 'before-commit', 'after-commit']) {
    const cwd = fixture();
    try {
      const source = pair(); let value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source);
      value.close(); let fired = false;
      value = controller(cwd, { faultInjector(name) { if (!fired && name === point) { fired = true; throw new Error(point); } } });
      const result = stage(value, issued, source);
      const committed = point === 'after-commit';
      assert.equal(result.code, committed ? 'PSE_STAGE_TRANSITION_COMMITTED' : 'STORE_UNAVAILABLE', point);
      assert.equal(value.read('pse-1').snapshot.revision, committed ? 1 : 0, point);
      value.close();
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

test('serializes same-request subprocess writers to one commit and one replay', async () => {
  const cwd = fixture();
  try {
    const source = pair(); const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source); value.close();
    const moduleUrl = new URL('../process-controller.mjs', import.meta.url).href;
    const code = `import {createProcessController} from ${JSON.stringify(moduleUrl)};const c=createProcessController({cwd:process.env.CWD_X,layer:'pse',authority:'pse-controller'});const p=JSON.parse(process.env.PAYLOAD);const r=c.transitionPseStage(p);c.close();process.stdout.write(JSON.stringify({code:r.code,replayed:r.replayed}));`;
    const payload = JSON.stringify({ processId: 'pse-1', requestId: 'race', action: 'forward',
      binding: issued.binding, expectedRevision: 0, taskPath: source.taskPath, checklistPath: source.checklistPath });
    const results = await Promise.all([childResult(code, { CWD_X: cwd, PAYLOAD: payload }),
      childResult(code, { CWD_X: cwd, PAYLOAD: payload })]);
    assert.deepEqual(results.map(item => item.status), [0, 0]);
    const parsed = results.map(item => JSON.parse(item.stdout));
    assert.deepEqual(parsed.map(item => item.code), ['PSE_STAGE_TRANSITION_COMMITTED', 'PSE_STAGE_TRANSITION_COMMITTED']);
    assert.deepEqual(parsed.map(item => item.replayed).sort(), [false, true]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('serializes distinct subprocess writers at one revision to commit and stale snapshot', async () => {
  const cwd = fixture();
  try {
    const source = pair(); const value = initialize(cwd); putPair(cwd, source); const issued = bind(value, source); value.close();
    const moduleUrl = new URL('../process-controller.mjs', import.meta.url).href;
    const code = `import {createProcessController} from ${JSON.stringify(moduleUrl)};const c=createProcessController({cwd:process.env.CWD_X,layer:'pse',authority:'pse-controller'});const p=JSON.parse(process.env.PAYLOAD);p.requestId=process.env.REQUEST_X;const r=c.transitionPseStage(p);c.close();process.stdout.write(JSON.stringify({code:r.code}));`;
    const payload = JSON.stringify({ processId: 'pse-1', action: 'forward', binding: issued.binding,
      expectedRevision: 0, taskPath: source.taskPath, checklistPath: source.checklistPath });
    const results = await Promise.all([childResult(code, { CWD_X: cwd, PAYLOAD: payload, REQUEST_X: 'race-a' }),
      childResult(code, { CWD_X: cwd, PAYLOAD: payload, REQUEST_X: 'race-b' })]);
    assert.deepEqual(results.map(item => item.status), [0, 0]);
    assert.deepEqual(results.map(item => JSON.parse(item.stdout).code).sort(),
      ['PSE_STAGE_TRANSITION_COMMITTED', 'STALE_SNAPSHOT']);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
