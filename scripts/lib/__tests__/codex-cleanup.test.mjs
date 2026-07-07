/**
 * codex-cleanup.test.mjs
 * Integration tests for cleanupCodexAssets() using a fresh temp homeDir.
 * NEVER touches the real ~/.codex — all tests use mkdtempSync-based homes.
 * Run with: node --test scripts/lib/__tests__/codex-cleanup.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cleanupCodexAssets, uninstallClaudeAssets } from '../client_installers.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QE_FENCE_BEGIN = '# QE Framework Agent Configuration — managed by qe-framework installer';
const QE_FENCE_END = '# End QE Framework Agent Configuration';

/**
 * Build a temp homeDir with a seeded ~/.codex layout.
 * @param {object} opts
 * @param {string[]} [opts.skills]       - skill dir names to create (each gets SKILL.md)
 * @param {string[]} [opts.skillsNoDoc]  - skill dir names WITHOUT SKILL.md (should be preserved)
 * @param {string[]} [opts.agentNames]   - agent names to create .toml + .md files for
 * @param {string|null} [opts.configToml] - raw config.toml content (null = omit file)
 */
function makeHome(opts = {}) {
  const { skills = [], skillsNoDoc = [], agentNames = [], configToml = null } = opts;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-codex-'));
  const codexDir = path.join(homeDir, '.codex');
  const skillsDir = path.join(codexDir, 'skills');
  const agentsDir = path.join(codexDir, 'agents');

  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });

  for (const name of skills) {
    const d = path.join(skillsDir, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `# ${name}\n`);
  }

  for (const name of skillsNoDoc) {
    const d = path.join(skillsDir, name);
    fs.mkdirSync(d, { recursive: true });
    // No SKILL.md — should be preserved even if name is in manifest
  }

  for (const name of agentNames) {
    fs.writeFileSync(path.join(agentsDir, `${name}.toml`), `[agent]\nname = "${name}"\n`);
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), `# ${name}\n`);
  }

  if (configToml !== null) {
    fs.writeFileSync(path.join(codexDir, 'config.toml'), configToml, 'utf8');
  }

  return homeDir;
}

/**
 * Build a config.toml string with a QE fence wrapping the given agent entries.
 */
function buildConfigWithFence(agentEntries, prelude = '', postlude = '') {
  const fenceLines = agentEntries.map(({ name, agentsDir }) =>
    `\n[agents."${name}"]\ndescription = "test"\nconfig_file = "${agentsDir}/${name}.toml"`
  ).join('\n');

  return [
    prelude,
    QE_FENCE_BEGIN,
    fenceLines,
    QE_FENCE_END,
    postlude,
  ].filter((s) => s !== '').join('\n');
}

// ---------------------------------------------------------------------------
// (a) Normal cleanup: seeded QE skills + agents + fence -> dry-run lists them,
//     purge removes them.
// ---------------------------------------------------------------------------

test('(a) normal purge: QE skills + agents removed, receipt written', (t) => {
  const homeDir = makeHome({
    skills: ['Qexecute', 'Mbump'],
    agentNames: ['Etask-executor', 'Edeep-researcher'],
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const agentsDir = path.join(homeDir, '.codex', 'agents');
  const configToml = buildConfigWithFence([
    { name: 'Etask-executor', agentsDir },
    { name: 'Edeep-researcher', agentsDir },
  ]);
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  const result = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  assert.equal(result.dryRun, false, 'should be purge mode');
  assert.equal(result.skills.length, 2, 'should find 2 QE skills');
  assert.equal(result.agents.length, 4, 'should find 4 agent files (2x .toml + 2x .md)');
  assert.equal(result.configEdited, true, 'config.toml fence should be stripped');

  // Files should be gone
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex', 'skills', 'Qexecute')), 'Qexecute skill removed');
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex', 'skills', 'Mbump')), 'Mbump skill removed');
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex', 'agents', 'Etask-executor.toml')), 'agent toml removed');
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex', 'agents', 'Etask-executor.md')), 'agent md removed');

  // config.toml fence should be gone, backup present
  const configText = fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
  assert.ok(!configText.includes(QE_FENCE_BEGIN), 'fence begin marker stripped');
  assert.ok(!configText.includes(QE_FENCE_END), 'fence end marker stripped');
  assert.ok(result.configBackup, 'backup path returned');
  assert.ok(fs.existsSync(result.configBackup), 'config.toml backup file exists');

  // Receipt should exist
  assert.ok(result.receiptPath, 'receipt path returned');
  assert.ok(fs.existsSync(result.receiptPath), 'purge receipt file exists');
  const receiptData = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
  assert.equal(receiptData.mode, 'purge', 'receipt mode is purge');
});

// ---------------------------------------------------------------------------
// (b) Re-run no-op (idempotent): second purge after first has nothing to remove.
// ---------------------------------------------------------------------------

test('(b) re-run is a no-op after first purge', (t) => {
  const homeDir = makeHome({
    skills: ['Qcommit'],
    agentNames: ['Ecode-debugger'],
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const agentsDir = path.join(homeDir, '.codex', 'agents');
  const configToml = buildConfigWithFence([{ name: 'Ecode-debugger', agentsDir }]);
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  // First purge
  cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  // Second purge — should find nothing to remove
  const result2 = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });
  assert.equal(result2.skills.length, 0, 'second purge: no skills to remove');
  assert.equal(result2.agents.length, 0, 'second purge: no agents to remove');
  assert.equal(result2.configEdited, false, 'second purge: config not edited (fence already gone)');
});

// ---------------------------------------------------------------------------
// (c) No ~/.codex -> silent empty plan returned.
// ---------------------------------------------------------------------------

test('(c) no ~/.codex directory -> graceful silent skip', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-codex-empty-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  // Ensure no .codex exists
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex')));

  const result = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });
  assert.deepEqual(result.skills, [], 'no skills');
  assert.deepEqual(result.agents, [], 'no agents');
  assert.equal(result.configEdited, false, 'config not edited');
});

