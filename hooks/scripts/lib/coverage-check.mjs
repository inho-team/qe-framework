#!/usr/bin/env node
'use strict';

/**
 * Coverage Check — TASK_REQUEST → VERIFY_CHECKLIST output-coverage validator.
 *
 * Adapts the FableCodex `fable_coverage.py` accountability idea to QE's real
 * artifacts. QE task pairs have no shared requirement IDs; instead each
 * TASK_REQUEST checklist item declares the artifacts it will produce with a
 * `→ output: <paths>` trailer. This validator proves that every declared output
 * is referenced by the paired VERIFY_CHECKLIST — i.e. nothing the task promises
 * to produce escapes verification ("orphan output").
 *
 * ## What it parses
 *
 *   TASK_REQUEST `## Checklist`:
 *     - [ ] 1. Do the thing. → output: `path/a.md` (수정), `path/b/` (삭제)
 *   Each `- [ ]` line is one requirement; the backtick-wrapped tokens after
 *   `→ output:` (or `-> output:`) are its declared artifacts.
 *
 *   VERIFY_CHECKLIST: the full markdown text is the haystack. Because QE
 *   checklists are prose (no shared IDs), an output is matched in tiers:
 *     - `path`     full normalized path appears (high confidence)
 *     - `basename` distinctive file name appears (generic names excluded)
 *     - `stem`     file name without extension appears as a whole word
 *                  (e.g. a `CHANGELOG.md` output verified by a `## CHANGELOG`
 *                   section) — length-guarded to avoid generic stems like SKILL
 *   Only an output with NO tier match is an "orphan". `path` matches are
 *   `verified`; `basename`/`stem` matches are reported as `weak` so a reviewer
 *   can tighten the wording if desired.
 *
 * ## Usage
 *
 *   import { coverageReport } from './coverage-check.mjs';
 *   const report = coverageReport(taskMd, verifyMd);
 *   if (!report.ok) { /* report.orphans lists unverified outputs *\/ }
 *
 * CLI:
 *   node coverage-check.mjs <uuid>      # check one pending pair
 *   node coverage-check.mjs --all       # scan all pending pairs
 *   node coverage-check.mjs --task A.md --verify B.md
 *   exit 0 = all declared outputs verified; exit 1 = orphan output(s) found.
 *
 * @module coverage-check
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const OUTPUT_MARKER = /(?:→|->)\s*output\s*:/i;
const CHECKBOX = /^\s*-\s*\[[ xX~]\]\s*(.*)$/;

// File names too generic to count as a basename/stem match — they appear in
// almost every checklist and would mask real orphans.
const GENERIC_NAMES = new Set([
  'skill.md', 'readme.md', 'index.md', 'agents.md', 'claude.md',
  'package.json', 'plugin.json', 'config.json', 'skill', 'readme', 'index', 'config',
]);
// Minimum stem length for a no-extension whole-word match. Keeps distinctive
// stems (CHANGELOG, UNDERSTAND_ANYTHING_EVAL) while excluding short generics.
const STEM_MIN = 6;

/**
 * Strip a single trailing slash so directory outputs (`a/b/`) and file outputs
 * compare uniformly, and lowercase for case-insensitive matching.
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  return p.replace(/\/+$/, '').trim();
}

/**
 * Extract every backtick-wrapped token from a string. Falls back to
 * comma-splitting when no backticks are present, dropping tokens that are only
 * parenthetical annotations like `(수정)`.
 * @param {string} s
 * @returns {string[]}
 */
function extractPaths(s) {
  const ticks = [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
  if (ticks.length) return ticks;
  return s
    .split(',')
    .map((part) => part.replace(/\([^)]*\)/g, '').trim())
    .filter((part) => part && !/^\(.*\)$/.test(part));
}

