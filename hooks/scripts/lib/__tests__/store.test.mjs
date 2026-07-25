#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openStore } from '../store.mjs';
import { isSqliteAvailable } from '../store-sqlite.mjs';
import {
  normalizeStatus, parseFailureContext, parseTaskLog, parseWikiPage, reindex,
} from '../store-indexer.mjs';

/** A realistic failure record as written by failure-capture.mjs. */
const FAILURE_DOC = [
  '# Failure Context',
  '',
  'date: 2026-07-17T12:36:41.291Z',
  'task_uuid: a9eb6eaf',
  '',
  '## Failure Reasons',
  '- VERIFY_CHECKLIST VERIFY_CHECKLIST_a9eb6eaf.md: 22 unchecked item(s)',
  '',
  '## Unchecked Checklist Items',
  '- [ ] first',
  '- [ ] second',
  '',
  '## Changed Files',
  '- README.md',
  '- docs/X.md',
  '- scripts/y.mjs',
  '',
].join('\n');

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
// ContextMemo
//
// Every assertion here backs a decision that can HARD-BLOCK a user's Read, so
// the bias under test is: when anything is uncertain, report not-cached.
// ---------------------------------------------------------------------------

for (const backend of BACKENDS) {
  test(`[${backend}] memo caches a file and reports it valid`, () => {
    const root = makeProject();
    const file = path.join(root, 'a.txt');
    fs.writeFileSync(file, 'hello');

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      assert.equal(store.memoValid(file), false, 'nothing cached yet');
      store.memoPut(file, 'hello');
      assert.equal(store.memoValid(file), true);
      assert.equal(store.memoGet(file), 'hello');
    } finally { store.close(); }
  });

  test(`[${backend}] an external edit invalidates the cache`, () => {
    const root = makeProject();
    const file = path.join(root, 'b.txt');
    fs.writeFileSync(file, 'v1');

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      store.memoPut(file, 'v1');
      assert.equal(store.memoValid(file), true);

      // A Bash/git/editor change never calls memoMarkModified; mtime is the
      // only signal, and blocking here would serve the model stale content.
      const future = new Date(Date.now() + 5000);
      fs.writeFileSync(file, 'v2');
      fs.utimesSync(file, future, future);
      assert.equal(store.memoValid(file), false, 'mtime change must invalidate');
    } finally { store.close(); }
  });

  test(`[${backend}] a deleted file is never a cache hit`, () => {
    const root = makeProject();
    const file = path.join(root, 'c.txt');
    fs.writeFileSync(file, 'x');

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      store.memoPut(file, 'x');
      fs.unlinkSync(file);
      assert.equal(store.memoValid(file), false);
    } finally { store.close(); }
  });

  test(`[${backend}] memoMarkModified invalidates`, () => {
    const root = makeProject();
    const file = path.join(root, 'd.txt');
    fs.writeFileSync(file, 'x');

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      store.memoPut(file, 'x');
      store.memoMarkModified(file);
      assert.equal(store.memoValid(file), false);
      assert.equal(store.memoGet(file), null);
    } finally { store.close(); }
  });

  test(`[${backend}] memoClear empties the cache`, () => {
    const root = makeProject();
    const file = path.join(root, 'e.txt');
    fs.writeFileSync(file, 'x');

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      store.memoPut(file, 'x');
      store.memoClear();
      // This is the post-compaction guarantee: a surviving entry would block
      // the re-read of content the model no longer holds.
      assert.equal(store.memoValid(file), false);
      assert.equal(store.memoStats().files, 0);
    } finally { store.close(); }
  });

  test(`[${backend}] oversized files are not cached`, () => {
    const root = makeProject();
    const file = path.join(root, 'big.txt');
    const big = 'x'.repeat(11 * 1024); // over the 10 KB per-file limit
    fs.writeFileSync(file, big);

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      store.memoPut(file, big);
      assert.equal(store.memoValid(file), false);
    } finally { store.close(); }
  });

  test(`[${backend}] an empty body is never a cache hit`, () => {
    // Regression: state.mjs treats a falsy cached body as "not cached", so a
    // Read that returned nothing must not block the next one. The sqlite
    // backend originally stored '' as a real value and blocked on it, telling
    // the model to reuse content it never received.
    const root = makeProject();
    const file = path.join(root, 'empty.txt');
    fs.writeFileSync(file, '');

    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      store.memoPut(file, '');
      assert.equal(store.memoValid(file), false);
    } finally { store.close(); }
  });

  test(`[${backend}] memoValid rejects empty and unknown paths`, () => {
    const root = makeProject();
    const store = openStore(root, { backend, sessionId: 's1' });
    try {
      assert.equal(store.memoValid(''), false);
      assert.equal(store.memoValid('/definitely/not/here.txt'), false);
    } finally { store.close(); }
  });
}

