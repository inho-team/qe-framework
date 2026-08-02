#!/usr/bin/env node
'use strict';

/**
 * qe-query.mjs — read-only query surface over QE state for Claude and Codex
 * (ADR-027 D4).
 *
 * Why a CLI and not a server: both agents already have a shell, so one
 * invocation path works for both with no per-client wiring, no port, and no
 * resident process — the boundary ADR-026 drew. An HTTP mode can wrap the same
 * catalog later without changing it.
 *
 * Why it exists at all: `.qe/TASK_LOG.md` is ~20k tokens. An agent that needs
 * "which tasks are still open" should spend a few hundred tokens on the answer
 * rather than pulling the whole file into context.
 *
 * Usage:
 *   node scripts/qe-query.mjs --list
 *   node scripts/qe-query.mjs tasks --status=done --limit=10
 *   node scripts/qe-query.mjs task --uuid=f878a99e --full
 *   node scripts/qe-query.mjs failures --since=7d
 *   node scripts/qe-query.mjs --sql "SELECT status, COUNT(*) c FROM task_log GROUP BY status"
 *   node scripts/qe-query.mjs reindex
 *
 * Output: `--json` (default), `--table`, `--md`.
 * Exit codes: 0 success, 1 usage error, 2 query error.
 */

import { existsSync } from '../hooks/scripts/lib/qe-fs.mjs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { openStore } from '../hooks/scripts/lib/store.mjs';
import { reindex } from '../hooks/scripts/lib/store-indexer.mjs';
import { getDbPath, openSqlite, closeSqlite } from '../hooks/scripts/lib/store-sqlite.mjs';
import { queryQeState } from '../hooks/scripts/lib/qe-access.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Named query catalog. Each entry documents itself so `--list` doubles as the
 * reference an agent reads before composing a call.
 */
const CATALOG = {
  tasks: {
    summary: 'Task log rows (status, plan, date, truncated title)',
    flags: ['--status=done|paused|in-progress|pending', '--plan=<substr>', '--since=<7d|YYYY-MM-DD>', '--limit=N', '--full'],
    run: (store, args) => store.queryTasks({
      status: args.status,
      plan: args.plan,
      since: args.since,
      limit: args.limit ?? 20,
      full: args.full,
    }),
  },
  task: {
    summary: 'One task log row by uuid (add --full for the complete body)',
    flags: ['--uuid=<id>', '--full'],
    run: (store, args) => {
      if (!args.uuid) throw new Error('task requires --uuid=<id>');
      return store.queryTasks({ uuid: args.uuid, full: args.full ?? true, limit: 1 });
    },
  },
  files: {
    summary: 'Indexed .qe files (specs, checklists, contracts, plans)',
    flags: ['--kind=task|checklist|contract|plan|handoff|analysis', '--status=pending|in-progress|completed', '--limit=N'],
    run: (store, args) => store.queryFiles({
      kind: args.kind, status: args.status, limit: args.limit ?? 50,
    }),
  },
  specs: {
    summary: 'TASK_REQUEST spec files (shorthand for files --kind=task)',
    flags: ['--status=pending|in-progress|completed', '--limit=N'],
    run: (store, args) => store.queryFiles({ kind: 'task', status: args.status, limit: args.limit ?? 50 }),
  },
  verification: {
    summary: 'VERIFY_CHECKLIST files (shorthand for files --kind=checklist)',
    flags: ['--status=pending|in-progress|completed', '--limit=N'],
    run: (store, args) => store.queryFiles({ kind: 'checklist', status: args.status, limit: args.limit ?? 50 }),
  },
  contracts: {
    summary: 'Active business-logic contracts',
    flags: ['--limit=N'],
    run: (store, args) => store.queryFiles({ kind: 'contract', limit: args.limit ?? 50 }),
  },
  analysis: {
    summary: 'Project analysis documents under .qe/analysis',
    flags: ['--limit=N'],
    run: (store, args) => store.queryFiles({ kind: 'analysis', limit: args.limit ?? 50 }),
  },
  wiki: {
    summary: 'LLM wiki pages with their frontmatter (type, topic, tier, provenance)',
    flags: ['--type=concept|source|index', '--topic=<name>', '--tier=<tier>', '--provenance=extracted|inferred|ambiguous', '--slug=<slug>', '--limit=N'],
    run: (store, args) => store.queryWiki({
      type: args.type, topic: args.topic, tier: args.tier,
      provenance: args.provenance, slug: args.slug, limit: args.limit ?? 50,
    }),
  },
  'wiki-links': {
    summary: 'Wiki link graph — inbound counts by default; --broken finds dangling [[links]]',
    flags: ['--broken', '--to=<slug>', '--from=<path substring>'],
    run: (store, args) => store.queryWikiLinks({
      broken: args.broken, to: args.to, from: args.from,
    }),
  },
  failures: {
    summary: 'Verification failure history (when, which task, why, how much was unchecked)',
    flags: ['--uuid=<task>', '--since=<7d|YYYY-MM-DD>', '--limit=N'],
    run: (store, args) => store.queryFailures({
      uuid: args.uuid, since: args.since, limit: args.limit ?? 50,
    }),
  },
  events: {
    summary: 'Telemetry events, newest last (sparse: QE currently emits only task_completed)',
    flags: ['--kind=<eventType>', '--session=<sid>', '--since=<7d>', '--limit=N'],
    run: (store, args) => store.queryEvents({
      kind: args.kind, sessionId: args.session, since: args.since, limit: args.limit ?? 50,
    }),
  },
  sessions: {
    summary: 'Known sessions and last-seen times',
    flags: ['--active'],
    run: (store, args) => store.listSessions({ activeOnly: args.active }),
  },
};

