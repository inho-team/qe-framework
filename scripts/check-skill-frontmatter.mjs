#!/usr/bin/env node
/**
 * check-skill-frontmatter.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Clean-room reimplementation of the idea behind agent-scripts'
 * `scripts/validate-skills` (pinned SHA d6ed98c7, MIT — no code copied,
 * so no MIT notice is required here).
 *
 * Contract: every skills/<Name>/SKILL.md must
 *   - have a YAML front matter block delimited by `---`,
 *   - declare non-empty `name` and `description` string fields,
 *   - carry a `name` that matches its skill directory name,
 *   - and no two skills may declare the same `name`.
 *
 * Only direct child directories of skills/ are scanned, so plain files such
 * as skills/CATALOG.md are ignored. Parsing follows the existing guard
 * convention (check-skill-tiers.mjs): manual line parsing with node:fs/node:path
 * only, no external YAML dependency.
 *
 * Usage:
 *   node scripts/check-skill-frontmatter.mjs [skillsDir] [--warn-only]
 *   - skillsDir: optional override (default: ../skills). Also honours
 *     env QE_FRONTMATTER_SKILLS_DIR. Used for fixture testing.
 *   - --warn-only: print violations but exit 0 (soft-launch mitigation for
 *     false positives blocking otherwise-valid skills).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const warnOnly = argv.includes('--warn-only');
const positional = argv.filter((a) => !a.startsWith('--'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS =
  positional[0] ||
  process.env.QE_FRONTMATTER_SKILLS_DIR ||
  join(ROOT, 'skills');

/**
 * Parse the YAML front matter of a SKILL.md into a { name, description } pair.
 * Returns { hasFrontmatter, name, description } where name/description are
 * undefined when absent. Manual line parsing — no YAML library.
 */
function parseFrontmatter(file) {
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n');
  if (lines[0].trim() !== '---') {
    return { hasFrontmatter: false };
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) {
    return { hasFrontmatter: false };
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
    hasFrontmatter: true,
    name: fields.name,
    description: fields.description,
  };
}

const failures = [];
const namesSeen = new Map(); // declared name -> [dir, ...]

let entries;
try {
  entries = readdirSync(SKILLS, { withFileTypes: true });
} catch (err) {
  console.error(`check-skill-frontmatter: cannot read skills dir "${SKILLS}": ${err.message}`);
  process.exit(1);
}

const dirs = entries
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const dir of dirs) {
  const file = join(SKILLS, dir, 'SKILL.md');
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.push(`${dir}: missing SKILL.md`);
    continue;
  }

  const { hasFrontmatter, name, description } = parseFrontmatter(file);
  if (!hasFrontmatter) {
    failures.push(`${dir}: missing YAML front matter (no --- block)`);
    continue;
  }

  if (name === undefined || name === '') {
    failures.push(`${dir}: empty or missing 'name' field`);
  } else {
    if (name !== dir) {
      failures.push(`${dir}: name "${name}" does not match directory "${dir}"`);
    }
    if (!namesSeen.has(name)) namesSeen.set(name, []);
    namesSeen.get(name).push(dir);
  }

  if (description === undefined || description === '') {
    failures.push(`${dir}: empty or missing 'description' field`);
  }
}

// Duplicate skill names across directories.
for (const [name, owners] of namesSeen) {
  if (owners.length > 1) {
    failures.push(`duplicate skill name "${name}" declared by: ${owners.join(', ')}`);
  }
}

if (failures.length) {
  if (warnOnly) {
    console.warn('check-skill-frontmatter: WARN (--warn-only, not failing build)');
    for (const f of failures) console.warn(`  ! ${f}`);
    process.exit(0);
  }
  console.error('check-skill-frontmatter: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`check-skill-frontmatter: PASS (${dirs.length} skills, name/description valid, no duplicates)`);
