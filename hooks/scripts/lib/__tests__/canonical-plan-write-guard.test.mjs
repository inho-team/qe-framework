import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { createGoals, advanceGoal, runGoalEvidence, setGoalAcceptance, createLifecycleOperation, recordEvent } from '../ledger.mjs';
import { openSqlite, closeSqlite } from '../store-sqlite.mjs';
import { canonicalJson, sha256 } from '../process-controller-store.mjs';

const SLUG = 'demo-plan';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'canonical-plan-guard-'));
  mkdirSync(join(dir, '.qe', 'planning', 'plans', SLUG), { recursive: true });
  return dir;
}

function spawnNode(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function acceptanceContract() {
  return {
    schema: 2,
    goalId: 'G001',
    goalShape: {
      outcomes: [{ id: 'O001', statement: 'first objective',
        completionMetric: 'node --test --help passes' }],
      allowedPaths: ['hooks/scripts/lib/ledger.mjs'],
      nonGoals: ['no extra scope'],
      dependencies: [],
    },
    requirements: [{ id: 'R001', outcomeId: 'O001', criterion: 'runs', command: 'node --test --help' }],
    scenarios: [{ id: 'S001', outcomeId: 'O001', kind: 'user-journey', scenario: 'a user runs the goal', expected: 'evidence is recorded', command: 'node --test --help' }],
    regression: { outcomeId: 'O001', scope: 'ledger evidence', command: 'node --test --help' },
    humanAcceptance: { required: false },
    goalAlignment: { objective: 'first objective', outcomeId: 'O001', rationale: 'keeps the objective stable' },
    riskAssessment: { categories: ['none'], rationale: 'no added risk' },
  };
}

function defineAcceptance(cwd) {
  const contract = acceptanceContract();
  const file = join(cwd, 'acceptance.json');
  writeFileSync(file, JSON.stringify(contract), 'utf8');
  setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file });
}