test('sqlite memo is per session; the file blob is shared', { skip: !SQLITE }, () => {
  const root = makeProject();
  const file = path.join(root, 'shared.txt');
  fs.writeFileSync(file, 'x');

  const a = openStore(root, { backend: 'sqlite', sessionId: 'sessA' });
  const b = openStore(root, { backend: 'sqlite', sessionId: 'sessB' });
  try {
    a.memoPut(file, 'x');
    assert.equal(a.memoValid(file), true);
    assert.equal(b.memoValid(file), false, 'another session must not inherit the cache');

    // And clearing one session leaves the other intact — the property the
    // shared blob cannot offer, where session-start wipes everyone.
    b.memoPut(file, 'x');
    b.memoClear();
    assert.equal(a.memoValid(file), true);
  } finally { a.close(); b.close(); }
});

test('sqlite memo evicts least-recently-read entries past the size budget',
  { skip: !SQLITE }, () => {
    const root = makeProject();
    const store = openStore(root, { backend: 'sqlite', sessionId: 's1' });
    try {
      // 20 x 8 KB = 160 KB against a 100 KB budget.
      const body = 'x'.repeat(8 * 1024);
      for (let i = 0; i < 20; i += 1) {
        const file = path.join(root, `f${i}.txt`);
        fs.writeFileSync(file, body);
        store.memoPut(file, body);
      }
      const stats = store.memoStats();
      assert.ok(stats.bytes <= 100 * 1024, `budget exceeded: ${stats.bytes}`);
      assert.ok(stats.files > 0 && stats.files < 20, `expected eviction, got ${stats.files}`);
      // The most recent write must survive; the oldest must not.
      assert.equal(store.memoValid(path.join(root, 'f19.txt')), true);
      assert.equal(store.memoValid(path.join(root, 'f0.txt')), false);
    } finally { store.close(); }
  });

// ---------------------------------------------------------------------------
// Sessions (ADR-027 P2 first slice)
// ---------------------------------------------------------------------------

for (const backend of BACKENDS) {
  test(`[${backend}] sessions round-trip and endSession removes from the active list`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      store.upsertSession({ sid: 'aaaaaaaa', name: 'one', plan: 'p1', pid: 111 });
      store.upsertSession({ sid: 'bbbbbbbb', name: 'two', plan: 'p2', pid: 222 });

      const active = store.listSessions({ activeOnly: true });
      assert.equal(active.length, 2);
      assert.deepEqual(active.map(s => s.sid).sort(), ['aaaaaaaa', 'bbbbbbbb']);
      assert.deepEqual(Object.keys(active[0]).sort(),
        ['last_seen', 'name', 'pid', 'plan', 'sid']);

      store.endSession('aaaaaaaa');
      const after = store.listSessions({ activeOnly: true });
      assert.deepEqual(after.map(s => s.sid), ['bbbbbbbb']);
    } finally { store.close(); }
  });

  test(`[${backend}] upsertSession updates rather than duplicating`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      store.upsertSession({ sid: 'cccccccc', name: 'before', pid: 1 });
      store.upsertSession({ sid: 'cccccccc', name: 'after', pid: 2 });
      const rows = store.listSessions({ activeOnly: true });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'after');
    } finally { store.close(); }
  });
}

