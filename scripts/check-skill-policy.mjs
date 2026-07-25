#!/usr/bin/env node
/**
 * check-skill-policy.mjs (guard — auto-discovered by check-all.mjs)
 *
 * Policy regression test for core QE Framework skills.
 * Enforces that load-bearing policy lines remain present and forbidden
 * phrases are not reintroduced into policy sections.
 *
 * Derived from agent-scripts' validate-skills pattern (MIT license, no code copied,
 * adapted to QE Framework conventions).
 *
 * Usage:
 *   node scripts/check-skill-policy.mjs [--self-test]
 *   - bare run: test against real skills/ directory, report PASS/FAIL with path
 *   - --self-test: test detection capability against fixtures/skill-policy/ fixtures,
 *     verify violation detection works and passing fixture passes clean
 *
 * Contract:
 *   - Core skills (Qcommit, Qgenerate-spec, Qexecute, Qplan) must exist in skills/
 *   - Each skill has required policy sentences (normalized line-match) and forbidden phrases
 *   - Forbidden phrase matching is document-wide (every line), with positional negation
 *     exemption: negation must appear BEFORE the phrase on the line, or the nearest
 *     preceding non-empty line must be a negated lead-in / negation heading
 *   - Missing core skills in bare run → FAIL
 *   - --self-test: detection must catch specific violations (incl. Korean-inversion and
 *     pre-heading exploits), prove missing-required detection on real Qcommit content,
 *     AND pass clean fixtures; any fixture dir without SKILL.md fails the self-test
 *
 * Policy Drift Rule (Contract):
 *   - Legitimate policy wording changes MUST update the ASSERTIONS table in this file
 *     in the SAME commit. Do NOT weaken or revert skill text to silence this guard.
 *   - See ASSERTIONS table comments for rationale and distinctive phrase selection.
 */

import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Determine skills directory: fixture override via env in --self-test mode only
let skillsDir = join(ROOT, 'skills');
if (selfTest) {
  // In self-test mode, default to fixtures directory unless env override
  skillsDir = process.env.QE_POLICY_SKILLS_DIR || join(ROOT, 'scripts', 'fixtures', 'skill-policy');
}

// Negation markers: a forbidden phrase is exempt only when one of these appears
// BEFORE the phrase's position on the same normalized line (positional check).
const NEGATION_MARKERS = ['never', 'no ', 'not ', "don't", 'do not', 'avoid', 'forbidden', '금지', '않', 'anti-pattern'];

// Heading/lead-in context markers: a forbidden phrase is also exempt when the nearest
// preceding non-empty line is a heading (or a lead-in ending with ':') that carries one
// of these negation/anti-pattern markers (e.g. "## Prohibited", "잘못된 예:", "## Anti-patterns").
const HEADING_NEGATION_MARKERS = ['never', '금지', '않', 'prohibited', 'anti-pattern', 'avoid', 'do not', 'wrong', '잘못'];

// Assertion table: canonical source of policy requirements per skill
// Each entry: { skill, required: [], forbidden: [] }
// Required: DISTINCTIVE normalized phrases (≥6 words of actual policy text) that must
//   appear on a single normalized line. Long enough to prevent accidental match in an
//   inversion sentence (e.g., "The X gate is now optional..." must NOT contain the
//   full required phrase for it to fail the check).
// Forbidden: phrases that must NOT appear in policy sections (scoped to re-introduction context)
const ASSERTIONS = [
  {
    skill: 'Qcommit',
    required: [
      'never add co-authored-by lines', // line 42: "Never add `Co-Authored-By` lines" (distinctive: full prohibition)
      'do not run raw commit operations directly when the active client has an available commit executor agent', // line 78: mandatory delegation rule (distinctive: complete mandate)
    ],
    forbidden: [
      // Tripwire: if this line appears non-negated, policy was inverted
      { phrase: 'generated with claude code', context: 'Policy' },
    ],
  },
  {
    skill: 'Qgenerate-spec',
    required: [
      'code risk register — for every type: code task, include a mandatory risk section that names worst-case failure', // line 117: full Risk Register mandate (distinctive: complete definition)
      'this gate always runs. unlike step 2.5, it has no skip conditions', // line 177: Step 2.6 MANDATORY gate (distinctive: hard gate definition)
    ],
    forbidden: [
      // Tripwire: gate skip conditions should never be optional (non-negated)
      { phrase: 'this gate may be skipped', context: 'Policy' },
    ],
  },
  {
    skill: 'Qexecute',
    required: [
      'loop limit: 3 iterations (confirm continuation via the interaction adapter each round)', // line 214: specific iteration limit + confirmation mandate (distinctive: complete requirement)
      'taskrequest has a ## risk register with all six fields filled: worst-case failure', // line 91: mandatory Risk Register gate (distinctive: full mandate with six-field prefix)
    ],
    forbidden: [
      // Tripwire: iteration limit must never be optional (non-negated)
      { phrase: 'iteration limit is optional', context: 'Policy' },
    ],
  },
  {
    skill: 'Qplan',
    required: [
      'qplan is the user-facing control surface for work', // Plan-first public entry point; internal QE capabilities must not leak into the user workflow
      'only a verified goal with explicit evidence may write back to the wiki', // Evidence-gated knowledge write-back is the Plan-owned Goal loop invariant
    ],
    forbidden: [
      // Tripwire: verification must never be weakened to allow evidence-free write-back
      { phrase: 'verified completion does not require evidence', context: 'Policy' },
    ],
  },
];