// ---------------------------------------------------------------------------
// (d) Non-QE content preserved: mcp_servers table, user project section,
//     user skill dir with QE-like prefix NOT in manifest + no SKILL.md,
//     user agent NOT in fence.
// ---------------------------------------------------------------------------

test('(d) non-QE content fully preserved after purge', (t) => {
  const homeDir = makeHome({
    skills: ['Qexecute'], // one real QE skill
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const agentsDir = path.join(homeDir, '.codex', 'agents');
  const skillsDir = path.join(homeDir, '.codex', 'skills');

  // User skill: QE-like prefix, NOT in manifest, has SKILL.md -> must be preserved
  const userSkillDir = path.join(skillsDir, 'Querty-notes');
  fs.mkdirSync(userSkillDir, { recursive: true });
  fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), '# user skill\n');

  // User agent NOT in fence -> must be preserved
  fs.writeFileSync(path.join(agentsDir, 'Estimator.toml'), '[agent]\nname = "Estimator"\n');
  fs.writeFileSync(path.join(agentsDir, 'Estimator.md'), '# Estimator\n');

  const configToml = [
    '# user top-level settings',
    'model = "gpt-5"',
    '',
    '[mcp_servers.myServer]',
    'command = "node"',
    'args = ["server.js"]',
    '',
    '[projects."/some/path"]',
    'trust_level = "trusted"',
    '',
    QE_FENCE_BEGIN,
    `\n[agents."Etask-executor"]\ndescription = "test"\nconfig_file = "${agentsDir}/Etask-executor.toml"`,
    QE_FENCE_END,
    '',
    '[env]',
    'MY_VAR = "1"',
  ].join('\n');

  // Create the QE agent files referenced in fence
  fs.writeFileSync(path.join(agentsDir, 'Etask-executor.toml'), '[agent]\n');
  fs.writeFileSync(path.join(agentsDir, 'Etask-executor.md'), '# Etask\n');

  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  // QE skill removed
  assert.ok(!fs.existsSync(path.join(skillsDir, 'Qexecute')), 'Qexecute removed');

  // User skill preserved
  assert.ok(fs.existsSync(path.join(skillsDir, 'Querty-notes')), 'user skill Querty-notes preserved');

  // User agent preserved
  assert.ok(fs.existsSync(path.join(agentsDir, 'Estimator.toml')), 'user agent Estimator.toml preserved');
  assert.ok(fs.existsSync(path.join(agentsDir, 'Estimator.md')), 'user agent Estimator.md preserved');

  // config.toml: mcp_servers, projects, env survive; fence stripped
  const configOut = fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
  assert.ok(configOut.includes('[mcp_servers.myServer]'), 'mcp_servers table preserved');
  assert.ok(configOut.includes('[projects."/some/path"]'), 'user projects section preserved');
  assert.ok(configOut.includes('[env]'), 'env section preserved');
  assert.ok(!configOut.includes(QE_FENCE_BEGIN), 'fence begin stripped');
  assert.ok(!configOut.includes(QE_FENCE_END), 'fence end stripped');
});

