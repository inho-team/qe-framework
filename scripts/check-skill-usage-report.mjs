#!/usr/bin/env node
/**
 * check-skill-usage-report.mjs (guard — auto-discovered by check-all.mjs)
 *
 * Locks in the ADR-025 qe-diet Phase 2 usage-report contract. Fully self-contained:
 * builds its own temp fixtures (nested skill depths, a dist/ stub outside skills/,
 * raw bare+namespaced names, alias names, a stale counter key, corrupt/missing
 * state) and asserts behavior against the exported pure functions. Does NOT depend
 * on the committed .qe/ tree or any pre-existing USAGE_REPORT.md, so it passes in a
 * fresh clone / CI.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  normalizeSkillName, enumerateCanonicalSkills, loadUsageState,
  computeReport, generate,
} = await import(join(__dirname, 'skill-usage-report.mjs'));

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

/**
 * Create a fixture SKILL.md under `root/relParentDir` (its parent dir basename
 * becomes the canonical skill name during enumeration).
 * @param {string} root - fixture root directory
 * @param {string} relParentDir - path (relative to root) of the skill's own dir
 * @returns {void}
 */
function mkSkill(root, relParentDir) {
  const dir = join(root, relParentDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: x\n---\nbody');
}

// ── 1. normalization: prefix strip + alias collapse ───────────────────────────
expect(normalizeSkillName('qe-framework:Qcommit') === 'Qcommit', '[norm] prefix not stripped');
expect(normalizeSkillName('Qgs') === 'Qgenerate-spec', '[norm] Qgs alias not collapsed');
expect(normalizeSkillName('qe-framework:Qgs') === 'Qgenerate-spec', '[norm] namespaced alias not collapsed');
expect(normalizeSkillName('Qrt') === 'Qexecute', '[norm] Qrt alias not collapsed');
expect(normalizeSkillName('') === '' && normalizeSkillName('qe-framework:') === '', '[norm] empty not handled');
expect(normalizeSkillName(42) === '', '[norm] non-string not handled');

// ── 2. enumeration: nested depth, dist/ exclusion, dedup, sorted, no symlink ───
{
  const root = mkdtempSync(join(tmpdir(), 'qe-skills-'));
  try {
    mkSkill(root, 'skills/Qalpha');                                   // flat depth
    mkSkill(root, 'skills/nested/quality/Qvitest');                  // nested depth 5
    mkSkill(root, 'dist/skills/qe-framework');                        // OUTSIDE skills/ → must be excluded
    mkdirSync(join(root, 'skills/empty-dir'), { recursive: true });   // no SKILL.md
    const canon = enumerateCanonicalSkills(join(root, 'skills'));
    expect(JSON.stringify(canon) === JSON.stringify(['Qalpha', 'Qvitest']),
      `[enum] expected [Qalpha,Qvitest] got ${JSON.stringify(canon)}`);
    expect(!canon.includes('qe-framework'), '[enum] dist/ stub leaked into canonical set');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ── 3. computeReport: alias collapse + never-used oracle ───────────────────────
{
  const canonical = ['Foo', 'Qgenerate-spec', 'Qexecute'];
  // used via aliases + namespaced + bare; Qrt→Qexecute, Qgs→Qgenerate-spec
  const skillsUsed = ['Qgs', 'qe-framework:Qgs', 'Qrt'];
  const r = computeReport(canonical, skillsUsed, {});
  expect(r.canonicalCount === 3, '[report] canonicalCount wrong');
  expect(r.usedCount === 2, `[report] used distinct should be 2 (Qgenerate-spec,Qexecute), got ${r.usedCount}`);
  expect(JSON.stringify(r.neverUsed) === JSON.stringify(['Foo']),
    `[report] never-used should be [Foo], got ${JSON.stringify(r.neverUsed)}`);
  // central oracle: neverUsedCount == canonicalCount - distinct(used in canonical)
  expect(r.neverUsedCount === r.canonicalCount - r.usedCount, '[report] never-used oracle violated');
}

// ── 4. stale counter key shown but excluded from denominator; NaN coerce ───────
{
  const canonical = ['Foo', 'Bar'];
  const counts = { Foo: 3, DeletedSkill: 9, Bar: 'corrupt', 'qe-framework:Foo': -5 };
  const r = computeReport(canonical, [], counts);
  // Foo used via counter (3 + coerced 0 from namespaced -5) → used; Bar 'corrupt'→0 but key present → used-in-canonical
  const stale = r.ranking.find(x => x.name === 'DeletedSkill');
  expect(stale && stale.stale === true, '[report] stale key not flagged');
  // never-used denominator must exclude stale (DeletedSkill not subtracted from canonical)
  expect(r.canonicalCount === 2, '[report] stale key polluted canonicalCount');
  expect(!r.neverUsed.includes('DeletedSkill'), '[report] stale key wrongly in never-used');
  // no NaN in ranking counts
  expect(r.ranking.every(x => Number.isInteger(x.count)), '[report] NaN/non-int count leaked');
}

// ── 5. loadUsageState: missing / corrupt / partial → empty, never throws ───────
{
  const root = mkdtempSync(join(tmpdir(), 'qe-state-'));
  try {
    expect(JSON.stringify(loadUsageState(join(root, 'nope.json'))) === '{"skillsUsed":[],"counts":{}}',
      '[state] missing file not empty');
    const corrupt = join(root, 'corrupt.json'); writeFileSync(corrupt, '{not valid json');
    const c = loadUsageState(corrupt);
    expect(Array.isArray(c.skillsUsed) && c.skillsUsed.length === 0, '[state] corrupt not empty');
    const partial = join(root, 'partial.json'); writeFileSync(partial, '{"session_stats":{}}');
    const p = loadUsageState(partial);
    expect(p.skillsUsed.length === 0 && Object.keys(p.counts).length === 0, '[state] partial not empty');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ── 6. generate(): mkdir -p, deterministic overwrite, caveat present ───────────
{
  const root = mkdtempSync(join(tmpdir(), 'qe-gen-'));
  try {
    mkSkill(root, 'skills/Qalpha');
    mkSkill(root, 'skills/Qbeta');
    const statePath = join(root, '.qe', 'state', 'unified-state.json');
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ session_stats: { skills_used: ['Qalpha'], skill_usage_counts: { Qalpha: 2 } } }));
    const outPath = join(root, '.qe', 'planning', 'plans', 'qe-diet', 'phases', '2', 'USAGE_REPORT.md'); // parent absent
    generate({ skillsDir: join(root, 'skills'), statePath, outPath });
    const first = readFileSync(outPath, 'utf8');
    generate({ skillsDir: join(root, 'skills'), statePath, outPath });
    const second = readFileSync(outPath, 'utf8');
    expect(first === second, '[gen] output not deterministic (byte-identical) on re-run');
    expect(/Caveat/.test(first) && /human confirmation|automatic deletion/i.test(first), '[gen] caveat missing');
    expect(/Qbeta/.test(first), '[gen] never-used Qbeta missing from report');
    expect(!/\d{4}-\d{2}-\d{2}T/.test(first), '[gen] ISO timestamp leaked → non-deterministic');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (failures.length) {
  console.error('check-skill-usage-report: FAIL');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('check-skill-usage-report: PASS (norm, enum-depth+dist-exclusion, never-used oracle, stale/NaN, state-resilience, deterministic+caveat)');