/**
 * Normalize text for matching: Unicode NFKC (folds homoglyphs/fullwidth forms), strip
 * zero-width characters (ZWSP/ZWNJ/ZWJ/BOM — evasion vector), strip markdown
 * emphasis/backticks, collapse whitespace.
 */
function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/[​‌‍﻿]/g, '') // strip zero-width chars
    .toLowerCase()
    .replace(/[`*_~]/g, '') // strip markdown emphasis
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/**
 * Check if normalized text contains a negation marker (prohibition/anti-pattern context).
 * English markers use word-boundary matching to avoid false positives (e.g., "no " in "code").
 * Korean markers (않, 금지) match as plain substrings: Korean attaches suffixes without
 * spaces (않습니다, 않는다, 않도록), so boundary matching would miss common conjugations.
 * @param {string} normalizedText - Already-normalized text (or slice of it)
 */
function hasNegationMarker(normalizedText) {
  return NEGATION_MARKERS.some(marker => {
    const normMarker = normalize(marker);
    if (/[가-힣]/.test(normMarker)) {
      // Korean marker: plain substring match (no space before suffixes/particles)
      return normalizedText.includes(normMarker);
    }
    // English marker: match as whole word or phrase — prefix with space or start of line,
    // suffix with space or end (so 'no ' does not match inside words)
    const regex = new RegExp(`(^|\\s)${normMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    return regex.test(normalizedText);
  });
}

/**
 * Check whether the nearest preceding non-empty line establishes negation context for
 * line `idx`: either a negated lead-in (ends with ':' and carries a negation marker) or
 * a markdown heading containing a negation/anti-pattern marker (substring match — headings
 * are short, so false-positive risk is low and punctuation like "Wrong:" must still match).
 * @param {string[]} rawLines - Raw content lines
 * @param {string[]} normLines - Normalized content lines (parallel array)
 * @param {number} idx - Index of the line containing the forbidden phrase
 * @returns {boolean}
 */
function hasNegationContext(rawLines, normLines, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    if (normLines[j] === '') continue; // skip blank lines
    if (/^#{1,6}\s/.test(rawLines[j].trim())) {
      // Nearest non-empty line is a heading: exempt only if it carries a negation marker
      return HEADING_NEGATION_MARKERS.some((m) => normLines[j].includes(normalize(m)));
    }
    if (normLines[j].endsWith(':')) {
      // Nearest non-empty line is a lead-in: exempt only if it is a negated lead-in
      return hasNegationMarker(normLines[j]);
    }
    return false; // nearest preceding non-empty line is ordinary prose — no exemption
  }
  return false; // no preceding non-empty line (phrase at top of document)
}

/**
 * Parse skill SKILL.md and check policy assertions.
 */
