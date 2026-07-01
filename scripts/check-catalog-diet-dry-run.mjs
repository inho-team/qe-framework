#!/usr/bin/env node
/**
 * Guard for catalog-diet-dry-run.mjs.
 * Builds a throwaway repository fixture and verifies scoring, schema, and
 * no-mutation behavior. It never mutates the real repository catalog.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDryRun } from './catalog-diet-dry-run.mjs';

const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const throws = (fn, rx, msg) => {
  try {
    fn();
    failures.push(`${msg} (expected throw, none)`);
  } catch (e) {
    if (rx && !rx.test(e.message)) failures.push(`${msg} (wrong error: ${e.message})`);
  }
};

function mkSkill(root, rel, name, extra = '') {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${extra}---\nbody\n`);
}

function mkFixture() {
  const root = mkdtempSync(join(tmpdir(), 'qe-catalog-diet-'));
  mkSkill(root, 'skills/Qplan', 'Qplan', 'tier: core\n');
  mkSkill(root, 'skills/Qdocx', 'Qdocx');
  mkSkill(root, 'skills/coding-experts/quality/Qvitest', 'Qvitest');
  mkSkill(root, 'skills/coding-experts/frontend/Qreact-expert', 'Qreact-expert');
  mkSkill(root, 'skills/Qmisc', 'Qmisc');
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', 'Eprofile-collector.md'), '# agent\n');
  const home = join(root, 'home');
  mkSkill(home, '.codex/skills/coding-experts/backend/Qrails-expert', 'Qrails-expert');
  return { root, home };
}

function checkPackageDietNoDrift() {
  const repoRoot = new URL('..', import.meta.url);
  const staleRootArtifacts = [
    'GEMINI.md',
    'audit_report.json',
    'audit_report.md',
    'test-framework.js',
    'test-hooks.js',
    'test-supervision.js',
    'run_metric.sh',
  ];

  for (const rel of staleRootArtifacts) {
    expect(!existsSync(new URL(rel, repoRoot)), `[diet] stale root artifact reintroduced: ${rel}`);
  }

  const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8'));
  const files = pkg.files || [];
  for (const rel of staleRootArtifacts) {
    expect(!files.includes(rel), `[diet] stale root artifact listed in package files: ${rel}`);
  }

  const requiredExclusions = [
    '!docs/index.html',
    '!docs/qe_framework_*.html',
    '!docs/presentation/',
    '!docs/archive/',
  ];
  for (const pattern of requiredExclusions) {
    expect(files.includes(pattern), `[diet] package files missing heavy docs exclusion: ${pattern}`);
  }
}

checkPackageDietNoDrift();

{
  const { root, home } = mkFixture();
  try {
    const beforeSkills = readdirSync(join(root, 'skills')).sort().join(',');
    const result = runDryRun({ root, home, phaseDir: '.qe/phase3', write: true });
    const afterSkills = readdirSync(join(root, 'skills')).sort().join(',');
    expect(beforeSkills === afterSkills, '[mutation] skills directory changed during dry-run');
    expect(existsSync(join(root, '.qe/phase3/DRY_RUN_REPORT.md')), '[report] markdown report not written');
    expect(existsSync(join(root, '.qe/phase3/PRUNE_MANIFEST.dry-run.json')), '[manifest] dry-run manifest not written');
    expect(result.inventoryCounts.repoSkills === 5, `[inventory] repo skill count wrong: ${result.inventoryCounts.repoSkills}`);
    expect(result.inventoryCounts.retiredOptionalSkills === 0, `[inventory] retired optional skill count wrong: ${result.inventoryCounts.retiredOptionalSkills}`);
    expect(result.inventoryCounts.repoAgents === 1, `[inventory] repo agent count wrong: ${result.inventoryCounts.repoAgents}`);
    expect(result.inventoryCounts.installedCodexCodingExperts === 1, '[inventory] installed coding-experts count wrong');

    const byName = Object.fromEntries(result.scored.map((item) => [item.name, item]));
    expect(byName.Qplan.classification === 'CORE', '[score] protected core not CORE');
    expect(byName.Qplan.proposedOperation === 'keep', '[score] protected core not kept');
    expect(byName.Qvitest.proposedOperation === 'remove-candidate', '[score] quality coding expert should be remove candidate');
    expect(byName.Qvitest.score >= 8, '[score] quality coding expert score too low');
    expect(byName.Qdocx.proposedOperation === 'remove-candidate', '[score] doc helper not remove candidate');
    expect(byName['Qreact-expert'].score >= 8, '[score] coding specialist score too low');

    const manifest = JSON.parse(readFileSync(join(root, '.qe/phase3/PRUNE_MANIFEST.dry-run.json'), 'utf8'));
    expect(manifest.dryRun === true, '[manifest] dryRun flag missing');
    expect(manifest.applySupported === false, '[manifest] applySupported must be false');
    const docx = manifest.candidates.find((item) => item.name === 'Qdocx');
    expect(Boolean(docx), '[manifest] Qdocx candidate missing');
    expect(docx.optionalPath === null, '[manifest] hard prune should not set optionalPath');
    for (const key of ['originalPath', 'optionalPath', 'classification', 'score', 'references', 'rollback', 'requiresHumanReview']) {
      expect(Object.hasOwn(docx, key), `[manifest] missing field ${key}`);
    }

    throws(() => runDryRun({ root, home, apply: true }), /unsupported|approved migration/, '[apply] --apply was not rejected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error('check-catalog-diet-dry-run: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('check-catalog-diet-dry-run: PASS (inventory, hard-prune scoring, manifest schema, no-mutation, apply rejection)');