// ---------------------------------------------------------------------------
// (e) External-owner pointers are not framework cleanup targets.
// ---------------------------------------------------------------------------

test('(e) external-owner pointer skill is preserved after purge', (t) => {
  const homeDir = makeHome({
    skills: ['Qdesign', 'Qexecute'],
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const result = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });
  const skillsDir = path.join(homeDir, '.codex', 'skills');

  assert.ok(!fs.existsSync(path.join(skillsDir, 'Qexecute')), 'current framework skill removed');
  assert.ok(fs.existsSync(path.join(skillsDir, 'Qdesign')), 'external qe-mcp-owned skill preserved');
  assert.equal(
    result.skills.some((p) => p.endsWith(`${path.sep}Qdesign`)),
    false,
    'external pointer omitted from cleanup result',
  );
});

// ---------------------------------------------------------------------------
// (f) Manifest-absent QE-like prefix user skill preserved (no SKILL.md check needed,
//     but also not in manifest -> preserved regardless).
// ---------------------------------------------------------------------------

test('(e) skill with QE-like prefix NOT in manifest is preserved', (t) => {
  const homeDir = makeHome({
    skills: ['Qexecute'], // in manifest
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const skillsDir = path.join(homeDir, '.codex', 'skills');
  // Skill with QE-like prefix but NOT in manifest — has SKILL.md
  const notInManifest = path.join(skillsDir, 'Manage-budget');
  fs.mkdirSync(notInManifest, { recursive: true });
  fs.writeFileSync(path.join(notInManifest, 'SKILL.md'), '# not QE\n');

  // No fence, no agents needed
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), '# empty\n', 'utf8');

  const result = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  // Only Qexecute should be in removal list
  assert.equal(result.skills.length, 1, 'only 1 skill (in manifest) targeted');
  assert.ok(result.skills[0].includes('Qexecute'), 'targeted skill is Qexecute');

  // Manage-budget must still exist
  assert.ok(fs.existsSync(notInManifest), 'Manage-budget skill preserved');
  assert.ok(!fs.existsSync(path.join(skillsDir, 'Qexecute')), 'Qexecute removed');
});

// ---------------------------------------------------------------------------
// (f) Agent NOT in fence is preserved, even with E* prefix.
// ---------------------------------------------------------------------------

