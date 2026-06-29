import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanupCodexAssets, installCodexAssets } from '../client_installers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const QE_AGENT_FENCE_BEGIN = '# QE Framework Agent Configuration — managed by qe-framework installer';
const QE_AGENT_FENCE_END = '# End QE Framework Agent Configuration';
const QE_HOOKS_FENCE_BEGIN = '# QE Framework Hook Configuration — managed by qe-framework installer';
const QE_HOOKS_FENCE_END = '# End QE Framework Hook Configuration';

function makeCodexHome(configToml = '') {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-codex-hooks-'));
  const codexDir = path.join(homeDir, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  if (configToml !== null) {
    fs.writeFileSync(path.join(codexDir, 'config.toml'), configToml, 'utf8');
  }
  return homeDir;
}

function readConfig(homeDir) {
  return fs.readFileSync(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
}

function countNeedle(text, needle) {
  return text.split(needle).length - 1;
}

test('install writes the full Codex lifecycle hook fence with trust guidance and no bypass flag', (t) => {
  const homeDir = makeCodexHome('# user config\n');
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const logs = [];

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: (line) => logs.push(line), syncManifest: false });

  const config = readConfig(homeDir);
  const expectedEntry = path.join(homeDir, '.codex', 'hooks', 'scripts', 'codex', 'lifecycle-codex.mjs');

  assert.ok(config.includes(QE_HOOKS_FENCE_BEGIN), 'hooks fence begin present');
  assert.ok(config.includes(QE_HOOKS_FENCE_END), 'hooks fence end present');
  for (const event of ['SessionStart', 'PreToolUse', 'PreCompact', 'PostToolUse', 'Stop', 'UserPromptSubmit', 'Notification', 'TeammateIdle', 'TaskCompleted']) {
    assert.ok(config.includes(`[[hooks.${event}]]`), `${event} table present`);
    assert.ok(config.includes(`[[hooks.${event}.hooks]]`), `${event} nested hook command table present`);
    assert.ok(config.includes(`\\\"${event}\\\"`) || config.includes(`"${event}"`), `${event} command argument present`);
  }
  assert.ok(config.includes('matcher = "*"'), 'PreToolUse wildcard matcher present');
  assert.ok(config.includes('matcher = "^(Write|Edit|Bash|Shell|shell|exec_command)$"'), 'PostToolUse matcher variants present');
  assert.ok(config.includes('type = "command"'), 'command hook type present');
  assert.ok(config.includes('timeout = 15'), 'PostToolUse timeout present');
  assert.ok(config.includes('statusMessage = "QE safety guard"'), 'PreToolUse status message present');
  assert.ok(config.includes(`node \\\"${expectedEntry}\\\"`), 'command references installed standalone hook path');
  assert.ok(fs.existsSync(expectedEntry), 'standalone Codex lifecycle hook wrapper is installed under ~/.codex/hooks');
  assert.equal(countNeedle(config, '[[hooks.PreToolUse]]'), 1, 'exactly one PreToolUse block');
  assert.equal(countNeedle(config, '[[hooks.'), 18, 'nine hook events and nine nested hook command tables');
  assert.ok(logs.includes('[codex-install] QE hooks installed — run /hooks in Codex to review and approve them.'), 'trust guidance log emitted');
  assert.ok(!config.includes('--dangerously-bypass-hook-trust'), 'does not bypass hook trust');
});

test('repeated install keeps exactly one hooks fence and one lifecycle block per event', (t) => {
  const homeDir = makeCodexHome('# user config\n');
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });
  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });
  let config = readConfig(homeDir);
  assert.equal(countNeedle(config, QE_HOOKS_FENCE_BEGIN), 1, 'one hooks fence after reinstall twice');
  assert.equal(countNeedle(config, '[[hooks.PreToolUse]]'), 1, 'one PreToolUse block after reinstall twice');
  assert.equal(countNeedle(config, '[[hooks.PreToolUse.hooks]]'), 1, 'one nested PreToolUse hook block after reinstall twice');
  assert.equal(countNeedle(config, '[[hooks.TaskCompleted]]'), 1, 'one TaskCompleted block after reinstall twice');
});

test('install migrates deprecated codex_hooks feature flag', (t) => {
  const homeDir = makeCodexHome([
    '[features]',
    'codex_hooks = true',
    '',
  ].join('\n'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const logs = [];

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: (line) => logs.push(line), syncManifest: false });

  const config = readConfig(homeDir);
  assert.ok(config.includes('[features]'), 'features table preserved');
  assert.ok(config.includes('hooks = true'), 'new hooks feature flag present');
  assert.ok(!config.includes('codex_hooks'), 'deprecated codex_hooks flag removed');
  assert.ok(
    logs.includes('[codex-install] migrated deprecated [features].codex_hooks to [features].hooks.'),
    'migration log emitted',
  );
});

