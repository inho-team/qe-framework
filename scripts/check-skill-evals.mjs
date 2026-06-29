#!/usr/bin/env node
/**
 * check-skill-evals.mjs
 * Structural layer of the skill eval harness (see evals/README.md, D020).
 * Deterministic, zero-dependency (node built-ins only).
 *
 * Checks:
 *   (a) eval-case schema  — every evals/cases/*.eval.md has the required frontmatter
 *                           fields, correct types, and a `skill` that exists.
 *   (b) cross-ref integrity — repo-path references inside each SKILL.md
 *                           (skills/.../SKILL.md, core/*.md, docs/*.md, scripts/*.mjs,
 *                           agents/*.md) resolve to real files.  WARN-level.
 *
 * Routing is NOT re-checked here — that stays in check-skill-routing.mjs.
 *
 * Exit 0 = clean or WARN only. Exit 1 = any FAIL (schema violation).
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const CASES_DIR = join(ROOT, 'evals', 'cases');

const REQUIRED_CASE_FIELDS = ['skill', 'prompt', 'must_include', 'must_not_include', 'rubric'];
const LIST_FIELDS = new Set(['must_include', 'must_not_include']);

// ─── frontmatter parser (supports scalars, `- item` lists, and `key: |` blocks) ──

/**
 * Parses YAML frontmatter supporting scalar values, block lists (`- item`),
 * and block scalars (`key: |`). Returns null when no frontmatter block exists.
 * @param {string} content - Raw file content.
 * @returns {Record<string, string|string[]>|null}
 */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fm = {};
  let curKey = null;     // active list key
  let block = null;      // active block-scalar key
  let blockLines = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (block !== null) {
      // collect indented block-scalar lines until a non-indented key appears
      if (/^\s+/.test(raw) || line === '') { blockLines.push(raw.replace(/^ {2}/, '')); continue; }
      fm[block] = blockLines.join('\n').trim();
      block = null; blockLines = null;
      // fall through to parse current line as a key
    }
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && curKey) {
      let v = listItem[1].trim();
      v = v.replace(/^["']|["']$/g, '');
      fm[curKey].push(v);
      continue;
    }
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim();
      curKey = null;
      if (val === '|' || val === '>') { block = key; blockLines = []; continue; }
      if (val === '') { fm[key] = []; curKey = key; continue; } // list follows
      fm[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  if (block !== null) fm[block] = blockLines.join('\n').trim();
  return fm;
}

// ─── collect skills ──────────────────────────────────────────────────────────

const skillNames = new Set();
const skillFiles = [];

function collectSkillFiles(dir = SKILLS_DIR) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skillPath = join(fullPath, 'SKILL.md');
      if (existsSync(skillPath)) {
        skillNames.add(entry.name);
        skillFiles.push(skillPath);
      } else {
        collectSkillFiles(fullPath);
      }
    }
  }
}
collectSkillFiles();

const fails = [];
const warns = [];

// ─── (a) eval-case schema validation ─────────────────────────────────────────

console.log('\n=== CHECK (a): eval-case schema ===');
let caseCount = 0;
if (existsSync(CASES_DIR)) {
  for (const f of readdirSync(CASES_DIR).sort()) {
    if (!f.endsWith('.eval.md')) continue;
    caseCount++;
    const content = readFileSync(join(CASES_DIR, f), 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) { fails.push(`FAIL [eval-schema] ${f}: no frontmatter block`); continue; }
    for (const field of REQUIRED_CASE_FIELDS) {
      if (!(field in fm)) {
        fails.push(`FAIL [eval-schema] ${f}: missing required field '${field}'`);
        continue;
      }
      if (LIST_FIELDS.has(field) && !Array.isArray(fm[field])) {
        fails.push(`FAIL [eval-schema] ${f}: field '${field}' must be a list`);
      }
      if (!LIST_FIELDS.has(field) && (typeof fm[field] !== 'string' || fm[field] === '')) {
        fails.push(`FAIL [eval-schema] ${f}: field '${field}' must be a non-empty string`);
      }
    }
    if (typeof fm.skill === 'string' && !skillNames.has(fm.skill)) {
      fails.push(`FAIL [eval-schema] ${f}: skill '${fm.skill}' does not exist under skills/`);
    }
  }
}
if (fails.length === 0) {
  console.log(`  OK: ${caseCount} eval case(s) valid`);
} else {
  for (const x of fails) console.log(' ', x);
}

// ─── (b) cross-ref integrity (WARN) ──────────────────────────────────────────

console.log('\n=== CHECK (b): SKILL.md repo-path cross-references (WARN) ===');
// The leading (?<![\w/.:-]) negative lookbehind rejects two false-positive classes:
//   - sub-paths of a longer path  (e.g. "scripts/x.mjs" inside "hooks/scripts/x.mjs")
//   - paths embedded in a URL      (e.g. ".../docs/install_linux.md" in a github URL)
// so a ref only matches when it starts at a real boundary (space, backtick, quote, ( ).
const PATH_RE = /(?<![\w/.:-])(skills\/[\w.-]+\/SKILL\.md|core\/[\w.\/-]+\.md|docs\/[\w.\/-]+\.md|scripts\/[\w.-]+\.mjs|agents\/[\w.-]+\.md)\b/g;
// Known template/example placeholders that intentionally name non-existent files.
const PLACEHOLDER_RE = /\b(Qname|Ename|Enew-agent|Qfoo|foo|bar|example|template|XXX|YYY|ZZZ)\b/i;
let refCount = 0;
const warnStart = warns.length;
for (const skillPath of skillFiles) {
  const dir = skillPath.split('/').at(-2);
  const content = readFileSync(skillPath, 'utf8');
  const seen = new Set();
  let mm;
  while ((mm = PATH_RE.exec(content)) !== null) {
    const ref = mm[1];
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (PLACEHOLDER_RE.test(ref)) continue; // skip documented placeholders
    refCount++;
    if (!existsSync(join(ROOT, ref))) {
      warns.push(`WARN [cross-ref] ${dir}: references '${ref}' which does not exist`);
    }
  }
}
if (warns.length === warnStart) {
  console.log(`  OK: ${refCount} repo-path reference(s) resolve`);
} else {
  for (const w of warns.slice(warnStart)) console.log(' ', w);
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log('\n=== SUMMARY ===');
console.log(`Skills scanned:   ${skillNames.size}`);
console.log(`Eval cases:       ${caseCount}`);
console.log(`Cross-refs:       ${refCount}`);
console.log(`FAILs:            ${fails.length}`);
console.log(`WARNs:            ${warns.length}`);

if (fails.length > 0) {
  console.log('\nFAIL details:');
  for (const f of fails) console.log(' ', f);
  process.exit(1);
} else if (warns.length > 0) {
  console.log('\nResult: PASS (with warnings)');
  process.exit(0);
} else {
  console.log('\nResult: PASS (clean)');
  process.exit(0);
}
