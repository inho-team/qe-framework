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
  const scriptsDir = path.join(codexDir, 'scripts');
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
  // Symmetry guard: non-skill files are not copied as skills.
  assert.ok(!fs.existsSync(path.join(skillsDir, 'CATALOG.md')), 'CATALOG.md not installed as a skill');
  assert.ok(
    !fs.existsSync(path.join(skillsDir, 'coding-experts')),
    'coding-experts catalog is not installed after hard prune',
  );

  // Agents: must have .toml files
  assert.ok(fs.existsSync(agentsDir), '~/.codex/agents/ created');
  const tomlFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.toml'));
  assert.ok(tomlFiles.length > 0, 'at least one agent .toml installed');

  assert.ok(fs.existsSync(scriptsDir), '~/.codex/scripts/ created');
  // Each .toml must contain name, model routing when source metadata exists,
  // compatibility note, and developer_instructions.
  for (const toml of tomlFiles.slice(0, 3)) {
    const content = fs.readFileSync(path.join(agentsDir, toml), 'utf8');
    assert.ok(content.includes('name ='), `${toml} contains name field`);
    assert.ok(content.includes('sandbox_mode = "workspace-write"'), `${toml} contains sandbox_mode`);
    assert.ok(content.includes('developer_instructions = """'), `${toml} contains developer_instructions`);
    assert.ok(content.includes('# Codex Native Agent Compatibility'), `${toml} contains compatibility note`);
    assert.ok(content.includes('role-separated inline execution'), `${toml} explains inline fallback`);
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

test('(b2) reinstall removes stray duplicate QE agent sections', (t) => {
  const staleConfig = [
    'model = "gpt-5"',
    '',
    '[agents."Ecode-reviewer"]',
    'description = "stale"',
    'config_file = "/tmp/stale.toml"',
    '',
    QE_FENCE_BEGIN,
    '',
    '[agents."Ecode-reviewer"]',
    'description = "old fenced"',
    'config_file = "/tmp/old.toml"',
    '',
    QE_FENCE_END,
  ].join('\n');
  const homeDir = makeCodexHome({ configToml: staleConfig });
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  const configContent = fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
  const matches = configContent.match(/\[agents\."Ecode-reviewer"\]/g) || [];
  assert.equal(matches.length, 1, 'exactly one Ecode-reviewer section remains');
  assert.ok(!configContent.includes('/tmp/stale.toml'), 'stray stale QE agent section removed');
  assert.ok(!configContent.includes('/tmp/old.toml'), 'old fenced QE agent section removed');
});

test('(b3) reinstall purges legacy QE skills before copying current assets', (t) => {
  const homeDir = makeCodexHome();
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  const legacyDir = path.join(homeDir, '.codex', 'skills', 'Mrelease');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'SKILL.md'), 'legacy release skill', 'utf8');

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  assert.ok(!fs.existsSync(legacyDir), 'legacy Mrelease skill removed during reinstall');
  assert.ok(fs.existsSync(path.join(homeDir, '.codex', 'skills', 'Qupdate')), 'current Qupdate skill installed');
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

test('(g) Codex agent renderer preserves metadata hints and escapes TOML strings', (t) => {
  const homeDir = makeCodexHome();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-agent-renderer-repo-'));
  t.after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  const agentsDir = path.join(repoRoot, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'Equote-agent.md'), [
    '---',
    'name: Equote-agent',
    'description: "Agent with \\"quoted\\" metadata and paths C:\\\\tmp"',
    'tools: Read, Bash',
    'recommendedModel: haiku',
    '---',
    '',
    '# Equote-agent',
    '',
    'Use the Agent tool only on Claude.',
    'Literal triple double quote: """',
    "Literal triple single quote: '''",
    'Windows path: C:\\tmp\\agent',
    '',
  ].join('\n'), 'utf8');

  installCodexAssets({ repoRoot, homeDir, log: () => {}, syncManifest: false });

  const tomlPath = path.join(homeDir, '.codex', 'agents', 'Equote-agent.toml');
  assert.ok(fs.existsSync(tomlPath), 'custom agent TOML created');
  const content = fs.readFileSync(tomlPath, 'utf8');

  assert.ok(content.includes('name = "Equote-agent"'), 'name rendered');
  assert.ok(content.includes('description = "'), 'description rendered');
  assert.ok(content.includes('\\\\\\"quoted\\\\\\"'), 'description quotes escaped');
  assert.ok(content.includes('C:\\\\\\\\tmp'), 'description backslashes escaped');
  assert.ok(content.includes('model = "gpt-5.3-codex-spark"'), 'haiku maps to Codex spark model');
  assert.ok(content.includes('model_reasoning_effort = "low"'), 'haiku maps to low reasoning effort');
  // Codex strict-deserializes role TOML and rejects unknown top-level keys, so
  // source hints are mirrored in developer_instructions instead of qe_* keys.
  assert.ok(!content.includes('qe_model_hint'), 'no unknown top-level model hint key');
  assert.ok(!content.includes('qe_reasoning_effort_hint'), 'no unknown top-level effort hint key');
  assert.ok(!content.includes('qe_tools_hint'), 'no unknown top-level tools hint key');
  assert.ok(content.includes('Source recommendedModel hint: `haiku`'), 'model hint in note');
  assert.ok(content.includes('Source reasoning effort hint: `low`'), 'effort hint inferred in note');
  assert.ok(content.includes('Codex model routing: `gpt-5.3-codex-spark` with effort `low`.'), 'Codex routing note included');
  assert.ok(content.includes('Source tool/MCP hint: `Read, Bash`'), 'tools hint in note');
  assert.ok(content.includes('developer_instructions = """'), 'uses TOML multiline basic string');
  assert.ok(content.includes('Literal triple double quote: \\"\\"\\"'), 'triple double quote escaped');
  assert.ok(content.includes("Literal triple single quote: '''"), 'triple single quote preserved safely');
  assert.ok(content.includes('Windows path: C:\\\\tmp\\\\agent'), 'backslashes escaped');
  assert.ok(content.includes('role-separated inline execution'), 'compatibility note included');
});