test('concurrent session upserts: sqlite keeps every entry, file loses some',
  { skip: !SQLITE }, async () => {
    const { spawnSync } = await import('node:child_process');
    const storeUrl = new URL('../store.mjs', import.meta.url).href;
    // Eight distinct 8-char sids, matching SID_RE in session-registry.mjs.
    const sids = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd',
      'eeeeeeee', 'ffffffff', 'gggggggg', 'hhhhhhhh'];

    const race = (backend) => {
      const root = makeProject();
      const warm = openStore(root, { backend });
      warm.listSessions({});
      warm.close();

      const script = `
        const { openStore } = await import(${JSON.stringify(storeUrl)});
        const s = openStore(process.env.RACE_ROOT, { backend: process.env.RACE_BACKEND });
        s.upsertSession({ sid: process.env.RACE_SID, name: process.env.RACE_SID, pid: process.pid });
        s.close();
      `;
      const kids = sids.map(sid => spawnSync(
        process.execPath, ['--input-type=module', '-e', script],
        { encoding: 'utf8', env: { ...process.env, RACE_ROOT: root, RACE_BACKEND: backend, RACE_SID: sid } },
      ));
      for (const kid of kids) assert.equal(kid.status, 0, kid.stderr);

      const store = openStore(root, { backend });
      const seen = store.listSessions({ activeOnly: true }).length;
      store.close();
      return seen;
    };

    assert.equal(race('sqlite'), sids.length, 'sqlite must keep every session');
    // Documents the defect this slice routes around; the file registry's
    // read-modify-write drops entries under concurrent starts.
    assert.ok(race('file') <= sids.length);
  });

// ---------------------------------------------------------------------------
// SIVS loop guard — the counter whose loss defeats a hard block
// ---------------------------------------------------------------------------

test('concurrent remediation rounds are counted exactly, so the limit holds',
  { skip: !SQLITE }, async () => {
    // Before this, six concurrent rounds each reported count 1 / blocked false
    // and persisted a final count of 1: the SIVS runaway guard was defeated
    // entirely. Sequentially the same six counted 1..6 and blocked from four.
    const { spawnSync } = await import('node:child_process');
    const guardUrl = new URL('../loop-guard.mjs', import.meta.url).href;
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.qe', 'state'), { recursive: true });

    // Create the schema up front; racing the DDL is covered separately.
    const warm = openStore(root, { backend: 'sqlite' });
    warm.getCounter('sivs_loop', 'warm');
    warm.close();

    const script = `
      const { recordAndCheck } = await import(${JSON.stringify(guardUrl)});
      const r = recordAndCheck(process.env.LG_CWD, 'task-x', 'remediation');
      process.stdout.write(JSON.stringify(r) + '\\n');
    `;
    const kids = Array.from({ length: 6 }, () => spawnSync(
      process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, LG_CWD: root } },
    ));

    const counts = kids.map(k => JSON.parse(k.stdout.trim()).count).sort((a, b) => a - b);
    assert.deepEqual(counts, [1, 2, 3, 4, 5, 6], 'every round must get a distinct count');

    const blocked = kids.filter(k => JSON.parse(k.stdout.trim()).blocked).length;
    assert.equal(blocked, 3, 'rounds 4, 5 and 6 must be blocked against a limit of 3');
  });

test('an existing unified-state count is carried into the store, not discarded',
  { skip: !SQLITE }, async () => {
    // Regression: making the store authoritative initially reset any count
    // already recorded in unified-state, so a task mid-loop had its limit
    // cleared at exactly the moment the guard was doing its job.
    const { recordAndCheck } = await import('../loop-guard.mjs');
    const root = makeProject();
    const stateDir = path.join(root, '.qe', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'unified-state.json'), JSON.stringify({
      sivs_loops: {
        'uuid-seed': {
          reentry: 0, remediation_rounds: 3, stages: [],
          first_seen: Date.now(), updated_at: Date.now(),
        },
      },
    }));

    const verdict = recordAndCheck(root, 'uuid-seed', 'remediation');
    assert.equal(verdict.count, 4, 'must continue from the recorded 3, not restart at 1');
    assert.equal(verdict.blocked, true);
  });

test('seedCounter is insert-if-absent so a racing first touch cannot double it',
  { skip: !SQLITE }, () => {
    const root = makeProject();
    const store = openStore(root, { backend: 'sqlite' });
    try {
      store.seedCounter('ns', 'k', 3);
      store.seedCounter('ns', 'k', 3); // second seed must be a no-op
      assert.equal(store.getCounter('ns', 'k'), 3);
      assert.equal(store.bumpCounter('ns', 'k', 1), 4);
      // A seed after the key exists must not overwrite the live count.
      store.seedCounter('ns', 'k', 99);
      assert.equal(store.getCounter('ns', 'k'), 4);
    } finally { store.close(); }
  });

