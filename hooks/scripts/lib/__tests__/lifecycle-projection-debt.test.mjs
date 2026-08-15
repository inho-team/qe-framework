import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ledger from '../ledger.mjs';
import { createProcessController } from '../process-controller.mjs';
import { canonicalJson, sha256 } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';

const SLUG = 'demo-plan';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-projection-debt-'));
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
  return {
    layer: 'goal',
    operation: 'transition',
    processId,
    to,
    expectedRevision,
    attestations: null,
    humanAcceptance: null,
  };
}

function stageProjectionFixture(cwd, operationId) {
  const processId = `qe-plan:${SLUG}:goal:G001`;
  const controller = createProcessController({ cwd, layer: 'goal', authority: 'goal-controller' });
  const current = controller.read(processId);
  assert.equal(current.snapshot.state, 'active');
  const created = ledger.createLifecycleOperation(cwd, SLUG, {
    operationId,
    semanticKey: `semantic-${operationId}`,
    kind: 'controller-projected',
    payload: { action: 'advance' },
    children: [transition(processId, 'failed', current.snapshot.revision)],
  });
  assert.equal(created.code, 'CREATED');

  const db = openSqlite(cwd, { readOnly: true });
  const prefix = `.qe/planning/plans/${SLUG}/`;
  const rows = Object.fromEntries(['goals.json', 'ledger.jsonl', 'STATE.md'].map(name => [name,
    db.prepare('SELECT content,sha256 FROM qe_files WHERE path=?').get(prefix + name)]));
  closeSqlite(db);

  const goal = JSON.parse(rows['goals.json'].content).goals[0];
  const recipe = {
    schema: 1,
    baseGoalsSha256: rows['goals.json'].sha256,
    baseLedgerSha256: rows['ledger.jsonl'].sha256,
    baseStateSha256: rows['STATE.md'].sha256,
    children: [{
      ordinal: 0,
      goalId: 'G001',
      expectedTargetSha256: sha256(canonicalJson(goal)),
      set: { status: 'failed' },
      event: { event: 'failed', status: 'failed', evidence: 'controller allowed' },
    }],
  };

  return { controller, recipe };
}

