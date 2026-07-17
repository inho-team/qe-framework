#!/usr/bin/env node
/**
 * check-core-doc-wiring.mjs  (gate — auto-discovered by check-all.mjs)
 *
 * Asserts that every `core/**\/*.md` document is referenced by at least one
 * runtime code file, so that editing the document actually changes behaviour.
 *
 * Why this gate exists
 * --------------------
 * `core/contexts/dev.md` declared in its own header that it activates on the
 * implement/build/create intent, but no code ever read `core/contexts/`. The
 * document was a silent no-op for its entire lifetime: the rules looked
 * enforced, and were not. Nothing failed, so nobody noticed. See issue #16.
 *
 * A document that no code loads cannot be relied on. Worse, it actively misleads
 * whoever reads it into believing a rule is enforced.
 *
 * Baseline, not a clean bill of health
 * ------------------------------------
 * 22 documents are unwired today. They are listed in KNOWN_UNWIRED so this gate
 * can be introduced without a repo-wide fix first. The list is a debt ledger,
 * not an exemption: this gate fails when a NEW unwired document appears, and it
 * also fails when a listed document becomes wired but is left on the list. That
 * second check is what keeps the ledger from silently rotting into permanence.
 *
 * Note that "referenced by code" is a necessary condition, not a sufficient one
 * — it cannot prove the reference does anything useful. It only catches the
 * specific failure where a document is wired to nothing at all.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/metadata-source.mjs';

// This file lists every unwired document by name in KNOWN_UNWIRED below. Scanning
// itself would therefore match every one of them and report the whole ledger as
// wired, so it is excluded from the scan.
const SELF = fileURLToPath(import.meta.url);
const SELF_REL = relative(ROOT, SELF).split(sep).join('/');

/**
 * Documents known to be unwired as of issue #16. Remove entries as they get
 * wired (or deleted) — a stale entry here fails this gate.
 */
const KNOWN_UNWIRED = new Set([
  'core/AGENT_BASE.md',
  'core/EXECUTION_HARNESS.md',
  'core/MEMORY_SPEC.md',
  'core/METRICS_SPEC.md',
  'core/MODE_TokenEfficiency.md',
  'core/PHILOSOPHY.md',
  'core/PRINCIPLES.md',
  'core/REMEDIATION_REQUEST_FORMAT.md',
  'core/RETROSPECTIVE_TEMPLATE.md',
  'core/STATE_SPEC.md',
  'core/USER_ACTION_REQUEST.md',
  'core/contexts/debug.md',
  'core/contexts/deploy.md',
  'core/contexts/research.md',
  'core/contexts/review.md',
  'core/rules/code-review.md',
  'core/rules/error-handling.md',
  'core/rules/git-workflow.md',
  'core/rules/naming.md',
  'core/rules/performance.md',
  'core/rules/security.md',
  'core/rules/testing.md',
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
 * purpose — a document referenced only by its own test is still wired to
 * nothing at runtime.
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

// A document is "wired" if its filename appears in runtime code. Filenames are
// matched rather than full paths because loaders build paths piecewise, e.g.
// join(__dirname, '..', '..', 'core', 'contexts', 'dev.md').
const codeText = listRuntimeCodeFiles()
  .map(file => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const failures = [];

for (const doc of listCoreDocs()) {
  const filename = doc.split('/').pop();
  const isWired = codeText.includes(filename);
  const isListed = KNOWN_UNWIRED.has(doc);

  if (!isWired && !isListed) {
    failures.push(
      `${doc} — no runtime code references it, so editing it changes nothing. ` +
      `Wire it into a hook (see hooks/scripts/prompt-check.mjs for the dev.md pattern), ` +
      `delete it, or add it to KNOWN_UNWIRED with a tracking issue.`
    );
  }

  if (isWired && isListed) {
    failures.push(
      `${doc} — now referenced by code but still listed in KNOWN_UNWIRED. ` +
      `Remove it from that list in ${SELF_REL}.`
    );
  }
}

// A path listed but no longer present would keep the ledger looking larger than
// the real debt, so treat it as stale too.
const presentDocs = new Set(listCoreDocs());
for (const listed of KNOWN_UNWIRED) {
  if (!presentDocs.has(listed)) {
    failures.push(`${listed} — listed in KNOWN_UNWIRED but the file no longer exists. Remove the entry.`);
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

const total = listCoreDocs().length;
console.log(
  `check-core-doc-wiring: PASS — ${total - KNOWN_UNWIRED.size}/${total} core docs wired, ` +
  `${KNOWN_UNWIRED.size} known-unwired (issue #16).`
);
