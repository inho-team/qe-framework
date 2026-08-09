import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import * as ledger from '../ledger.mjs';
import { createProcessController } from '../process-controller.mjs';
import { canonicalJson, sha256 } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const SLUG = 'adapter-plan';

function makeProject() {
  const cwd = mkdtempSync(join(tmpdir(), 'lifecycle-plan-goal-adapter-'));
  mkdirSync(join(cwd, '.qe', 'planning', 'plans', SLUG), { recursive: true });
  return cwd;
}

function withRoot(cwd, callback) {
  const previous = process.env.QE_ROOT;
  process.env.QE_ROOT = cwd;
  try { return callback(); }
  finally {
    if (previous === undefined) delete process.env.QE_ROOT;
    else process.env.QE_ROOT = previous;
  }
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

function acceptanceFor(goalId, objective) {
  return {
    schema: 1, goalId,
    goalShape: { primaryOutcome: `Complete ${goalId}`, completionMetric: `${goalId} is complete`,
      allowedPaths: ['hooks/scripts/lib/ledger.mjs'], nonGoals: ['No release'], dependencies: [] },
    requirements: [{ id: 'R001', criterion: 'Complete safely', command: 'node --test --help' }],
    scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'Complete', expected: 'Complete', command: 'node --test --help' }],
    regression: { scope: 'existing behavior', command: 'node --test --help' },
    traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
    humanAcceptance: { required: false },
    goalAlignment: { objective, rationale: 'The scenario observes completion.' },
    riskAssessment: { categories: ['none'], rationale: 'Fixture only.' },
  };
}

function completionFor(goalId, objective, verifier) {
  return {
    schema: 1, goalId,
    requirements: [{ id: 'R001', outcome: 'pass', evidence: 'command passed' }],
    scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'scenario passed' }],
    regression: { outcome: 'pass', evidence: 'regression passed' },
    independentVerification: { verifier, mode: 'machine-reexecution', outcome: 'pass', evidence: 'fresh session passed' },
    goalAlignment: { objective, verifier, outcome: 'pass', evidence: 'aligned' },
    humanAcceptance: { status: 'not-required', evidence: '' }, limitations: [],
  };
}

function publishAcceptance(cwd, goalId = 'G001', objective = 'first objective') {
  const file = join(cwd, `${goalId}.acceptance.json`);
  writeFileSync(file, JSON.stringify(acceptanceFor(goalId, objective)), 'utf8');
  ledger.setGoalAcceptance(cwd, SLUG, { goalId, file });
}

