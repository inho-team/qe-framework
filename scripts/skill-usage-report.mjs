#!/usr/bin/env node
/**
 * skill-usage-report.mjs — ADR-025 qe-diet Phase 2, Part B.
 *
 * Produces a Phase-3 CANDIDATE signal report: which skills show no usage signal
 * (never-used) and the forward per-skill invocation frequency. Zero-dependency
 * ESM, Node built-ins only.
 *
 * IMPORTANT — capture limitation: usage is observed ONLY where pre-tool-use.mjs
 * intercepts a `toolName === 'Skill'` call. Skills invoked via slash-command
 * expansion, sub-agents, or other runtime paths may NOT be captured, so a truly
 * used skill can appear "never-used". The report is a human-reviewed candidate
 * input, NEVER an automatic deletion/demotion signal.
 *
 * Determinism: output is byte-identical on re-run for identical inputs — no
 * timestamps, no Date.now, explicit sort orders.
 *
 * Pure functions are exported for the guard (scripts/check-skill-usage-report.mjs).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Known aliases → canonical skill name. A USED alias marks its canonical target
// used; the non-canonical alias name itself is never counted as a distinct skill.
// Sourced from skills/CATALOG.md and QE_CONVENTIONS.md (Qgs/Qrt pass-throughs).
export const ALIAS_MAP = {
  Qgs: 'Qgenerate-spec',
  Qrt: 'Qexecute',
};

/**
 * Normalize a raw observed skill name: strip the `qe-framework:` plugin prefix,
 * trim, then resolve a known alias to its canonical target. Returns '' for
 * empty/degenerate input (callers drop empties).
 */
export function normalizeSkillName(raw) {
  if (typeof raw !== 'string') return '';
  let name = raw.trim();
  if (name.startsWith('qe-framework:')) name = name.slice('qe-framework:'.length).trim();
  if (!name) return '';
  return ALIAS_MAP[name] || name;
}

/**
 * Enumerate the canonical skill set: every SKILL.md strictly under `skillsDir`,
 * at any depth. Canonical name = the SKILL.md PARENT directory basename. Symlinks
 * are NOT followed (prevents cycles and out-of-tree smuggling). Deduplicated by
 * name and returned sorted ascending.
 */
export function enumerateCanonicalSkills(skillsDir) {
  const names = new Set();
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;            // never follow symlinks
      if (e.isDirectory()) { walk(join(dir, e.name)); continue; }
      if (e.isFile() && e.name === 'SKILL.md') {
        const base = dir.split('/').pop();
        if (base) names.add(base);
      }
    }
  };
  walk(skillsDir);
  return [...names].sort();
}

/**
 * Read the binary used-set and the forward counter from unified-state.json.
 * Missing / corrupt / partial state → empty set + empty map (never throws).
 */
export function loadUsageState(statePath) {
  try {
    if (!existsSync(statePath)) return { skillsUsed: [], counts: {} };
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    const stats = (parsed && typeof parsed === 'object' && parsed.session_stats) || {};
    const skillsUsed = Array.isArray(stats.skills_used) ? stats.skills_used : [];
    const counts = (stats.skill_usage_counts && typeof stats.skill_usage_counts === 'object')
      ? stats.skill_usage_counts : {};
    return { skillsUsed, counts };
  } catch {
    return { skillsUsed: [], counts: {} };
  }
}

