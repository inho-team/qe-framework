#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CATALOG, assertReadOnlySql, parseArgs, resolveSince } from '../../../../scripts/qe-query.mjs';
import { isSqliteAvailable } from '../store-sqlite.mjs';

const CLI = fileURLToPath(new URL('../../../../scripts/qe-query.mjs', import.meta.url));
const SQLITE = isSqliteAvailable();

/**
 * Build a project root containing a small TASK_LOG.
 * @returns {string} Absolute project root
 */
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-query-'));
  fs.mkdirSync(path.join(root, '.qe'), { recursive: true });
  fs.writeFileSync(path.join(root, '.qe', 'TASK_LOG.md'), [
    '| UUID | Task | Status | Plan/Phase | Date |',
    '|------|------|--------|-----------|------|',
    '| aaa1 | shipped thing | ✅ | planA / P1 | 2026-07-20 |',
    '| bbb2 | queued thing | 🔲 | planB / P2 | 2026-07-21 |',
    '',
  ].join('\n'));
  return root;
}

/**
 * Invoke the CLI as a subprocess.
 * @param {string[]} args - CLI arguments
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---------------------------------------------------------------------------
// Read-only SQL guard
// ---------------------------------------------------------------------------

test('assertReadOnlySql accepts SELECT and WITH', () => {
  assert.ok(assertReadOnlySql('SELECT 1'));
  assert.ok(assertReadOnlySql('  select uuid from task_log  '));
  assert.ok(assertReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x'));
  assert.ok(assertReadOnlySql('SELECT 1;')); // one trailing semicolon is fine
});

test('assertReadOnlySql rejects every mutating form', () => {
  const rejected = [
    'DELETE FROM task_log',
    'UPDATE task_log SET status = 1',
    'INSERT INTO task_log VALUES(1)',
    'DROP TABLE task_log',
    'CREATE TABLE x(a)',
    'PRAGMA user_version',
    'VACUUM',
    "ATTACH DATABASE '/tmp/evil.db' AS e",
    'SELECT 1; DROP TABLE task_log',
    '',
    '   ',
  ];
  for (const sql of rejected) {
    assert.throws(() => assertReadOnlySql(sql), undefined, `must reject: ${sql}`);
  }
});

test('assertReadOnlySql strips comments before deciding', () => {
  // A comment must not be able to hide a second statement...
  assert.throws(() => assertReadOnlySql('SELECT 1 /* x */ ; DELETE FROM task_log'));
  // ...nor make a mutating statement look like a SELECT.
  assert.throws(() => assertReadOnlySql('-- SELECT 1\nDELETE FROM task_log'));
  // A trailing line comment on a genuine SELECT is harmless.
  assert.ok(assertReadOnlySql('SELECT 1 -- ; DROP TABLE task_log'));
});

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

test('parseArgs handles =, space-separated and boolean flags', () => {
  const { command, args } = parseArgs(['tasks', '--status=done', '--limit', '5', '--table']);
  assert.equal(command, 'tasks');
  assert.equal(args.status, 'done');
  assert.equal(args.limit, '5');
  assert.equal(args.table, true);
});

test('parseArgs keeps a space-separated SQL statement intact', () => {
  const { args } = parseArgs(['--sql', 'SELECT status, COUNT(*) FROM task_log', '--table']);
  assert.equal(args.sql, 'SELECT status, COUNT(*) FROM task_log');
  assert.equal(args.table, true);
});

test('parseArgs does not let a boolean flag swallow the command', () => {
  const { command, args } = parseArgs(['--table', 'tasks']);
  assert.equal(command, 'tasks');
  assert.equal(args.table, true);
});

// ---------------------------------------------------------------------------
// Time bounds
// ---------------------------------------------------------------------------

test('resolveSince understands relative and absolute forms', () => {
  const now = Date.now();
  assert.ok(Math.abs(resolveSince('7d') - (now - 7 * 86400000)) < 5000);
  assert.ok(Math.abs(resolveSince('24h') - (now - 24 * 3600000)) < 5000);
  assert.ok(Math.abs(resolveSince('30m') - (now - 30 * 60000)) < 5000);
  assert.equal(resolveSince('2026-07-20'), Date.UTC(2026, 6, 20));
  assert.equal(resolveSince(undefined), undefined);
});