function checkSkillPolicy(skillPath, assertion) {
  const skillFile = join(skillPath, 'SKILL.md');

  if (!existsSync(skillFile)) {
    return { skill: assertion.skill, error: `missing SKILL.md` };
  }

  try {
    const content = readFileSync(skillFile, 'utf8').replace(/^﻿/, ''); // strip BOM
    const contentLines = content.split('\n');
    const normalizedLines = contentLines.map((l) => normalize(l));

    const failures = [];

    // Check required sentences (line-level: some single normalized line must contain the phrase)
    for (const req of assertion.required) {
      const normReq = normalize(req);
      if (!normalizedLines.some((line) => line.includes(normReq))) {
        failures.push(`missing required: "${req}"`);
      }
    }

    // Check forbidden phrases: document-wide line scan (no section scoping — the old
    // section-scoped scan had a blind spot before the first policy heading).
    // Exemption is positional: negation must appear BEFORE the phrase on the line,
    // or the nearest preceding non-empty line must be a negated lead-in / negation heading.
    // KNOWN RESIDUAL: a line like "Avoid ambiguity: always append X" (negation word before
    // the phrase but semantically mandating) stays exempt — NL semantics beyond lint scope.
    for (const forbid of assertion.forbidden) {
      const normPhrase = normalize(forbid.phrase);

      for (let i = 0; i < contentLines.length; i++) {
        const normLine = normalizedLines[i];
        const pos = normLine.indexOf(normPhrase);
        if (pos < 0) continue;

        // Positional negation: only markers BEFORE the phrase exempt the line
        // (kills the Korean-inversion exploit: "...를 추가하지 않는 것은 잘못이다")
        if (hasNegationMarker(normLine.slice(0, pos))) continue;

        // Context exemption: nearest preceding non-empty line is a negated lead-in
        // or a heading with a negation/anti-pattern marker
        if (hasNegationContext(contentLines, normalizedLines, i)) continue;

        failures.push(`forbidden phrase detected: "${forbid.phrase}" (${forbid.context})`);
        break; // Report each forbidden phrase once per skill
      }
    }

    return {
      skill: assertion.skill,
      passed: failures.length === 0,
      failures,
    };
  } catch (err) {
    return {
      skill: assertion.skill,
      error: `failed to read: ${err.message}`,
    };
  }
}

/**
 * Real-catalog-grounded detection proof: copy the REAL skills/Qcommit/SKILL.md into a
 * temp dir, delete the line matching the first required assertion, and verify the
 * checker reports missing-required. Proves detection works on real content, not just
 * synthetic fixtures. Temp dir is always cleaned up.
 * @returns {{ok: boolean, reason: string}}
 */
function runRealContentProof() {
  const assertion = ASSERTIONS.find((a) => a.skill === 'Qcommit');
  const realSkillFile = join(ROOT, 'skills', 'Qcommit', 'SKILL.md');
  if (!existsSync(realSkillFile)) {
    return { ok: false, reason: 'real skills/Qcommit/SKILL.md not found' };
  }

  const content = readFileSync(realSkillFile, 'utf8');
  const lines = content.split('\n');
  const firstReq = normalize(assertion.required[0]);
  const idx = lines.findIndex((l) => normalize(l).includes(firstReq));
  if (idx < 0) {
    return { ok: false, reason: `first required assertion not found in real content: "${assertion.required[0]}"` };
  }
  lines.splice(idx, 1); // delete the load-bearing policy line

  let tmpBase = null;
  try {
    tmpBase = mkdtempSync(join(tmpdir(), 'qe-policy-selftest-'));
    const tmpSkillDir = join(tmpBase, 'Qcommit');
    mkdirSync(tmpSkillDir);
    writeFileSync(join(tmpSkillDir, 'SKILL.md'), lines.join('\n'), 'utf8');

    const result = checkSkillPolicy(tmpSkillDir, assertion);
    if (result.error) return { ok: false, reason: `real-content check errored: ${result.error}` };
    const fired = !result.passed && result.failures.some((f) => f.includes('missing required'));
    return fired
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'missing-required did not fire on real content with policy line deleted' };
  } catch (err) {
    return { ok: false, reason: `failed to create temp directory: ${err.message}` };
  } finally {
    if (tmpBase) rmSync(tmpBase, { recursive: true, force: true });
  }
}

/**
 * Self-test mode: verify that the checker detects specific violation classes correctly.
 * - Fixtures named *Passing must pass clean; fixtures named *Violation must fail.
 * - A fixture dir without SKILL.md fails the self-test (no silent skip).
 * - The two exploit fixtures (Korean-inversion, pre-heading) must fire forbidden-detected.
 * - Real-content deletion proof must fire missing-required on real Qcommit content.
 */
