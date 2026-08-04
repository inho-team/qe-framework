import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntake, issueNextBatch, pauseIntake } from '../knowledge-elicitation.mjs';
import {
  IntakeStoreError, initializeIntakeRecord, mutateIntakeRecord, readIntakeRecord,
} from '../knowledge-elicitation-store.mjs';
import { loadSqliteModule } from '../store-sqlite.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const question = { id: 'q1', text: 'What outcome matters?', dimension: 'acceptance', kind: 'base', ordinal: 1 };

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-intake-store-'));
  mkdirSync(join(cwd, '.qe'), { recursive: true });
  return cwd;
}

function rowBytes(cwd, slug = 'demo') {
  const sqlite = loadSqliteModule();
  const db = new sqlite.DatabaseSync(join(cwd, '.qe', 'qe.db'));
  try { return db.prepare('SELECT content FROM qe_files WHERE path=?').get(`.qe/planning/plans/${slug}/INTAKE.json`)?.content; }
  finally { db.close(); }
}

test('initializes revision 1 and rejects duplicate initialization', () => {
  const cwd = project();
  const first = initializeIntakeRecord(cwd, 'demo', OWNER, createIntake({ inventory: [question] }));
  assert.equal(first.revision, 1);
  assert.equal(readIntakeRecord(cwd, 'demo').ownerSession, OWNER);
  assert.throws(() => initializeIntakeRecord(cwd, 'demo', OWNER, first.intake),
    (error) => error instanceof IntakeStoreError && error.code === 'INTAKE_STORE_EXISTS');
});

test('matching owner and revision commit exactly one revision', () => {
  const cwd = project();
  initializeIntakeRecord(cwd, 'demo', OWNER, createIntake({ inventory: [question] }));
  const changed = mutateIntakeRecord(cwd, 'demo', {
    ownerSession: OWNER, expectedRevision: 1,
    transition: (state) => issueNextBatch(state).state,
  });
  assert.equal(changed.changed, true);
  assert.equal(changed.record.revision, 2);
  assert.equal(changed.record.intake.questions[0].label, '[1/1]');
  const unchanged = mutateIntakeRecord(cwd, 'demo', {
    ownerSession: OWNER, expectedRevision: 2,
    transition: (state) => issueNextBatch(state).state,
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.record.revision, 2);
});

test('stale revision and competing owner preserve prior bytes', () => {
  const cwd = project();
  initializeIntakeRecord(cwd, 'demo', OWNER, createIntake({ inventory: [question] }));
  const before = rowBytes(cwd);
  assert.throws(() => mutateIntakeRecord(cwd, 'demo', {
    ownerSession: OWNER, expectedRevision: 2, transition: pauseIntake,
  }), (error) => error.code === 'INTAKE_STORE_STALE_REVISION');
  assert.equal(rowBytes(cwd), before);
  assert.throws(() => mutateIntakeRecord(cwd, 'demo', {
    ownerSession: OTHER, expectedRevision: 1, transition: pauseIntake,
  }), (error) => error.code === 'INTAKE_STORE_OWNER_CONFLICT');
  assert.equal(rowBytes(cwd), before);
});

test('rejects history rewrite and unsafe identifiers without changing bytes', () => {
  const cwd = project();
  initializeIntakeRecord(cwd, 'demo', OWNER, createIntake({ inventory: [question] }));
  const before = rowBytes(cwd);
  assert.throws(() => mutateIntakeRecord(cwd, 'demo', {
    ownerSession: OWNER, expectedRevision: 1,
    transition: (state) => ({ ...state, history: [] }),
  }), (error) => error.code === 'INTAKE_STORE_HISTORY_REWRITE');
  assert.equal(rowBytes(cwd), before);
  assert.throws(() => readIntakeRecord(cwd, '../escape'), (error) => error.code === 'INTAKE_STORE_INVALID_SLUG');
  assert.throws(() => mutateIntakeRecord(cwd, 'demo', {
    ownerSession: 'unknown', expectedRevision: 1, transition: pauseIntake,
  }), (error) => error.code === 'INTAKE_STORE_INVALID_SESSION');
});
