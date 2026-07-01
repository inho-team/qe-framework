#!/usr/bin/env node
/**
 * run_mtest_skill.mjs — batch runner for the admin skill-test workflow.
 *
 * Usage:
 *   node scripts/run_mtest_skill.mjs --batch '<glob>' [--out <file>]
 *
 * The `<glob>` is a repo-relative pattern that resolves to directories
 * containing `SKILL.md`. Example: `skills/Q*` matches every Q-prefixed skill
 * directory; the runner walks each one for its SKILL.md.
 *
 * For every SKILL.md it
 *   1. consults `hooks/scripts/lib/mtest-cache.mjs` for a cached verdict keyed
 *      by the content hash of the SKILL.md;
 *   2. on miss, runs a deterministic stand-in for the qe-admin-mcp
 *      skill-test workflow
 *      (virtual-prompt generation + routing simulation) that mirrors the
 *      algorithm owned by `qe-admin-mcp` — the actual LLM call is the admin workflow's
 *      responsibility, so this runner's "verdict" is the
 *      static replay of that matcher applied to each skill's own triggers;
 *   3. saves the fresh verdict back into the cache;
 *   4. emits a markdown table to stdout and (optionally) to `--out <file>`.
 *
 * Only Node built-ins are used (`node:fs`, `node:path`, `node:url`).
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getCachedVerdict,
  saveVerdict,
  computeSkillHash
} from '../hooks/scripts/lib/mtest-cache.mjs';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * Parse argv into a normalised options object. Supports `--batch <glob>`,
 * `--out <file>`, and single-skill legacy invocation (no flag).
 * @param {string[]} argv
 * @returns {{mode: 'batch'|'single', pattern: string|null, outFile: string|null, singleSkill: string|null}}
 */
function parseArgs(argv) {
  let mode = 'single';
  let pattern = null;
  let outFile = null;
  let singleSkill = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--batch') {
      mode = 'batch';
      pattern = argv[++i] ?? null;
    } else if (arg === '--out') {
      outFile = argv[++i] ?? null;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      singleSkill = arg;
    }
  }
  return { mode, pattern, outFile, singleSkill };
}

/**
 * Emit usage text to stdout. Kept free of ANSI colour so it remains readable
 * when captured into logs or piped through `--out`.
 * @returns {void}
 */
function printHelp() {
  process.stdout.write(
    [
      'run_mtest_skill.mjs — batch runner for qe-admin-mcp skill-test workflow',
      '',
      'Usage:',
      "  node scripts/run_mtest_skill.mjs --batch '<glob>' [--out <file>]",
      '  node scripts/run_mtest_skill.mjs <skill-name>         # single skill',
      '',
      'Options:',
      "  --batch <glob>   Resolve <glob> relative to repo root, collect every",
      '                   SKILL.md under each match, run the workflow, cache',
      '                   results, and emit a markdown table.',
      '  --out <file>     Mirror the markdown output to <file>.',
      '  --help, -h       Show this message.',
      ''
    ].join('\n')
  );
}

// ---------------------------------------------------------------------------
// Glob expansion — intentionally minimal, built-ins only.
// ---------------------------------------------------------------------------

/**
 * Expand a repo-relative glob into matching directory paths.
 * Supports `*` (any chars except `/`) in the final segment only — sufficient
 * for `skills/Q*` style audit patterns and avoids pulling in a
 * heavyweight matcher.
 *
 * Path-traversal defence: segments of `..`, absolute paths, and NUL bytes are
 * rejected so the caller cannot escape `baseDir`.
 * @param {string} pattern
 * @param {string} baseDir
 * @returns {string[]} absolute directory paths
 */
function expandGlob(pattern, baseDir) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('glob pattern is required');
  }
  if (pattern.includes('\0')) {
    throw new Error('glob pattern must not contain NUL bytes');
  }
  if (path.isAbsolute(pattern)) {
    throw new Error('glob pattern must be repo-relative');
  }

  const segments = pattern.split('/').filter(Boolean);
  if (segments.some(seg => seg === '..')) {
    throw new Error('glob pattern must not contain ".." segments');
  }

  const results = [];
  walk([baseDir], segments, 0, results);

  return results.filter(p => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Recursive helper for {@link expandGlob}. Expands one path segment at a time,
 * honouring literal segments exactly and `*` as a per-segment wildcard.
 * @param {string[]} currentPaths - candidate paths after the previous segment.
 * @param {string[]} segments - full list of glob segments.
 * @param {number} depth - current segment index.
 * @param {string[]} out - accumulator for matched leaf paths.
 */
function walk(currentPaths, segments, depth, out) {
  if (depth >= segments.length) {
    out.push(...currentPaths);
    return;
  }
  const segment = segments[depth];
  const next = [];

  for (const base of currentPaths) {
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }

    if (segment.includes('*')) {
      const re = globSegmentToRegex(segment);
      for (const entry of entries) {
        if (re.test(entry.name)) next.push(path.join(base, entry.name));
      }
    } else {
      for (const entry of entries) {
        if (entry.name === segment) next.push(path.join(base, entry.name));
      }
    }
  }
  walk(next, segments, depth + 1, out);
}