test('controller-bound Plan/Goal adapter exports a closed fail-closed entrypoint', { concurrency: false }, () => {
  assert.equal(typeof ledger.executePlanGoalTransition, 'function');
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      assert.deepEqual(
        ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next', evidence: '' }),
        { ok: false, code: 'INVALID_INPUT', audited: false },
      );
      assert.deepEqual(
        ledger.executePlanGoalTransition(cwd, SLUG, { action: 'unknown' }),
        { ok: false, code: 'INVALID_INPUT', audited: false },
      );
      for (const evidence of ['', '   ', 'bad\0value', '\ud800', 'x'.repeat(49153)]) {
        assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'block', evidence }),
          { ok: false, code: 'INVALID_INPUT', audited: false });
      }
      const accessor = { action: 'block' };
      Object.defineProperty(accessor, 'evidence', { enumerable: true, get() { throw new Error('getter'); } });
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, accessor),
        { ok: false, code: 'INVALID_INPUT', audited: false });
      const proxied = new Proxy({ action: 'next' }, { ownKeys() { throw new Error('proxy'); } });
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, proxied),
        { ok: false, code: 'INVALID_INPUT', audited: false });
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('adapter is unavailable outside the canonical QE root and does not create files', { concurrency: false }, () => {
  const cwd = makeProject();
  const before = process.env.QE_ROOT;
  delete process.env.QE_ROOT;
  try {
    assert.deepEqual(
      ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
      { ok: false, code: 'STORE_UNAVAILABLE', audited: false },
    );
  } finally {
    if (before !== undefined) process.env.QE_ROOT = before;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('next rejects a Goal without immutable acceptance and releases the adapter head', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      assert.deepEqual(
        ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'ACCEPTANCE_REQUIRED', audited: true },
      );
      const db = openSqlite(cwd, { readOnly: true });
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lifecycle_plan_goal_heads').get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lifecycle_plan_goal_receipts WHERE kind='rejected'").get().count, 1);
      closeSqlite(db);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('accepted next bootstraps controllers and atomically projects one Goal activation', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      const acceptanceFile = join(cwd, 'G001.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify({
        schema: 1,
        goalId: 'G001',
        goalShape: {
          primaryOutcome: 'The first Goal starts only through the controller adapter',
          completionMetric: 'The canonical Goal is active with one attempt',
          allowedPaths: ['hooks/scripts/lib/ledger.mjs'],
          nonGoals: ['No release behavior'],
          dependencies: [],
        },
        requirements: [{ id: 'R001', criterion: 'Requested behavior works', command: 'node --test --help' }],
        scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'A user starts the Goal', expected: 'The Goal is active', command: 'node --test --help' }],
        regression: { scope: 'existing behavior', command: 'node --test --help' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
        humanAcceptance: { required: false },
        goalAlignment: { objective: 'first objective', rationale: 'The scenario observes the requested Goal activation.' },
        riskAssessment: { categories: ['none'], rationale: 'The fixture has no external product risk.' },
      }), 'utf8');
      ledger.setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: acceptanceFile });

      const projected = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(projected.ok, true, JSON.stringify(projected));
      assert.equal(projected.code, 'PROJECTED');
      assert.deepEqual(projected.goal, { id: 'G001', status: 'active', attempts: 1 });
      const replay = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(replay.code, 'REPLAYED');
      assert.equal(replay.receiptId, projected.receiptId);

      const db = openSqlite(cwd, { readOnly: true });
      const goals = JSON.parse(db.prepare('SELECT content FROM qe_files WHERE path=?')
        .get(`.qe/planning/plans/${SLUG}/goals.json`).content);
      const ledgerLines = db.prepare('SELECT content FROM qe_files WHERE path=?')
        .get(`.qe/planning/plans/${SLUG}/ledger.jsonl`).content.trim().split('\n');
      assert.equal(goals.goals[0].status, 'active');
      assert.equal(goals.goals[0].attempts, 1);
      assert.equal(JSON.parse(ledgerLines.at(-1)).receiptId, projected.receiptId);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lifecycle_plan_goal_receipts WHERE kind='projected'").get().count, 1);
      const intent = JSON.parse(db.prepare('SELECT intent_json FROM lifecycle_plan_goal_intents').get().intent_json);
      const evidenceKinds = ['acceptance', 'completion', 'implementation-run', 'verification-run'];
      const evidenceTuples = evidenceKinds.map(kind => {
        const suffix = kind === 'acceptance' ? 'acceptance.json'
          : kind === 'completion' ? 'completion.json' : `${kind}.json`;
        const rowIdentity = `.qe/planning/plans/${SLUG}/evidence/G001.${suffix}`;
        const row = db.prepare('SELECT sha256 FROM qe_files WHERE path=?').get(rowIdentity);
        return { kind, rowIdentity, presence: Boolean(row),
          rawSha256: row?.sha256 || sha256(canonicalJson(['qe-plan-goal-no-row-v1'])) };
      });
      for (const identity of db.prepare(`SELECT identity,operation,artifact_path,artifact_sha256,event_sha256,event_offset
        FROM plan_write_identities WHERE slug=? AND goal_id=? ORDER BY operation,identity`).all(SLUG, 'G001')) {
        evidenceTuples.push({ kind: `plan-write-identity:${identity.operation}`, rowIdentity: identity.identity,
          presence: true, rawSha256: sha256(canonicalJson(identity)) });
      }
      evidenceTuples.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
      assert.deepEqual(intent.evidenceSnapshot.tuples, evidenceTuples);
      assert.equal(intent.evidenceSnapshot.digest, sha256(canonicalJson([
        'qe-plan-goal-evidence-snapshot-v1', SLUG, 'G001', 0, evidenceTuples,
      ])));
      closeSqlite(db);

      assert.throws(() => ledger.append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' }),
        error => error?.code === 'DIRECT_TRANSITION_DENIED');
      assert.throws(() => ledger.recordEvent(cwd, SLUG, { ts: new Date().toISOString(), event: 'failed',
        goalId: 'G001', status: 'failed', evidence: 'bypass', attempt: 1 }),
      error => error?.code === 'DIRECT_TRANSITION_DENIED');
      assert.equal(ledger.renderState(cwd, SLUG).verified, true);

      const raw = openSqlite(cwd);
      assert.throws(() => raw.prepare('UPDATE lifecycle_plan_goal_receipts SET kind=? WHERE receipt_id=?')
        .run('rejected', projected.receiptId), /PLAN_GOAL_ADAPTER_IMMUTABLE/);
      assert.throws(() => raw.prepare('DELETE FROM lifecycle_plan_goal_intents WHERE operation_id=?')
        .run(projected.operationId), /qe_plan_goal_adapter_write_v1|PLAN_GOAL_ADAPTER_IMMUTABLE/);
      closeSqlite(raw);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('foreign controller history is rejected instead of adopted as bootstrap authority', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      const controller = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
      assert.equal(controller.initialize({ processId: `qe-plan:${SLUG}`, requestId: 'foreign-bootstrap' }).code,
        'INITIALIZED');
      controller.close();
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'CONTROLLER_STATE_CONFLICT', audited: false });
      const db = openSqlite(cwd, { readOnly: true });
      assert.equal(db.prepare('SELECT COUNT(*) count FROM lifecycle_plan_goal_bootstraps').get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE name='lifecycle_operations'").get().count, 0);
      closeSqlite(db);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('exact bootstrap audit recovers a controller-first crash before manifest persistence', { concurrency: false }, () => {
  const cwd = makeProject();
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      globalThis[fault] = point => { if (point === 'bootstrap-before-persist') throw new Error('fault cut'); };
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'CONTROLLER_STATE_CONFLICT');
      delete globalThis[fault];
      const recovered = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(recovered.code, 'PROJECTED', JSON.stringify(recovered));
      const db = openSqlite(cwd, { readOnly: true });
      assert.ok(db.prepare('SELECT COUNT(*) count FROM lifecycle_plan_goal_bootstraps').get().count >= 2);
      assert.equal(db.prepare("SELECT COUNT(*) count FROM lifecycle_plan_goal_receipts WHERE kind='projected'").get().count, 1);
      closeSqlite(db);
    });
  } finally {
    delete globalThis[fault];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('partial bootstrap rejects a foreign denied audit suffix', { concurrency: false }, () => {
  const cwd = makeProject();
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      globalThis[fault] = point => { if (point === 'bootstrap-before-persist') throw new Error('fault cut'); };
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'CONTROLLER_STATE_CONFLICT');
      delete globalThis[fault];
      const controller = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
      const current = controller.read(`qe-plan:${SLUG}`);
      const denied = controller.transition({ processId: `qe-plan:${SLUG}`, requestId: 'foreign-denied-suffix',
        to: 'complete', expectedRevision: current.snapshot.revision, attestations: null, humanAcceptance: null });
      assert.equal(denied.allowed, false);
      controller.close();
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'CONTROLLER_STATE_CONFLICT', audited: false });
      const db = openSqlite(cwd, { readOnly: true });
      assert.equal(db.prepare('SELECT COUNT(*) count FROM lifecycle_plan_goal_bootstraps').get().count, 0);
      closeSqlite(db);
    });
  } finally {
    delete globalThis[fault];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('partial bootstrap rejects a foreign allowed audit suffix', { concurrency: false }, () => {
  const cwd = makeProject();
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      globalThis[fault] = point => { if (point === 'bootstrap-before-persist') throw new Error('fault cut'); };
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'CONTROLLER_STATE_CONFLICT');
      delete globalThis[fault];
      const controller = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
      const current = controller.read(`qe-plan:${SLUG}`);
      const allowed = controller.transition({ processId: `qe-plan:${SLUG}`, requestId: 'foreign-allowed-suffix',
        to: 'planned', expectedRevision: current.snapshot.revision, attestations: null, humanAcceptance: null });
      assert.equal(allowed.allowed, true);
      controller.close();
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'CONTROLLER_STATE_CONFLICT', audited: false });
      const db = openSqlite(cwd, { readOnly: true });
      assert.equal(db.prepare('SELECT COUNT(*) count FROM lifecycle_plan_goal_bootstraps').get().count, 0);
      closeSqlite(db);
    });
  } finally {
    delete globalThis[fault];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('advanceGoal creates the one permitted initial STATE projection for a fresh accepted Plan', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      publishAcceptance(cwd);
      const result = ledger.advanceGoal(cwd, SLUG);
      assert.equal(result.code, 'PROJECTED', JSON.stringify(result));
      assert.deepEqual(result.goal, { id: 'G001', status: 'active', attempts: 1 });
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('fresh Plan creates initial STATE after the adapter schema was installed by another Plan', { concurrency: false }, () => {
  const cwd = makeProject();
  const secondSlug = 'adapter-plan-successor';
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      assert.equal(ledger.advanceGoal(cwd, SLUG).code, 'PROJECTED');

      ledger.createGoals(cwd, secondSlug, ['Successor::successor objective']);
      const acceptanceFile = join(cwd, 'successor.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify(acceptanceFor('G001', 'successor objective')), 'utf8');
      ledger.setGoalAcceptance(cwd, secondSlug, { goalId: 'G001', file: acceptanceFile });

      const before = openSqlite(cwd, { readOnly: true });
      assert.equal(before.prepare('SELECT COUNT(*) count FROM qe_files WHERE path=?')
        .get(`.qe/planning/plans/${secondSlug}/STATE.md`).count, 0);
      closeSqlite(before);

      const result = ledger.advanceGoal(cwd, secondSlug);
      assert.equal(result.code, 'PROJECTED', JSON.stringify(result));
      assert.deepEqual(result.goal, { id: 'G001', status: 'active', attempts: 1 });
      const after = openSqlite(cwd, { readOnly: true });
      assert.equal(after.prepare('SELECT COUNT(*) count FROM qe_files WHERE path=?')
        .get(`.qe/planning/plans/${secondSlug}/STATE.md`).count, 1);
      closeSqlite(after);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('fresh Plan replaces its placeholder STATE exactly once after adapter installation', { concurrency: false }, () => {
  const cwd = makeProject();
  const secondSlug = 'adapter-plan-placeholder';
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      assert.equal(ledger.advanceGoal(cwd, SLUG).code, 'PROJECTED');

      ledger.createGoals(cwd, secondSlug, ['Successor::successor objective']);
      const acceptanceFile = join(cwd, 'placeholder.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify(acceptanceFor('G001', 'successor objective')), 'utf8');
      ledger.setGoalAcceptance(cwd, secondSlug, { goalId: 'G001', file: acceptanceFile });
      const placeholder = `# State — ${secondSlug}\n\n> Initial projection pending.\n`;
      const db = openSqlite(cwd);
      const now = Date.now();
      db.prepare(`INSERT INTO qe_files(path,content,encoding,size,mode,mtime_ms,sha256,migrated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(`.qe/planning/plans/${secondSlug}/STATE.md`, placeholder,
        'utf8', Buffer.byteLength(placeholder), 0o644, now, sha256(placeholder), now);
      closeSqlite(db);

      const result = ledger.advanceGoal(cwd, secondSlug);
      assert.equal(result.code, 'PROJECTED', JSON.stringify(result));
      assert.deepEqual(result.goal, { id: 'G001', status: 'active', attempts: 1 });
      assert.equal(ledger.renderState(cwd, secondSlug, { adapterBootstrap: true }).verified, true);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('block then fail follows the controller recovery matrix without changing attempts', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      const acceptanceFile = join(cwd, 'G001.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify({
        schema: 1, goalId: 'G001',
        goalShape: { primaryOutcome: 'Start safely', completionMetric: 'Goal becomes active',
          allowedPaths: ['hooks/scripts/lib/ledger.mjs'], nonGoals: ['No release'], dependencies: [] },
        requirements: [{ id: 'R001', criterion: 'Start safely', command: 'node --test --help' }],
        scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'Start', expected: 'Active', command: 'node --test --help' }],
        regression: { scope: 'existing behavior', command: 'node --test --help' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
        humanAcceptance: { required: false },
        goalAlignment: { objective: 'first objective', rationale: 'The scenario observes the objective.' },
        riskAssessment: { categories: ['none'], rationale: 'Fixture only.' },
      }), 'utf8');
      ledger.setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: acceptanceFile });
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'PROJECTED');

      const blocked = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'block', evidence: 'waiting on a bounded dependency' });
      assert.equal(blocked.code, 'PROJECTED', JSON.stringify(blocked));
      assert.deepEqual(blocked.goal, { id: 'G001', status: 'blocked', attempts: 1 });
      const failed = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'fail', evidence: 'dependency could not be resolved' });
      assert.equal(failed.code, 'PROJECTED', JSON.stringify(failed));
      assert.deepEqual(failed.goal, { id: 'G001', status: 'failed', attempts: 1 });
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'fail', evidence: 'dependency could not be resolved' }).code, 'REPLAYED');
      const retried = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(retried.code, 'PROJECTED', JSON.stringify(retried));
      assert.deepEqual(retried.goal, { id: 'G001', status: 'active', attempts: 2 });
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('durable intent resumes after a committed-intent response cut', { concurrency: false }, () => {
  const cwd = makeProject();
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      globalThis[fault] = point => { if (point === 'intent-committed') throw new Error('fault cut'); };
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'STORE_UNAVAILABLE');
      delete globalThis[fault];
      let resumed;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        resumed = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
        if (resumed.code !== 'OPERATION_IN_PROGRESS') break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      assert.equal(resumed.code, 'PROJECTED', JSON.stringify(resumed));
      assert.deepEqual(resumed.goal, { id: 'G001', status: 'active', attempts: 1 });
    });
  } finally {
    delete globalThis[fault];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('controller-terminal and adapter pre/post-commit cuts recover without duplicate projection', { concurrency: false }, () => {
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  for (const point of ['controller-terminal', 'pre-commit', 'post-commit']) {
    const cwd = makeProject();
    try {
      withRoot(cwd, () => {
        ledger.createGoals(cwd, SLUG, ['First::first objective']);
        ledger.renderState(cwd, SLUG);
        publishAcceptance(cwd);
        globalThis[fault] = cut => { if (cut === point) throw new Error(`cut:${point}`); };
        assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code,
          'STORE_UNAVAILABLE', point);
        delete globalThis[fault];
        const recovered = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
        assert.ok(['PROJECTED', 'REPLAYED'].includes(recovered.code), `${point}: ${JSON.stringify(recovered)}`);
        const db = openSqlite(cwd, { readOnly: true });
        assert.equal(db.prepare("SELECT COUNT(*) count FROM lifecycle_plan_goal_receipts WHERE kind='projected'").get().count, 1);
        const goals = JSON.parse(db.prepare('SELECT content FROM qe_files WHERE path=?')
          .get(`.qe/planning/plans/${SLUG}/goals.json`).content);
        assert.deepEqual({ status: goals.goals[0].status, attempts: goals.goals[0].attempts },
          { status: 'active', attempts: 1 });
        closeSqlite(db);
      });
    } finally {
      delete globalThis[fault];
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('controller denial carries an exact allowed Plan prefix into generation one', { concurrency: false }, () => {
  const cwd = makeProject();
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      globalThis[fault] = point => point === 'controller-roster' ? 1 : undefined;
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'TRANSITION_DENIED', audited: true });
      delete globalThis[fault];
      const projected = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(projected.code, 'PROJECTED', JSON.stringify(projected));
      const db = openSqlite(cwd, { readOnly: true });
      const denied = JSON.parse(db.prepare("SELECT receipt_json FROM lifecycle_plan_goal_receipts WHERE kind='controller-denied'").get().receipt_json);
      const receipt = JSON.parse(db.prepare("SELECT receipt_json FROM lifecycle_plan_goal_receipts WHERE kind='projected'").get().receipt_json);
      assert.equal(denied.generation, 0);
      assert.equal(denied.allowedHeadSnapshots.length, 1);
      assert.deepEqual(Object.keys(denied.allowedHeadSnapshots[0]).sort(),
        ['controllerHeadSnapshotCore', 'controllerHeadSnapshotDigest', 'resultRef']);
      assert.equal(receipt.generation, 1);
      assert.equal(receipt.carryFromReceiptId, denied.receiptId);
      assert.deepEqual(receipt.carriedHeadSnapshots, denied.allowedHeadSnapshots);
      assert.equal(receipt.receiptId, sha256(canonicalJson(['qe-plan-goal-receipt-v2', 'projected',
        receipt.slug, receipt.operationId, receipt.semanticKey, receipt.reservationId,
        receipt.generation, receipt.carryFromReceiptId, receipt.requestDigest,
        receipt.goalProofDigest, receipt.planProofDigest, receipt.allowedPrefixDigest,
        receipt.newlyAllowedResultRefs, receipt.eventContentDigest, receipt.targetHashes])));
      closeSqlite(db);
    });
  } finally {
    delete globalThis[fault];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('complete derives repository proof and closes both Goal and Plan controllers', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      const acceptanceFile = join(cwd, 'G001.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify({
        schema: 1, goalId: 'G001',
        goalShape: { primaryOutcome: 'Complete safely', completionMetric: 'Goal and Plan complete',
          allowedPaths: ['hooks/scripts/lib/ledger.mjs'], nonGoals: ['No release'], dependencies: [] },
        requirements: [{ id: 'R001', criterion: 'Complete safely', command: 'node --test --help' }],
        scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'Complete', expected: 'Complete', command: 'node --test --help' }],
        regression: { scope: 'existing behavior', command: 'node --test --help' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
        humanAcceptance: { required: false },
        goalAlignment: { objective: 'first objective', rationale: 'The scenario observes completion.' },
        riskAssessment: { categories: ['none'], rationale: 'Fixture only.' },
      }), 'utf8');
      ledger.setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: acceptanceFile });
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'PROJECTED');
      ledger.runGoalEvidence(cwd, SLUG, { goalId: 'G001', role: 'implementation',
        sessionId: '11111111-1111-4111-8111-111111111111' });
      ledger.runGoalEvidence(cwd, SLUG, { goalId: 'G001', role: 'verification', verifier: 'adapter-independent',
        sessionId: '22222222-2222-4222-8222-222222222222' });
      const completionFile = join(cwd, 'G001.completion.json');
      writeFileSync(completionFile, JSON.stringify({
        schema: 1, goalId: 'G001',
        requirements: [{ id: 'R001', outcome: 'pass', evidence: 'command passed' }],
        scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'scenario passed' }],
        regression: { outcome: 'pass', evidence: 'regression passed' },
        independentVerification: { verifier: 'adapter-independent', mode: 'machine-reexecution', outcome: 'pass', evidence: 'fresh session passed' },
        goalAlignment: { objective: 'first objective', verifier: 'adapter-independent', outcome: 'pass', evidence: 'aligned' },
        humanAcceptance: { status: 'not-required', evidence: '' }, limitations: [],
      }), 'utf8');
      ledger.recordGoalEvidence(cwd, SLUG, { goalId: 'G001', file: completionFile });

      const completed = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'complete' });
      assert.equal(completed.code, 'PROJECTED', JSON.stringify(completed));
      assert.deepEqual(completed.goal, { id: 'G001', status: 'complete', attempts: 1 });
      const db = openSqlite(cwd, { readOnly: true });
      const states = db.prepare('SELECT process_id,snapshot_json FROM process_controller_state ORDER BY process_id').all();
      assert.deepEqual(states.map(row => JSON.parse(row.snapshot_json).state), ['complete', 'complete']);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lifecycle_plan_goal_proofs WHERE kind='goal'").get().count, 1);
      for (const row of db.prepare('SELECT proof_id,proof_json FROM lifecycle_plan_goal_proofs').all()) {
        const proof = JSON.parse(row.proof_json);
        const attestations = proof.kind === 'goal' ? Object.values(proof.attestations)
          : [proof.goalsVerified, proof.independentVerification, proof.goalAlignment];
        assert.ok(attestations.every(item => item.proofRef === `qe-plan-goal-proof:${row.proof_id}`));
      }
      closeSqlite(db);
      const raw = openSqlite(cwd);
      const immutableTables = ['lifecycle_plan_goal_audit', 'lifecycle_plan_goal_bootstraps',
        'lifecycle_plan_goal_intents', 'lifecycle_plan_goal_proofs', 'lifecycle_plan_goal_receipts'];
      for (const table of immutableTables) {
        assert.throws(() => raw.exec(`UPDATE ${table} SET slug=slug WHERE rowid=(SELECT MIN(rowid) FROM ${table})`),
          /PLAN_GOAL_ADAPTER_IMMUTABLE/);
        assert.throws(() => raw.exec(`DELETE FROM ${table} WHERE rowid=(SELECT MIN(rowid) FROM ${table})`),
          /PLAN_GOAL_ADAPTER_IMMUTABLE|qe_plan_goal_adapter_write_v1/);
        assert.throws(() => raw.exec(`INSERT INTO ${table} SELECT * FROM ${table} LIMIT 1`),
          /PLAN_GOAL_ADAPTER_IMMUTABLE|qe_plan_goal_adapter_write_v1/);
      }
      assert.throws(() => raw.exec(`INSERT INTO lifecycle_plan_goal_heads
        SELECT slug,semantic_key,reservation_id,created_at FROM lifecycle_plan_goal_intents LIMIT 1`),
      /PLAN_GOAL_ADAPTER_IMMUTABLE|qe_plan_goal_adapter_write_v1/);
      closeSqlite(raw);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('legacy all-complete Plan reconstructs complete Goal and Plan controller authority before no-op', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      ledger.append(cwd, SLUG, { goalId: 'G001', event: 'started', status: 'active' });
      ledger.runGoalEvidence(cwd, SLUG, { goalId: 'G001', role: 'implementation',
        sessionId: '11111111-1111-4111-8111-111111111111' });
      ledger.runGoalEvidence(cwd, SLUG, { goalId: 'G001', role: 'verification',
        verifier: 'legacy-independent', sessionId: '22222222-2222-4222-8222-222222222222' });
      const completionFile = join(cwd, 'G001.completion.json');
      writeFileSync(completionFile, JSON.stringify(completionFor('G001', 'first objective', 'legacy-independent')), 'utf8');
      ledger.recordGoalEvidence(cwd, SLUG, { goalId: 'G001', file: completionFile });
      const raw = openSqlite(cwd);
      const path = `.qe/planning/plans/${SLUG}/goals.json`;
      const row = raw.prepare('SELECT content FROM qe_files WHERE path=?').get(path);
      const goals = JSON.parse(row.content);
      goals.goals[0].status = 'complete';
      const content = `${JSON.stringify(goals, null, 2)}\n`;
      raw.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?')
        .run(content, Buffer.byteLength(content), sha256(content), path);
      closeSqlite(raw);
      ledger.renderState(cwd, SLUG);

      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: true, code: 'PLAN_COMPLETE', audited: false, action: 'next', total: 1 });
      const check = openSqlite(cwd, { readOnly: true });
      const states = check.prepare('SELECT process_id,snapshot_json FROM process_controller_state ORDER BY process_id').all();
      assert.deepEqual(states.map(item => JSON.parse(item.snapshot_json).state), ['complete', 'complete']);
      assert.equal(check.prepare("SELECT COUNT(*) count FROM lifecycle_plan_goal_proofs WHERE kind='plan'").get().count, 1);
      assert.equal(check.prepare(`SELECT COUNT(*) count FROM lifecycle_plan_goal_bootstraps
        WHERE manifest_json LIKE '%\"scope\":\"plan\"%' AND manifest_json LIKE '%\"targetState\":\"complete\"%'`).get().count, 1);
      closeSqlite(check);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('partial adapter schema is detected without auto-repair', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).code, 'ACCEPTANCE_REQUIRED');
      const raw = openSqlite(cwd);
      raw.exec('DROP TRIGGER lifecycle_plan_goal_receipts_no_update');
      closeSqlite(raw);
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'ADAPTER_STORE_CORRUPT', audited: false });
      const check = openSqlite(cwd, { readOnly: true });
      assert.equal(check.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='lifecycle_plan_goal_receipts_no_update'").get().count, 0);
      closeSqlite(check);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing STATE is not created when any partial adapter object exists', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      const raw = openSqlite(cwd);
      raw.exec('CREATE TABLE lifecycle_plan_goal_audit(partial INTEGER)');
      closeSqlite(raw);
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'ADAPTER_STORE_CORRUPT', audited: false });
      const db = openSqlite(cwd, { readOnly: true });
      assert.equal(db.prepare('SELECT COUNT(*) count FROM qe_files WHERE path=?')
        .get(`.qe/planning/plans/${SLUG}/STATE.md`).count, 0);
      closeSqlite(db);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('non-adapter lifecycle operation cannot authorize controller bootstrap history', { concurrency: false }, () => {
  const cwd = makeProject();
  const operationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      const processId = `qe-plan:${SLUG}`;
      const controller = createProcessController({ cwd, layer: 'plan', authority: 'plan-controller' });
      assert.equal(controller.initialize({ processId, requestId: 'foreign-lifecycle-init' }).code, 'INITIALIZED');
      assert.equal(ledger.createLifecycleOperation(cwd, SLUG, {
        operationId, semanticKey: 'foreign-lifecycle-authority', kind: 'foreign-operation', payload: {},
        children: [{ layer: 'plan', operation: 'transition', processId, to: 'active', expectedRevision: 0,
          attestations: null, humanAcceptance: null }],
      }).code, 'CREATED');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0,
        owner: 'foreign-lifecycle', leaseMs: 1000 });
      assert.equal(claim.code, 'CLAIMED', JSON.stringify(claim));
      assert.equal(controller.transition(claim.child.request).allowed, true);
      assert.equal(ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0,
        claimToken: claim.child.claim.token }).operation.status, 'committed');
      controller.close();
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'CONTROLLER_STATE_CONFLICT', audited: false });
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('trustworthy outstanding projection debt is audited and blocks controller execution', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      const acceptanceFile = join(cwd, 'G001.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify({
        schema: 1, goalId: 'G001',
        goalShape: { primaryOutcome: 'Start safely', completionMetric: 'Goal becomes active',
          allowedPaths: ['hooks/scripts/lib/ledger.mjs'], nonGoals: ['No release'], dependencies: [] },
        requirements: [{ id: 'R001', criterion: 'Start safely', command: 'node --test --help' }],
        scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'Start', expected: 'Active', command: 'node --test --help' }],
        regression: { scope: 'existing behavior', command: 'node --test --help' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
        humanAcceptance: { required: false },
        goalAlignment: { objective: 'first objective', rationale: 'The scenario observes the objective.' },
        riskAssessment: { categories: ['none'], rationale: 'Fixture only.' },
      }), 'utf8');
      ledger.setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: acceptanceFile });
      const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const processId = `qe-plan:${SLUG}:goal:G001`;
      const controller = createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' });
      controller.initialize({ processId, requestId: 'debt-init' });
      assert.equal(ledger.createLifecycleOperation(cwd, SLUG, {
        operationId, semanticKey: 'unresolved-projection', kind: 'controller-projected', payload: {},
        children: [{ layer: 'goal', operation: 'transition', processId, to: 'active', expectedRevision: 0,
          attestations: null, humanAcceptance: null }],
      }).code, 'CREATED');
      const db = openSqlite(cwd, { readOnly: true });
      const prefix = `.qe/planning/plans/${SLUG}/`;
      const rows = Object.fromEntries(['goals.json', 'ledger.jsonl', 'STATE.md'].map(name => [name,
        db.prepare('SELECT content,sha256 FROM qe_files WHERE path=?').get(prefix + name)]));
      closeSqlite(db);
      const goal = JSON.parse(rows['goals.json'].content).goals[0];
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: {
        schema: 1, baseGoalsSha256: rows['goals.json'].sha256,
        baseLedgerSha256: rows['ledger.jsonl'].sha256, baseStateSha256: rows['STATE.md'].sha256,
        children: [{ ordinal: 0, goalId: 'G001', expectedTargetSha256: sha256(canonicalJson(goal)),
          set: { status: 'active', attempts: 1 }, event: { event: 'started', status: 'active', evidence: 'reserved' } }],
      } }).code, 'STAGED');
      controller.close();

      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'PROJECTION_DEBT_OUTSTANDING', audited: true });
      const check = openSqlite(cwd, { readOnly: true });
      assert.equal(check.prepare("SELECT COUNT(*) AS count FROM lifecycle_plan_goal_receipts WHERE kind='rejected'").get().count, 1);
      assert.equal(check.prepare('SELECT COUNT(*) AS count FROM lifecycle_plan_goal_heads').get().count, 0);
      closeSqlite(check);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('apply-time debt rejection replays and recovers controller-first state after resolution', { concurrency: false }, () => {
  const cwd = makeProject();
  const fault = Symbol.for('qe.lifecycle-plan-goal-adapter.fault-injector');
  const debtOperationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let debtId;
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective', 'Second::second objective']);
      ledger.renderState(cwd, SLUG);
      publishAcceptance(cwd);
      globalThis[fault] = point => {
        if (point !== 'before-apply') return;
        delete globalThis[fault];
        const processId = `qe-plan:${SLUG}:goal:G002`;
        const controller = createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' });
        const controllerState = controller.read(processId);
        assert.equal(controllerState.snapshot.state, 'pending');
        assert.equal(ledger.createLifecycleOperation(cwd, SLUG, {
          operationId: debtOperationId, semanticKey: 'apply-time-debt-fixture', kind: 'controller-projected', payload: {},
          children: [{ layer: 'goal', operation: 'transition', processId, to: 'pending',
            expectedRevision: controllerState.snapshot.revision,
            attestations: null, humanAcceptance: null }],
        }).code, 'CREATED');
        const db = openSqlite(cwd, { readOnly: true });
        const prefix = `.qe/planning/plans/${SLUG}/`;
        const rows = Object.fromEntries(['goals.json', 'ledger.jsonl', 'STATE.md'].map(name => [name,
          db.prepare('SELECT content,sha256 FROM qe_files WHERE path=?').get(prefix + name)]));
        const goal = JSON.parse(rows['goals.json'].content).goals[1];
        closeSqlite(db);
        assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId: debtOperationId, recipe: {
          schema: 1, baseGoalsSha256: rows['goals.json'].sha256,
          baseLedgerSha256: rows['ledger.jsonl'].sha256, baseStateSha256: rows['STATE.md'].sha256,
          children: [{ ordinal: 0, goalId: 'G002', expectedTargetSha256: sha256(canonicalJson(goal)),
            set: { status: goal.status },
            event: { event: 'checkpoint', status: goal.status, evidence: 'debt fixture' } }],
        } }).code, 'STAGED');
        const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId: debtOperationId,
          ordinal: 0, owner: 'debt-fixture', leaseMs: 1000 });
        assert.equal(claim.code, 'CLAIMED');
        assert.equal(controller.transition(claim.child.request).allowed, true);
        assert.equal(ledger.settleLifecycleChild(cwd, SLUG, { operationId: debtOperationId,
          ordinal: 0, claimToken: claim.child.claim.token }).operation.status, 'committed');
        controller.close();
        const raw = openSqlite(cwd);
        const goalsPath = `${prefix}goals.json`;
        const drifted = `${rows['goals.json'].content}\n`;
        raw.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?').run(
          drifted, Buffer.byteLength(drifted), sha256(drifted), goalsPath);
        closeSqlite(raw);
        assert.equal(ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId: debtOperationId }).code,
          'TARGET_CONFLICT');
        const quarantined = ledger.quarantineLifecycleProjection(cwd, SLUG, {
          operationId: debtOperationId, reason: 'TARGET_CONFLICT', replacementOperationId: null,
        });
        assert.equal(quarantined.code, 'QUARANTINED');
        debtId = quarantined.debtId;
        const restore = openSqlite(cwd);
        restore.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?').run(
          rows['goals.json'].content, Buffer.byteLength(rows['goals.json'].content), rows['goals.json'].sha256,
          goalsPath);
        closeSqlite(restore);
      };
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'PROJECTION_DEBT_OUTSTANDING', audited: true });
      assert.deepEqual(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }),
        { ok: false, code: 'PROJECTION_DEBT_OUTSTANDING', audited: true });
      const db = openSqlite(cwd, { readOnly: true });
      const goalsSha256 = db.prepare('SELECT sha256 FROM qe_files WHERE path=?')
        .get(`.qe/planning/plans/${SLUG}/goals.json`).sha256;
      closeSqlite(db);
      assert.equal(ledger.resolveLifecycleProjectionDebt(cwd, SLUG, { debtId, mode: 'equivalence',
        proof: { expectedGoalsSha256: goalsSha256 } }).code, 'RESOLVED');
      const recovered = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(recovered.code, 'PROJECTED', JSON.stringify(recovered));
      assert.deepEqual(recovered.goal, { id: 'G001', status: 'active', attempts: 1 });
    });
  } finally {
    delete globalThis[fault];
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('two-process next race converges to one projection and an immutable replay', { concurrency: false }, async () => {
  const cwd = makeProject();
  try {
    await withRoot(cwd, async () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      const acceptanceFile = join(cwd, 'G001.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify({
        schema: 1, goalId: 'G001',
        goalShape: { primaryOutcome: 'Start safely', completionMetric: 'Goal becomes active',
          allowedPaths: ['hooks/scripts/lib/ledger.mjs'], nonGoals: ['No release'], dependencies: [] },
        requirements: [{ id: 'R001', criterion: 'Start safely', command: 'node --test --help' }],
        scenarios: [{ id: 'S001', kind: 'user-journey', scenario: 'Start', expected: 'Active', command: 'node --test --help' }],
        regression: { scope: 'existing behavior', command: 'node --test --help' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
        humanAcceptance: { required: false },
        goalAlignment: { objective: 'first objective', rationale: 'The scenario observes the objective.' },
        riskAssessment: { categories: ['none'], rationale: 'Fixture only.' },
      }), 'utf8');
      ledger.setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: acceptanceFile });
      const moduleUrl = new URL('../ledger.mjs', import.meta.url).href;
      const source = `
        const ledger = await import(${JSON.stringify(moduleUrl)});
        let result;
        for (let attempt=0; attempt<100; attempt+=1) {
          result=ledger.executePlanGoalTransition(process.env.ADAPTER_CWD, ${JSON.stringify(SLUG)}, {action:'next'});
          if (!['OPERATION_IN_PROGRESS','STORE_UNAVAILABLE'].includes(result.code)) break;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        process.stdout.write(JSON.stringify(result));
      `;
      const runs = await Promise.all([
        childResult(source, { QE_ROOT: cwd, ADAPTER_CWD: cwd }),
        childResult(source, { QE_ROOT: cwd, ADAPTER_CWD: cwd }),
      ]);
      assert.deepEqual(runs.map(run => run.status), [0, 0], runs.map(run => run.stderr).join('\n'));
      const results = runs.map(run => JSON.parse(run.stdout));
      assert.deepEqual(results.map(result => result.code).sort(), ['PROJECTED', 'REPLAYED']);
      const db = openSqlite(cwd, { readOnly: true });
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lifecycle_plan_goal_receipts WHERE kind='projected'").get().count, 1);
      closeSqlite(db);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('last Goal completion binds the ordered whole-Plan proof aggregate', { concurrency: false }, () => {
  const cwd = makeProject();
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective', 'Second::second objective']);
      ledger.renderState(cwd, SLUG);
      for (const [goalId, objective] of [['G001', 'first objective'], ['G002', 'second objective']]) {
        const file = join(cwd, `${goalId}.acceptance.json`);
        writeFileSync(file, JSON.stringify(acceptanceFor(goalId, objective)), 'utf8');
        ledger.setGoalAcceptance(cwd, SLUG, { goalId, file });
      }
      const completeGoal = (goalId, objective, implementationSession, verificationSession) => {
        const verifier = `independent-${goalId}`;
        ledger.runGoalEvidence(cwd, SLUG, { goalId, role: 'implementation', sessionId: implementationSession });
        ledger.runGoalEvidence(cwd, SLUG, { goalId, role: 'verification', verifier, sessionId: verificationSession });
        const file = join(cwd, `${goalId}.completion.json`);
        writeFileSync(file, JSON.stringify(completionFor(goalId, objective, verifier)), 'utf8');
        ledger.recordGoalEvidence(cwd, SLUG, { goalId, file });
        return ledger.executePlanGoalTransition(cwd, SLUG, { action: 'complete' });
      };

      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' }).goal.id, 'G001');
      assert.equal(completeGoal('G001', 'first objective',
        '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222').code, 'PROJECTED');
      const secondStart = ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next' });
      assert.equal(secondStart.goal?.id, 'G002', JSON.stringify(secondStart));
      const final = completeGoal('G002', 'second objective',
        '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
      assert.equal(final.code, 'PROJECTED', JSON.stringify(final));

      const db = openSqlite(cwd, { readOnly: true });
      const planProof = db.prepare("SELECT proof_json FROM lifecycle_plan_goal_proofs WHERE kind='plan'").get();
      const parsed = JSON.parse(planProof.proof_json);
      assert.deepEqual(parsed.goalIds, ['G001', 'G002']);
      assert.equal(parsed.goalProofDigests.length, 2);
      assert.equal(JSON.parse(db.prepare('SELECT snapshot_json FROM process_controller_state WHERE process_id=?')
        .get(`qe-plan:${SLUG}`).snapshot_json).state, 'complete');
      closeSqlite(db);
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
