#!/usr/bin/env node
/**
 * catalog-diet-dry-run.mjs
 *
 * Read-only catalog pruning dry-run for skill-prune-research.
 * It scores QE skill catalog entries and writes report artifacts without
 * moving, deleting, renaming, committing, or editing package metadata.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');
const DEFAULT_PHASE_DIR = '.qe/planning/plans/skill-prune-research/phases/3';

const PROTECTED_CORE = new Set([
  'Qplan',
  'Qgs',
  'Qgenerate-spec',
  'Qatomic-run',
  'Qrun-task',
  'Qcode-run-task',
  'Qcritical-review',
  'Qverify-contract',
  'Qsivs-config',
  'Qcommit',
  'Qversion',
  'Qarchive',
  'Qcompact',
  'Qresume',
  'Qrefresh',
  'Qsweep',
  'Qgc',
  'Qmistake',
  'Qinit',
  'Qhelp',
  'Qupdate',
  'Qcontext',
  'Qmemory',
  'Qwiki-compile',
  'Qwiki-ingest',
  'Qwiki-query',
  'Qprofile',
  'Qproject-sync',
  'Qcatalog-diet',
]);

const OPTIONAL_NAME_PATTERNS = [
  /^Qpm-/,
  /^Qgrad-/,
  /^Qfinance/,
  /^Qjira/,
  /^Qaudio/,
  /^Qyoutube/,
  /^Qdocx$/,
  /^Qpdf$/,
  /^Qpptx$/,
  /^Qxlsx$/,
  /^Qdoc-converter$/,
  /^Qdata-analysis$/,
  /^Qcontract$/,
];

const OPTIONAL_PATH_SEGMENTS = [
  'coding-experts/backend',
  'coding-experts/frontend',
  'coding-experts/languages',
  'coding-experts/data',
  'coding-experts/infra',
  'coding-experts/ai',
  'coding-experts/quality',
];

function relPosix(root, absPath) {
  return relative(root, absPath).split(sep).join('/');
}

function walkForFiles(root, fileName) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) out.push(...walkForFiles(p, fileName));
    else if (ent.isFile() && ent.name === fileName) out.push(p);
  }
  return out.sort();
}

function listAgentFiles(root) {
  const dir = join(root, 'agents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isFile() && /^E.*\.md$/.test(ent.name))
    .map((ent) => join(dir, ent.name))
    .sort();
}

function readFrontmatter(skillMd) {
  const text = readFileSync(skillMd, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const data = {};
  if (lines[0]?.trim() !== '---') return data;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break;
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return data;
}

function skillRecord(root, skillMd, source) {
  const dir = dirname(skillMd);
  const fm = readFrontmatter(skillMd);
  const name = fm.name || dir.split(sep).pop();
  return {
    source,
    name,
    path: relPosix(root, dir),
    skillMd: relPosix(root, skillMd),
    tier: fm.tier || '',
    description: fm.description || '',
  };
}

function scanInventory(root, home = process.env.HOME || '') {
  const repoSkills = walkForFiles(join(root, 'skills'), 'SKILL.md')
    .map((p) => skillRecord(root, p, 'repo-skill'));
  const optionalSkills = walkForFiles(join(root, 'skills-optional'), 'SKILL.md')
    .map((p) => skillRecord(root, p, 'retired-optional-skill'));
  const repoAgents = listAgentFiles(root)
    .map((p) => ({ source: 'repo-agent', name: p.split(sep).pop().replace(/\.md$/, ''), path: relPosix(root, p) }));
  const codexRoot = home ? join(home, '.codex', 'skills') : '';
  const installedCodexSkills = codexRoot && existsSync(codexRoot)
    ? walkForFiles(codexRoot, 'SKILL.md').map((p) => {
        const dir = dirname(p);
        const fm = readFrontmatter(p);
        return {
          source: 'installed-codex-skill',
          name: fm.name || dir.split(sep).pop(),
          path: relPosix(codexRoot, dir),
          skillMd: relPosix(codexRoot, p),
          tier: fm.tier || '',
          description: fm.description || '',
        };
      })
    : [];

  return { repoSkills, optionalSkills, repoAgents, installedCodexSkills };
}

function isOptionalFamily(record) {
  return OPTIONAL_NAME_PATTERNS.some((rx) => rx.test(record.name))
    || OPTIONAL_PATH_SEGMENTS.some((part) => record.path.includes(part));
}

function classifySkill(record) {
  const reasons = [];
  let score = 0;
  let classification = 'NEEDS-REVIEW';
  let profile = 'full';
  let proposedOperation = 'keep-review';
  let risk = 'Needs human review before catalog movement.';
  let requiresHumanReview = true;

  if (PROTECTED_CORE.has(record.name) || record.tier === 'core') {
    return {
      ...record,
      classification: 'CORE',
      score: 0,
      reasons: ['protected core or tier:core'],
      risk: 'Removing this can break PSE/SIVS/safety/state/recovery workflows.',
      proposedProfile: 'core',
      proposedOperation: 'keep',
      rollback: 'Not applicable; protected core stays in catalog.',
      requiresHumanReview: false,
    };
  }

  if (record.source === 'retired-optional-skill') {
    return {
      ...record,
      classification: 'OPTIONAL',
      score: 6,
      reasons: ['legacy optional/retired skill surface'],
      risk: 'Legacy optional surface should not be packaged by the hard-pruned framework.',
      proposedProfile: 'removed',
      proposedOperation: 'already-retired',
      rollback: 'Restore from git history if a later task deliberately reintroduces it.',
      requiresHumanReview: false,
    };
  }

  if (isOptionalFamily(record)) {
    score = record.path.includes('coding-experts') ? 8 : 7;
    classification = score >= 8 ? 'DELETE-CANDIDATE' : 'DELETE-REVIEW';
    profile = 'removed';
    proposedOperation = 'remove-candidate';
    risk = 'Published entrypoint users need deprecation and restore instructions.';
    requiresHumanReview = true;
    reasons.push('non-core domain helper');
    reasons.push('hard-prune family from Phase 4 policy');
    if (record.path.includes('coding-experts')) reasons.push('retired specialist coding-expert surface');
  } else {
    score = 3;
    reasons.push('not protected, but no strong optional-family match');
  }

  return {
    ...record,
    classification,
    score,
    reasons,
    risk,
    proposedProfile: profile,
    proposedOperation,
    rollback: 'No real move in this dry-run. Later prune tasks should rely on git history for restore.',
    requiresHumanReview,
  };
}

function summarizeScored(scored) {
  const byClassification = {};
  const byProfile = {};
  for (const item of scored) {
    byClassification[item.classification] = (byClassification[item.classification] || 0) + 1;
    byProfile[item.proposedProfile] = (byProfile[item.proposedProfile] || 0) + 1;
  }
  return { byClassification, byProfile };
}

function buildManifest(scored) {
  const candidates = scored
    .filter((item) => ['remove-candidate', 'keep-review'].includes(item.proposedOperation))
    .filter((item) => item.classification !== 'CORE')
    .map((item) => ({
      name: item.name,
      originalPath: item.path,
      optionalPath: null,
      classification: item.classification,
      score: item.score,
      references: [
        '.qe/planning/plans/skill-prune-research/phases/2/CANDIDATE_REPORT.md',
        '.qe/planning/plans/skill-prune-research/phases/2/DOCS_POLICY.md',
      ],
      rollback: item.rollback,
      requiresHumanReview: item.requiresHumanReview,
      proposedOperation: item.proposedOperation,
    }));

  return {
    schema: 1,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    applySupported: false,
    note: 'Dry-run manifest only. It proposes removals, not demotions. Restore is via git history or a later explicit reintroduction task.',
    candidates,
  };
}

function markdownReport(result) {
  const lines = [];
  lines.push('# Catalog Diet Dry-Run Report');
  lines.push('');
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push('Recommended option: hard prune non-core candidates in a separate approved task.');
  lines.push('');
  lines.push('No files were moved, deleted, renamed, committed, or version-edited by this command.');
  lines.push('');
  lines.push('## Inventory');
  lines.push('');
  lines.push('| Surface | Count |');
  lines.push('| --- | ---: |');
  for (const [surface, count] of Object.entries(result.inventoryCounts)) {
    lines.push(`| ${surface} | ${count} |`);
  }
  lines.push('');
  lines.push('## Before / After Estimate');
  lines.push('');
  lines.push('| Metric | Before | After hard-prune proposal |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Repo skills | ${result.beforeAfter.repoSkillsBefore} | ${result.beforeAfter.repoSkillsAfterIfRemoved} |`);
  lines.push(`| Retired optional skills | ${result.beforeAfter.optionalSkillsBefore} | 0 |`);
  lines.push('');
  lines.push('## Classification Summary');
  lines.push('');
  lines.push('| Classification | Count |');
  lines.push('| --- | ---: |');
  for (const [classification, count] of Object.entries(result.summary.byClassification)) {
    lines.push(`| ${classification} | ${count} |`);
  }
  lines.push('');
  lines.push('## Candidate Details');
  lines.push('');
  lines.push('| Name | Classification | Score | Profile | Operation | Risk | Rollback note |');
  lines.push('| --- | --- | ---: | --- | --- | --- | --- |');
  for (const item of result.scored
    .filter((row) => row.classification !== 'CORE')
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))) {
    lines.push(`| ${item.name} | ${item.classification} | ${item.score} | ${item.proposedProfile} | ${item.proposedOperation} | ${item.risk} | ${item.rollback} |`);
  }
  lines.push('');
  lines.push('## Verification Commands');
  lines.push('');
  lines.push('- `npm run qe:validate`');
  lines.push('- `node scripts/check-catalog-diet-dry-run.mjs`');
  lines.push('- `npm run check:all`');
  lines.push('');
  lines.push('## Handoff');
  lines.push('');
  lines.push('Use this report to generate a later approved prune spec. Do not apply removals from this dry-run directly.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function runDryRun(options = {}) {
  if (options.apply) {
    throw new Error('--apply is intentionally unsupported. Create a later approved migration task instead.');
  }
  const root = resolve(options.root || DEFAULT_ROOT);
  const phaseDir = resolve(root, options.phaseDir || DEFAULT_PHASE_DIR);
  const inventory = scanInventory(root, options.home ?? process.env.HOME ?? '');
  const scored = inventory.repoSkills.concat(inventory.optionalSkills).map(classifySkill);
  const removeCount = scored.filter((item) => item.proposedOperation === 'remove-candidate' && item.source === 'repo-skill').length;
  const manifest = buildManifest(scored);
  const result = {
    schema: 1,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    inventoryCounts: {
      repoSkills: inventory.repoSkills.length,
      retiredOptionalSkills: inventory.optionalSkills.length,
      repoAgents: inventory.repoAgents.length,
      installedCodexSkills: inventory.installedCodexSkills.length,
      installedCodexCodingExperts: inventory.installedCodexSkills.filter((item) => item.path.includes('coding-experts')).length,
    },
    beforeAfter: {
      repoSkillsBefore: inventory.repoSkills.length,
      repoSkillsAfterIfRemoved: inventory.repoSkills.length - removeCount,
      optionalSkillsBefore: inventory.optionalSkills.length,
    },
    summary: summarizeScored(scored),
    scored,
    manifest,
  };

  if (options.write !== false) {
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(join(phaseDir, 'DRY_RUN_REPORT.md'), markdownReport(result), 'utf8');
    writeFileSync(join(phaseDir, 'PRUNE_MANIFEST.dry-run.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return result;
}

function parseArgs(argv) {
  const out = { write: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--no-write') out.write = false;
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--root') out.root = argv[++i];
    else if (arg === '--phase-dir') out.phaseDir = argv[++i];
    else if (arg === '--home') out.home = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function main(argv) {
  const options = parseArgs(argv);
  const result = runDryRun(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('catalog-diet-dry-run: PASS');
    console.log(`repo skills: ${result.inventoryCounts.repoSkills}`);
    console.log(`retired optional skills: ${result.inventoryCounts.retiredOptionalSkills}`);
    console.log(`remove candidates: ${result.manifest.candidates.filter((c) => c.proposedOperation === 'remove-candidate').length}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`catalog-diet-dry-run: ${e.message}`);
    process.exit(1);
  }
}

export {
  PROTECTED_CORE,
  classifySkill,
  scanInventory,
  runDryRun,
  buildManifest,
};
