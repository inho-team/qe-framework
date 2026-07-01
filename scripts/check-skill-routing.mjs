#!/usr/bin/env node
/**
 * check-skill-routing.mjs
 * Validates skill frontmatter, bidirectional routing integrity, and description collisions.
 * Exit 0 = clean or WARN only. Exit 1 = any FAIL.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SKILLS_DIR = join(ROOT, 'skills');
const AGENTS_DIR = join(ROOT, 'agents');
const INTENT_GATE = join(ROOT, 'core', 'INTENT_GATE.md');

// ─── helpers ────────────────────────────────────────────────────────────────

function collectSkillEntries(dir = SKILLS_DIR, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skillPath = join(fullPath, 'SKILL.md');
      if (existsSync(skillPath)) {
        const content = readFileSync(skillPath, 'utf8');
        const fm = parseFrontmatter(content);
        out.push({ dir: entry.name, path: skillPath, content, fm });
      } else {
        collectSkillEntries(fullPath, out);
      }
    }
  }
  return out;
}

/**
 * Parses YAML frontmatter from a Markdown file's content.
 * Supports the `---\n...\n---` block at the start of the file.
 * @param {string} content - Raw file content.
 * @returns {Record<string, string>|null} Key-value pairs from frontmatter, or null if none found.
 */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  return fm;
}

/**
 * Tokenizes a description string into lowercase words, removing stopwords and short tokens.
 * @param {string} str - Input description string.
 * @returns {string[]} Array of meaningful tokens for similarity comparison.
 */
