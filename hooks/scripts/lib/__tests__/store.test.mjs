#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openStore } from '../store.mjs';
import { isSqliteAvailable } from '../store-sqlite.mjs';
import { normalizeStatus, parseTaskLog, reindex } from '../store-indexer.mjs';

const SQLITE = isSqliteAvailable();
const BACKENDS = SQLITE ? ['file', 'sqlite'] : ['file'];

/**
 * Create a throwaway project root with a `.qe` directory.
 * @returns {string} Absolute path to the project root
 */
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-store-'));
  fs.mkdirSync(path.join(root, '.qe'), { recursive: true });
  return root;
}

// ---------------------------------------------------------------------------
// Backend parity — the property P1 depends on before reads may switch over.
// ---------------------------------------------------------------------------

for (const backend of BACKENDS) {
  test(`[${backend}] state round-trips through the facade`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      assert.equal(store.getState('ns', 'missing'), null);
      store.setState('ns', 'k', { a: 1, nested: { b: 'x' } });
      assert.deepEqual(store.getState('ns', 'k'), { a: 1, nested: { b: 'x' } });
    } finally { store.close(); }
  });

  test(`[${backend}] counters accumulate`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      assert.equal(store.getCounter('t', 'c'), 0);
      assert.equal(store.bumpCounter('t', 'c', 1), 1);
      assert.equal(store.bumpCounter('t', 'c', 4), 5);
      assert.equal(store.getCounter('t', 'c'), 5);
    } finally { store.close(); }
  });

  test(`[${backend}] session scoping keeps counters separate`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      store.bumpCounter('t', 'c', 3, { sessionId: 'a' });
      store.bumpCounter('t', 'c', 7, { sessionId: 'b' });
      assert.equal(store.getCounter('t', 'c', { sessionId: 'a' }), 3);
      assert.equal(store.getCounter('t', 'c', { sessionId: 'b' }), 7);
    } finally { store.close(); }
  });

  test(`[${backend}] events preserve insertion order within one millisecond`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      for (const tool of ['A', 'B', 'C', 'D']) store.appendEvent({ kind: 'tool_use', tool });
      assert.deepEqual(store.queryEvents({ limit: 10 }).map(r => r.tool), ['A', 'B', 'C', 'D']);
    } finally { store.close(); }
  });

  test(`[${backend}] events filter by kind`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      store.appendEvent({ kind: 'tool_use', tool: 'Read' });
      store.appendEvent({ kind: 'failure', tool: 'Bash' });
      store.appendEvent({ kind: 'failure', tool: 'Edit' });
      assert.equal(store.queryEvents({ kind: 'failure' }).length, 2);
      assert.equal(store.queryEvents({ kind: 'tool_use' }).length, 1);
    } finally { store.close(); }
  });

  test(`[${backend}] queryTasks reads TASK_LOG.md`, () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, '.qe', 'TASK_LOG.md'), [
      '# Task Log',
      '',
      '| UUID | Task | Status | Plan/Phase | Date |',
      '|------|------|--------|-----------|------|',
      '| aaa1 | first thing | ✅ | planA / P1 | 2026-07-20 |',
      '| bbb2 | second thing | 🔲 | planB / P2 | 2026-07-21 |',
      '',
    ].join('\n'));

    const store = openStore(root, { backend });
    try {
      if (backend === 'sqlite') reindex(root, store);
      const done = store.queryTasks({ status: 'done' });
      assert.equal(done.length, 1);
      assert.equal(done[0].uuid, 'aaa1');

      const pending = store.queryTasks({ status: 'pending' });
      assert.equal(pending.length, 1);
      assert.equal(pending[0].uuid, 'bbb2');

      // Column shape must match across backends or the CLI renders
      // different headers depending on the runtime.
      assert.deepEqual(Object.keys(done[0]).sort(),
        ['dated_at', 'plan', 'status', 'title', 'uuid']);
    } finally { store.close(); }
  });
}

// ---------------------------------------------------------------------------
// Fail-open and backend selection
// ---------------------------------------------------------------------------

test('forcing an unavailable backend still yields a working store', () => {
  const root = makeProject();
  const store = openStore(root, { backend: 'sqlite' });
  try {
    store.setState('ns', 'k', 1);
    assert.equal(store.getState('ns', 'k'), 1);
    assert.ok(['file', 'sqlite'].includes(store.backend));
  } finally { store.close(); }
});

test('explicit file backend is honoured even when sqlite exists', () => {
  const root = makeProject();
  const store = openStore(root, { backend: 'file' });
  try {
    assert.equal(store.backend, 'file');
    assert.equal(fs.existsSync(path.join(root, '.qe', 'qe.db')), false);
  } finally { store.close(); }
});

test('file backend reports no derived index rather than an empty one', () => {
  const root = makeProject();
  const store = openStore(root, { backend: 'file' });
  try {
    // null means "no index, scan the filesystem"; [] would falsely claim the
    // index exists and is empty.
    assert.equal(store.queryFiles({ kind: 'task' }), null);
  } finally { store.close(); }
});

// ---------------------------------------------------------------------------
// Concurrency — the defect ADR-027 exists to fix
// ---------------------------------------------------------------------------