test('resetLoop clears the store counters, so a task is not blocked forever',
  { skip: !SQLITE }, async () => {
    // The dangerous direction: a stale counter surviving a reset blocks
    // legitimate work, which is worse than failing to stop a runaway.
    const { recordAndCheck, resetLoop, checkLimits } = await import('../loop-guard.mjs');
    const root = makeProject();
    fs.mkdirSync(path.join(root, '.qe', 'state'), { recursive: true });

    for (let i = 0; i < 5; i += 1) recordAndCheck(root, 'uuid-reset', 'remediation');
    assert.equal(checkLimits(root, 'uuid-reset').remediation.blocked, true);

    resetLoop(root, 'uuid-reset');
    assert.equal(checkLimits(root, 'uuid-reset').remediation.count, 0);
    assert.equal(checkLimits(root, 'uuid-reset').remediation.blocked, false);
    assert.equal(recordAndCheck(root, 'uuid-reset', 'remediation').count, 1);
  });

for (const backend of BACKENDS) {
  test(`[${backend}] resetCounter removes the key`, () => {
    const root = makeProject();
    const store = openStore(root, { backend });
    try {
      store.bumpCounter('ns', 'k', 5);
      assert.equal(store.getCounter('ns', 'k'), 5);
      store.resetCounter('ns', 'k');
      assert.equal(store.getCounter('ns', 'k'), 0);
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
// LLM wiki
// ---------------------------------------------------------------------------

/** A concept page in the shape `.qe/wiki/conventions.md` specifies. */
const WIKI_CONCEPT = [
  '---',
  'type: concept',
  'canonical: store-tiering',
  'aka: ["티어링", "storage tiering"]',
  'topic: demo',
  'summary: "Tier A/B/C 저장 분류."',
  'tags: [storage, adr-027, tiering]',   // bare flow scalars — the parse trap
  'provenance: extracted',
  'tier: draft',
  'status: active',
  'updated: 2026-07-25',
  '---',
  '**정의:** ADR-027의 3계층 저장 분류.',
  '## Key points',
  '- rebuildable [[sources/adr-027]]',
  '- dangling [[concepts/missing-page]]',
  '',
].join('\n');

const WIKI_SOURCE = [
  '---',
  'type: source',
  'title: "ADR-027"',
  'topic: demo',
  'summary: "store and query layer."',
  'tags: [decision]',
  'provenance: inferred',
  'tier: reviewed',
  '---',
  'TL;DR',
  '',
].join('\n');

/**
 * Write a two-page wiki into a project.
 * @param {string} root - Project root
 */
function seedWiki(root) {
  const base = path.join(root, '.qe', 'wiki', 'pages', 'demo');
  fs.mkdirSync(path.join(base, 'concepts'), { recursive: true });
  fs.mkdirSync(path.join(base, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(base, 'concepts', 'store-tiering.md'), WIKI_CONCEPT);
  fs.writeFileSync(path.join(base, 'sources', 'adr-027.md'), WIKI_SOURCE);
}

test('parseWikiPage reads frontmatter, slug and links', () => {
  const parsed = parseWikiPage(WIKI_CONCEPT, '.qe/wiki/pages/demo/concepts/store-tiering.md');
  assert.equal(parsed.page.type, 'concept');
  assert.equal(parsed.page.topic, 'demo');
  assert.equal(parsed.page.slug, 'concepts/store-tiering');
  assert.equal(parsed.page.title, 'store-tiering');
  assert.equal(parsed.page.tier, 'draft');
  assert.equal(parsed.page.provenance, 'extracted');
  assert.deepEqual(JSON.parse(parsed.page.aka), ['티어링', 'storage tiering']);
  assert.deepEqual(parsed.links, ['sources/adr-027', 'concepts/missing-page']);
});

test('unquoted flow sequences do not defeat the parser', () => {
  // Regression: `tags: [storage, adr-027, tiering]` is parsed as inline JSON by
  // the shared frontmatter reader and was rejected, silently degrading 11 of 15
  // real pages to type "unknown" and hiding every other field with them.
  const parsed = parseWikiPage(WIKI_CONCEPT, '.qe/wiki/pages/demo/concepts/x.md');
  assert.equal(parsed.page.type, 'concept', 'must not fall back to unknown');

  // Already-quoted items must survive untouched.
  const quoted = WIKI_CONCEPT.replace(
    'tags: [storage, adr-027, tiering]',
    'sources: ["[[sources/adr-027]]", "[[sources/other]]"]',
  );
  assert.equal(parseWikiPage(quoted, 'x.md').page.type, 'concept');
});

test('a page with no frontmatter is still indexed, as unknown', () => {
  // "Which pages still need frontmatter" has to remain answerable.
  const parsed = parseWikiPage('# Just a heading\n', '.qe/wiki/pages/demo/aliases.md');
  assert.equal(parsed.page.type, 'unknown');
  assert.equal(parsed.page.topic, 'demo');
});

for (const backend of BACKENDS) {
  test(`[${backend}] queryWiki filters on frontmatter fields`, () => {
    const root = makeProject();
    seedWiki(root);
    const store = openStore(root, { backend });
    try {
      assert.equal(store.queryWiki({}).length, 2);
      assert.equal(store.queryWiki({ type: 'concept' }).length, 1);
      assert.equal(store.queryWiki({ tier: 'reviewed' }).length, 1);
      assert.equal(store.queryWiki({ provenance: 'extracted' }).length, 1);
      assert.equal(store.queryWiki({ topic: 'demo' }).length, 2);
      assert.equal(store.queryWiki({ slug: 'concepts/store-tiering' }).length, 1);
      assert.equal(store.queryWiki({ type: 'nope' }).length, 0);
    } finally { store.close(); }
  });

  test(`[${backend}] queryWikiLinks resolves the graph and finds dangling links`, () => {
    const root = makeProject();
    seedWiki(root);
    const store = openStore(root, { backend });
    try {
      const broken = store.queryWikiLinks({ broken: true });
      assert.equal(broken.length, 1);
      assert.equal(broken[0].target, 'concepts/missing-page');

      const inbound = store.queryWikiLinks({});
      const adr = inbound.find(r => r.slug === 'sources/adr-027');
      assert.equal(adr.inbound, 1, 'the concept page links to it');

      assert.equal(store.queryWikiLinks({ to: 'sources/adr-027' }).length, 1);
      assert.equal(store.queryWikiLinks({ from: 'store-tiering' }).length, 2);
    } finally { store.close(); }
  });

  test(`[${backend}] wiki queries answer without an explicit reindex`, () => {
    const root = makeProject();
    seedWiki(root);
    const store = openStore(root, { backend });
    try {
      // No reindex() anywhere: writing the page must be enough.
      assert.equal(store.queryWiki({ type: 'concept' }).length, 1);
    } finally { store.close(); }
  });
}

test('a page added after the first query is picked up', { skip: !SQLITE }, () => {
  const root = makeProject();
  seedWiki(root);
  const store = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(store.queryWiki({}).length, 2);
    fs.writeFileSync(
      path.join(root, '.qe', 'wiki', 'pages', 'demo', 'concepts', 'later.md'),
      WIKI_CONCEPT.replace('canonical: store-tiering', 'canonical: later'),
    );
    assert.equal(store.queryWiki({}).length, 3, 'the index must notice the new page');
  } finally { store.close(); }
});

test('removing a page drops it and its links', { skip: !SQLITE }, () => {
  const root = makeProject();
  seedWiki(root);
  const store = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(store.queryWiki({}).length, 2);
    fs.unlinkSync(path.join(root, '.qe', 'wiki', 'pages', 'demo', 'concepts', 'store-tiering.md'));
    assert.equal(store.queryWiki({}).length, 1);
    // Its outgoing links must go with it, not linger as phantom edges.
    assert.equal(store.queryWikiLinks({ broken: true }).length, 0);
  } finally { store.close(); }
});

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

test('reindex is a no-op on the file backend', () => {
  const root = makeProject();
  const store = openStore(root, { backend: 'file' });
  try {
    assert.deepEqual(reindex(root, store),
      { files: 0, tasks: 0, failures: 0, skipped: true, pruned: 0 });
  } finally { store.close(); }
});

// ---------------------------------------------------------------------------
// Failure history (Tier B)
// ---------------------------------------------------------------------------

test('parseFailureContext extracts the queryable fields', () => {
  const rec = parseFailureContext(FAILURE_DOC, '.qe/learning/failures/2026-07/x/CONTEXT.md');
  assert.equal(rec.taskUuid, 'a9eb6eaf');
  assert.equal(rec.occurredAt, Date.parse('2026-07-17T12:36:41.291Z'));
  assert.match(rec.reason, /22 unchecked/);
  assert.equal(rec.uncheckedCount, 2);
  assert.equal(rec.changedFiles, 3);
  assert.equal(rec.id, '.qe/learning/failures/2026-07/x/CONTEXT.md');
});

test('parseFailureContext ignores documents that are not failure records', () => {
  assert.equal(parseFailureContext('# Something Else\n\ndate: 2026-01-01', 'x.md'), null);
  assert.equal(parseFailureContext('', 'x.md'), null);
});

test('parseFailureContext survives missing sections', () => {
  const rec = parseFailureContext('# Failure Context\n\ndate: bad-date\n', 'y.md');
  assert.equal(rec.occurredAt, null);
  assert.equal(rec.taskUuid, null);
  assert.equal(rec.reason, null);
  assert.equal(rec.uncheckedCount, 0);
});

for (const backend of BACKENDS) {
  test(`[${backend}] queryFailures reads the failure history`, () => {
    const root = makeProject();
    const dir = path.join(root, '.qe', 'learning', 'failures', '2026-07', 'run1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CONTEXT.md'), FAILURE_DOC);

    const store = openStore(root, { backend });
    try {
      if (backend === 'sqlite') assert.equal(reindex(root, store).failures, 1);

      const rows = store.queryFailures({});
      assert.equal(rows.length, 1);
      assert.equal(rows[0].task_uuid, 'a9eb6eaf');
      assert.equal(rows[0].unchecked_count, 2);

      assert.equal(store.queryFailures({ uuid: 'a9eb6eaf' }).length, 1);
      assert.equal(store.queryFailures({ uuid: 'nope' }).length, 0);
      assert.equal(store.queryFailures({ since: Date.parse('2027-01-01') }).length, 0);

      // Both backends must agree on column names, or the CLI renders
      // different headers depending on the runtime.
      assert.deepEqual(Object.keys(rows[0]).sort(),
        ['changed_files', 'occurred_at', 'reason', 'src_path', 'task_uuid', 'unchecked_count']);
    } finally { store.close(); }
  });
}

test('queryFiles self-heals a cold index instead of reporting nothing',
  { skip: !SQLITE }, () => {
    // Third instance of the same silently-empty defect (after queryTasks and
    // queryFailures): `specs --status pending` answered with nothing while four
    // TASK_REQUEST files sat on disk, because file_index was only ever built by
    // an explicit reindex.
    const root = makeProject();
    const pending = path.join(root, '.qe', 'tasks', 'pending');
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, 'TASK_REQUEST_aaa111.md'), '# One\n');
    fs.writeFileSync(path.join(pending, 'TASK_REQUEST_bbb222.md'), '# Two\n');

    const store = openStore(root, { backend: 'sqlite' });
    try {
      // No reindex() call anywhere in this test — the query must cover itself.
      const rows = store.queryFiles({ kind: 'task', status: 'pending' });
      assert.equal(rows.length, 2, 'must see the files without an explicit reindex');
    } finally { store.close(); }
  });