/**
 * Flags that take a value. Listed explicitly so that `--sql "SELECT ..."`
 * (space separated) works without a bare `--table` swallowing the positional
 * command that may follow it.
 */
const VALUE_FLAGS = new Set([
  'sql', 'cwd', 'status', 'kind', 'plan', 'since', 'limit', 'uuid', 'session',
  'type', 'topic', 'tier', 'provenance', 'slug', 'to', 'from',
]);

/**
 * Parse `--flag`, `--flag=value`, `--flag value` and positional arguments.
 * @param {string[]} argv - Raw arguments after the script name
 * @returns {{command: string|null, args: object}}
 */
function parseArgs(argv) {
  const args = {};
  let command = null;

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      if (command === null) command = raw;
      continue;
    }

    const [flag, ...rest] = raw.slice(2).split('=');
    const name = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    if (rest.length) {
      args[name] = rest.join('=');
      continue;
    }

    const next = argv[i + 1];
    if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith('--')) {
      args[name] = next;
      i += 1;
      continue;
    }

    args[name] = true;
  }

  return { command, args };
}

/**
 * Resolve a relative time expression to an epoch-millisecond bound.
 *
 * Accepts `7d`, `24h`, `30m`, or an absolute `YYYY-MM-DD`. Anything else is
 * rejected rather than silently coerced, because a misread bound produces a
 * plausible-looking but wrong result set.
 *
 * @param {string|boolean|undefined} value - Raw `--since` value
 * @returns {number|undefined} Epoch ms, or undefined when not supplied
 */
function resolveSince(value) {
  if (value === undefined || value === true) return undefined;
  const text = String(value).trim();

  const relative = text.match(/^(\d+)\s*([dhm])$/i);
  if (relative) {
    const n = Number(relative[1]);
    const unit = { d: 86400000, h: 3600000, m: 60000 }[relative[2].toLowerCase()];
    return Date.now() - n * unit;
  }

  const absolute = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (absolute) {
    return Date.UTC(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]));
  }

  throw new Error(`unrecognised --since value: "${text}" (use 7d, 24h, 30m, or YYYY-MM-DD)`);
}

/**
 * Reject anything that is not a single read-only SELECT.
 *
 * The store holds a project's working history, and this escape hatch exists so
 * an agent is not blocked by a missing named query — not so it can mutate
 * state. The connection is also opened read-only, so this check is the second
 * of two independent barriers rather than the only one.
 *
 * @param {string} sql - Candidate statement
 * @throws {Error} When the statement is not a lone SELECT/WITH
 */