function runSelfTest() {
  const fixturesDir = skillsDir; // In self-test, this points to fixtures dir

  if (!existsSync(fixturesDir)) {
    console.error(`check-skill-policy: FAIL (self-test fixtures not found at ${fixturesDir})`);
    process.exit(1);
  }

  const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (fixtures.length === 0) {
    console.error(`check-skill-policy: FAIL (no fixture skills in ${fixturesDir})`);
    process.exit(1);
  }

  const detectedClasses = new Set();
  const selfTestErrors = [];

  for (const fixture of fixtures) {
    const fixturePath = join(fixturesDir, fixture);
    // Find a matching assertion by exact match after stripping known suffix pattern
    // (e.g., "QcommitViolationKoreanInversion" -> strip "(Violation[A-Za-z]*)" -> "Qcommit")
    const suffixStripped = fixture.replace(/(Passing|Violation[A-Za-z]*)$/, '');
    const assertion = ASSERTIONS.find((a) => a.skill === suffixStripped) || {
      skill: fixture,
      required: ['test required'],
      forbidden: [{ phrase: 'test forbidden', context: 'Policy' }],
    };

    const result = checkSkillPolicy(fixturePath, assertion);

    if (result.error) {
      // A fixture dir without a readable SKILL.md is a broken self-test — FAIL loudly
      selfTestErrors.push(`fixture ${fixture}: ${result.error}`);
      continue;
    }

    // Name-based expectations: *Passing must pass, *Violation must fail
    if (fixture.includes('Passing')) {
      if (result.passed) {
        detectedClasses.add('passing-clean');
      } else {
        selfTestErrors.push(`fixture ${fixture} expected to pass but failed: ${result.failures.join('; ')}`);
      }
    } else if (fixture.includes('Violation')) {
      if (result.passed) {
        selfTestErrors.push(`fixture ${fixture} expected to fail but passed`);
        continue;
      }
      for (const failure of result.failures) {
        if (failure.includes('missing required')) detectedClasses.add('missing-required');
        if (failure.includes('forbidden phrase detected')) detectedClasses.add('forbidden-detected');
      }
      // Exploit fixtures must fire forbidden-detected specifically
      const forbiddenFired = result.failures.some((f) => f.includes('forbidden phrase detected'));
      if (fixture.includes('KoreanInversion')) {
        if (forbiddenFired) detectedClasses.add('exploit-korean-inversion');
        else selfTestErrors.push(`fixture ${fixture}: forbidden-detected did not fire (Korean-inversion exploit alive)`);
      }
      if (fixture.includes('PreHeading')) {
        if (forbiddenFired) detectedClasses.add('exploit-pre-heading');
        else selfTestErrors.push(`fixture ${fixture}: forbidden-detected did not fire (pre-heading exploit alive)`);
      }
    }
  }

  // Real-catalog-grounded proof: delete required line from real Qcommit content in a temp copy
  const proof = runRealContentProof();
  if (proof.ok) {
    detectedClasses.add('real-content-missing-required');
  } else {
    selfTestErrors.push(`real-content proof failed: ${proof.reason}`);
  }

  const REQUIRED_CLASSES = [
    'missing-required',
    'forbidden-detected',
    'passing-clean',
    'exploit-korean-inversion',
    'exploit-pre-heading',
    'real-content-missing-required',
  ];
  const missingClasses = REQUIRED_CLASSES.filter((c) => !detectedClasses.has(c));

  if (selfTestErrors.length === 0 && missingClasses.length === 0) {
    const detectedList = Array.from(detectedClasses).sort().join(', ');
    console.log(`check-skill-policy: PASS (dir: ${fixturesDir}) [self-test detection verified: ${detectedList}]`);
    process.exit(0);
  } else {
    console.error(`check-skill-policy: FAIL (self-test detection failed)`);
    for (const e of selfTestErrors) console.error(`  ✗ ${e}`);
    for (const c of missingClasses) console.error(`  ✗ detection class did not fire: ${c}`);
    process.exit(1);
  }
}

// Main: bare run against real skills/
if (selfTest) {
  runSelfTest();
} else {
  const failures = [];

  for (const assertion of ASSERTIONS) {
    const skillPath = join(ROOT, 'skills', assertion.skill);

    if (!existsSync(skillPath)) {
      failures.push(`missing core skill: ${assertion.skill}`);
      continue;
    }

    const result = checkSkillPolicy(skillPath, assertion);
    if (result.error) {
      failures.push(`${assertion.skill}: ${result.error}`);
    } else if (!result.passed) {
      for (const f of result.failures) {
        failures.push(`${assertion.skill}: ${f}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('check-skill-policy: FAIL');
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error('');
    console.error('policy-drift rule: legitimate policy wording changes MUST update the ASSERTIONS table in scripts/check-skill-policy.mjs in the same commit.');
    console.error('do NOT weaken or revert the skill text to silence this guard — see scripts/check-skill-policy.mjs header for the contract.');
    process.exit(1);
  }

  console.log(`check-skill-policy: PASS (dir: ${join(ROOT, 'skills')})`);
  process.exit(0);
}