/**
 * Compile a single glob segment (e.g. `Q*`) into an anchored RegExp that only
 * matches within that segment.
 * @param {string} segment
 * @returns {RegExp}
 */
function globSegmentToRegex(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

// ---------------------------------------------------------------------------
// Skill discovery — one SKILL.md per matched directory (recursive).
// ---------------------------------------------------------------------------

/**
 * Find every SKILL.md file reachable from `root`, depth-first, sorted.
 * @param {string} root
 * @returns {string[]} absolute paths to SKILL.md files.
 */
function collectSkillFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
    }
  }
  out.sort();
  return out;
}

// ---------------------------------------------------------------------------
// Workflow replay — static stand-in for the LLM-driven routing sim.
// ---------------------------------------------------------------------------

/**
 * Parse YAML-ish frontmatter from a SKILL.md into a flat object. Only the
 * fields used by the routing sim (`name`, `triggers`, `keywords`, `description`)
 * need to be retrievable.
 * @param {string} text
 * @returns {Record<string,string>}
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

/**
 * Generate three virtual prompts (normal / boundary / unregistered) for a
 * skill, using its declared triggers where available.
 * @param {Record<string,string>} fm — frontmatter.
 * @returns {string[]}
 */
function generateVirtualPrompts(fm) {
  const triggers = (fm.triggers ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const keywords = (fm.keywords ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const pool = [...triggers, ...keywords];
  if (pool.length === 0) pool.push(fm.name ?? 'run skill');

  const normal = pool[0];
  const boundary = pool[Math.min(1, pool.length - 1)];
  const unregistered = `quickly ${pool[0]} please`;
  return [normal, boundary, unregistered];
}

/**
 * Score how strongly a prompt matches a skill's own declared triggers. Mirrors
 * the keyword-weighted matcher from SKILL.md `simulateRouting`, scoped to the
 * single skill under test.
 * @param {string} prompt
 * @param {Record<string,string>} fm
 * @returns {number}
 */
function scorePromptAgainstSkill(prompt, fm) {
  const msgLower = prompt.toLowerCase();
  const msgWords = msgLower.split(/\s+/);
  const triggers = (fm.triggers ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const keywords = (fm.keywords ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  let matched = 0;
  let weight = 0;
  for (const term of [...triggers, ...keywords]) {
    const termWords = term.split(/\s+/);
    const exact = termWords.some(tw => msgWords.includes(tw));
    const substring = msgLower.includes(term);
    if (exact) { matched++; weight += term.length * 2; }
    else if (substring) { matched++; weight += term.length; }
  }
  return matched > 0 ? matched * 3 + weight : 0;
}

/**
 * Classify a score into one of the verdicts documented by the admin skill-test workflow.
 * Thresholds mirror the skill doc: `>= 2*threshold` PASS, `>= threshold` WEAK,
 * below that UNREACHABLE. MISROUTE/CONFLICT require cross-skill context that
 * the batch runner does not replay — full LLM mode surfaces those.
 * @param {number} score
 * @returns {string}
 */
function classify(score) {
  const threshold = 6;
  if (score >= threshold * 2) return 'PASS';
  if (score >= threshold) return 'WEAK';
  return 'UNREACHABLE';
}

/**
 * Replay the deterministic core of the admin skill-test workflow against a single
 * SKILL.md, producing a verdict object ready for the cache.
 * @param {string} skillFileAbs — absolute path to the SKILL.md being tested.
 * @returns {{verdict: string, accuracy: number}}
 */
function replayWorkflow(skillFileAbs) {
  const text = readFileSync(skillFileAbs, 'utf8');
  const fm = parseFrontmatter(text);
  const prompts = generateVirtualPrompts(fm);

  let passes = 0;
  const verdicts = [];
  for (const p of prompts) {
    const score = scorePromptAgainstSkill(p, fm);
    const v = classify(score);
    verdicts.push(v);
    if (v === 'PASS') passes++;
  }
  const accuracy = prompts.length === 0 ? 0 : passes / prompts.length;

  // Aggregate: any UNREACHABLE lowers to UNREACHABLE; all-PASS stays PASS;
  // any WEAK among passes → WEAK overall.
  let overall;
  if (verdicts.every(v => v === 'PASS')) overall = 'PASS';
  else if (verdicts.some(v => v === 'UNREACHABLE')) overall = 'UNREACHABLE';
  else overall = 'WEAK';

  return { verdict: overall, accuracy: Number(accuracy.toFixed(3)) };
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

/**
 * Format a list of row objects as a markdown table matching the shape
 * documented in SKILL.md batch mode.
 * @param {Array<{skill: string, hash: string, verdict: string, accuracy: number, cache: string, timestamp: string}>} rows
 * @returns {string}
 */
function renderMarkdownTable(rows) {
  const header = '| Skill | Hash | Verdict | Accuracy | Cache | Timestamp |';
  const sep = '|-------|------|---------|----------|-------|-----------|';
  const body = rows.map(r =>
    `| ${r.skill} | ${r.hash.slice(0, 15)} | ${r.verdict} | ${r.accuracy} | ${r.cache} | ${r.timestamp} |`
  );
  return [header, sep, ...body].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Batch-mode driver. Expands the glob, iterates each SKILL.md, consults the
 * cache, runs the replay on miss, saves, and renders the results table.
 * @param {string} pattern
 * @param {string} baseDir
 * @returns {string} markdown table
 */
function runBatch(pattern, baseDir) {
  const matchedDirs = expandGlob(pattern, baseDir);
  const skillFiles = new Set();
  for (const dir of matchedDirs) {
    for (const f of collectSkillFiles(dir)) skillFiles.add(f);
  }

  const rows = [];
  for (const abs of [...skillFiles].sort()) {
    const rel = path.relative(baseDir, abs);
    let cached = null;
    let cacheLabel = 'MISS';
    try {
      cached = getCachedVerdict(rel, baseDir);
    } catch {
      cached = null;
    }

    let verdict;
    let hash;
    let timestamp;
    if (cached) {
      verdict = { verdict: cached.verdict, accuracy: cached.accuracy };
      hash = cached.content_hash;
      timestamp = cached.timestamp;
      cacheLabel = 'HIT';
    } else {
      verdict = replayWorkflow(abs);
      hash = computeSkillHash(rel, baseDir);
      const saved = saveVerdict(rel, verdict, baseDir);
      const fresh = getCachedVerdict(rel, baseDir);
      timestamp = fresh?.timestamp ?? new Date().toISOString();
      hash = saved.content_hash;
    }

    rows.push({
      skill: rel,
      hash,
      verdict: verdict.verdict,
      accuracy: verdict.accuracy,
      cache: cacheLabel,
      timestamp
    });
  }

  return renderMarkdownTable(rows);
}

// Run only when invoked directly (not when imported by tests).
const isDirectInvocation = import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');

if (isDirectInvocation) {
  const { mode, pattern, outFile, singleSkill } = parseArgs(process.argv.slice(2));
  const baseDir = process.cwd();

  if (mode === 'batch') {
    if (!pattern) {
      process.stderr.write('error: --batch requires a glob pattern\n');
      process.exit(2);
    }
    const table = runBatch(pattern, baseDir);
    process.stdout.write(table);
    if (outFile) {
      mkdirSync(path.dirname(path.resolve(baseDir, outFile)), { recursive: true });
      writeFileSync(path.resolve(baseDir, outFile), table, 'utf8');
    }
  } else {
    // Single-skill mode: delegate to batch pipeline with a single path but
    // bypass cache (per SKILL.md: interactive audits always re-evaluate).
    if (!singleSkill) {
      printHelp();
      process.exit(0);
    }
    const candidate = path.join('skills', singleSkill, 'SKILL.md');
    const abs = path.resolve(baseDir, candidate);
    if (!existsSync(abs)) {
      process.stderr.write(`error: ${candidate} not found\n`);
      process.exit(2);
    }
    const verdict = replayWorkflow(abs);
    const hash = computeSkillHash(candidate, baseDir);
    const row = {
      skill: candidate,
      hash,
      verdict: verdict.verdict,
      accuracy: verdict.accuracy,
      cache: 'BYPASS',
      timestamp: new Date().toISOString()
    };
    process.stdout.write(renderMarkdownTable([row]));
  }
}

export { runBatch, replayWorkflow, expandGlob, collectSkillFiles };
