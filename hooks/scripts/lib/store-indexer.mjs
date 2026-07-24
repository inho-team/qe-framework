#!/usr/bin/env node
'use strict';

/**
 * store-indexer.mjs — builds the Tier B derived index from `.qe` files
 * (ADR-027 P3).
 *
 * Tier B keeps Markdown as the source of truth and mirrors only the queryable
 * fields into SQLite. Nothing here is authoritative: dropping every table this
 * module writes and re-running `reindex()` restores the same state. That is
 * the property that makes the index safe to delete on corruption.
 *
 * The point is context economy, not disk speed. `.qe/TASK_LOG.md` alone is
 * ~20k tokens; answering "which tasks are still open" by reading it costs an
 * agent more context than the answer is worth.
 *
 * @module store-indexer
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/** Directories mirrored into `file_index`, with the kind each one carries. */
const INDEXED_DIRS = [
  { dir: ['tasks'], kind: 'task' },
  { dir: ['checklists'], kind: 'checklist' },
  { dir: ['contracts', 'active'], kind: 'contract' },
  { dir: ['planning'], kind: 'plan' },
  { dir: ['handoffs'], kind: 'handoff' },
  { dir: ['analysis'], kind: 'analysis' },
  { dir: ['security-reports'], kind: 'security-report' },
];

/** Status is inferred from the containing folder, which is how QE encodes it. */
const STATUS_FOLDERS = ['pending', 'in-progress', 'completed', 'active', 'archived'];

/**
 * Normalize the emoji/status cell of a TASK_LOG row into a stable token.
 *
 * The Markdown uses emoji (✅ / ⏸️ / 🔄) that are awkward to filter on from a
 * shell. Callers query `status = 'done'`, not an emoji they must escape.
 *
 * @param {string} raw - Raw status cell text
 * @returns {string} One of: done | paused | in-progress | pending | unknown
 */
export function normalizeStatus(raw) {
  const s = String(raw || '').trim();
  if (/✅|\bdone\b|\bcompleted?\b/i.test(s)) return 'done';
  if (/⏸️?|\bpaused?\b|\bon.?hold\b/i.test(s)) return 'paused';
  if (/🔄|▶️|\bin.?progress\b|\bwip\b/i.test(s)) return 'in-progress';
  // 🔲 is the marker this project uses for "spec written, not started".
  if (/⏳|🔲|☐|\bpending\b|\btodo\b/i.test(s)) return 'pending';
  return 'unknown';
}

