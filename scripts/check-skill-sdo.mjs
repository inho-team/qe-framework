#!/usr/bin/env node
/**
 * check-skill-sdo.mjs (guard — auto-discovered by check-all.mjs)
 *
 * Skill Description Quality (SDO) lint — Phase 1 WARN-only report.
 *
 * Validates skill descriptions to ensure they are trigger-condition focused,
 * not workflow summaries. Phase 1 is report-only (exit 0) because the existing
 * catalog already violates these rules. A FAIL grade would deadlock check-all
 * until all descriptions are rewritten (separate task).
 *
 * Deterministic rules:
 * (a) Trigger marker check: description must contain "Use when" (primary),
 *     "Invoke for", or "Use for" anywhere (case-insensitive, presence check).
 *     Core skills also require sibling-boundary text like "Use Q..." per
 *     CHECK(d) whitelist.
 * (b) Forbidden leading pattern: description starting with 3rd-person present
 *     action verbs (Creates, Generates, Analyzes, etc.) indicates workflow summary.
 * (c) Whitelist: sibling-boundary clauses ("Use Q...") required by CHECK(d) for
 *     core auto-routing skills (Qplan, Qgenerate-spec, Qgs, Qexecute).
 *
 * Based on principles from obra/superpowers (MIT) and steipete/agent-scripts (MIT),
 * adapted to QE conventions and Phase 1 report-only posture.
 *
 * Usage:
 *   node scripts/check-skill-sdo.mjs
 *
 * Exit code: Always 0 (Phase 1 WARN-only).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'skills');

/**
 * Parse the YAML front matter of a SKILL.md into a { name, description } pair.
 * Returns { name, description } where name/description are undefined when absent.
 * Manual line parsing — no YAML library.
 */
function parseFrontmatter(file) {
  const content = readFileSync(file, 'utf8').replace(/^﻿/, ''); // BOM strip
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') {
    return { name: undefined, description: undefined };
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) {
    return { name: undefined, description: undefined };
  }
  const fields = {};
  for (const l of lines.slice(1, end)) {
    const m = l.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m && !(m[1] in fields)) {
      let v = m[2].trim();
      // Normalize YAML scalars: `name: "Foo"` / `name: 'Foo'` == `name: Foo`.
      const quoted = v.match(/^(['"])([\s\S]*)\1$/);
      if (quoted) v = quoted[2];
      fields[m[1]] = v;
    }
  }
  return {
    name: fields.name,
    description: fields.description,
  };
}

/**
 * Normalize description for pattern matching:
 * - trim whitespace
 * - strip markdown formatting (backticks, bold/italic markers)
 * - collapse whitespace
 */
function normalizeDescription(desc) {
  if (!desc || typeof desc !== 'string') return '';
  return desc
    .trim()
    .replace(/^['"]|['"]$/g, '') // strip quotes
    .replace(/[`*_]/g, '') // strip markdown
    .replace(/\s+/g, ' '); // collapse whitespace
}

/**
 * List of 3rd-person present action verbs that indicate workflow summary.
 * These are forbidden as leading words in trigger descriptions.
 */
const FORBIDDEN_LEADING_VERBS = [
  'creates',
  'generates',
  'analyzes',
  'builds',
  'writes',
  'modifies',
  'updates',
  'executes',
  'performs',
  'handles',
  'manages',
  'processes',
  'transforms',
  'converts',
  'renders',
  'applies',
  'calculates',
  'computes',
  'runs',
  'produces',
  'exports',
  'formats',
  'diagnoses',
  'configures',
  'implements',
  'integrates',
  'optimizes',
  'orchestrates',
  'parses',
  'refines',
  'restores',
  'scans',
  'synchronizes',
  'validates',
];

// Word-boundary regexes: "reuse formatting" must NOT satisfy the "use for" marker.
const TRIGGER_MARKER_RES = [/\buse when\b/i, /\binvoke for\b/i, /\buse for\b/i];
const CORE_AUTO_SKILLS = ['qplan', 'qgenerate-spec', 'qgs', 'qexecute'];

/**
 * Check if description starts with a forbidden action verb.
 * @param {string} normalized - Normalized description
 * @returns {string|null} - Verb if found, null otherwise
 */
function checkForbiddenVerb(normalized) {
  const firstWords = normalized.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
  for (const verb of FORBIDDEN_LEADING_VERBS) {
    if (firstWords.toLowerCase().startsWith(verb)) {
      return verb;
    }
  }
  return null;
}

/**
 * Check if description has a valid trigger marker anywhere in its text
 * (word-boundary presence check, case-insensitive — not start-anchored).
 * @param {string} normalized - Normalized description
 * @returns {boolean}
 */
function hasTriggerMarker(normalized) {
  return TRIGGER_MARKER_RES.some((re) => re.test(normalized));
}

/**
 * Check if description contains sibling-boundary text ("Use Q...").
 * @param {string} normalized - Normalized description
 * @returns {boolean}
 */
function hasSiblingBoundary(normalized) {
  return /\buse\s+q[a-z-]+/i.test(normalized);
}

const violations = [];

// Enumerate direct child directories of skills/
let entries;
try {
  entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
} catch (err) {
  console.error(`check-skill-sdo: cannot read skills dir "${SKILLS_DIR}": ${err.message}`);
  process.exit(1);
}

const dirs = entries
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const dir of dirs) {
  const file = join(SKILLS_DIR, dir, 'SKILL.md');
  if (!existsSync(file) || !statSync(file).isFile()) {
    continue; // skip if no SKILL.md (frontmatter guard will catch this)
  }

  const { name, description } = parseFrontmatter(file);
  if (!description || description === '') {
    continue; // skip if no description (frontmatter guard will catch this)
  }

  const normalized = normalizeDescription(description);
  const violations_here = [];

  // Rule (a): Check for trigger marker
  if (!hasTriggerMarker(normalized)) {
    violations_here.push(
      `missing trigger marker (expected: "Use when", "Invoke for", or "Use for")`
    );
  }

  // Rule (b): Check for forbidden leading verb
  const forbiddenVerb = checkForbiddenVerb(normalized);
  if (forbiddenVerb) {
    violations_here.push(
      `description starts with action verb "${forbiddenVerb}" (suggests workflow summary, not trigger condition)`
    );
  }

  // Rule (c): For core auto-routing skills, check sibling boundary
  if (CORE_AUTO_SKILLS.includes(dir.toLowerCase())) {
    if (!hasSiblingBoundary(normalized)) {
      violations_here.push(
        `core auto-routing skill missing sibling-boundary text (expected "Use Q..." reference)`
      );
    }
  }

  if (violations_here.length > 0) {
    violations.push({
      skill: dir,
      description: description.substring(0, 80),
      reasons: violations_here,
    });
  }
}

// Output report
if (violations.length > 0) {
  for (const v of violations) {
    console.warn(`  ! ${v.skill}: ${v.reasons.join('; ')}`);
    console.warn(`    (description: "${v.description}${v.description.length > 80 ? '...' : ''}"`);
  }
  console.log(`\ncheck-skill-sdo: WARN (${violations.length} violations)`);
} else {
  console.log(`check-skill-sdo: PASS (0 violations)`);
}

// Phase 1: ALWAYS exit 0 (WARN-only, not FAIL)
process.exit(0);