/**
 * Parse a TASK_REQUEST markdown body into checklist items with their declared
 * output artifacts. Only the `## Checklist` section is scanned; fenced code
 * blocks are ignored. Never throws.
 *
 * @param {string} content - TASK_REQUEST markdown text
 * @returns {Array<{ id: string|null, line: number, text: string, outputs: string[] }>}
 */
export function extractTaskOutputs(content) {
  if (typeof content !== 'string' || !content) return [];
  const lines = content.split('\n');
  const items = [];
  let inChecklist = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Enter on the `## Checklist` heading; leave on the next top-level `## `.
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      inChecklist = /checklist/i.test(h2[1]);
      continue;
    }
    if (!inChecklist) continue;

    const cb = line.match(CHECKBOX);
    if (!cb) continue;

    const body = cb[1];
    const idMatch = body.match(/^(\d+)\./);
    const id = idMatch ? idMatch[1] : null;

    let outputs = [];
    const om = body.match(OUTPUT_MARKER);
    if (om) {
      outputs = extractPaths(body.slice(om.index + om[0].length));
    }

    items.push({ id, line: i + 1, text: body.trim(), outputs });
  }
  return items;
}

/**
 * Escape a string for safe inclusion in a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Classify how a declared output is matched against the verify haystack.
 * Case-insensitive; the haystack may be passed in any case.
 * @param {string} path - declared output path
 * @param {string} hay - VERIFY_CHECKLIST text
 * @returns {'path'|'basename'|'stem'|null} tier, or null when unmatched (orphan)
 */