test('projection debt APIs are exported and quarantine blocks completion', { concurrency: false }, () => {
  const cwd = makeProject();
  const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    withRoot(cwd, () => {
      ledger.createGoals(cwd, SLUG, ['First::first objective']);
      ledger.renderState(cwd, SLUG);
      const acceptanceFile = join(cwd, 'G001.acceptance.json');
      writeFileSync(acceptanceFile, JSON.stringify({
        schema: 2,
        goalId: 'G001',
        goalShape: { outcomes: [{ id: 'O001', statement: 'Complete safely',
          completionMetric: 'Goal completion remains debt-gated' }],
          allowedPaths: ['hooks/scripts/lib/ledger.mjs'], nonGoals: ['No release'], dependencies: [] },
        requirements: [{ id: 'R001', outcomeId: 'O001', criterion: 'Requested behavior works', command: 'node --test --help' }],
        scenarios: [{ id: 'S001', outcomeId: 'O001', kind: 'user-journey', scenario: 'A user completes the primary flow', expected: 'The requested result is visible', command: 'node --test --help' }],
        regression: { outcomeId: 'O001', scope: 'existing behavior', command: 'node --test --help' },
        traceability: [{ requirementId: 'R001', scenarioIds: ['S001'] }],
        humanAcceptance: { required: false },
        goalAlignment: { objective: 'first objective', outcomeId: 'O001', rationale: 'The scenario observes the objective.' },
        riskAssessment: { categories: ['none'], rationale: 'Fixture only.' },
      }), 'utf8');
      assert.equal(ledger.setGoalAcceptance(cwd, SLUG, { goalId: 'G001', file: acceptanceFile }).acceptance.status, 'defined');
      assert.equal(ledger.executePlanGoalTransition(cwd, SLUG, { action: 'next',
        sessionId: '11111111-1111-4111-8111-111111111111' }).code, 'PROJECTED');
      ledger.runGoalEvidence(cwd, SLUG, { goalId: 'G001', role: 'implementation',
        sessionId: '11111111-1111-4111-8111-111111111111' });
      ledger.runGoalEvidence(cwd, SLUG, { goalId: 'G001', role: 'verification', verifier: 'fresh reviewer',
        sessionId: '22222222-2222-4222-8222-222222222222' });

      const fixture = stageProjectionFixture(cwd, operationId);
      assert.equal(ledger.stageLifecycleProjection(cwd, SLUG, { operationId, recipe: fixture.recipe }).code, 'STAGED');
      const claim = ledger.claimLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, owner: 'worker', leaseMs: 1000 });
      assert.equal(claim.code, 'CLAIMED');
      assert.equal(fixture.controller.transition(claim.child.request).code, 'ALLOWED');
      const settled = ledger.settleLifecycleChild(cwd, SLUG, { operationId, ordinal: 0, claimToken: claim.child.claim.token });
      assert.equal(settled.operation.status, 'committed');
      fixture.controller.close();

      assert.equal(typeof ledger.quarantineLifecycleProjection, 'function');
      assert.equal(typeof ledger.getLifecycleProjectionDebt, 'function');
      assert.equal(typeof ledger.assertNoLifecycleProjectionDebt, 'function');
      assert.equal(typeof ledger.resolveLifecycleProjectionDebt, 'function');
      assert.equal(typeof ledger.bindLifecycleProjectionDebtCompensation, 'function');

      const db = openSqlite(cwd);
      const prefix = `.qe/planning/plans/${SLUG}/`;
      const goalsPath = prefix + 'goals.json';
      const goalsRow = db.prepare('SELECT content FROM qe_files WHERE path=?').get(goalsPath);
      const tamperedGoals = `${goalsRow.content}\n`;
      db.prepare('UPDATE qe_files SET content=?,size=?,sha256=? WHERE path=?').run(
        tamperedGoals, Buffer.byteLength(tamperedGoals), sha256(tamperedGoals), goalsPath,
      );
      closeSqlite(db);

      assert.equal(ledger.applyLifecycleOutcomeProjection(cwd, SLUG, { operationId }).code, 'TARGET_CONFLICT');

      const quarantine = ledger.quarantineLifecycleProjection(cwd, SLUG, {
        operationId,
        reason: 'TARGET_CONFLICT',
        replacementOperationId: null,
      });
      assert.equal(quarantine.code, 'QUARANTINED');

      const assertion = ledger.assertNoLifecycleProjectionDebt(cwd, SLUG);
      assert.equal(assertion.code, 'OUTSTANDING_DEBT');

      const completionFile = join(cwd, 'G001.completion.json');
      writeFileSync(completionFile, JSON.stringify({
        schema: 1,
        goalId: 'G001',
        requirements: [{ id: 'R001', outcome: 'pass', evidence: 'targeted behavior test passed' }],
        scenarios: [{ id: 'S001', outcome: 'pass', evidence: 'primary user flow executed successfully' }],
        regression: { outcome: 'pass', evidence: 'node --test passed' },
        independentVerification: { verifier: 'fresh reviewer', mode: 'machine-reexecution', outcome: 'pass', evidence: 'machine reran the locked acceptance commands' },
        goalAlignment: { objective: 'first objective', outcomeId: 'O001', verifier: 'fresh reviewer', outcome: 'pass', evidence: 'The independent verifier confirmed each result covers the unchanged Goal objective.' },
        humanAcceptance: { status: 'not-required' },
        limitations: [],
      }), 'utf8');
      assert.throws(() => ledger.recordGoalEvidence(cwd, SLUG, { goalId: 'G001', file: completionFile }),
        error => error?.code === 'PROJECTION_DEBT_OUTSTANDING');
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