function tokenize(str) {
  const STOPWORDS = new Set([
    'a','an','the','and','or','of','to','in','for','on','with','at','by',
    'from','as','is','it','its','this','that','be','are','was','were',
    'when','use','used','using','you','your','i','me','we','our',
  ]);
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Computes the Jaccard similarity coefficient between two token arrays.
 * @param {string[]} tokensA - Token set A.
 * @param {string[]} tokensB - Token set B.
 * @returns {number} Similarity score in [0, 1]; 0 if both arrays are empty.
 */
function jaccard(tokensA, tokensB) {
  if (tokensA.length === 0 && tokensB.length === 0) return 0;
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── 1. Collect all skills ───────────────────────────────────────────────────

const skillEntries = []; // { name, path, fm, description }
const skillNames = new Set();

for (const entry of collectSkillEntries()) {
  skillEntries.push(entry);
  skillNames.add(entry.dir);
}

// ─── 2. Parse INTENT_GATE routing targets ───────────────────────────────────

if (!existsSync(INTENT_GATE)) {
  console.error(`ERROR: INTENT_GATE not found at ${INTENT_GATE}`);
  console.error('Cannot perform routing integrity checks without INTENT_GATE.md.');
  process.exit(1);
}

const intentGateContent = readFileSync(INTENT_GATE, 'utf8');

// Extract routing targets from table rows: | Intent | Keywords | Target |
const routingTargets = new Set();
const tableRowRe = /^\|[^|]+\|[^|]+\|([^|]+)\|/gm;
let rowMatch;
while ((rowMatch = tableRowRe.exec(intentGateContent)) !== null) {
  const cell = rowMatch[1].trim();
  // skip header rows
  if (cell === 'Routing Target' || cell.startsWith('---') || cell.startsWith('Refer to')) continue;
  // handle historical multi-target syntax
  const parts = cell.split('/').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    // strip markdown bold/italic/backtick
    let clean = part.replace(/`/g, '').trim();
    // remove trailing parenthetical annotation BEFORE stripping * so "Qgrad-* (matching skill)" → "Qgrad-*"
    clean = clean.replace(/\s+\(.*\)$/, '').trim();
    // strip bold markers but preserve * used as glob (only strip ** or leading/trailing * that aren't glob)
    // A glob * appears at end after alphanumeric/dash: keep it. Strip ** bold markers.
    clean = clean.replace(/\*\*/g, '').trim();
    if (clean && /^[A-Za-z]/.test(clean)) routingTargets.add(clean);
  }
}

// ─── 3. Check agent file existence ──────────────────────────────────────────

function agentExists(name) {
  return existsSync(join(AGENTS_DIR, `${name}.md`));
}

/**
 * Returns true if a skill directory with the given name exists under skills/.
 * @param {string} name - Skill directory name (e.g. "Qcommit").
 * @returns {boolean}
 */
function skillExists(name) {
  return skillNames.has(name);
}

/**
 * Resolves an INTENT_GATE routing target to a real skill or agent.
 * Supports exact names, wildcard globs (e.g. "Qgrad-*"), and agent file lookup.
 * @param {string} target - Routing target string from INTENT_GATE.
 * @returns {boolean} True if the target resolves to at least one existing skill or agent.
 */
function resolveTarget(target) {
  // wildcard glob: e.g. "Qgrad-*"
  if (target.includes('*')) {
    const prefix = target.replace('*', '');
    for (const s of skillNames) {
      if (s.startsWith(prefix)) return true;
    }
    // also check agents
    try {
      for (const f of readdirSync(AGENTS_DIR)) {
        if (f.replace(/\.md$/, '').startsWith(prefix)) return true;
      }
    } catch { /* ignore */ }
    return false;
  }
  return skillExists(target) || agentExists(target);
}

// ─── 4. Build set of skills registered in INTENT_GATE ───────────────────────

const intentGateSkills = new Set();
for (const target of routingTargets) {
  if (target.includes('*')) {
    const prefix = target.replace('*', '');
    for (const s of skillNames) {
      if (s.startsWith(prefix)) intentGateSkills.add(s);
    }
  } else {
    intentGateSkills.add(target);
  }
}

// ─── Run checks ─────────────────────────────────────────────────────────────

const fails = [];
const warns = [];

// (a) Frontmatter validation
console.log('\n=== CHECK (a): Frontmatter validation ===');
for (const entry of skillEntries) {
  const { dir, fm } = entry;
  if (!fm) {
    fails.push(`FAIL [frontmatter] ${dir}: no YAML frontmatter found`);
    continue;
  }
  if (!fm.name || fm.name.trim() === '') {
    fails.push(`FAIL [frontmatter] ${dir}: missing or empty 'name' field`);
  }
  if (!fm.description || fm.description.trim() === '') {
    fails.push(`FAIL [frontmatter] ${dir}: missing or empty 'description' field`);
  }
}

const frontmatterFails = fails.length;
if (frontmatterFails === 0) {
  console.log(`  OK: all ${skillEntries.length} skills have valid frontmatter`);
} else {
  for (const f of fails) console.log(' ', f);
}

// (b-i) Dangling routes: INTENT_GATE targets that don't resolve
console.log('\n=== CHECK (b-i): Dangling routes in INTENT_GATE ===');
const danglingCount = fails.length;
for (const target of routingTargets) {
  if (!resolveTarget(target)) {
    fails.push(`FAIL [dangling-route] INTENT_GATE target '${target}' → no matching skill or agent found`);
  }
}
if (fails.length === danglingCount) {
  console.log(`  OK: all ${routingTargets.size} routing targets resolve to real skills/agents`);
} else {
  for (const f of fails.slice(danglingCount)) console.log(' ', f);
}

// (b-ii) True orphans: skills with no description AND not in INTENT_GATE
console.log('\n=== CHECK (b-ii): True orphan skills (no entry point) ===');
const orphanCount = fails.length;
for (const entry of skillEntries) {
  const { dir, fm } = entry;
  if (!fm) continue; // already failed in (a)
  const hasDescription = fm.description && fm.description.trim() !== '';
  const inGate = intentGateSkills.has(dir);
  if (!hasDescription && !inGate) {
    fails.push(`FAIL [orphan] ${dir}: no description trigger AND not registered in INTENT_GATE`);
  }
}
if (fails.length === orphanCount) {
  console.log(`  OK: no true orphans found (all skills have description or INTENT_GATE entry)`);
} else {
  for (const f of fails.slice(orphanCount)) console.log(' ', f);
}

// (c) Description collision — WARN only (Jaccard >= 0.6 on stopword-filtered tokens)
console.log('\n=== CHECK (c): Description token collision (WARN, threshold Jaccard >= 0.6) ===');
const JACCARD_THRESHOLD = 0.6;

const skillTokens = skillEntries
  .filter(e => e.fm && e.fm.description)
  .map(e => ({ dir: e.dir, tokens: tokenize(e.fm.description) }));

const collisionPairs = new Set();
for (let i = 0; i < skillTokens.length; i++) {
  for (let j = i + 1; j < skillTokens.length; j++) {
    const a = skillTokens[i];
    const b = skillTokens[j];
    if (a.tokens.length === 0 || b.tokens.length === 0) continue;
    const score = jaccard(a.tokens, b.tokens);
    if (score >= JACCARD_THRESHOLD) {
      const key = `${a.dir}|${b.dir}`;
      if (!collisionPairs.has(key)) {
        collisionPairs.add(key);
        warns.push(`WARN [collision] '${a.dir}' and '${b.dir}' have similar descriptions (Jaccard=${score.toFixed(2)})`);
      }
    }
  }
}

if (warns.length === 0) {
  console.log(`  OK: no description collisions above threshold`);
} else {
  for (const w of warns) console.log(' ', w);
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n=== SUMMARY ===');
console.log(`Skills scanned:   ${skillEntries.length}`);
console.log(`Routing targets:  ${routingTargets.size}`);
console.log(`FAILs:            ${fails.length}`);
console.log(`WARNs:            ${warns.length}`);

if (fails.length > 0) {
  console.log('\nFAIL details:');
  for (const f of fails) console.log(' ', f);
  process.exit(1);
} else if (warns.length > 0) {
  console.log('\nWARN details:');
  for (const w of warns) console.log(' ', w);
  console.log('\nResult: PASS (with warnings)');
  process.exit(0);
} else {
  console.log('\nResult: PASS (clean)');
  process.exit(0);
}