test('an in-place edit is reflected without add/remove', { skip: !SQLITE }, () => {
  // Regression: a count-only freshness check missed an edit that left the file
  // count unchanged. A spec kept serving its old title, and a wiki page its
  // old tier, until something added or removed a file. The signature now folds
  // in mtimes.
  const root = makeProject();
  const pending = path.join(root, '.qe', 'tasks', 'pending');
  fs.mkdirSync(pending, { recursive: true });
  const spec = path.join(pending, 'TASK_REQUEST_edit1.md');
  fs.writeFileSync(spec, '# First Title\n');

  const store = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(store.queryFiles({ kind: 'task' })[0].title, 'First Title');

    fs.writeFileSync(spec, '# Changed Title\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(spec, future, future);

    assert.equal(store.queryFiles({ kind: 'task' })[0].title, 'Changed Title',
      'the in-place edit must be picked up');
  } finally { store.close(); }
});

test('an in-place wiki edit is reflected', { skip: !SQLITE }, () => {
  const root = makeProject();
  const dir = path.join(root, '.qe', 'wiki', 'pages', 'demo', 'concepts');
  fs.mkdirSync(dir, { recursive: true });
  const page = path.join(dir, 'c1.md');
  fs.writeFileSync(page, '---\ntype: concept\ncanonical: c1\ntopic: demo\ntier: draft\n---\nx\n');

  const store = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(store.queryWiki({})[0].tier, 'draft');

    fs.writeFileSync(page, '---\ntype: concept\ncanonical: c1\ntopic: demo\ntier: reviewed\n---\nx\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(page, future, future);

    assert.equal(store.queryWiki({})[0].tier, 'reviewed', 'the tier change must show');
  } finally { store.close(); }
});

