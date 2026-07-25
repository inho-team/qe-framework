#!/usr/bin/env node
/**
 * check-doc-conventions.mjs  (gate — auto-discovered by check-all.mjs)
 *
 * Lints the QE execution-document convention defined in `core/DOC_CONVENTIONS.md`.
 * Zero external dependencies: Node builtins plus the repo's own shared extractor
 * (`scripts/lib/doc-frontmatter.mjs`) and index helper (`scripts/lib/doc-index.mjs`).
 *
 * Opt-in by design (D-G1): only documents that CARRY a `qe-doc-frontmatter`
 * block are checked. Documents without the block are grandfathered until the
 * Phase 4 bulk migration — the four current legacy files (`5b7591e7`,
 * `923a69eb`, `qsumm001`, `2026-06-29T…-sivs-autofallback`) are skipped with zero
 * false failures. An opening marker that is never closed is NOT a skip — it is a
 * FAIL, so a corrupted block can never masquerade as a legacy document.
 *
 * FAIL vs WARN is decided by the SOURCE document's lifecycle folder: a broken
 * link from a pending/in-progress document is a generation-path FAIL; a dangling
 * link from a completed/archived document is a post-move WARN that the next
 * rebuild reconciles.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocFrontmatter } from './lib/doc-frontmatter.mjs';
import { listExecutionDocFiles, computeIndex, KINDS } from './lib/doc-index.mjs';

// Default target is the repo this script lives in; an explicit CLI/test argument
// (`node scripts/check-doc-conventions.mjs <root>`) lints a fixture root instead.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = process.argv[2] ? resolve(process.argv[2]) : REPO_ROOT;

const REQUIRED_FIELDS = ['kind', 'uuid', 'plan', 'phase', 'created', 'status', 'links'];
const STATUS_VALUES = new Set(['pending', 'in-progress', 'completed', 'archived']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}$/; // 8-hex; legacy ids are allowed via the fallback below.

const failures = [];
const warnings = [];

/** A pending/in-progress source raises FAIL; completed/archived raises WARN. */
function severityFor(rel) {
  return rel.includes('/completed/') || rel.includes('/archived/') || rel.includes('/.archive/')
    ? 'warn'
    : 'fail';
}

/** Record a problem at the severity dictated by the source lifecycle folder. */
function report(rel, message, severity = 'fail') {
  (severity === 'warn' ? warnings : failures).push(`${rel} — ${message}`);
}

/**
 * Validate a single `[[link]]` target. Rejects unsafe forms outright (absolute,
 * parent-traversal, external, shell interpolation) and checks that the file path
 * exists, ignoring any `#fragment`.
 */
function checkLink(rel, rawLink) {
  const inner = String(rawLink).replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
  const pathPart = inner.split('#')[0].trim();
  if (pathPart === '') {
    report(rel, `empty link target in "${rawLink}"`, 'fail');
    return;
  }
  if (/^([a-z]+:)?\/\//i.test(pathPart) || /^[a-z]+:/i.test(pathPart)) {
    report(rel, `external/scheme link not allowed: "${pathPart}"`, 'fail');
    return;
  }
  if (pathPart.startsWith('/')) {
    report(rel, `absolute link not allowed: "${pathPart}"`, 'fail');
    return;
  }
  // Split on both separators so a backslash cannot smuggle a `..` segment past
  // the traversal guard on a platform that treats `\` as a path separator.
  if (pathPart.split(/[\\/]/).includes('..')) {
    report(rel, `parent-traversal link not allowed: "${pathPart}"`, 'fail');
    return;
  }
  if (/[$`;|&<>*?\s\\\x00]/.test(pathPart)) {
    report(rel, `unsafe characters in link: "${pathPart}"`, 'fail');
    return;
  }
  // Canonical containment: enforce the target actually resolves inside the repo
  // root rather than trusting the string checks above. Defense in depth.
  const resolved = resolve(ROOT, pathPart);
  const rootResolved = resolve(ROOT);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    report(rel, `link escapes repo root: "${pathPart}"`, 'fail');
    return;
  }
  if (!existsSync(resolved)) {
    const sev = severityFor(rel);
    report(rel, `${sev === 'warn' ? 'dangling' : 'broken'} link: "${pathPart}"`, sev);
  }
}

/** Validate one opted-in document's frontmatter block against the convention. */
function checkDoc({ full, rel }) {
  const text = readFileSync(full, 'utf8');
  const fm = extractDocFrontmatter(text);

  if (fm.state === 'missing') return; // grandfathered — no block, not our concern yet.
  if (fm.state !== 'valid') {
    report(rel, `invalid qe-doc-frontmatter block: ${fm.error || fm.state}`, 'fail');
    return;
  }

  const md = fm.metadata || {};
  for (const field of REQUIRED_FIELDS) {
    if (md[field] === undefined || md[field] === null || md[field] === '') {
      report(rel, `missing required frontmatter field "${field}"`, 'fail');
    }
  }
  if (md.kind !== undefined && !KINDS.includes(md.kind)) {
    report(rel, `invalid kind "${md.kind}" (allowed: ${KINDS.join(', ')})`, 'fail');
  }
  if (typeof md.uuid === 'string' && md.uuid && !UUID_RE.test(md.uuid) && !/^[A-Za-z0-9._-]+$/.test(md.uuid)) {
    report(rel, `invalid uuid "${md.uuid}"`, 'fail');
  }
  if (typeof md.created === 'string' && md.created && !DATE_RE.test(md.created)) {
    report(rel, `created must be YYYY-MM-DD, got "${md.created}"`, 'fail');
  }
  if (typeof md.status === 'string' && md.status && !STATUS_VALUES.has(md.status)) {
    report(rel, `invalid status "${md.status}"`, 'fail');
  }
  if (md.links !== undefined) {
    if (!Array.isArray(md.links)) {
      report(rel, 'links must be a list of [[path]] values', 'fail');
    } else {
      for (const link of md.links) checkLink(rel, link);
    }
  }
}

// 1. Per-document convention checks (opt-in).
for (const doc of listExecutionDocFiles(ROOT)) {
  try {
    checkDoc(doc);
  } catch (err) {
    failures.push(`${doc.rel} — could not lint: ${err.message}`);
  }
}

// 2. Derived-index freshness: the on-disk .qe/index.md must equal a fresh rebuild
//    of the current directory state. A drift means a generator skipped its single
//    post-write rebuild call — a generation-path defect, so it is a FAIL.
const indexPath = join(ROOT, '.qe', 'index.md');
try {
  if (!existsSync(indexPath)) {
    failures.push('.qe/index.md — missing; run `node scripts/lib/doc-index.mjs` to generate it.');
  } else if (readFileSync(indexPath, 'utf8') !== computeIndex(ROOT)) {
    failures.push('.qe/index.md — stale; rebuild with `node scripts/lib/doc-index.mjs` after any doc create/move.');
  }
} catch (err) {
  failures.push(`.qe/index.md — could not verify freshness: ${err.message}`);
}

// Report. Warnings never fail the gate; only FAIL-severity findings do. See
// core/DOC_CONVENTIONS.md for the full contract.
if (warnings.length > 0) {
  console.warn('check-doc-conventions: WARN\n');
  for (const w of warnings) console.warn(`  - ${w}`);
  console.warn('');
}
if (failures.length > 0) {
  console.error('check-doc-conventions: FAIL\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\n${failures.length} problem(s). See core/DOC_CONVENTIONS.md.`);
  process.exit(1);
}
console.log(`check-doc-conventions: PASS — convention honored${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
