#!/usr/bin/env node
/**
 * check-invocation-trigger.mjs  (guard — auto-discovered by check-all.mjs)
 *
 * Trigger-drift regression guard (audit-harvest R7).
 *
 * The critical skill/hook audit found a copy-paste template `invocation_trigger`
 * ("When framework initialization, maintenance, or audit is required.") left on
 * dozens of skills whose real trigger was entirely different. Those skills have
 * since been fixed or relocated; this guard keeps the template string from
 * silently reappearing on a live skill.
 *
 * NFR4 (no false signals): `Qinit` legitimately uses this phrasing — its purpose
 * *is* framework initialization, and Phase 1 of the audit judged it PASS. It is
 * carried on an explicit baseline allowlist, not a blanket exception. Add a skill
 * to BASELINE only with a documented reason.
 *
 * Env override: QE_SKILLS_DIR points the scan at a fixture dir (red-green test);
 * defaults to the repo `skills/` directory.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = process.env.QE_SKILLS_DIR || join(ROOT, 'skills');

// Forbidden copy-paste template. Compared case-insensitively, trailing-period-agnostic.
const FORBIDDEN = 'when framework initialization, maintenance, or audit is required';

// Baseline allowlist: skills for which this phrasing is genuinely correct.
// Qinit — its purpose is framework initialization (audit Phase 1: PASS).
const BASELINE = new Set(['Qinit']);

/** Recursively collect every SKILL.md path under a directory. */
function findSkillFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...findSkillFiles(p));
    else if (entry === 'SKILL.md') out.push(p);
  }
  return out;
}

/** Read the `invocation_trigger:` value from a SKILL.md frontmatter, or ''. */
function frontmatterTrigger(text) {
  const lines = text.replace(/^﻿/, '').split('\n');
  if (lines[0].trim() !== '---') return '';
  const end = lines.indexOf('---', 1);
  if (end < 0) return '';
  for (const l of lines.slice(1, end)) {
    const m = l.match(/^invocation_trigger:\s*(.+)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

/** Skill name = the SKILL.md's parent directory basename. */
function skillName(file) {
  return file.split('/').slice(-2, -1)[0];
}

if (!existsSync(SKILLS_DIR)) {
  console.log(`check-invocation-trigger: no skills dir at ${SKILLS_DIR} — nothing to check.`);
  process.exit(0);
}

const failures = [];
const files = findSkillFiles(SKILLS_DIR);

for (const f of files) {
  const trigger = frontmatterTrigger(readFileSync(f, 'utf8'));
  const norm = trigger.toLowerCase().replace(/\.\s*$/, '');
  if (norm === FORBIDDEN) {
    const name = skillName(f);
    if (BASELINE.has(name)) continue; // legitimate use — allowlisted
    failures.push(`${name}: invocation_trigger is the forbidden copy-paste template (trigger-drift). Set a trigger that matches the skill's real activation condition.`);
  }
}

if (failures.length > 0) {
  console.error(`check-invocation-trigger: FAIL (${failures.length})`);
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log(`check-invocation-trigger: PASS (${files.length} skills scanned, baseline allowlist: ${[...BASELINE].join(', ')})`);
process.exit(0);