test('run evidence reruns create a new generation and archive the prior current record', () => {
  const cwd = makeProject();
  const priorRoot = process.env.QE_ROOT;
  try {
    process.env.QE_ROOT = cwd;
    createGoals(cwd, SLUG, ['First::first objective']);
    defineAcceptance(cwd);
    advanceGoal(cwd, SLUG, { sessionId: '11111111-1111-4111-8111-111111111111' });

    const first = runGoalEvidence(cwd, SLUG, {
      goalId: 'G001',
      role: 'implementation',
      sessionId: '11111111-1111-1111-1111-111111111111',
    });
    const second = runGoalEvidence(cwd, SLUG, {
      goalId: 'G001',
      role: 'implementation',
      sessionId: '22222222-2222-2222-2222-222222222222',
    });

    assert.ok(first.runId);
    assert.ok(second.runId);
    assert.notEqual(second.runId, first.runId);
    const db = openSqlite(cwd, { readOnly: true });
    const current = JSON.parse(db.prepare('SELECT content FROM qe_files WHERE path=?')
      .get(`.qe/planning/plans/${SLUG}/evidence/G001.implementation-run.json`).content);
    assert.equal(current.runId, second.runId);
    assert.equal(current.sessionId, '22222222-2222-2222-2222-222222222222');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM qe_files WHERE path=?')
      .get(`.qe/planning/plans/${SLUG}/evidence/runs/G001.implementation.${first.runId}.json`).count, 1);
    closeSqlite(db);
  } finally {
    if (priorRoot === undefined) delete process.env.QE_ROOT;
    else process.env.QE_ROOT = priorRoot;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('canonical plan import fails closed when disk has a stale goals.json without a DB row', () => {
  const cwd = makeProject();
  try {
    const stale = join(cwd, '.qe', 'planning', 'plans', SLUG, 'goals.json');
    writeFileSync(stale, JSON.stringify({ planSlug: SLUG, schema: 1, createdAt: '2026-08-05T00:00:00.000Z', goals: [] }), 'utf8');

    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const { createGoals } = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const out = createGoals(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, ['First::first objective']);
      console.log(JSON.stringify(out));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'CANONICAL_BACKEND_CONFLICT');
    assert.equal(parsed.reason, 'stale disk goals.json without DB row');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('lifecycle journal stores a final parent manifest and schema seal', () => {
  const cwd = makeProject();
  try {
    const result = createLifecycleOperation(cwd, SLUG, {
      operationId: '11111111-1111-4111-8111-111111111111',
      semanticKey: 'semantic-1',
      kind: 'test',
      payload: { action: 'test' },
      children: [
        { layer: 'goal', operation: 'initialize', processId: 'goal-a' },
      ],
    });
    assert.equal(result.code, 'CREATED');
    const db = openSqlite(cwd);
    const row = db.prepare('SELECT roster_json, roster_digest, finalized FROM lifecycle_operations WHERE operation_id=?')
      .get('11111111-1111-4111-8111-111111111111');
    const seal = db.prepare('SELECT name, version FROM qe_schema_seals WHERE name=?').get('lifecycle-journal-immutability');
    closeSqlite(db);
    assert.equal(row.finalized, 1);
    assert.ok(Array.isArray(JSON.parse(row.roster_json)));
    assert.equal(seal.name, 'lifecycle-journal-immutability');
    assert.equal(seal.version, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('recordEvent rejects accessor-backed records before JSONL append', () => {
  const cwd = makeProject();
  try {
    createGoals(cwd, SLUG, ['First::first objective']);
    const event = {};
    Object.defineProperty(event, 'ts', { enumerable: true, get() { throw new Error('getter should not run'); } });
    event.event = 'checkpoint';
    event.goalId = 'G001';
    event.status = 'active';
    event.evidence = 'evidence';
    event.attempt = 0;

    assert.throws(() => recordEvent(cwd, SLUG, event), /CANONICAL_STORE_INVALID/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('canonical root plan writes goals, ledger, state, and evidence identities inside one DB-authoritative transaction', () => {
  const cwd = makeProject();
  try {
    const acceptance = acceptanceContract();
    writeFileSync(join(cwd, 'acceptance.json'), JSON.stringify(acceptance), 'utf8');
    const completion = {
      schema: 1, goalId: 'G001',
      requirements: [{ id: 'R001', outcome: 'pass', evidence: 'run passed' }],
      scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'scenario passed' }],
      regression: { outcome: 'pass', evidence: 'regression passed' },
      independentVerification: { verifier: 'root-test-verifier', mode: 'machine-reexecution', outcome: 'pass', evidence: 'fresh session passed' },
      goalAlignment: { objective: 'first objective', outcomeId: 'O001', verifier: 'root-test-verifier', outcome: 'pass', evidence: 'aligned' },
      humanAcceptance: { status: 'not-required', evidence: '' }, limitations: [],
    };
    writeFileSync(join(cwd, 'completion.json'), JSON.stringify(completion), 'utf8');
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const ledger = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const { openSqlite } = await import(${JSON.stringify(new URL('../store-sqlite.mjs', import.meta.url).href)});
      ledger.createGoals(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, ['First::first objective']);
      ledger.setGoalAcceptance(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', file: ${JSON.stringify(join(cwd, 'acceptance.json'))} });
      ledger.setGoalAcceptance(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', file: ${JSON.stringify(join(cwd, 'acceptance.json'))} });
      ledger.append(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', event: 'started', status: 'active' });
      const firstRun = ledger.runGoalEvidence(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', role: 'implementation', sessionId: '11111111-1111-4111-8111-111111111111' });
      const secondRun = ledger.runGoalEvidence(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', role: 'implementation', sessionId: '22222222-2222-4222-8222-222222222222' });
      ledger.runGoalEvidence(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', role: 'verification', verifier: 'root-test-verifier', sessionId: '33333333-3333-4333-8333-333333333333' });
      ledger.recordGoalEvidence(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', file: ${JSON.stringify(join(cwd, 'completion.json'))} });
      ledger.recordGoalEvidence(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', file: ${JSON.stringify(join(cwd, 'completion.json'))} });
      ledger.renderState(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)});
      const db = openSqlite(${JSON.stringify(cwd)}, { readOnly: true });
      const goals = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/goals.json').content;
      const ledgerText = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/ledger.jsonl').content;
      const state = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/STATE.md').content;
      const acceptanceRow = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/evidence/G001.acceptance.json').content;
      const currentRun = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/evidence/G001.implementation-run.json').content;
      const historyRun = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/evidence/runs/G001.implementation.' + firstRun.runId + '.json').content;
      const completionRow = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/evidence/G001.completion.json').content;
      const identity = db.prepare('SELECT operation, artifact_path FROM plan_write_identities WHERE slug=? AND goal_id=? ORDER BY created_at').all(${JSON.stringify(SLUG)}, 'G001');
      db.close();
      console.log(JSON.stringify({ goals, ledgerText, state, acceptanceRow, currentRun, historyRun, completionRow, firstRun, secondRun, identity }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, QE_ROOT: cwd },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.match(parsed.goals, /"acceptance"/);
    assert.match(parsed.ledgerText, /"event":"created"/);
    assert.match(parsed.ledgerText, /"event":"checkpoint"/);
    assert.equal((parsed.ledgerText.match(/"event":"checkpoint"/g) || []).length, 1);
    assert.match(parsed.state, /Status: active/);
    assert.match(parsed.acceptanceRow, /"goalId": "G001"/);
    assert.equal(JSON.parse(parsed.currentRun).runId, parsed.secondRun.runId);
    assert.equal(JSON.parse(parsed.historyRun).runId, parsed.firstRun.runId);
    assert.notEqual(parsed.firstRun.invocationId, parsed.secondRun.invocationId);
    assert.equal(JSON.parse(parsed.completionRow).goalId, 'G001');
    assert.equal((parsed.ledgerText.match(/completion=evidence\/G001\.completion\.json/g) || []).length, 1);
    assert.ok(Array.isArray(parsed.identity));
    assert.ok(parsed.identity.length >= 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('canonical root serializes concurrent append and run-evidence generations without losing a ledger suffix', async () => {
  const cwd = makeProject();
  try {
    const ledgerUrl = new URL('../ledger.mjs', import.meta.url).href;
    const acceptance = acceptanceContract();
    writeFileSync(join(cwd, 'acceptance.json'), JSON.stringify(acceptance), 'utf8');
    const setup = `
      process.env.QE_ROOT=process.env.CWD;
      const m=await import(${JSON.stringify(ledgerUrl)});
      m.createGoals(process.env.CWD,'${SLUG}',['First::first objective']);
      m.setGoalAcceptance(process.env.CWD,'${SLUG}',{goalId:'G001',file:process.env.ACCEPTANCE});
      m.append(process.env.CWD,'${SLUG}',{goalId:'G001',event:'started',status:'active'});
    `;
    const setupResult = await spawnNode(setup, { CWD: cwd, ACCEPTANCE: join(cwd, 'acceptance.json') });
    assert.equal(setupResult.status, 0, setupResult.stderr);
    const appendSource = `
      process.env.QE_ROOT=process.env.CWD;
      const m=await import(${JSON.stringify(ledgerUrl)});
      m.append(process.env.CWD,'${SLUG}',{goalId:'G001',event:'checkpoint',evidence:process.env.EVIDENCE});
    `;
    const appendResults = await Promise.all([
      spawnNode(appendSource, { CWD: cwd, EVIDENCE: 'race-a' }),
      spawnNode(appendSource, { CWD: cwd, EVIDENCE: 'race-b' }),
    ]);
    assert.deepEqual(appendResults.map(item => item.status), [0, 0], appendResults.map(item => item.stderr).join('\n'));
    const runSource = `
      process.env.QE_ROOT=process.env.CWD;
      const m=await import(${JSON.stringify(ledgerUrl)});
      const result=m.runGoalEvidence(process.env.CWD,'${SLUG}',{goalId:'G001',role:'implementation',sessionId:process.env.SESSION});
      process.stdout.write(JSON.stringify(result));
    `;
    const runResults = await Promise.all([
      spawnNode(runSource, { CWD: cwd, SESSION: '11111111-1111-4111-8111-111111111111' }),
      spawnNode(runSource, { CWD: cwd, SESSION: '22222222-2222-4222-8222-222222222222' }),
    ]);
    assert.deepEqual(runResults.map(item => item.status), [0, 0], runResults.map(item => item.stderr).join('\n'));
    const runs = runResults.map(item => JSON.parse(item.stdout));
    assert.notEqual(runs[0].runId, runs[1].runId);
    const db = new DatabaseSync(join(cwd, '.qe', 'qe.db'), { readOnly: true });
    const ledgerText = db.prepare('SELECT content FROM qe_files WHERE path=?')
      .get(`.qe/planning/plans/${SLUG}/ledger.jsonl`).content;
    const histories = db.prepare("SELECT path FROM qe_files WHERE path LIKE ?")
      .all(`.qe/planning/plans/${SLUG}/evidence/runs/G001.implementation.%`);
    db.close();
    assert.match(ledgerText, /race-a/);
    assert.match(ledgerText, /race-b/);
    assert.equal((ledgerText.match(/implementation-run=/g) || []).length, 2);
    assert.equal(histories.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('legacy lifecycle tables backfill roster columns and install guard triggers', () => {
  const cwd = makeProject();
  try {
    const dbPath = join(cwd, '.qe', 'qe.db');
    const intentDigest = sha256(canonicalJson([
      'qe-lifecycle-intent-v1',
      1,
      'journal-test',
      'semantic-1',
      'test',
      {},
      [{ ordinal: 0, layer: 'goal', operation: 'initialize', processId: 'goal-a' }],
    ]));
    const requestId = sha256(canonicalJson([
      'qe-lifecycle-child-v1', 'journal-test', '11111111-1111-4111-8111-111111111111',
      0, 'goal', 'initialize', 'goal-a',
    ]));
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE lifecycle_operations(
        slug TEXT NOT NULL,
        operation_id TEXT PRIMARY KEY,
        semantic_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        intent_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        current_ordinal INTEGER NOT NULL,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(slug, semantic_key)
      );
      CREATE TABLE lifecycle_operation_children(
        operation_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        layer TEXT NOT NULL,
        operation_kind TEXT NOT NULL,
        process_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        claim_owner TEXT,
        claim_token TEXT,
        lease_until INTEGER,
        result_ref_json TEXT,
        PRIMARY KEY(operation_id, ordinal),
        UNIQUE(operation_id, request_id)
      );
      INSERT INTO lifecycle_operations VALUES(
        'journal-test','11111111-1111-4111-8111-111111111111','semantic-1','test','{}','${intentDigest}','pending',0,NULL,1,1
      );
      INSERT INTO lifecycle_operation_children VALUES(
        '11111111-1111-4111-8111-111111111111',0,'goal','initialize','goal-a','${requestId}','{"processId":"goal-a","requestId":"${requestId}"}','pending',0,NULL,NULL,NULL,NULL
      );
    `);
    db.close();
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const { createLifecycleOperation } = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const { openSqlite } = await import(${JSON.stringify(new URL('../store-sqlite.mjs', import.meta.url).href)});
      const result = createLifecycleOperation(${JSON.stringify(cwd)}, 'journal-test', {
        operationId: '11111111-1111-4111-8111-111111111111',
        semanticKey: 'semantic-1',
        kind: 'test',
        payload: {},
        children: [{ layer: 'goal', operation: 'initialize', processId: 'goal-a' }],
      });
      const replay = createLifecycleOperation(${JSON.stringify(cwd)}, 'journal-test', {
        operationId: '11111111-1111-4111-8111-111111111111',
        semanticKey: 'semantic-1',
        kind: 'test',
        payload: {},
        children: [{ layer: 'goal', operation: 'initialize', processId: 'goal-a' }],
      });
      const db = openSqlite(${JSON.stringify(cwd)});
      const row = db.prepare('SELECT roster_json, roster_digest, finalized FROM lifecycle_operations WHERE operation_id=?').get('11111111-1111-4111-8111-111111111111');
      const seal = db.prepare('SELECT name, version FROM qe_schema_seals WHERE name=?').get('lifecycle-journal-immutability');
      db.close();
      console.log(JSON.stringify({ result, replay, row, seal }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, QE_ROOT: cwd },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.result.code, 'REPLAYED');
    assert.equal(parsed.replay.code, 'REPLAYED');
    assert.equal(parsed.row.finalized, 1);
    assert.equal(parsed.seal.name, 'lifecycle-journal-immutability');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('partial lifecycle manifest migration fails closed without repairing the schema', () => {
  const cwd = makeProject();
  try {
    const raw = new DatabaseSync(join(cwd, '.qe', 'qe.db'));
    raw.exec(`
      CREATE TABLE lifecycle_operations(
        slug TEXT NOT NULL, operation_id TEXT PRIMARY KEY, semantic_key TEXT NOT NULL, kind TEXT NOT NULL,
        payload_json TEXT NOT NULL, intent_digest TEXT NOT NULL, roster_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL, current_ordinal INTEGER NOT NULL, result_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(slug, semantic_key)
      );
    `);
    raw.close();
    const result = createLifecycleOperation(cwd, SLUG, {
      operationId: '11111111-1111-4111-8111-111111111111', semanticKey: 'semantic-1',
      kind: 'test', payload: {}, children: [{ layer: 'goal', operation: 'initialize', processId: 'goal-a' }],
    });
    assert.equal(result.code, 'STORE_UNAVAILABLE');
    const check = new DatabaseSync(join(cwd, '.qe', 'qe.db'), { readOnly: true });
    const columns = check.prepare('PRAGMA table_info(lifecycle_operations)').all().map(row => row.name);
    const sealTable = check.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='qe_schema_seals'").get();
    check.close();
    assert.equal(columns.includes('roster_json'), true);
    assert.equal(columns.includes('roster_digest'), false);
    assert.equal(columns.includes('finalized'), false);
    assert.equal(sealTable, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('lifecycle trigger guards reject immutable parent, child, and seal mutations', () => {
  const cwd = makeProject();
  try {
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const { createLifecycleOperation } = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const { openSqlite } = await import(${JSON.stringify(new URL('../store-sqlite.mjs', import.meta.url).href)});
      createLifecycleOperation(${JSON.stringify(cwd)}, 'journal-test', {
        operationId: '11111111-1111-4111-8111-111111111111',
        semanticKey: 'semantic-1',
        kind: 'test',
        payload: {},
        children: [{ layer: 'goal', operation: 'initialize', processId: 'goal-a' }],
      });
      const db = openSqlite(${JSON.stringify(cwd)});
      const outcomes = [];
      for (const sql of [
        \"UPDATE lifecycle_operations SET slug='x' WHERE operation_id='11111111-1111-4111-8111-111111111111'\",
        \"UPDATE lifecycle_operations SET status='evil' WHERE operation_id='11111111-1111-4111-8111-111111111111'\",
        \"UPDATE lifecycle_operation_children SET request_json='{}' WHERE operation_id='11111111-1111-4111-8111-111111111111' AND ordinal=0\",
        \"UPDATE lifecycle_operation_children SET status='evil' WHERE operation_id='11111111-1111-4111-8111-111111111111' AND ordinal=0\",
        \"DELETE FROM lifecycle_operation_children WHERE operation_id='11111111-1111-4111-8111-111111111111' AND ordinal=0\",
        \"INSERT INTO qe_schema_seals(name,version,digest,installed_at) VALUES('lifecycle-journal-immutability',1,'x',1)\",
      ]) {
        try { db.exec(sql); outcomes.push('ok'); }
        catch (error) { outcomes.push(error.message); }
      }
      db.close();
      console.log(JSON.stringify(outcomes));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, QE_ROOT: cwd },
    });
    assert.equal(result.status, 0, result.stderr);
    const outcomes = JSON.parse(result.stdout.trim());
    assert.equal(outcomes.length, 6);
    assert.ok(outcomes.some(message => /no such function/i.test(message)), JSON.stringify(outcomes));
    assert.ok(outcomes.some(message => /LIFECYCLE_IMMUTABLE/i.test(message)), JSON.stringify(outcomes));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('canonical root validates the goals/ledger presence matrix and preserves official file modes', () => {
  const cwd = makeProject();
  try {
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const { createGoals } = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const { openSqlite } = await import(${JSON.stringify(new URL('../store-sqlite.mjs', import.meta.url).href)});
      createGoals(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, ['First::first objective']);
      let db = openSqlite(${JSON.stringify(cwd)});
      const goalsPath = '.qe/planning/plans/${SLUG}/goals.json';
      const ledgerPath = '.qe/planning/plans/${SLUG}/ledger.jsonl';
      db.prepare('UPDATE qe_files SET mode=? WHERE path=?').run(0o100644, goalsPath);
      db.close();
      const replay = createGoals(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, []);
      db = openSqlite(${JSON.stringify(cwd)});
      const mode = db.prepare('SELECT mode FROM qe_files WHERE path=?').get(goalsPath).mode;
      db.prepare('DELETE FROM qe_files WHERE path=?').run(ledgerPath);
      db.close();
      let missingCode = null;
      try { createGoals(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, []); }
      catch (error) { missingCode = error.code; }
      console.log(JSON.stringify({ replay, mode, missingCode }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, QE_ROOT: cwd },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.replay.skipped, true);
    assert.equal(parsed.mode, 0o100644);
    assert.equal(parsed.missingCode, 'CANONICAL_STORE_INVALID');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('lifecycle seal detects trigger tamper and raw SQLite lacks the roster UDF', () => {
  const cwd = makeProject();
  try {
    const created = createLifecycleOperation(cwd, SLUG, {
      operationId: '11111111-1111-4111-8111-111111111111',
      semanticKey: 'semantic-1', kind: 'test', payload: {},
      children: [{ layer: 'goal', operation: 'initialize', processId: 'goal-a' }],
    });
    assert.equal(created.code, 'CREATED');
    const raw = new DatabaseSync(join(cwd, '.qe', 'qe.db'));
    assert.throws(() => raw.exec(`
      INSERT INTO lifecycle_operations
      (slug,operation_id,semantic_key,kind,payload_json,intent_digest,roster_json,roster_digest,finalized,status,current_ordinal,result_json,created_at,updated_at)
      VALUES('demo-plan','22222222-2222-4222-8222-222222222222','semantic-2','test','{}','x','[]','x',0,'pending',0,NULL,1,1)
    `), /no such function: qe_lifecycle_roster_digest_v1/);
    raw.exec('DROP TRIGGER lifecycle_operations_parent_delete_guard');
    raw.close();
    assert.equal(createLifecycleOperation(cwd, SLUG, {
      operationId: '22222222-2222-4222-8222-222222222222',
      semanticKey: 'semantic-2', kind: 'test', payload: {},
      children: [{ layer: 'goal', operation: 'initialize', processId: 'goal-b' }],
    }).code, 'STORE_UNAVAILABLE');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