export function classifyOutput(path, hay) {
  const norm = normalizePath(path).toLowerCase();
  if (!norm) return null;
  const h = (typeof hay === 'string' ? hay : '').toLowerCase();
  if (h.includes(norm)) return 'path';

  const base = norm.split('/').pop() || '';
  if (base && !GENERIC_NAMES.has(base) && h.includes(base)) return 'basename';

  const stem = base.replace(/\.[^.]+$/, '');
  if (stem.length >= STEM_MIN && !GENERIC_NAMES.has(stem)) {
    const re = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(stem)}([^a-z0-9_]|$)`);
    if (re.test(h)) return 'stem';
  }
  return null;
}

/**
 * Build a coverage report: which TASK_REQUEST-declared outputs are referenced by
 * the VERIFY_CHECKLIST, and which are orphaned (declared but never verified).
 * `verified` = full-path match; `weak` = basename/stem-only match; orphan = none.
 *
 * @param {string} taskContent - TASK_REQUEST markdown text
 * @param {string} verifyContent - VERIFY_CHECKLIST markdown text
 * @returns {{
 *   items: Array<{ id: string|null, line: number, text: string, hasOutput: boolean,
 *                  outputs: Array<{ path: string, tier: ('path'|'basename'|'stem'|null) }> }>,
 *   orphans: Array<{ id: string|null, path: string, line: number }>,
 *   weak: Array<{ id: string|null, path: string, line: number, tier: string }>,
 *   totalOutputs: number,
 *   coveredOutputs: number,
 *   noOutputItems: number,
 *   ok: boolean
 * }}
 */
export function coverageReport(taskContent, verifyContent) {
  const items = extractTaskOutputs(taskContent);
  const hay = (typeof verifyContent === 'string' ? verifyContent : '').toLowerCase();
  const orphans = [];
  const weak = [];
  let totalOutputs = 0;
  let coveredOutputs = 0;

  const itemReports = items.map((it) => {
    const outputs = it.outputs.map((path) => {
      const tier = classifyOutput(path, hay);
      totalOutputs++;
      if (tier) {
        coveredOutputs++;
        if (tier !== 'path') weak.push({ id: it.id, path, line: it.line, tier });
      } else {
        orphans.push({ id: it.id, path, line: it.line });
      }
      return { path, tier };
    });
    return {
      id: it.id,
      line: it.line,
      text: it.text,
      hasOutput: it.outputs.length > 0,
      outputs,
    };
  });

  return {
    items: itemReports,
    orphans,
    weak,
    totalOutputs,
    coveredOutputs,
    noOutputItems: itemReports.filter((r) => !r.hasOutput).length,
    ok: orphans.length === 0,
  };
}

// --- CLI ---------------------------------------------------------------------

const TASK_DIR = join('.qe', 'tasks', 'pending');
const VERIFY_DIR = join('.qe', 'checklists', 'pending');

/**
 * Read a file as UTF-8, returning '' on any error (fault-tolerant).
 * @param {string} p
 * @returns {string}
 */
function readSafe(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf-8') : ''; } catch { return ''; }
}

/**
 * Render a one-pair report to stdout. Returns true when fully covered.
 * @param {string} label
 * @param {string} taskContent
 * @param {string} verifyContent
 * @returns {boolean}
 */
function reportPair(label, taskContent, verifyContent) {
  const r = coverageReport(taskContent, verifyContent);
  const head = `coverage-check: ${label} — outputs ${r.coveredOutputs}/${r.totalOutputs} verified`;
  const weakNote = (w) =>
    `  ~ [item ${w.id ?? '?'} @L${w.line}] verified by ${w.tier} only: ${w.path}`;
  if (r.ok) {
    const tail = r.noOutputItems ? ` (${r.noOutputItems} item(s) declare no output)` : '';
    console.log(`${head} ✓${tail}`);
    for (const w of r.weak) console.log(weakNote(w));
    return true;
  }
  console.log(`${head} — ${r.orphans.length} ORPHAN(S):`);
  for (const o of r.orphans) {
    console.log(`  ✗ [item ${o.id ?? '?'} @L${o.line}] not verified: ${o.path}`);
  }
  for (const w of r.weak) console.log(weakNote(w));
  return false;
}

/**
 * List pending task UUIDs by scanning the task directory.
 * @returns {string[]}
 */
function pendingUuids() {
  try {
    return readdirSync(TASK_DIR)
      .map((f) => f.match(/^TASK_REQUEST_(.+)\.md$/))
      .filter(Boolean)
      .map((m) => m[1]);
  } catch { return []; }
}

/**
 * CLI entry point. Resolves a task/verify pair (by `--task/--verify`, `--all`,
 * or a single UUID under `.qe/`) and prints coverage reports.
 * @param {string[]} argv - process.argv
 * @returns {number} exit code: 0 all covered, 1 orphan(s) found, 2 usage error
 */
function main(argv) {
  const args = argv.slice(2);
  const taskFlag = args.indexOf('--task');
  const verifyFlag = args.indexOf('--verify');

  // Explicit file pair.
  if (taskFlag !== -1 && verifyFlag !== -1) {
    const ok = reportPair(
      'pair',
      readSafe(args[taskFlag + 1]),
      readSafe(args[verifyFlag + 1]),
    );
    return ok ? 0 : 1;
  }

  // Scan all pending pairs.
  if (args.includes('--all')) {
    const uuids = pendingUuids();
    if (!uuids.length) {
      console.log('coverage-check: no pending TASK_REQUEST files found.');
      return 0;
    }
    let allOk = true;
    for (const uuid of uuids) {
      const ok = reportPair(
        uuid,
        readSafe(join(TASK_DIR, `TASK_REQUEST_${uuid}.md`)),
        readSafe(join(VERIFY_DIR, `VERIFY_CHECKLIST_${uuid}.md`)),
      );
      allOk = allOk && ok;
    }
    return allOk ? 0 : 1;
  }

  // Single UUID.
  const uuid = args.find((a) => !a.startsWith('--'));
  if (!uuid) {
    console.error('Usage: coverage-check.mjs <uuid> | --all | --task A.md --verify B.md');
    return 2;
  }
  const ok = reportPair(
    uuid,
    readSafe(join(TASK_DIR, `TASK_REQUEST_${uuid}.md`)),
    readSafe(join(VERIFY_DIR, `VERIFY_CHECKLIST_${uuid}.md`)),
  );
  return ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