function assertReadOnlySql(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')        // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .trim()
    .replace(/;\s*$/, '');            // one optional trailing semicolon

  if (!stripped) throw new Error('empty SQL');
  if (stripped.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(stripped)) throw new Error('only SELECT (or WITH ... SELECT) is allowed');
  if (/\b(attach|detach|pragma|vacuum)\b/i.test(stripped)) {
    throw new Error('ATTACH / DETACH / PRAGMA / VACUUM are not allowed');
  }
  return stripped;
}

/**
 * Render rows as a fixed-width text table.
 * @param {Array<object>} rows - Result rows
 * @returns {string}
 */
function renderTable(rows) {
  if (!rows.length) return '(no rows)';
  const columns = [...new Set(rows.flatMap(Object.keys))];
  const cell = (row, col) => {
    const v = row[col];
    if (v === null || v === undefined) return '';
    // Long prose cells are what this tool exists to avoid printing in full.
    const s = String(v).replace(/\s+/g, ' ');
    return s.length > 80 ? `${s.slice(0, 79)}…` : s;
  };
  const widths = columns.map(c => Math.max(c.length, ...rows.map(r => cell(r, c).length)));
  const line = (cells) => cells.map((v, i) => v.padEnd(widths[i])).join('  ');
  return [
    line(columns),
    widths.map(w => '-'.repeat(w)).join('  '),
    ...rows.map(r => line(columns.map(c => cell(r, c)))),
  ].join('\n');
}

/**
 * Render rows as a Markdown table.
 * @param {Array<object>} rows - Result rows
 * @returns {string}
 */
function renderMarkdown(rows) {
  if (!rows.length) return '_(no rows)_';
  const columns = [...new Set(rows.flatMap(Object.keys))];
  const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/\|/g, '\\|').replace(/\s+/g, ' '));
  return [
    `| ${columns.join(' | ')} |`,
    `|${columns.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${columns.map(c => esc(r[c])).join(' | ')} |`),
  ].join('\n');
}

/**
 * Print the catalog of named queries.
 * @returns {string}
 */
function renderCatalog() {
  const lines = ['Named queries:', ''];
  for (const [name, entry] of Object.entries(CATALOG)) {
    lines.push(`  ${name.padEnd(13)} ${entry.summary}`);
    if (entry.flags?.length) lines.push(`  ${' '.repeat(13)} ${entry.flags.join('  ')}`);
  }
  lines.push('', 'Other commands:');
  lines.push('  reindex       Rebuild the derived index from .qe files');
  lines.push('  --sql "..."   Run a read-only SELECT against the store');
  lines.push('', 'Formats: --json (default)  --table  --md');
  return lines.join('\n');
}

/**
 * Entry point.
 * @returns {Promise<number>} Process exit code
 */
