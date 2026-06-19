#!/usr/bin/env node
/**
 * eval-skills-behavioral.mjs
 * Behavioral layer of the skill eval harness (see evals/README.md, D020).
 *
 * Deterministic, zero-dependency. Performs NO model calls — it only discovers and
 * validates opt-in eval cases under evals/cases/*.eval.md and emits a run manifest
 * (evals/.manifest.json). The actual prompt execution + LLM judging is done by the
 * `Mtest-skill` skill, which reads this manifest.
 *
 * Exit 0 = manifest written (even with 0 cases). Exit 1 = a case failed schema.
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, 'skills');
const CASES_DIR = join(ROOT, 'evals', 'cases');
const MANIFEST = join(ROOT, 'evals', '.manifest.json');

const REQUIRED = ['skill', 'prompt', 'must_include', 'must_not_include', 'rubric'];
const LIST_FIELDS = new Set(['must_include', 'must_not_include']);

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
      fm[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  if (block !== null) fm[block] = blockLines.join('\n').trim();
  return fm;
}

const skillNames = new Set();
for (const dir of readdirSync(SKILLS_DIR)) {
  if (dir === 'coding-experts') continue;
  if (existsSync(join(SKILLS_DIR, dir, 'SKILL.md')) && statSync(join(SKILLS_DIR, dir)).isDirectory()) {
    skillNames.add(dir);
  }
}

const cases = [];
const errors = [];

if (existsSync(CASES_DIR)) {
  for (const f of readdirSync(CASES_DIR).sort()) {
    if (!f.endsWith('.eval.md')) continue;
    const fm = parseFrontmatter(readFileSync(join(CASES_DIR, f), 'utf8'));
    if (!fm) { errors.push(`${f}: no frontmatter`); continue; }
    let ok = true;
    for (const field of REQUIRED) {
      if (!(field in fm)) { errors.push(`${f}: missing '${field}'`); ok = false; continue; }
      if (LIST_FIELDS.has(field) && !Array.isArray(fm[field])) { errors.push(`${f}: '${field}' must be a list`); ok = false; }
      if (!LIST_FIELDS.has(field) && (typeof fm[field] !== 'string' || fm[field] === '')) { errors.push(`${f}: '${field}' must be a non-empty string`); ok = false; }
    }
    if (typeof fm.skill === 'string' && !skillNames.has(fm.skill)) { errors.push(`${f}: skill '${fm.skill}' not found`); ok = false; }
    if (!ok) continue;
    cases.push({
      file: `evals/cases/${f}`,
      skill: fm.skill,
      prompt: fm.prompt,
      must_include: fm.must_include,
      must_not_include: fm.must_not_include,
      rubric: fm.rubric,
    });
  }
}

if (errors.length > 0) {
  console.error('Behavioral eval manifest build FAILED — fix these cases:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  note: 'Run via Mtest-skill: execute each prompt, gate on must_include/must_not_include, then LLM-judge against rubric. This script makes no model calls.',
  caseCount: cases.length,
  cases,
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`eval-skills-behavioral: wrote ${cases.length} case(s) → evals/.manifest.json`);
console.log('Next: run /Mtest-skill to execute the manifest with LLM judging.');
process.exit(0);