/**
 * Split one Markdown table row into trimmed cells.
 *
 * A naive `split('|')` corrupts real rows: TASK_LOG prose contains inline code
 * such as `` `(?:build|test)` `` whose pipe is not a cell separator. Splitting
 * on it shifts every later cell left, so status, plan and date all come from
 * the wrong column — measured at 5 of 106 rows in this repository before this
 * was fixed. Backtick spans and backslash escapes are therefore honoured.
 *
 * @param {string} line - A single `| a | b |` line
 * @returns {string[]} Cell values
 */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let backtickRun = 0; // length of the fence currently open, 0 when outside code

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|'; // escaped pipe is literal content
      i += 1;
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (trimmed[i + run] === '`') run += 1;
      // A code span closes only on a fence of matching length, mirroring
      // CommonMark, so `` ` `` inside a double-backtick span stays content.
      if (backtickRun === 0) backtickRun = run;
      else if (backtickRun === run) backtickRun = 0;
      current += '`'.repeat(run);
      i += run - 1;
      continue;
    }

    if (ch === '|' && backtickRun === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

/**
 * Parse `.qe/TASK_LOG.md` into structured rows.
 *
 * Column order is read from the header rather than assumed, because the table
 * has shipped in both `| UUID | Task | Status |` and `| Status | UUID |`
 * orders across QE versions.
 *
 * @param {string} content - Full TASK_LOG.md text
 * @param {string} [srcPath] - Path recorded on each row for provenance
 * @returns {Array<object>} Parsed task rows
 */
export function parseTaskLog(content, srcPath = '.qe/TASK_LOG.md') {
  if (!content) return [];

  const lines = content.split('\n');
  const rows = [];
  let columns = null;
  let rowNo = 0;

  for (const line of lines) {
    if (!line.includes('|')) { columns = null; continue; }

    const cells = splitRow(line);
    if (cells.length < 2) continue;

    // Header row: remember where each field lives.
    const lower = cells.map(c => c.toLowerCase());
    if (lower.includes('uuid') && (lower.includes('status') || lower.includes('task'))) {
      columns = {
        uuid: lower.indexOf('uuid'),
        title: lower.findIndex(c => c === 'task' || c === 'name'),
        status: lower.indexOf('status'),
        plan: lower.findIndex(c => c.startsWith('plan')),
        date: lower.findIndex(c => c.startsWith('date')),
      };
      continue;
    }

    if (!columns) continue;
    if (/^-{2,}$/.test(cells[0]?.replace(/[:\s]/g, ''))) continue; // separator

    const uuid = cells[columns.uuid];
    if (!uuid) continue;

    const body = columns.title >= 0 ? (cells[columns.title] || '') : '';
    const dateCell = columns.date >= 0 ? cells[columns.date] : '';
    const dateMatch = String(dateCell).match(/(\d{4})-(\d{2})-(\d{2})/);
    const statusRaw = columns.status >= 0 ? (cells[columns.status] || '') : '';

    rowNo += 1;
    rows.push({
      uuid,
      // The body cell runs to thousands of characters. `title` is the short
      // form a query returns by default; `body` stays available for the one
      // row a caller actually wants to read in full.
      title: body.length > 200 ? `${body.slice(0, 200)}…` : body,
      body,
      status: normalizeStatus(statusRaw),
      statusRaw: statusRaw || null,
      plan: columns.plan >= 0 ? (cells[columns.plan] || null) : null,
      datedAt: dateMatch
        ? Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
        : null,
      srcPath,
      rowNo,
    });
  }

  return rows;
}

/**
 * Parse a `.qe/learning/failures/**\/CONTEXT.md` record.
 *
 * These files are written by `failure-capture.mjs` and are the only durable
 * record QE keeps of *why* a verification run failed. The fields extracted
 * here are the ones worth filtering on; the prose stays in the file.
 *
 * @param {string} content - CONTEXT.md text
 * @param {string} relPath - Path relative to the project root, used as the id
 * @returns {object|null} Structured record, or null if it is not a failure doc
 */
export function parseFailureContext(content, relPath) {
  if (!content || !/^#\s*Failure Context/m.test(content)) return null;

  const dateMatch = content.match(/^date:\s*(.+)$/m);
  const uuidMatch = content.match(/^task_uuid:\s*(.+)$/m);

  /**
   * Collect the bullet lines of one `## Section`.
   * @param {string} heading - Section title
   * @returns {string[]} Bullet contents
   */
  const section = (heading) => {
    // The terminator is "next ## heading, or true end of string". JavaScript
    // has no \Z, and `$` under /m matches every line end — either mistake makes
    // the final section of a document parse as empty. `(?![\s\S])` is the only
    // reliable end-of-input assertion here.
    const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm');
    const body = content.match(re)?.[1] || '';
    return body
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map(line => line.trim().slice(2).trim())
      .filter(Boolean);
  };

  const reasons = section('Failure Reasons');
  const occurredAt = dateMatch ? Date.parse(dateMatch[1].trim()) : NaN;

  return {
    id: relPath,
    occurredAt: Number.isFinite(occurredAt) ? occurredAt : null,
    taskUuid: uuidMatch ? uuidMatch[1].trim() : null,
    reason: reasons.join('; ') || null,
    uncheckedCount: section('Unchecked Checklist Items').length,
    changedFiles: section('Changed Files').length,
    srcPath: relPath,
  };
}

/**
 * Recursively collect files under a directory.
 * @param {string} root - Directory to walk
 * @param {string[]} [out] - Accumulator
 * @returns {string[]} Absolute file paths
 */
function walk(root, out = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // `.archive`, `.snapshots` and `.verdicts` are cold storage; indexing them
    // would bury live rows under thousands of retired ones.
    if (entry.name.startsWith('.')) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(md|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Derive the status token for an indexed file from its folder path.
 * @param {string} relPath - Path relative to the project root
 * @returns {string|null}
 */
function statusFromPath(relPath) {
  const segments = relPath.split('/');
  for (const segment of segments) {
    if (STATUS_FOLDERS.includes(segment)) return segment;
  }
  return null;
}

/**
 * Extract a human title: the first Markdown heading, else the filename.
 * @param {string} content - File contents
 * @param {string} fallback - Filename to use when no heading exists
 * @returns {string}
 */
function titleOf(content, fallback) {
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

/**
 * Collect every `.qe` file that belongs in `file_index`, as ready-to-upsert
 * records.
 *
 * Exported so `reindex()` and the sqlite backend's freshness check share one
 * definition of "what is indexable". Duplicating that list is how an index and
 * its refresh path drift into disagreeing about what should be there.
 *
 * @param {string} cwd - Project root
 * @returns {Array<object>} Records shaped for `store.indexFile()`
 */
export function collectIndexableFiles(cwd) {
  const qeDir = join(cwd, '.qe');
  const records = [];

  for (const { dir, kind } of INDEXED_DIRS) {
    const root = join(qeDir, ...dir);
    if (!existsSync(root)) continue;

    for (const abs of walk(root)) {
      let stat;
      let content = '';
      try {
        stat = statSync(abs);
        // Only small text files are read for a title; a large generated
        // artifact contributes its metadata without being slurped.
        if (stat.size <= 256 * 1024) content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }

      const relPath = relative(cwd, abs);
      const uuidMatch = abs.match(/_([A-Za-z0-9-]{6,})\.md$/);

      records.push({
        path: relPath,
        kind,
        status: statusFromPath(relPath),
        uuid: uuidMatch ? uuidMatch[1] : null,
        title: titleOf(content, abs.split('/').pop()),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        // Change-detection fingerprint only — never an integrity or identity
        // check. SHA-1 is chosen for speed, truncated to 12 hex chars, and a
        // collision here costs at most one skipped re-index of a local file.
        hash: content ? createHash('sha1').update(content).digest('hex').slice(0, 12) : null,
      });
    }
  }

  return records;
}

/**
 * Rebuild the Tier B index for a project.
 *
 * Safe to run repeatedly; every write is an upsert keyed on path or uuid.
 * Rows for files that disappeared are pruned so a stale index cannot report a
 * task that no longer exists.
 *
 * @param {string} cwd - Project root
 * @param {object} store - An open store (must be the sqlite backend)
 * @returns {{files: number, tasks: number, skipped: boolean, pruned: number}}
 */
export function reindex(cwd, store) {
  // The file backend has no index tables; asking it to index is a no-op, not
  // an error — callers should keep working against the filesystem.
  if (!store || store.backend !== 'sqlite') {
    return { files: 0, tasks: 0, failures: 0, skipped: true, pruned: 0 };
  }

  const qeDir = join(cwd, '.qe');
  const records = collectIndexableFiles(cwd);
  const seenPaths = new Set();
  for (const record of records) {
    store.indexFile(record);
    seenPaths.add(record.path);
  }
  const files = records.length;

  const pruned = store.pruneIndex ? store.pruneIndex([...seenPaths]) : 0;

  let failures = 0;
  const failuresRoot = join(qeDir, 'learning', 'failures');
  if (existsSync(failuresRoot) && store.upsertFailure) {
    for (const abs of walk(failuresRoot)) {
      if (!abs.endsWith('CONTEXT.md')) continue;
      try {
        const record = parseFailureContext(readFileSync(abs, 'utf8'), relative(cwd, abs));
        if (record) { store.upsertFailure(record); failures += 1; }
      } catch {
        // One unreadable record must not abort the rest of the sweep.
      }
    }
  }

  let tasks = 0;
  const taskLogPath = join(qeDir, 'TASK_LOG.md');
  if (existsSync(taskLogPath) && store.upsertTaskRow) {
    try {
      const rows = parseTaskLog(readFileSync(taskLogPath, 'utf8'), relative(cwd, taskLogPath));
      for (const row of rows) {
        store.upsertTaskRow(row);
        tasks += 1;
      }
    } catch {
      // A malformed TASK_LOG must not abort the file index that already
      // succeeded; the caller sees tasks: 0 and can re-run.
    }
  }

  return { files, tasks, failures, skipped: false, pruned };
}

export { INDEXED_DIRS, STATUS_FOLDERS };
