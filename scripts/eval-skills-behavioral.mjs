#!/usr/bin/env node
/**
 * eval-skills-behavioral.mjs
 * Behavioral layer of the skill eval harness (see evals/README.md, D020).
 *
 * Deterministic, zero-dependency. Performs NO model calls — it only discovers and
 * validates opt-in eval cases under evals/cases/*.eval.md and emits a run manifest
 * (evals/.manifest.json). The manifest is deterministic; behavioral review happens
 * outside this script, typically via manual /Qcritical-review handoff.
 *
 * Exit 0 = manifest written (even with 0 cases). Exit 1 = a case failed schema.
 */

import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const CASES_DIR = join(ROOT, 'evals', 'cases');
const MANIFEST = join(ROOT, 'evals', '.manifest.json');

const REQUIRED = ['skill', 'prompt', 'must_include', 'must_not_include', 'rubric'];
const LIST_FIELDS = new Set(['must_include', 'must_not_include']);
// Canonical optional fields for pressure-scenario RED/GREEN/REFACTOR + no-guidance control.
// MUST stay in sync with check-skill-evals.mjs (sibling validator, intentionally duplicate).
// See: qe-framework/scripts/check-skill-evals.mjs
const OPTIONAL = ['red_scenario', 'green_expectation', 'refactor_note', 'no_guidance_control'];

/**
 * Parses YAML frontmatter supporting scalars, `- item` lists, and `key: |` block scalars.
 * @param {string} content
 * @returns {Record<string, string|string[]>|null}
 */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fm = {};
  let curKey = null, block = null, blockLines = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (block !== null) {
      if (/^\s+/.test(raw) || line === '') { blockLines.push(raw.replace(/^ {2}/, '')); continue; }
      fm[block] = blockLines.join('\n').trim();
      block = null; blockLines = null;
    }
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && curKey) { fm[curKey].push(listItem[1].trim().replace(/^["']|["']$/g, '')); continue; }
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim(), val = kv[2].trim();
      curKey = null;
      if (val === '|' || val === '>') { block = key; blockLines = []; continue; }
      if (val === '') { fm[key] = []; curKey = key; continue; }
      // Bare YAML null scalars (null / ~) → empty string so emptiness checks fire.
      // Quoted "null" stays a literal string. MUST stay in sync with check-skill-evals.mjs.
      if (/^(null|~)$/i.test(val)) { fm[key] = ''; continue; }
      fm[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  if (block !== null) fm[block] = blockLines.join('\n').trim();
  return fm;
}

const skillNames = new Set();

/**
 * Recursively collect skill directory names under skills/ into the module-level
 * `skillNames` set (a directory counts when it contains a SKILL.md).
 * @param {string} [dir=SKILLS_DIR] - Directory to scan.
 */
function collectSkillNames(dir = SKILLS_DIR) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(join(fullPath, 'SKILL.md'))) {
        skillNames.add(entry.name);
      } else {
        collectSkillNames(fullPath);
      }
    }
  }
}
collectSkillNames();

const cases = [];
const errors = [];
const sourceInputs = [];

if (existsSync(CASES_DIR)) {
  for (const f of readdirSync(CASES_DIR).sort()) {
    if (!f.endsWith('.eval.md')) continue;
    const caseRaw = readFileSync(join(CASES_DIR, f), 'utf8');
    const fm = parseFrontmatter(caseRaw);
    if (!fm) { errors.push(`${f}: no frontmatter`); continue; }
    let ok = true;
    for (const field of REQUIRED) {
      if (!(field in fm)) { errors.push(`${f}: missing '${field}'`); ok = false; continue; }
      // Empty-after-colon parses to [] — treat as present-but-empty (FAIL), same as bare null.
      // MUST stay in sync with check-skill-evals.mjs.
      if (LIST_FIELDS.has(field) && (!Array.isArray(fm[field]) || fm[field].length === 0)) { errors.push(`${f}: '${field}' must be a non-empty list`); ok = false; }
      if (!LIST_FIELDS.has(field) && (typeof fm[field] !== 'string' || fm[field] === '')) { errors.push(`${f}: '${field}' must be a non-empty string`); ok = false; }
    }
    // Validate optional fields: present-but-empty prohibition (string-like: non-empty; list-like: non-empty array)
    for (const field of OPTIONAL) {
      if (field in fm) {
        const val = fm[field];
        if (typeof val === 'string' && val.trim() === '') { errors.push(`${f}: optional '${field}' is present but empty`); ok = false; }
        if (Array.isArray(val) && val.length === 0) { errors.push(`${f}: optional '${field}' is present but empty`); ok = false; }
      }
    }
    if (typeof fm.skill === 'string' && !skillNames.has(fm.skill)) { errors.push(`${f}: skill '${fm.skill}' not found`); ok = false; }
    if (!ok) continue;
    sourceInputs.push(`${f}\0${caseRaw}\0${readFileSync(join(SKILLS_DIR, fm.skill, 'SKILL.md'), 'utf8')}`);
    const caseObj = {
      file: `evals/cases/${f}`,
      skill: fm.skill,
      prompt: fm.prompt,
      must_include: fm.must_include,
      must_not_include: fm.must_not_include,
      rubric: fm.rubric,
    };
    // Attach optional fields if present
    for (const field of OPTIONAL) {
      if (field in fm) caseObj[field] = fm[field];
    }
    cases.push(caseObj);
  }
}

if (errors.length > 0) {
  console.error('Behavioral eval manifest build FAILED — fix these cases:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceDigest: createHash('sha256').update(sourceInputs.join('\0')).digest('hex'),
  note: 'Deterministic manifest only: discover cases, validate schema, and emit evals/.manifest.json. No model calls are made here; use /Qcritical-review manually for behavioral review when needed.',
  caseCount: cases.length,
  cases,
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`eval-skills-behavioral: wrote ${cases.length} case(s) → evals/.manifest.json`);
console.log('Next: hand the skill text or manifest to /Qcritical-review if you need behavioral review.');
process.exit(0);