test('(g2) Codex agent renderer maps Claude model tiers to Codex model routing', (t) => {
  const homeDir = makeCodexHome();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-agent-routing-repo-'));
  t.after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  const agentsDir = path.join(repoRoot, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const [name, model] of [
    ['Ehaiku', 'haiku'],
    ['Esonnet', 'sonnet'],
    ['Eopus', 'opus'],
  ]) {
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), [
      '---',
      `name: ${name}`,
      `description: ${name}`,
      `recommendedModel: ${model}`,
      '---',
      '',
      `# ${name}`,
      '',
    ].join('\n'), 'utf8');
  }

  installCodexAssets({ repoRoot, homeDir, log: () => {}, syncManifest: false });

  const haiku = fs.readFileSync(path.join(homeDir, '.codex', 'agents', 'Ehaiku.toml'), 'utf8');
  const sonnet = fs.readFileSync(path.join(homeDir, '.codex', 'agents', 'Esonnet.toml'), 'utf8');
  const opus = fs.readFileSync(path.join(homeDir, '.codex', 'agents', 'Eopus.toml'), 'utf8');

  assert.ok(haiku.includes('model = "gpt-5.3-codex-spark"'), 'haiku maps to spark');
  assert.ok(haiku.includes('model_reasoning_effort = "low"'), 'haiku maps to low effort');
  assert.ok(sonnet.includes('model = "gpt-5.4-mini"'), 'sonnet maps to standard Codex model');
  assert.ok(sonnet.includes('model_reasoning_effort = "medium"'), 'sonnet maps to medium effort');
  assert.ok(opus.includes('model = "gpt-5.4"'), 'opus maps to frontier Codex model');
  assert.ok(opus.includes('model_reasoning_effort = "high"'), 'opus maps to high effort');
});

test('(h) Codex skill install compacts long descriptions without changing source or body', (t) => {
  const homeDir = makeCodexHome();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-skill-compact-repo-'));
  t.after(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  const skillDir = path.join(repoRoot, 'skills', 'Qlong-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  const sourceSkill = [
    '---',
    'name: Qlong-skill',
    'description: This skill has a deliberately verbose description with many implementation details, routing hints, examples, caveats, distinctions from adjacent skills, and extra prose that would otherwise consume too much Codex skill context budget. Use when testing Codex skill installer compaction, validating context budget behavior, or preserving routing triggers while shortening metadata.',
    '---',
    '',
    '# Qlong-skill',
    '',
    'Body content must remain intact.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), sourceSkill, 'utf8');

  const logs = [];
  installCodexAssets({ repoRoot, homeDir, log: (line) => logs.push(line), syncManifest: false });

  const installed = fs.readFileSync(path.join(homeDir, '.codex', 'skills', 'Qlong-skill', 'SKILL.md'), 'utf8');
  const sourceAfter = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const desc = installed.match(/^description:\s*(.+)$/m)?.[1] || '';

  assert.equal(sourceAfter, sourceSkill, 'source skill is unchanged');
  assert.ok(desc.length <= 235, 'installed description line is compact');
  assert.ok(desc.includes('Use when testing Codex skill installer compaction'), 'routing trigger is preserved');
  assert.ok(installed.includes('Body content must remain intact.'), 'skill body is preserved');
  assert.ok(
    logs.includes('[codex-install] compacted 1 Codex skill description(s) for context budget.'),
    'compaction log emitted',
  );
});

test('(i) delegating PSE skills document Codex native client-adapter behavior', () => {
  const qcommit = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'Qcommit', 'SKILL.md'), 'utf8');
  const qcodeRunTask = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'Qcode-run-task', 'SKILL.md'), 'utf8');
  const qcriticalReview = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'Qcritical-review', 'SKILL.md'), 'utf8');

  assert.ok(qcommit.includes('Codex native'), 'Qcommit documents Codex native path');
  assert.ok(qcommit.includes('role-separated inline'), 'Qcommit documents inline fallback');
  assert.ok(qcommit.includes('Ecommit-executor'), 'Qcommit keeps Ecommit-executor delegation');

  assert.ok(qcodeRunTask.includes('Codex native'), 'Qcode-run-task documents Codex native path');
  assert.ok(qcodeRunTask.includes('role-separated inline'), 'Qcode-run-task documents inline fallback');
  assert.ok(qcodeRunTask.includes('Eqa-orchestrator'), 'Qcode-run-task keeps Claude orchestrator path');

  assert.ok(qcriticalReview.includes('Codex native'), 'Qcritical-review documents Codex native path');
  assert.ok(qcriticalReview.includes('role-separated inline'), 'Qcritical-review documents inline fallback');
  assert.ok(qcriticalReview.includes('role-separated inline passes'), 'Qcritical-review documents inline reviewer fallback');
});