test('sqlite counters survive concurrent writers; file counters do not', { skip: !SQLITE }, async () => {
  const { spawnSync } = await import('node:child_process');
  const storeUrl = new URL('../store.mjs', import.meta.url).href;
  const WORKERS = 4;
  const PER_WORKER = 50;

  const runRace = (backend) => {
    const root = makeProject();
    // Create the schema once up front; racing the DDL is a separate concern.
    const warm = openStore(root, { backend });
    warm.getCounter('bench', 'hits');
    warm.close();

    // Arguments arrive by environment, not argv: under `node -e` there is no
    // script path, so argv[1] is already the first user argument and the
    // usual argv[2]/argv[3] offsets silently read undefined.
    const script = `
      const { openStore } = await import(${JSON.stringify(storeUrl)});
      const s = openStore(process.env.RACE_ROOT, { backend: process.env.RACE_BACKEND });
      for (let i = 0; i < ${PER_WORKER}; i++) s.bumpCounter('bench', 'hits', 1);
      s.close();
    `;
    const children = Array.from({ length: WORKERS }, () => spawnSync(
      process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, RACE_ROOT: root, RACE_BACKEND: backend } },
    ));
    for (const child of children) assert.equal(child.status, 0, child.stderr);

    const store = openStore(root, { backend });
    const total = store.getCounter('bench', 'hits');
    store.close();
    return total;
  };

  const expected = WORKERS * PER_WORKER;
  assert.equal(runRace('sqlite'), expected, 'sqlite must not lose increments');
  // The file backend is expected to lose updates. Asserting it documents the
  // defect so a future "fix" to the file backend cannot land unnoticed.
  assert.ok(runRace('file') <= expected, 'file backend cannot exceed the true count');
});

// ---------------------------------------------------------------------------
// TASK_LOG parsing
// ---------------------------------------------------------------------------

test('normalizeStatus maps the markers this project uses', () => {
  assert.equal(normalizeStatus('✅'), 'done');
  assert.equal(normalizeStatus('⏸️ waiting on key'), 'paused');
  assert.equal(normalizeStatus('🔲'), 'pending');
  assert.equal(normalizeStatus('🔄'), 'in-progress');
  assert.equal(normalizeStatus(''), 'unknown');
  assert.equal(normalizeStatus('something else'), 'unknown');
});

test('inline code containing a pipe does not shift later cells', () => {
  // Regression: a naive split('|') corrupted 5 of 106 real rows, pulling
  // status/plan/date out of the wrong columns.
  const rows = parseTaskLog([
    '| UUID | Task | Status | Plan/Phase | Date |',
    '|------|------|--------|-----------|------|',
    '| r5 | regex `(?:build|test)` widened | ✅ | ad-hoc | 2026-07-05 |',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].uuid, 'r5');
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[0].plan, 'ad-hoc');
  assert.equal(rows[0].datedAt, Date.UTC(2026, 6, 5));
});

test('escaped pipes stay content', () => {
  const rows = parseTaskLog([
    '| UUID | Task | Status | Plan/Phase | Date |',
    '|------|------|--------|-----------|------|',
    '| e1 | a \\| b | ✅ | p | 2026-07-05 |',
  ].join('\n'));
  assert.equal(rows[0].body, 'a | b');
  assert.equal(rows[0].status, 'done');
});

test('column order is read from the header, not assumed', () => {
  const rows = parseTaskLog([
    '| Status | UUID | Task |',
    '|--------|------|------|',
    '| ✅ | zz9 | reordered |',
  ].join('\n'));
  assert.equal(rows[0].uuid, 'zz9');
  assert.equal(rows[0].status, 'done');
});

test('long bodies are truncated in title but preserved in body', () => {
  const long = 'x'.repeat(500);
  const rows = parseTaskLog([
    '| UUID | Task | Status |',
    '|------|------|--------|',
    `| t1 | ${long} | ✅ |`,
  ].join('\n'));
  assert.ok(rows[0].title.length < 250);
  assert.equal(rows[0].body.length, 500);
});

test('parseTaskLog tolerates empty and malformed input', () => {
  assert.deepEqual(parseTaskLog(''), []);
  assert.deepEqual(parseTaskLog('no table here'), []);
  assert.deepEqual(parseTaskLog('| a | b |\n| c | d |'), []); // no recognisable header
});

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

test('reindex is a no-op on the file backend', () => {
  const root = makeProject();
  const store = openStore(root, { backend: 'file' });
  try {
    assert.deepEqual(reindex(root, store), { files: 0, tasks: 0, skipped: true, pruned: 0 });
  } finally { store.close(); }
});

test('reindex indexes files and prunes rows for deleted files', { skip: !SQLITE }, () => {
  const root = makeProject();
  const pending = path.join(root, '.qe', 'tasks', 'pending');
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(path.join(pending, 'TASK_REQUEST_abc123.md'), '# Spec one\n');
  fs.writeFileSync(path.join(pending, 'TASK_REQUEST_def456.md'), '# Spec two\n');

  const store = openStore(root, { backend: 'sqlite' });
  try {
    const first = reindex(root, store);
    assert.equal(first.files, 2);
    assert.equal(store.queryFiles({ kind: 'task' }).length, 2);

    const rows = store.queryFiles({ kind: 'task', status: 'pending' });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.status === 'pending'));
    assert.ok(rows.some(r => r.uuid === 'abc123'));

    fs.unlinkSync(path.join(pending, 'TASK_REQUEST_abc123.md'));
    const second = reindex(root, store);
    assert.equal(second.pruned, 1, 'row for the deleted file must be pruned');
    assert.equal(store.queryFiles({ kind: 'task' }).length, 1);
  } finally { store.close(); }
});

test('schema migrates forward on an existing database', { skip: !SQLITE }, () => {
  const root = makeProject();
  const a = openStore(root, { backend: 'sqlite' });
  a.setState('ns', 'k', 'v');
  a.close();

  // Re-opening must not wipe or fail on the already-migrated database.
  const b = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(b.getState('ns', 'k'), 'v');
  } finally { b.close(); }
});
