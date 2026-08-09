import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProcessController } from '../process-controller.mjs';
import { createProcessControllerStore } from '../process-controller-store.mjs';
import { closeSqlite, openSqlite } from '../store-sqlite.mjs';
import { independentOracle, qualifyCardinality, runQualification, seedFixture, TABLES } from '../../../../scripts/benchmark-process-metrics.mjs';

function fixture(prefix = 'qe-metrics-scale-') { return mkdtempSync(path.join(tmpdir(), prefix)); }

test('fingerprint-bound recorder distinguishes prepare from every statement execution', () => {
  const cwd = fixture(); const events = []; const db = openSqlite(cwd, { statementObserver: event => events.push(event) });
  try {
    db.exec('CREATE TABLE recorder_probe(value INTEGER)');
    const statement = db.prepare('SELECT value FROM recorder_probe');
    assert.equal(events.length, 0, 'prepare-only must not count as execution');
    statement.all(); statement.all();
    assert.equal(events.length, 2, 'cached statement must count every execution');
    assert.deepEqual(events[0], { kind: 'sqlite-statement-execution', selectCount: 1,
      tables: ['recorder_probe'] });
    assert.equal(Object.isFrozen(events[0]), true); assert.equal(Object.isFrozen(events[0].tables), true);
  } finally { closeSqlite(db); rmSync(cwd, { recursive: true, force: true }); }
});

test('processMetrics executes one fingerprinted bulk SELECT per metrics table at fixed cardinalities', () => {
  for (const cardinality of [0, 100]) {
    const cwd = fixture();
    try {
      seedFixture(cwd, cardinality); let events = [];
      const store = createProcessControllerStore(cwd, { metricsStatementObserver: event => events.push(event) });
      events = []; const report = store.processMetrics();
      const reads = events.filter(event => event.selectCount > 0);
      assert.equal(reads.length, 7); assert.ok(reads.every(event => event.selectCount === 1));
      assert.deepEqual(reads.flatMap(event => event.tables).sort(), [...TABLES].sort());
      assert.deepEqual(report.counts, { controllerProcesses: cardinality, sivsProcesses: cardinality,
        boundTasks: cardinality, verifiedTasks: 0 });
      assert.equal(report.metrics.at(-1).reason,
        cardinality === 0 ? 'VERIFICATION_PROOF_POPULATION_EMPTY' : 'VERIFICATION_HISTORY_UNPROVABLE');
      assert.equal(independentOracle(cwd).logicalTasks, cardinality);
      store.close();
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('empty golden vector and public constructor instrumentation confinement remain fixed', () => {
  const cwd = fixture(); const leaked = [];
  try {
    const controller = createProcessController({ cwd, layer: 'sivs', authority: 'sivs-controller',
      metricsStatementObserver: event => leaked.push(event) });
    const report = controller.processMetrics();
    assert.equal(report.digest, '6aa18a93d3c73006c569bc56737825b42b1a21dbc281a83ecd2a60b1ed556014');
    assert.equal(report.metrics.at(-1).reason, 'VERIFICATION_PROOF_POPULATION_EMPTY');
    assert.deepEqual(leaked, []); controller.close();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('persistent child qualification uses 20 warm samples and fixed RSS/query budgets', async () => {
  const row = await qualifyCardinality(0);
  assert.equal(row.qualification, 'PASS');
  assert.equal(row.warmSamplesMs.length, 20);
  assert.equal(row.fingerprint.filter(item => item.selectCount > 0).length, 7);
  assert.ok(row.rssDeltaBytes <= 536_870_912);
});

test('an incomplete cardinality set cannot qualify the broad scale gate', async () => {
  const report = await runQualification([0]);
  assert.equal(report.status, 'NOT_QUALIFIED');
  assert.deepEqual(report.coverage.requiredCardinalities, [0, 100, 1000, 10000]);
  assert.deepEqual(report.coverage.measuredCardinalities, [0]);
  assert.equal(report.rows[0].executionCount, 7);
  assert.equal(report.rows[0].p95GrowthVsPrevious, null);
});
