#!/usr/bin/env node
'use strict';

/**
 * check-store-parity.mjs — the file and sqlite store backends must agree.
 *
 * ADR-027 P1 promised this guard and it was never built, which left the whole
 * migration resting on an unchecked assumption: that swapping backends does not
 * change what QE sees. Two backends implementing one contract drift silently —
 * a divergence only shows up as a behaviour change on whichever machine happens
 * to run the other one.
 *
 * Drift already happened twice during the migration and both were caught by
 * luck rather than by a guard:
 *   - sqlite returned same-millisecond events in arbitrary order while the
 *     JSONL backend is inherently insertion-ordered.
 *   - sqlite treated an empty cached body as a real cache hit, so a Read that
 *     returned nothing blocked the next one. The blob backend never did.
 *
 * Each case below runs the same operations against both backends and compares
 * the results. Where the two are *intentionally* different (session-scoped memo
 * vs one shared blob) the difference is asserted explicitly rather than ignored,
 * so a change to that decision also trips the guard.
 *
 * Run: node scripts/check-store-parity.mjs   (auto-discovered by check-all.mjs)
 * Exit: 0 pass, 1 any mismatch.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { openStore } = await import(join(HERE, '..', 'hooks', 'scripts', 'lib', 'store.mjs'));
const { isSqliteAvailable } = await import(join(HERE, '..', 'hooks', 'scripts', 'lib', 'store-sqlite.mjs'));

const failures = [];
const sandboxes = [];

/**
 * Record a failed expectation.
 * @param {boolean} cond - Condition that must hold
 * @param {string} msg - What went wrong
 */
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

/**
 * Create a throwaway project root.
 * @returns {string} Absolute path
 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'qe-parity-'));
  sandboxes.push(dir);
  mkdirSync(join(dir, '.qe', 'state'), { recursive: true });
  return dir;
}

/**
 * Run one scenario against both backends and return both results.
 *
 * Each backend gets its own sandbox so neither can observe the other's writes.
 *
 * @param {(store: object, root: string) => any} scenario - Operations to run
 * @returns {{file: any, sqlite: any}}
 */
function bothBackends(scenario) {
  const out = {};
  for (const backend of ['file', 'sqlite']) {
    const root = sandbox();
    const store = openStore(root, { backend, sessionId: 'sess-1' });
    try {
      out[backend] = scenario(store, root);
    } finally {
      store.close();
    }
  }
  return out;
}

/**
 * Assert both backends produced the same JSON-comparable value.
 * @param {string} label - Scenario name for the failure message
 * @param {{file: any, sqlite: any}} results - Output of bothBackends
 */
function same(label, results) {
  const a = JSON.stringify(results.file);
  const b = JSON.stringify(results.sqlite);
  expect(a === b, `[${label}] backends disagree\n    file  : ${a}\n    sqlite: ${b}`);
}

if (!isSqliteAvailable()) {
  // Nothing to compare against — the file backend is the only implementation.
  console.log('check-store-parity: SKIP (node:sqlite unavailable; needs Node >= 22.5)');
  process.exit(0);
}

// --- state -----------------------------------------------------------------

same('state round-trip', bothBackends((s) => {
  s.setState('ns', 'k', { a: 1, nested: { b: 'x' }, list: [1, 2, 3] });
  return [s.getState('ns', 'k'), s.getState('ns', 'absent')];
}));

// --- counters --------------------------------------------------------------

same('counter sequence', bothBackends((s) => {
  const seen = [s.getCounter('t', 'c')];
  seen.push(s.bumpCounter('t', 'c', 1));
  seen.push(s.bumpCounter('t', 'c', 4));
  seen.push(s.getCounter('t', 'c'));
  s.resetCounter('t', 'c');
  seen.push(s.getCounter('t', 'c'));
  return seen;
}));

same('counter session scoping', bothBackends((s) => {
  s.bumpCounter('t', 'c', 3, { sessionId: 'a' });
  s.bumpCounter('t', 'c', 7, { sessionId: 'b' });
  return [s.getCounter('t', 'c', { sessionId: 'a' }), s.getCounter('t', 'c', { sessionId: 'b' })];
}));

// --- events ----------------------------------------------------------------

// Insertion order within one millisecond: the original sqlite divergence.
same('event order and filtering', bothBackends((s) => {
  for (const tool of ['A', 'B', 'C', 'D']) s.appendEvent({ kind: 'tool_use', tool });
  s.appendEvent({ kind: 'failure', tool: 'E' });
  return {
    order: s.queryEvents({ limit: 10 }).map(r => r.tool),
    failures: s.queryEvents({ kind: 'failure' }).map(r => r.tool),
    kinds: s.queryEvents({ limit: 10 }).map(r => r.kind),
  };
}));