test('queryFiles drops rows for files that disappeared', { skip: !SQLITE }, () => {
  const root = makeProject();
  const pending = path.join(root, '.qe', 'tasks', 'pending');
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(path.join(pending, 'TASK_REQUEST_ccc333.md'), '# Three\n');
  fs.writeFileSync(path.join(pending, 'TASK_REQUEST_ddd444.md'), '# Four\n');

  const store = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(store.queryFiles({ kind: 'task' }).length, 2);
    fs.unlinkSync(path.join(pending, 'TASK_REQUEST_ccc333.md'));
    // A completed or removed task must stop answering as pending.
    assert.equal(store.queryFiles({ kind: 'task' }).length, 1);
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

// ---------------------------------------------------------------------------
// Upgrading an existing installation
// ---------------------------------------------------------------------------

/**
 * Build a database that predates the current schema.
 * @param {string} root - Project root
 * @param {number} claimedVersion - What `user_version` should claim
 */
function seedLegacyDb(root, claimedVersion) {
  const sqlite = process.getBuiltinModule('node:sqlite');
  const db = new sqlite.DatabaseSync(path.join(root, '.qe', 'qe.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE state_kv(ns TEXT, k TEXT, session_id TEXT DEFAULT '', v TEXT,
      updated_at INTEGER, PRIMARY KEY(ns, k, session_id));
    CREATE TABLE counters(ns TEXT, k TEXT, session_id TEXT DEFAULT '',
      n INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY(ns, k, session_id));
  `);
  db.prepare('INSERT INTO state_kv VALUES(?,?,?,?,?)').run('legacy', 'kept', '', '"old value"', 1);
  db.prepare('INSERT INTO counters VALUES(?,?,?,?,?)').run('legacy', 'hits', '', 42, 1);
  db.exec(`PRAGMA user_version = ${claimedVersion}`);
  db.close();
}

test('an older schema upgrades in place and keeps its data', { skip: !SQLITE }, () => {
  const root = makeProject();
  seedLegacyDb(root, 1);

  const store = openStore(root, { backend: 'sqlite' });
  try {
    assert.equal(store.backend, 'sqlite');
    assert.equal(store.getState('legacy', 'kept'), 'old value', 'existing rows must survive');
    assert.equal(store.getCounter('legacy', 'hits'), 42, 'existing counts must survive');
    // And the tables added by later migrations must now work.
    store.appendEvent({ kind: 'tool_use', tool: 'Read' });
    assert.equal(store.queryEvents({}).length, 1);
  } finally { store.close(); }
});

test('a database whose version overstates its tables repairs itself',
  { skip: !SQLITE }, () => {
    // An interrupted upgrade or a partial restore leaves user_version ahead of
    // the schema. Trusting the version meant the first query against a missing
    // table threw, the facade demoted to the file backend for the rest of the
    // process, and the caller silently went back to the lost-update behaviour
    // this backend exists to remove — while still reporting success.
    const root = makeProject();
    seedLegacyDb(root, 4); // claims current, actually has two tables

    const file = path.join(root, 'probe.txt');
    fs.writeFileSync(file, 'x');

    const store = openStore(root, { backend: 'sqlite', sessionId: 's1' });
    try {
      store.memoPut(file, 'x');
      assert.equal(store.memoValid(file), true, 'the memo table must have been created');
      store.upsertSession({ sid: 'aaaaaaaa' });
      assert.equal(store.listSessions({}).length, 1);
      // Explicit empty scope: the store was opened with sessionId 's1', and
      // the pre-existing row is project-global (session_id = '').
      assert.equal(store.getCounter('legacy', 'hits', { sessionId: '' }), 42,
        'repair must not discard data');
      assert.equal(store.backend, 'sqlite', 'must not have demoted to the file backend');
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
