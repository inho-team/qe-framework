/**
 * codex-install.test.mjs
 * Integration tests for installCodexAssets() using fresh temp homeDir(s).
 * NEVER touches the real ~/.codex or ~/.claude — all tests use mkdtempSync-based homes.
 * Run with: node --test scripts/lib/__tests__/codex-install.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installCodexAssets, installClaudeAssets, cleanupCodexAssets } from '../client_installers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root: scripts/lib/__tests__ -> ../../.. -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const QE_FENCE_BEGIN = '# QE Framework Agent Configuration — managed by qe-framework installer';
const QE_FENCE_END = '# End QE Framework Agent Configuration';

/** Create a temp homeDir with ~/.codex pre-existing (simulates a Codex user). */
function makeCodexHome(opts = {}) {
  const { configToml = null } = opts;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-install-'));
  const codexDir = path.join(homeDir, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  if (configToml !== null) {
    fs.writeFileSync(path.join(codexDir, 'config.toml'), configToml, 'utf8');
  }
  return homeDir;
}

/** Create a temp homeDir WITHOUT ~/.codex (simulates a non-Codex user). */
function makeEmptyHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qe-install-no-codex-'));
}

// ---------------------------------------------------------------------------
// (a) install into a temp HOME that HAS ~/.codex → skills + agents + config fence
// ---------------------------------------------------------------------------

