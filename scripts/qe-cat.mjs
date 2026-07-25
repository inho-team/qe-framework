#!/usr/bin/env node
/**
 * qe-cat.mjs — print a .qe file's content from the DB store (qe_files).
 *
 * The .qe tree is backed by the SQLite store, so a path may have no file on
 * disk. This resolves it the same way the framework does — row first, on-disk
 * fallback — so skills and the agent can read .qe content whether or not the
 * underlying file still exists.
 *
 * Usage:
 *   node scripts/qe-cat.mjs .qe/tasks/in-progress/TASK_REQUEST_x.md
 *   node scripts/qe-cat.mjs --ls .qe/planning/plans          # list children
 *   node scripts/qe-cat.mjs --exists .qe/foo.md              # print 1/0
 */

import { readFileSync, existsSync, readdirSync } from '../hooks/scripts/lib/qe-fs.mjs';

const args = process.argv.slice(2);
const flag = args[0] && args[0].startsWith('--') ? args.shift() : null;
const target = args[0];

if (!target) {
  console.error('usage: node scripts/qe-cat.mjs [--ls|--exists] <.qe/path>');
  process.exit(1);
}

try {
  if (flag === '--exists') {
    process.stdout.write(existsSync(target) ? '1\n' : '0\n');
  } else if (flag === '--ls') {
    for (const name of readdirSync(target).sort()) process.stdout.write(name + '\n');
  } else {
    process.stdout.write(readFileSync(target, 'utf8'));
  }
} catch (e) {
  console.error(`qe-cat: ${e.code || 'ERROR'} — ${target}`);
  process.exit(1);
}