test('resolveSince rejects rather than silently coercing', () => {
  // A misread bound yields a plausible but wrong result set, which is worse
  // than an error the caller can see.
  for (const bad of ['yesterday', '7 days', '7x', 'now-1d', '2026/07/20']) {
    assert.throws(() => resolveSince(bad), undefined, `must reject: ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// Catalog + end-to-end
// ---------------------------------------------------------------------------

test('every catalog entry is documented and runnable', () => {
  for (const [name, entry] of Object.entries(CATALOG)) {
    assert.equal(typeof entry.summary, 'string', `${name} needs a summary`);
    assert.ok(entry.summary.length > 0, `${name} summary must not be empty`);
    assert.equal(typeof entry.run, 'function', `${name} needs a run()`);
  }
});

test('--list exits 0 and names the catalog', () => {
  const r = run(['--list']);
  assert.equal(r.status, 0);
  for (const name of Object.keys(CATALOG)) assert.ok(r.stdout.includes(name), `missing ${name}`);
});

test('no arguments prints usage and exits non-zero', () => {
  const r = run([]);
  assert.equal(r.status, 1);
});

test('unknown query exits 1 and shows the catalog', () => {
  const r = run(['nope', '--cwd', os.tmpdir()]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown query/);
});

test('tasks query works without sqlite by reading TASK_LOG.md', () => {
  const root = makeProject();
  const r = run(['tasks', '--cwd', root, '--status', 'done']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uuid, 'aaa1');
  assert.equal(rows[0].dated_at, '2026-07-20', 'dates render as ISO, not epoch ms');
});

test('reindex then query round-trips through the CLI', { skip: !SQLITE }, () => {
  const root = makeProject();
  const indexed = run(['reindex', '--cwd', root]);
  assert.equal(indexed.status, 0, indexed.stderr);
  assert.equal(JSON.parse(indexed.stdout).tasks, 2);

  const r = run(['--cwd', root, '--sql', 'SELECT status, COUNT(*) c FROM task_log GROUP BY status']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 2);
});

test('--sql against a mutating statement exits 2 and changes nothing', { skip: !SQLITE }, () => {
  const root = makeProject();
  run(['reindex', '--cwd', root]);

  const before = JSON.parse(run(['tasks', '--cwd', root]).stdout).length;
  const r = run(['--cwd', root, '--sql', 'DELETE FROM task_log']);
  assert.equal(r.status, 2);
  const after = JSON.parse(run(['tasks', '--cwd', root]).stdout).length;
  assert.equal(after, before, 'rejected statement must not have mutated the store');
});

test('--sql on a project with no database primes the index instead of erroring',
  { skip: !SQLITE }, () => {
    // The statement runs read-only and so cannot build the index itself. Raw
    // SQL as an agent's first command used to answer from empty tables — a
    // result indistinguishable from "nothing matched". The CLI now primes
    // through a read-write store first.
    const root = makeProject(); // has a TASK_LOG, no qe.db yet
    assert.equal(fs.existsSync(path.join(root, '.qe', 'qe.db')), false);

    const r = run(['--cwd', root, '--sql', 'SELECT COUNT(*) n FROM task_log']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout)[0].n, 2, 'must see the rows, not an empty table');
  });

test('--sql still reports a missing database when it cannot be created', () => {
  // No .qe directory at all: priming has nothing to index and cannot create
  // the store, so the caller gets an explicit error rather than empty output.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-query-bare-'));
  const r = run(['--cwd', root, '--sql', 'SELECT 1']);
  assert.notEqual(r.status, 0, 'must not silently succeed');
  if (r.status === 2) assert.match(r.stderr, /reindex|sqlite/);
});

test('a mistyped --cwd errors instead of creating a directory tree', () => {
  // Regression: `mkdirSync(recursive: true)` used to materialize the whole
  // path, leaving a stray `.qe/qe.db` on disk and returning [] — an empty
  // result an agent cannot tell apart from "nothing matched".
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-cwd-'));
  const bogus = path.join(sandbox, 'definitely-not-here');

  const r = run(['tasks', '--cwd', bogus]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not exist/);
  assert.equal(fs.existsSync(bogus), false, 'must not create the missing path');
});

test('index-only queries fail loudly on the file backend', () => {
  const root = makeProject();
  const r = spawnSync(process.execPath, [CLI, 'specs', '--cwd', root], {
    encoding: 'utf8',
    env: { ...process.env, QE_STORAGE_BACKEND: 'file' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /derived index/);
});