test('(a) install into existing ~/.codex: skills, agent tomls, and config fence all present', (t) => {
  const homeDir = makeCodexHome();
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const result = installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  assert.equal(result.skipped, false, 'should not skip when ~/.codex exists');
  assert.equal(result.dryRun, false, 'not a dry run');

  const codexDir = path.join(homeDir, '.codex');
  const skillsDir = path.join(codexDir, 'skills');
  const agentsDir = path.join(codexDir, 'agents');
  const configPath = path.join(codexDir, 'config.toml');

  // Skills dir must exist with at least some skills
  assert.ok(fs.existsSync(skillsDir), '~/.codex/skills/ created');
  const installedSkills = fs.readdirSync(skillsDir);
  assert.ok(installedSkills.length > 0, 'at least one skill installed');

  // Verify a well-known REAL skill (dir with SKILL.md) is present.
  const repoSkillsDir = path.join(REPO_ROOT, 'skills');
  if (fs.existsSync(repoSkillsDir)) {
    const firstRealSkill = fs.readdirSync(repoSkillsDir).find((e) => {
      try {
        return fs.lstatSync(path.join(repoSkillsDir, e)).isDirectory()
          && fs.existsSync(path.join(repoSkillsDir, e, 'SKILL.md'));
      } catch { return false; }
    });
    if (firstRealSkill) {
      assert.ok(
        fs.existsSync(path.join(skillsDir, firstRealSkill)),
        `real skill ${firstRealSkill} present under ~/.codex/skills`
      );
    }
  }
  // Symmetry guard: non-skill entries (CATALOG.md, coding-experts) must NOT be
  // installed — install copies only real skill dirs so uninstall leaves nothing.
  assert.ok(!fs.existsSync(path.join(skillsDir, 'CATALOG.md')), 'CATALOG.md not installed as a skill');

  // Agents: must have .toml files
  assert.ok(fs.existsSync(agentsDir), '~/.codex/agents/ created');
  const tomlFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.toml'));
  assert.ok(tomlFiles.length > 0, 'at least one agent .toml installed');

  // Each .toml must contain name and developer_instructions
  for (const toml of tomlFiles.slice(0, 3)) {
    const content = fs.readFileSync(path.join(agentsDir, toml), 'utf8');
    assert.ok(content.includes('name ='), `${toml} contains name field`);
    assert.ok(content.includes("developer_instructions = '''"), `${toml} contains developer_instructions`);
  }

  // config.toml must have exactly ONE QE fence
  assert.ok(fs.existsSync(configPath), 'config.toml created');
  const configContent = fs.readFileSync(configPath, 'utf8');
  const beginCount = (configContent.match(new RegExp(QE_FENCE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const endCount = (configContent.match(new RegExp(QE_FENCE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(beginCount, 1, 'config.toml has exactly 1 QE_FENCE_BEGIN');
  assert.equal(endCount, 1, 'config.toml has exactly 1 QE_FENCE_END');

  // Fence must contain agent entries
  assert.ok(configContent.includes('[agents.'), 'config fence contains agent entries');
});

// ---------------------------------------------------------------------------
// (b) idempotent: run install twice → exactly ONE fence, no duplicate errors
// ---------------------------------------------------------------------------

test('(b) idempotent: install twice → exactly one fence, no duplicate skill dirs', (t) => {
  const homeDir = makeCodexHome();
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });
  // Second install — must not crash and must not duplicate the fence
  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  const configPath = path.join(homeDir, '.codex', 'config.toml');
  const configContent = fs.readFileSync(configPath, 'utf8');

  const beginCount = (configContent.match(new RegExp(QE_FENCE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const endCount = (configContent.match(new RegExp(QE_FENCE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(beginCount, 1, 'after 2 installs: exactly 1 QE_FENCE_BEGIN');
  assert.equal(endCount, 1, 'after 2 installs: exactly 1 QE_FENCE_END');

  // Skills: no error thrown means overwrite succeeded (files should still be present)
  const skillsDir = path.join(homeDir, '.codex', 'skills');
  assert.ok(fs.existsSync(skillsDir), '~/.codex/skills/ still exists after second install');
});

// ---------------------------------------------------------------------------
// (c) graceful skip: temp HOME with NO ~/.codex → creates nothing, no throw
// ---------------------------------------------------------------------------

test('(c) graceful skip: no ~/.codex → installCodexAssets creates nothing and does not throw', (t) => {
  const homeDir = makeEmptyHome();
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  let result;
  assert.doesNotThrow(() => {
    result = installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });
  }, 'installCodexAssets must not throw when ~/.codex is absent');

  assert.equal(result.skipped, true, 'result.skipped must be true');
  // ~/.codex must NOT have been created
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex')), '~/.codex was NOT created');
});

// ---------------------------------------------------------------------------
// (d) round-trip: install → cleanupCodexAssets({purge:true}) → QE assets gone
// ---------------------------------------------------------------------------

test('(d) round-trip: install then purge removes QE skills and fence', (t) => {
  const homeDir = makeCodexHome();
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  // Verify install happened
  const skillsDir = path.join(homeDir, '.codex', 'skills');
  const configPath = path.join(homeDir, '.codex', 'config.toml');
  assert.ok(fs.existsSync(skillsDir), 'skills dir exists after install');
  assert.ok(fs.readFileSync(configPath, 'utf8').includes(QE_FENCE_BEGIN), 'fence present after install');

  // Now cleanup
  const cleanResult = cleanupCodexAssets({ homeDir, purge: true, log: () => {} });
  assert.equal(cleanResult.dryRun, false, 'cleanup ran in purge mode');

  // QE fence must be gone
  const configAfter = fs.readFileSync(configPath, 'utf8');
  assert.ok(!configAfter.includes(QE_FENCE_BEGIN), 'fence removed after purge');
  assert.ok(!configAfter.includes(QE_FENCE_END), 'fence end removed after purge');

  // QE skills must be gone (those that were in manifest and had SKILL.md)
  if (fs.existsSync(skillsDir)) {
    const remaining = fs.readdirSync(skillsDir);
    // All remaining entries should NOT be QE-known skills with SKILL.md
    // (Purge is correct if skills listed in cleanResult.skills are absent)
    for (const removed of cleanResult.skills) {
      assert.ok(!fs.existsSync(removed), `purged skill dir not present: ${removed}`);
    }
  }
});

// ---------------------------------------------------------------------------
// (e) preserve: pre-seeded mcp_servers + user section survive alongside QE fence
// ---------------------------------------------------------------------------

test('(e) preserve: mcp_servers and user sections survive fence upsert', (t) => {
  const preExistingConfig = [
    '# user top-level config',
    'model = "gpt-5"',
    '',
    '[mcp_servers.myServer]',
    'command = "node"',
    'args = ["server.js"]',
    '',
    '[projects."/work/myproject"]',
    'trust_level = "trusted"',
    '',
  ].join('\n');

  const homeDir = makeCodexHome({ configToml: preExistingConfig });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  const configContent = fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');

  assert.ok(configContent.includes('[mcp_servers.myServer]'), '[mcp_servers.myServer] preserved');
  assert.ok(configContent.includes('command = "node"'), 'mcp_servers command preserved');
  assert.ok(configContent.includes('[projects."/work/myproject"]'), 'projects section preserved');
  assert.ok(configContent.includes('model = "gpt-5"'), 'top-level user config preserved');
  assert.ok(configContent.includes(QE_FENCE_BEGIN), 'QE fence also present');
  assert.ok(configContent.includes(QE_FENCE_END), 'QE fence end also present');

  // Fence must appear exactly once
  const beginCount = (configContent.match(new RegExp(QE_FENCE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.equal(beginCount, 1, 'exactly one QE fence begin marker');
});

// ---------------------------------------------------------------------------
// (f) no-Claude-regression: installClaudeAssets still works on a temp HOME
// ---------------------------------------------------------------------------

test('(f) no-Claude-regression: installClaudeAssets still operates correctly', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-claude-reg-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  // installClaudeAssets must not throw
  let result;
  assert.doesNotThrow(() => {
    result = installClaudeAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {} });
  }, 'installClaudeAssets must not throw');

  // Result must have expected shape
  assert.ok(typeof result.mode === 'string', 'result.mode is a string');
  assert.ok(typeof result.created === 'number', 'result.created is a number');

  // Skills should be installed under ~/.claude/commands (standalone mode)
  // or plugin path — at minimum the function ran without error
  const claudeDir = path.join(homeDir, '.claude');
  assert.ok(fs.existsSync(claudeDir), '~/.claude directory was created');
});
