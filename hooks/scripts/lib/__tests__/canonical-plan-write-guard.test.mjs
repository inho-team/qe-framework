import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { createGoals, advanceGoal, runGoalEvidence, setGoalAcceptance, createLifecycleOperation, recordEvent } from '../ledger.mjs';
import { openSqlite, closeSqlite } from '../store-sqlite.mjs';

const SLUG = 'demo-plan';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'canonical-plan-guard-'));
  mkdirSync(join(dir, '.qe', 'planning', 'plans', SLUG), { recursive: true });
  return dir;
}

function defineAcceptance(cwd) {
  const contract = {
    schema: 1,
    goalId: 'G001',
    goalShape: {
      primaryOutcome: 'first objective',
      completionMetric: 'node --test --help passes',
      allowedPaths: ['hooks/scripts/lib/ledger.mjs'],
      nonGoals: ['no extra scope'],
      dependencies: [],
    },
    requirements: [{ id: 'R001', criterion: 'runs', command: 'node --test --help' }],
    scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'a user runs the goal', expected: 'evidence is recorded', command: 'node --test --help' }],
    regression: { scope: 'ledger evidence', command: 'node --test --help' },
    humanAcceptance: { required: false },
    goalAlignment: { objective: 'first objective', rationale: 'keeps the objective stable' },
    riskAssessment: { categories: ['none'], rationale: 'no added risk' },
  };
  const file = join(cwd, 'acceptance.json');
  writeFileSync(file, JSON.stringify(contract), 'utf8');
  setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file });
}

test('run evidence reruns create a new generation and archive the prior current record', () => {
  const cwd = makeProject();
  try {
    createGoals(cwd, SLUG, ['First::first objective']);
    defineAcceptance(cwd);
    advanceGoal(cwd, SLUG);

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
    const current = JSON.parse(readFileSync(join(cwd, '.qe', 'planning', 'plans', SLUG, 'evidence', 'G001.implementation-run.json'), 'utf8'));
    assert.equal(current.runId, second.runId);
    assert.equal(current.sessionId, '22222222-2222-2222-2222-222222222222');
    assert.ok(existsSync(join(cwd, '.qe', 'planning', 'plans', SLUG, 'evidence', 'runs', `G001.implementation.${first.runId}.json`)));
  } finally {
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
    const acceptance = {
      schema: 1,
      goalId: 'G001',
      goalShape: {
        primaryOutcome: 'first objective',
        completionMetric: 'node --test --help passes',
        allowedPaths: ['hooks/scripts/lib/ledger.mjs'],
        nonGoals: ['no extra scope'],
        dependencies: [],
      },
      requirements: [{ id: 'R001', criterion: 'runs', command: 'node --test --help' }],
      scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'a user runs the goal', expected: 'evidence is recorded', command: 'node --test --help' }],
      regression: { scope: 'ledger evidence', command: 'node --test --help' },
      humanAcceptance: { required: false },
      goalAlignment: { objective: 'first objective', rationale: 'keeps the objective stable' },
      riskAssessment: { categories: ['none'], rationale: 'no added risk' },
    };
    writeFileSync(join(cwd, 'acceptance.json'), JSON.stringify(acceptance), 'utf8');
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const ledger = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const { openSqlite } = await import(${JSON.stringify(new URL('../store-sqlite.mjs', import.meta.url).href)});
      ledger.createGoals(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, ['First::first objective']);
      ledger.setGoalAcceptance(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', file: ${JSON.stringify(join(cwd, 'acceptance.json'))} });
      ledger.append(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)}, { goalId: 'G001', event: 'started', status: 'active' });
      ledger.renderState(${JSON.stringify(cwd)}, ${JSON.stringify(SLUG)});
      const db = openSqlite(${JSON.stringify(cwd)}, { readOnly: true });
      const goals = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/goals.json').content;
      const ledgerText = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/ledger.jsonl').content;
      const state = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/STATE.md').content;
      const acceptanceRow = db.prepare('SELECT content FROM qe_files WHERE path=?').get('.qe/planning/plans/${SLUG}/evidence/G001.acceptance.json').content;
      const identity = db.prepare('SELECT operation, artifact_path FROM plan_write_identities WHERE slug=? AND goal_id=? ORDER BY created_at').all(${JSON.stringify(SLUG)}, 'G001');
      db.close();
      console.log(JSON.stringify({ goals, ledgerText, state, acceptanceRow, identity }));
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
    assert.match(parsed.state, /Status: active/);
    assert.match(parsed.acceptanceRow, /"goalId": "G001"/);
    assert.ok(Array.isArray(parsed.identity));
    assert.ok(parsed.identity.length >= 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('legacy lifecycle tables backfill roster columns and install guard triggers', () => {
  const cwd = makeProject();
  try {
    const dbPath = join(cwd, '.qe', 'qe.db');
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
        'journal-test','11111111-1111-4111-8111-111111111111','semantic-1','test','{}','digest','pending',0,NULL,1,1
      );
      INSERT INTO lifecycle_operation_children VALUES(
        '11111111-1111-4111-8111-111111111111',0,'goal','initialize','goal-a','req-1','{"processId":"goal-a","requestId":"req-1"}','pending',0,NULL,NULL,NULL,NULL
      );
    `);
    db.close();
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const { createLifecycleOperation, openSqlite } = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
      const result = createLifecycleOperation(${JSON.stringify(cwd)}, 'journal-test', {
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
      console.log(JSON.stringify({ result, row, seal }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, QE_ROOT: cwd },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.result.code, 'REPLAYED');
    assert.equal(parsed.row.finalized, 1);
    assert.equal(parsed.seal.name, 'lifecycle-journal-immutability');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('lifecycle trigger guards reject immutable parent, child, and seal mutations', () => {
  const cwd = makeProject();
  try {
    const script = `
      process.env.QE_ROOT = ${JSON.stringify(cwd)};
      const { createLifecycleOperation, openSqlite } = await import(${JSON.stringify(new URL('../ledger.mjs', import.meta.url).href)});
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
        \"UPDATE lifecycle_operation_children SET request_json='{}' WHERE operation_id='11111111-1111-4111-8111-111111111111' AND ordinal=0\",
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
    assert.equal(outcomes.length, 4);
    assert.ok(outcomes.every(message => /LIFECYCLE_IMMUTABLE|cannot/i.test(message)));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