test('(f) agent with E* prefix but NOT in fence is preserved', (t) => {
  const homeDir = makeHome({
    agentNames: ['Etask-executor', 'Estimator'],
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const agentsDir = path.join(homeDir, '.codex', 'agents');
  // Fence only lists Etask-executor
  const configToml = [
    QE_FENCE_BEGIN,
    `\n[agents."Etask-executor"]\ndescription = "test"\nconfig_file = "${agentsDir}/Etask-executor.toml"`,
    QE_FENCE_END,
  ].join('\n');
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  // Etask-executor removed
  assert.ok(!fs.existsSync(path.join(agentsDir, 'Etask-executor.toml')), 'Etask-executor.toml removed');
  // Estimator preserved (not in fence)
  assert.ok(fs.existsSync(path.join(agentsDir, 'Estimator.toml')), 'Estimator.toml preserved');
  assert.ok(fs.existsSync(path.join(agentsDir, 'Estimator.md')), 'Estimator.md preserved');
});

// ---------------------------------------------------------------------------
// (g) Dry-run: writes a receipt and deletes NOTHING.
// ---------------------------------------------------------------------------

test('(g) dry-run writes receipt but deletes nothing', (t) => {
  const homeDir = makeHome({
    skills: ['Qexecute', 'Qcommit'],
    agentNames: ['Edeep-researcher'],
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const agentsDir = path.join(homeDir, '.codex', 'agents');
  const configToml = buildConfigWithFence([{ name: 'Edeep-researcher', agentsDir }]);
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  // Default: dryRun=true, purge=false
  const result = cleanupCodexAssets({ homeDir, log: () => {} });

  assert.equal(result.dryRun, true, 'result reports dry-run');
  assert.equal(result.configEdited, false, 'config not modified in dry-run');

  // Skills still exist
  assert.ok(fs.existsSync(path.join(homeDir, '.codex', 'skills', 'Qexecute')), 'Qexecute NOT deleted in dry-run');
  assert.ok(fs.existsSync(path.join(homeDir, '.codex', 'skills', 'Qcommit')), 'Qcommit NOT deleted in dry-run');

  // Agent files still exist
  assert.ok(fs.existsSync(path.join(agentsDir, 'Edeep-researcher.toml')), 'agent toml NOT deleted in dry-run');

  // config.toml unchanged
  const configText = fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
  assert.ok(configText.includes(QE_FENCE_BEGIN), 'fence still present in dry-run');

  // Receipt file written
  assert.ok(result.receiptPath, 'receipt path returned');
  assert.ok(fs.existsSync(result.receiptPath), 'dry-run receipt file exists');
  const receiptData = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
  assert.equal(receiptData.mode, 'dry-run', 'receipt mode is dry-run');
  assert.ok(Array.isArray(receiptData.skills), 'receipt has skills array');
  assert.ok(receiptData.skills.length > 0, 'receipt lists would-be-removed skills');
});

// ---------------------------------------------------------------------------
// (h) Purge writes a purge receipt recording what was removed.
// ---------------------------------------------------------------------------

test('(h) purge writes receipt with removed items', (t) => {
  const homeDir = makeHome({
    skills: ['Qsecret'],
    agentNames: ['Ecommit-executor'],
  });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const agentsDir = path.join(homeDir, '.codex', 'agents');
  const configToml = buildConfigWithFence([{ name: 'Ecommit-executor', agentsDir }]);
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  const result = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  assert.equal(result.dryRun, false, 'purge mode');
  assert.ok(result.receiptPath, 'receipt path returned');
  assert.ok(fs.existsSync(result.receiptPath), 'purge receipt file exists');

  const receiptData = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
  assert.equal(receiptData.mode, 'purge', 'receipt mode is purge');
  assert.ok(receiptData.skills.length > 0, 'receipt lists removed skills');
  assert.ok(receiptData.agents.length > 0, 'receipt lists removed agents');
  assert.equal(receiptData.configFenceStripped, true, 'receipt marks fence stripped');
  assert.ok(receiptData.configBackup, 'receipt records config backup path');
});

// ---------------------------------------------------------------------------
// Regression: uninstallClaudeAssets() still works unchanged (no codex side effects
// when purgeCodex is not set).
// ---------------------------------------------------------------------------

test('regression: uninstallClaudeAssets() dry run runs without error', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-codex-reg-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  // No .codex, no .claude — should not throw
  assert.doesNotThrow(() => {
    uninstallClaudeAssets({ homeDir, log: () => {} });
  }, 'uninstallClaudeAssets should not throw with empty homeDir');
});

test('regression: uninstallClaudeAssets() with purgeCodex=false leaves codex untouched', (t) => {
  const homeDir = makeHome({ skills: ['Qexecute'] });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), '# clean\n', 'utf8');

  // purgeCodex=false (default) -> Codex assets should remain
  uninstallClaudeAssets({ homeDir, purgeCodex: false, log: () => {} });

  assert.ok(
    fs.existsSync(path.join(homeDir, '.codex', 'skills', 'Qexecute')),
    'Qexecute skill preserved when purgeCodex=false'
  );
});

// ---------------------------------------------------------------------------
// (i) Security: a tampered fence config_file pointing OUTSIDE ~/.codex must NOT
//     delete the out-of-tree victim. Boundary guard confines deletes to .codex.
// ---------------------------------------------------------------------------

test('(i) out-of-tree config_file is refused — victim outside ~/.codex survives purge', (t) => {
  const homeDir = makeHome({ agentNames: [] });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  // Victim lives OUTSIDE the codex tree.
  const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-victim-'));
  t.after(() => fs.rmSync(victimDir, { recursive: true, force: true }));
  const victimToml = path.join(victimDir, 'important.toml');
  const victimMd = path.join(victimDir, 'important.md');
  fs.writeFileSync(victimToml, 'do-not-delete\n');
  fs.writeFileSync(victimMd, 'do-not-delete\n');

  // Fence whose config_file escapes ~/.codex.
  const configToml = [
    QE_FENCE_BEGIN,
    `\n[agents."important"]\ndescription = "evil"\nconfig_file = "${victimToml}"`,
    QE_FENCE_END,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), configToml, 'utf8');

  const result = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  assert.ok(fs.existsSync(victimToml), 'out-of-tree victim .toml must survive');
  assert.ok(fs.existsSync(victimMd), 'out-of-tree victim .md must survive');
  assert.equal(result.agents.length, 0, 'no out-of-tree agent path should be queued for removal');
});