// --- ContextMemo -----------------------------------------------------------

same('memo lifecycle', bothBackends((s, root) => {
  const file = join(root, 'f.txt');
  writeFileSync(file, 'body');
  const steps = [s.memoValid(file)];
  s.memoPut(file, 'body');
  steps.push(s.memoValid(file), s.memoGet(file));
  s.memoMarkModified(file);
  steps.push(s.memoValid(file), s.memoGet(file));
  return steps;
}));

// The documented edge: a Read that returned nothing must not block the next
// one. sqlite originally stored '' as a real value and blocked on it.
same('empty body is not a cache hit', bothBackends((s, root) => {
  const file = join(root, 'empty.txt');
  writeFileSync(file, '');
  s.memoPut(file, '');
  return s.memoValid(file);
}));

// An external edit (Bash/git/other editor) never calls memoMarkModified, so the
// on-disk mtime is the only invalidation signal both backends have.
same('external edit invalidates', bothBackends((s, root) => {
  const file = join(root, 'ext.txt');
  writeFileSync(file, 'v1');
  s.memoPut(file, 'v1');
  const before = s.memoValid(file);
  const future = new Date(Date.now() + 5000);
  writeFileSync(file, 'v2');
  utimesSync(file, future, future);
  return [before, s.memoValid(file)];
}));

same('oversized body is not cached', bothBackends((s, root) => {
  const file = join(root, 'big.txt');
  const big = 'x'.repeat(11 * 1024); // over the 10 KB per-file limit
  writeFileSync(file, big);
  s.memoPut(file, big);
  return s.memoValid(file);
}));

same('memoClear empties the cache', bothBackends((s, root) => {
  const file = join(root, 'c.txt');
  writeFileSync(file, 'x');
  s.memoPut(file, 'x');
  s.memoClear();
  return [s.memoValid(file), s.memoStats().files];
}));

// --- sessions --------------------------------------------------------------

same('session upsert and end', bothBackends((s) => {
  s.upsertSession({ sid: 'aaaaaaaa', name: 'one', plan: 'p1', pid: 111 });
  s.upsertSession({ sid: 'bbbbbbbb', name: 'two', plan: 'p2', pid: 222 });
  s.upsertSession({ sid: 'aaaaaaaa', name: 'one-renamed', pid: 111 });
  const listed = s.listSessions({ activeOnly: true })
    .map(r => `${r.sid}:${r.name}`).sort();
  s.endSession('aaaaaaaa');
  const after = s.listSessions({ activeOnly: true }).map(r => r.sid).sort();
  return { listed, after };
}));

// --- task log --------------------------------------------------------------

const TASK_LOG = [
  '# Task Log',
  '',
  '| UUID | Task | Status | Plan/Phase | Date |',
  '|------|------|--------|-----------|------|',
  '| aaa1 | shipped thing | ✅ | planA / P1 | 2026-07-20 |',
  '| bbb2 | queued thing | 🔲 | planB / P2 | 2026-07-21 |',
  '| ccc3 | regex `(?:build|test)` widened | ✅ | planC | 2026-07-22 |',
  '',
].join('\n');

same('task log queries', bothBackends((s, root) => {
  writeFileSync(join(root, '.qe', 'TASK_LOG.md'), TASK_LOG);
  return {
    done: s.queryTasks({ status: 'done' }).map(r => r.uuid),
    pending: s.queryTasks({ status: 'pending' }).map(r => r.uuid),
    columns: Object.keys(s.queryTasks({ limit: 1 })[0] || {}).sort(),
    // The inline-code pipe must not shift later columns in either backend.
    inlineCodeRow: s.queryTasks({ uuid: 'ccc3' }).map(r => `${r.status}|${r.plan}`),
  };
}));

// --- failure history -------------------------------------------------------

const FAILURE_DOC = [
  '# Failure Context',
  '',
  'date: 2026-07-17T12:36:41.291Z',
  'task_uuid: a9eb6eaf',
  '',
  '## Failure Reasons',
  '- VERIFY_CHECKLIST: 22 unchecked item(s)',
  '',
  '## Unchecked Checklist Items',
  '- [ ] first',
  '- [ ] second',
  '',
  '## Changed Files',
  '- README.md',
  '- scripts/y.mjs',
  '',
].join('\n');