test('install removes deprecated codex_hooks when hooks feature flag already exists', (t) => {
  const homeDir = makeCodexHome([
    '[features]',
    'hooks = true',
    'codex_hooks = false',
    '',
  ].join('\n'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  const config = readConfig(homeDir);
  assert.equal(countNeedle(config, 'hooks = true'), 1, 'existing hooks feature flag preserved once');
  assert.ok(!config.includes('codex_hooks'), 'deprecated codex_hooks flag removed');
});

test('install migrates deprecated dotted codex_hooks feature flag', (t) => {
  const homeDir = makeCodexHome('features.codex_hooks = true\n');
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  const config = readConfig(homeDir);
  assert.ok(config.includes('features.hooks = true'), 'new dotted hooks feature flag present');
  assert.ok(!config.includes('features.codex_hooks'), 'deprecated dotted codex_hooks flag removed');
});

test('cleanup removes only QE hooks fence and preserves user config sections', (t) => {
  const preExistingConfig = [
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
  const homeDir = makeCodexHome(preExistingConfig);
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });
  cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  const config = readConfig(homeDir);
  assert.equal(countNeedle(config, QE_HOOKS_FENCE_BEGIN), 0, 'hooks fence removed after cleanup');
  assert.equal(countNeedle(config, QE_HOOKS_FENCE_END), 0, 'hooks fence end removed after cleanup');
  assert.equal(countNeedle(config, '[[hooks.PreToolUse]]'), 0, 'PreToolUse block removed after cleanup');
  assert.ok(!fs.existsSync(path.join(homeDir, '.codex', 'hooks')), 'Codex hook bundle removed after cleanup');
  assert.ok(config.includes('model = "gpt-5"'), 'user model preserved');
  assert.ok(config.includes('[mcp_servers.myServer]'), 'user mcp section preserved');
  assert.ok(config.includes('[projects."/work/myproject"]'), 'user project section preserved');
});

test('agent fence and mcp_servers are preserved alongside hooks fence', (t) => {
  const preExistingConfig = [
    'model = "gpt-5"',
    '',
    '[mcp_servers.myServer]',
    'command = "node"',
    'args = ["server.js"]',
    '',
    QE_AGENT_FENCE_BEGIN,
    '',
    '[agents."ExistingQE"]',
    'description = "old"',
    'config_file = "/tmp/old.toml"',
    '',
    QE_AGENT_FENCE_END,
    '',
    '[projects."/work/myproject"]',
    'trust_level = "trusted"',
    '',
  ].join('\n');
  const homeDir = makeCodexHome(preExistingConfig);
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });

  const config = readConfig(homeDir);
  assert.ok(config.includes('[mcp_servers.myServer]'), 'mcp_servers table preserved');
  assert.ok(config.includes('args = ["server.js"]'), 'mcp_servers args preserved');
  assert.ok(config.includes('[projects."/work/myproject"]'), 'project section preserved');
  assert.ok(config.includes(QE_AGENT_FENCE_BEGIN), 'agent fence present');
  assert.ok(config.includes(QE_AGENT_FENCE_END), 'agent fence end present');
  assert.ok(config.includes(QE_HOOKS_FENCE_BEGIN), 'hooks fence present');
  assert.equal(countNeedle(config, QE_AGENT_FENCE_BEGIN), 1, 'one agent fence');
  assert.equal(countNeedle(config, QE_HOOKS_FENCE_BEGIN), 1, 'one hooks fence');
});

test('round-trip leaves no QE fence and preserves every user-authored line', (t) => {
  const userLines = [
    'model = "gpt-5"',
    '[mcp_servers.myServer]',
    'command = "node"',
    'args = ["server.js"]',
    '[projects."/work/myproject"]',
    'trust_level = "trusted"',
  ];
  const homeDir = makeCodexHome(userLines.join('\n') + '\n');
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));

  installCodexAssets({ repoRoot: REPO_ROOT, homeDir, log: () => {}, syncManifest: false });
  cleanupCodexAssets({ homeDir, purge: true, log: () => {} });

  const after = readConfig(homeDir);
  // No QE-managed content survives the round-trip.
  for (const marker of [QE_AGENT_FENCE_BEGIN, QE_AGENT_FENCE_END, QE_HOOKS_FENCE_BEGIN, QE_HOOKS_FENCE_END, '[[hooks.PreToolUse]]', '[agents."']) {
    assert.equal(countNeedle(after, marker), 0, `no residual QE marker: ${marker}`);
  }
  // Every user-authored line survives byte-for-byte.
  for (const line of userLines) {
    assert.ok(after.includes(line), `user line preserved: ${line}`);
  }
});