/** Coerce a counter value to a safe non-negative integer (corrupt → 0). */
function safeCount(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * Compute the report model from the canonical set + raw usage signals.
 * All normalization happens here (read-time), on both inputs.
 */
export function computeReport(canonical, skillsUsed, counts) {
  const canonicalSet = new Set(canonical);

  // distinct normalized used names that are real canonical skills
  const usedInCanonical = new Set();
  for (const raw of skillsUsed) {
    const n = normalizeSkillName(raw);
    if (n && canonicalSet.has(n)) usedInCanonical.add(n);
  }

  // forward frequency: sum coerced counts by normalized key
  const freq = new Map();
  for (const [rawKey, rawVal] of Object.entries(counts)) {
    const n = normalizeSkillName(rawKey);
    if (!n) continue;
    freq.set(n, (freq.get(n) || 0) + safeCount(rawVal));
  }
  // a normalized counter key also counts as "used in canonical" for never-used math
  for (const n of freq.keys()) if (canonicalSet.has(n)) usedInCanonical.add(n);

  const neverUsed = canonical.filter((c) => !usedInCanonical.has(c)); // already sorted (canonical is sorted)

  const ranking = [...freq.entries()]
    .map(([name, count]) => ({ name, count, stale: !canonicalSet.has(name) }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

  return {
    canonicalCount: canonical.length,
    usedCount: usedInCanonical.size,
    neverUsed,
    neverUsedCount: neverUsed.length,
    ranking,
    countedSkillCount: freq.size,
  };
}

/** Render deterministic markdown (no timestamps / Date.now / random). */
export function renderMarkdown(r) {
  const lines = [];
  lines.push('# Skill Usage Report — qe-diet Phase 2');
  lines.push('');
  lines.push('> Phase 3 CANDIDATE signal. Generated by `scripts/skill-usage-report.mjs`.');
  lines.push('');
  lines.push('## Caveat (read before acting)');
  lines.push('');
  lines.push('Usage is captured ONLY where `pre-tool-use.mjs` intercepts a `toolName === "Skill"` call. ');
  lines.push('Skills invoked via slash-command expansion, sub-agents, or other runtime paths may NOT be ');
  lines.push('captured, so a "never-used" skill may in fact be used. This is a single-user / single-machine / ');
  lines.push('limited-history signal and a Phase-3 candidate that REQUIRES human confirmation — it must NOT be ');
  lines.push('used as an automatic deletion or demotion input, nor as the sole basis for any decision.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Canonical skills (runtime enumeration): ${r.canonicalCount}`);
  lines.push(`- Skills with a usage signal (normalized, in catalog): ${r.usedCount}`);
  lines.push(`- Never-used (candidate): ${r.neverUsedCount}`);
  lines.push(`- Skills with a forward counter: ${r.countedSkillCount}`);
  lines.push('');
  lines.push('## Forward frequency (Skill-tool invocations since instrumentation)');
  lines.push('');
  if (r.ranking.length === 0) {
    lines.push('_No forward counter data yet (`skill_usage_counts` empty — instrumentation just landed)._');
  } else {
    lines.push('| Skill | Count | Note |');
    lines.push('|-------|------:|------|');
    for (const row of r.ranking) {
      lines.push(`| ${row.name} | ${row.count} | ${row.stale ? 'not in current catalog' : ''} |`);
    }
  }
  lines.push('');
  lines.push(`## Never-used candidates (${r.neverUsedCount})`);
  lines.push('');
  if (r.neverUsed.length === 0) {
    lines.push('_None — every canonical skill has a usage signal._');
  } else {
    for (const name of r.neverUsed) lines.push(`- ${name}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Orchestrate a full run against concrete paths. Returns the report model. */
export function generate({ skillsDir, statePath, outPath }) {
  const canonical = enumerateCanonicalSkills(skillsDir);
  const { skillsUsed, counts } = loadUsageState(statePath);
  const report = computeReport(canonical, skillsUsed, counts);
  const md = renderMarkdown(report);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md);
  return report;
}

// CLI entry — exact module-identity check so importers (e.g. the guard, whose
// filename also ends with "skill-usage-report.mjs") do NOT trigger a real run.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const skillsDir = join(REPO_ROOT, 'skills');
  const statePath = join(REPO_ROOT, '.qe', 'state', 'unified-state.json');
  const outPath = join(REPO_ROOT, '.qe', 'planning', 'plans', 'qe-diet', 'phases', '2', 'USAGE_REPORT.md');
  const r = generate({ skillsDir, statePath, outPath });
  console.log(
    `skill-usage-report: canonical=${r.canonicalCount} used=${r.usedCount} ` +
    `never-used=${r.neverUsedCount} counted=${r.countedSkillCount} → ${outPath}`
  );
}