same('failure history queries', bothBackends((s, root) => {
  const dir = join(root, '.qe', 'learning', 'failures', '2026-07', 'run1');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CONTEXT.md'), FAILURE_DOC);
  const rows = s.queryFailures({});
  return {
    count: rows.length,
    columns: Object.keys(rows[0] || {}).sort(),
    row: rows[0] ? `${rows[0].task_uuid}|${rows[0].unchecked_count}|${rows[0].changed_files}` : null,
    filtered: s.queryFailures({ uuid: 'nope' }).length,
  };
}));

// --- LLM wiki --------------------------------------------------------------

const WIKI_CONCEPT = [
  '---',
  'type: concept',
  'canonical: store-tiering',
  'aka: ["티어링", "storage tiering"]',
  'topic: demo',
  'summary: "Tier A/B/C."',
  'tags: [storage, adr-027]',    // bare flow scalars — the historic parse trap
  'provenance: extracted',
  'tier: draft',
  'status: active',
  'updated: 2026-07-25',
  '---',
  '- links [[sources/adr-027]] and [[concepts/missing-page]]',
  '',
].join('\n');

const WIKI_SOURCE = [
  '---',
  'type: source',
  'title: "ADR-027"',
  'topic: demo',
  'tags: [decision]',
  'provenance: inferred',
  'tier: reviewed',
  '---',
  'TL;DR',
  '',
].join('\n');

/**
 * Write a two-page wiki into a sandbox.
 * @param {string} root - Project root
 */
function seedWiki(root) {
  const base = join(root, '.qe', 'wiki', 'pages', 'demo');
  mkdirSync(join(base, 'concepts'), { recursive: true });
  mkdirSync(join(base, 'sources'), { recursive: true });
  writeFileSync(join(base, 'concepts', 'store-tiering.md'), WIKI_CONCEPT);
  writeFileSync(join(base, 'sources', 'adr-027.md'), WIKI_SOURCE);
}

same('wiki page fields', bothBackends((s, root) => {
  seedWiki(root);
  const rows = s.queryWiki({});
  return {
    count: rows.length,
    columns: Object.keys(rows[0] || {}).sort(),
    concepts: s.queryWiki({ type: 'concept' }).map(r => `${r.slug}|${r.tier}|${r.provenance}`),
    reviewed: s.queryWiki({ tier: 'reviewed' }).map(r => r.slug),
  };
}));

same('wiki link graph', bothBackends((s, root) => {
  seedWiki(root);
  return {
    broken: s.queryWikiLinks({ broken: true }).map(r => r.target),
    inbound: s.queryWikiLinks({}).map(r => `${r.slug}:${r.inbound}`),
    to: s.queryWikiLinks({ to: 'sources/adr-027' }).length,
  };
}));

// --- intentional divergences ----------------------------------------------
// Asserted explicitly so that changing either decision trips this guard rather
// than silently altering behaviour.

{
  const root = sandbox();
  const fileStore = openStore(root, { backend: 'file' });
  try {
    expect(fileStore.queryFiles({ kind: 'task' }) === null,
      '[by design] file backend must return null from queryFiles, meaning "no index — scan the filesystem"; [] would falsely claim an empty index');
  } finally { fileStore.close(); }
}

{
  const root = sandbox();
  const file = join(root, 'shared.txt');
  writeFileSync(file, 'x');
  const a = openStore(root, { backend: 'sqlite', sessionId: 'sessA' });
  const b = openStore(root, { backend: 'sqlite', sessionId: 'sessB' });
  try {
    a.memoPut(file, 'x');
    expect(a.memoValid(file) === true && b.memoValid(file) === false,
      '[by design] sqlite memo is per session — another session must not inherit the cache');
  } finally { a.close(); b.close(); }

  const root2 = sandbox();
  const file2 = join(root2, 'shared.txt');
  writeFileSync(file2, 'x');
  const c = openStore(root2, { backend: 'file', sessionId: 'sessA' });
  const d = openStore(root2, { backend: 'file', sessionId: 'sessB' });
  try {
    c.memoPut(file2, 'x');
    expect(d.memoValid(file2) === true,
      '[by design] file backend memo is one shared blob — every session sees it (the behaviour the sqlite backend deliberately fixes)');
  } finally { c.close(); d.close(); }
}

// --- report ----------------------------------------------------------------

for (const dir of sandboxes) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
}

if (failures.length > 0) {
  console.log(`check-store-parity: FAIL — ${failures.length} mismatch(es)`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}

console.log('check-store-parity: PASS (state, counters, events, memo, sessions, task log, failures, wiki pages + link graph, and 3 by-design divergences)');
