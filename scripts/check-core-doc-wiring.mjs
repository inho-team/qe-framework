#!/usr/bin/env node
/**
 * check-core-doc-wiring.mjs  (gate — auto-discovered by check-all.mjs)
 *
 * Asserts that every `core/**\/*.md` document is reachable — that something,
 * whether code or another document, actually leads to it.
 *
 * Why this gate exists
 * --------------------
 * `core/contexts/dev.md` declared in its own header that it activates on the
 * implement/build/create intent, but no code read `core/contexts/` and no
 * document linked to it either. It was a silent no-op for its entire lifetime:
 * the rules looked enforced, and were not. Nothing failed, so nobody noticed.
 * See issue #16.
 *
 * Two ways to be reachable
 * ------------------------
 * A core document earns its place in one of two ways, and the gate accepts both:
 *
 *   1. Wired — a runtime code file names it, so a hook loads and injects it.
 *      This is how `contexts/*.md` and `PRINCIPLES.md` reach the model.
 *   2. Referenced — another document names it, so a reader (human or model)
 *      following the docs arrives at it. This is how `rules/*.md`, `AGENT_BASE.md`
 *      and the various *_SPEC.md files are meant to be used; requiring a hook to
 *      load them would be wrong, not an improvement.
 *
 * An earlier revision of this gate demanded code references from every document,
 * which flagged 14 healthy reference docs as debt. Debt you cannot pay is noise,
 * and a gate that cries wolf gets ignored — so the rule is reachability, not
 * wiring. A document that is neither wired nor referenced is the real defect:
 * nothing leads to it, so editing it changes nothing for anyone.
 *
 * Baseline, not a clean bill of health
 * ------------------------------------
 * The remaining unreachable documents are listed in KNOWN_UNREACHABLE so this
 * gate can run green today. The list is a debt ledger, not an exemption: the gate
 * fails when a NEW unreachable document appears, and equally when a listed one
 * becomes reachable but is left on the list. That second check is what stops the
 * ledger from quietly rotting into permanence.
 *
 * Note that reachability is a necessary condition, not a sufficient one — it
 * cannot prove the reference does anything useful. It only catches the specific
 * failure where a document is connected to nothing at all.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/metadata-source.mjs';

// This file names every unreachable document in KNOWN_UNREACHABLE below. Scanning
// itself would match all of them and report the whole ledger as reachable, so it
// is excluded from both scans.
const SELF = fileURLToPath(import.meta.url);
const SELF_REL = relative(ROOT, SELF).split(sep).join('/');

/**
 * Documents reachable from neither code nor any other document, as of issue #16.
 * Remove entries as they get wired, linked, or deleted — a stale entry fails this
 * gate.
 */
const KNOWN_UNREACHABLE = new Set([
  'core/MEMORY_SPEC.md',
]);

/** @returns {string[]} repo-relative POSIX paths of every core/ markdown file */
function listCoreDocs() {
  const coreDir = join(ROOT, 'core');
  return readdirSync(coreDir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(entry.parentPath, entry.name))
    .map(full => relative(ROOT, full).split(sep).join('/'))
    .sort();
}

/**
 * Runtime code that could load a core document. Test files are excluded on
 * purpose — a document referenced only by its own test is still wired to nothing
 * at runtime.
 *
 * @returns {string[]} absolute paths
 */
function listRuntimeCodeFiles() {
  const files = [];

  for (const dir of ['hooks', 'scripts']) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;

      const full = join(entry.parentPath, entry.name);
      if (full.includes('__tests__')) continue;
      if (full === SELF) continue;

      files.push(full);
    }
  }

  files.push(join(ROOT, '.claude-plugin', 'plugin.json'));
  return files;
}

/**
 * Documents that could link to a core document. CHANGELOG.md is deliberately not
 * scanned: it records that a file once changed, which says nothing about whether
 * anything leads to it today.
 *
 * @returns {{ rel: string, text: string }[]}
 */
function listDocFiles() {
  const docs = [];

  for (const dir of ['core', 'skills', 'agents', 'docs']) {
    const dirPath = join(ROOT, dir);
    if (!existsSync(dirPath)) continue;

    for (const entry of readdirSync(dirPath, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const full = join(entry.parentPath, entry.name);
      try {
        docs.push({ rel: relative(ROOT, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
      } catch {
        // Unreadable file cannot reference anything; skip it.
      }
    }
  }

  return docs;
}

// Filenames are matched rather than full paths because loaders build paths
// piecewise, e.g. join(__dirname, '..', '..', 'core', 'contexts', 'dev.md').
const codeText = listRuntimeCodeFiles()
  .map(file => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const docFiles = listDocFiles();
const coreDocs = listCoreDocs();
const failures = [];

for (const doc of coreDocs) {
  const filename = doc.split('/').pop();

  const isWired = codeText.includes(filename);
  // A document naming itself proves nothing, so it never counts as a referrer.
  const isReferenced = docFiles.some(other => other.rel !== doc && other.text.includes(filename));

  const isReachable = isWired || isReferenced;
  const isListed = KNOWN_UNREACHABLE.has(doc);

  if (!isReachable && !isListed) {
    failures.push(
      `${doc} — nothing leads to it: no runtime code loads it and no document links to it, ` +
      `so editing it changes nothing for anyone. Wire it into a hook ` +
      `(see hooks/scripts/prompt-check.mjs for the contexts pattern), link it from a ` +
      `document that is itself reachable, delete it, or add it to KNOWN_UNREACHABLE ` +
      `with a tracking issue.`
    );
  }

  if (isReachable && isListed) {
    const how = isWired ? 'runtime code now loads it' : 'a document now links to it';
    failures.push(`${doc} — ${how}, but it is still listed in KNOWN_UNREACHABLE. Remove it from that list in ${SELF_REL}.`);
  }
}

// A path listed but no longer present would keep the ledger looking larger than
// the real debt, so treat it as stale too.
const presentDocs = new Set(coreDocs);
for (const listed of KNOWN_UNREACHABLE) {
  if (!presentDocs.has(listed)) {
    failures.push(`${listed} — listed in KNOWN_UNREACHABLE but the file no longer exists. Remove the entry.`);
  }
}

if (failures.length > 0) {
  console.error('check-core-doc-wiring: FAIL\n');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(`\n${failures.length} problem(s). See issue #16.`);
  process.exit(1);
}

console.log(
  `check-core-doc-wiring: PASS — ${coreDocs.length - KNOWN_UNREACHABLE.size}/${coreDocs.length} core docs reachable, ` +
  `${KNOWN_UNREACHABLE.size} known-unreachable (issue #16).`
);