async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const format = args.table ? 'table' : args.md ? 'md' : 'json';

  // A mistyped --cwd must fail here rather than resolve to a path that does
  // not exist. Otherwise the query returns an empty set, which an agent
  // cannot distinguish from a genuine "no matching rows".
  const cwd = args.cwd === undefined || args.cwd === true
    ? process.cwd()
    : resolve(String(args.cwd));
  if (!existsSync(cwd)) {
    process.stderr.write(`--cwd path does not exist: ${cwd}\n`);
    return 1;
  }

  if (args.help || (!command && !args.sql && !args.list)) {
    process.stdout.write(`${renderCatalog()}\n`);
    return command || args.list ? 0 : 1;
  }

  if (args.list) {
    process.stdout.write(`${renderCatalog()}\n`);
    return 0;
  }

  // Raw SQL takes its own path: a dedicated read-only connection, never the
  // read-write store handle.
  if (args.sql) {
    if (args.sql === true) {
      process.stderr.write('--sql requires a statement\n');
      return 1;
    }
    // Refresh the derived indexes through a normal read-write store first.
    // The statement itself runs on a read-only connection, which by definition
    // cannot self-heal a stale or missing index — so raw SQL as the very first
    // command would answer from empty tables, and an empty result set is
    // indistinguishable from "nothing matched".
    try {
      // Only prime inside an actual QE project. Opening the store creates
      // `.qe/` on demand, and a stray query run from an unrelated directory
      // should not leave a state folder behind.
      if (!existsSync(join(cwd, '.qe'))) throw new Error('not a QE project');
      const primer = openStore(cwd);
      try {
        if (primer.backend === 'sqlite') {
          // One call per derived index. Each has its own freshness check, so
          // omitting one leaves that table empty for raw SQL — which is how
          // `file_index` was silently empty here after the first version of
          // this priming shipped covering only tasks and failures.
          primer.queryTasks({ limit: 1 });
          primer.queryFailures({ limit: 1 });
          primer.queryFiles({ limit: 1 });
          primer.queryWiki({ limit: 1 });
        }
      } finally {
        primer.close();
      }
    } catch {
      // Priming is best effort; the query below still runs against whatever
      // the database already holds.
    }

    if (!existsSync(getDbPath(cwd))) {
      process.stderr.write(`no store database at ${getDbPath(cwd)} — run: qe-query reindex\n`);
      return 2;
    }
    let db;
    try {
      const statement = assertReadOnlySql(String(args.sql));
      db = openSqlite(cwd, { readOnly: true });
      if (!db) throw new Error('sqlite unavailable (needs Node >= 22.5)');
      const rows = db.prepare(statement).all();
      emit(rows, format);
      return 0;
    } catch (err) {
      process.stderr.write(`query error: ${err.message}\n`);
      return 2;
    } finally {
      closeSqlite(db);
    }
  }

  const store = openStore(cwd);
  try {
    if (command === 'reindex') {
      const result = reindex(cwd, store);
      if (result.skipped) {
        process.stderr.write('reindex skipped: sqlite backend unavailable, files remain the source of truth\n');
        return 0;
      }
      process.stdout.write(`${JSON.stringify({ ...result, backend: store.backend }, null, 2)}\n`);
      return 0;
    }

    const entry = CATALOG[command];
    if (!entry) {
      process.stderr.write(`unknown query "${command}"\n\n${renderCatalog()}\n`);
      return 1;
    }

    const normalized = {
      ...args,
      since: resolveSince(args.since),
      limit: args.limit === undefined ? undefined : Number(args.limit),
    };
    if (normalized.limit !== undefined && !Number.isFinite(normalized.limit)) {
      throw new Error(`--limit must be a number, got "${args.limit}"`);
    }

    const rows = queryQeState(store, command, normalized);
    if (rows === null) {
      process.stderr.write(
        `"${command}" needs the derived index, which the file backend does not have.\n`
        + 'Run "qe-query reindex" on Node >= 22.5, or read the files directly.\n',
      );
      return 2;
    }
    emit(rows, format);
    return 0;
  } catch (err) {
    process.stderr.write(`query error: ${err.message}\n`);
    return 2;
  } finally {
    store.close();
  }
}

/** Columns stored as epoch milliseconds, rendered as ISO dates instead. */
const TIME_COLUMNS = new Set([
  'ts', 'dated_at', 'last_seen', 'indexed_at', 'mtime_ms', 'occurred_at',
]);

/**
 * Replace epoch-millisecond columns with ISO strings.
 *
 * Applied to every format, including JSON: an agent reading `1784851200000`
 * has to convert it before it can reason about the date, which is exactly the
 * kind of avoidable step this tool exists to remove.
 *
 * @param {Array<object>} rows - Result rows
 * @returns {Array<object>} Rows with time columns humanized
 */
function humanizeTimes(rows) {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      if (TIME_COLUMNS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        const iso = new Date(value).toISOString();
        // Date-only columns carry no meaningful time component.
        out[key] = key === 'dated_at' ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

/**
 * Write rows in the requested format.
 * @param {Array<object>} rows - Result rows
 * @param {'json'|'table'|'md'} format - Output format
 */
function emit(rows, format) {
  const list = humanizeTimes(Array.isArray(rows) ? rows : [rows]);
  if (format === 'table') process.stdout.write(`${renderTable(list)}\n`);
  else if (format === 'md') process.stdout.write(`${renderMarkdown(list)}\n`);
  else process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
}

// Only run when invoked as a command. Tests import the guards below directly,
// and importing must not execute a query or set an exit code.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export { CATALOG, assertReadOnlySql, resolveSince, parseArgs, renderTable, renderMarkdown, main, HERE };
