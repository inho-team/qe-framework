#!/usr/bin/env node
/**
 * check-skill-tiers.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Progressive-disclosure contract (trust-hardening Phase 5):
 *   - the declared core skills exist and carry `tier: core` in their frontmatter,
 *   - every `tier:` value present anywhere is one of core|extended|experimental.
 * Skills with no tier default to "extended" — that is intentional, not an error.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const CORE = ['Qinit', 'Qcontext', 'Qplan', 'Qgs', 'Qexecute', 'Qsivs-config'];
const VALID = new Set(['core', 'extended', 'experimental']);

/** Read the `tier:` value from a SKILL.md YAML frontmatter, or undefined. */
function frontmatterTier(file) {
  const lines = readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n');
  if (lines[0].trim() !== '---') return undefined;
  const end = lines.indexOf('---', 1);
  if (end < 0) return undefined;
  for (const l of lines.slice(1, end)) {
    const m = l.match(/^tier:\s*(\S+)/);
    if (m) return m[1];
  }
  return undefined;
}

const failures = [];

// 1. Declared core skills exist and are tagged tier: core.
for (const s of CORE) {
  const f = join(SKILLS, s, 'SKILL.md');
  if (!existsSync(f)) { failures.push(`core skill missing: ${s}/SKILL.md`); continue; }
  const t = frontmatterTier(f);
  if (t !== 'core') failures.push(`${s}: tier="${t ?? '(none)'}", expected "core"`);
}

// 2. Any tier value present must be valid.
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'SKILL.md') {
      const t = frontmatterTier(p);
      if (t !== undefined && !VALID.has(t)) failures.push(`${p}: invalid tier "${t}" (use core|extended|experimental)`);
    }
  }
})(SKILLS);

if (failures.length) {
  console.error('check-skill-tiers: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check-skill-tiers: PASS (${CORE.length} core skills tagged, all tier values valid)`);
