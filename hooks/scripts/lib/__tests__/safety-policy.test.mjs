import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PRE = join(ROOT, 'hooks', 'scripts', 'pre-tool-use.mjs');
const fixtures = [];

function fixture(hooks = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'qe-safety-policy-'));
  fixtures.push(cwd);
  mkdirSync(join(cwd, '.qe'), { recursive: true });
  writeFileSync(join(cwd, '.qe', 'config.json'), JSON.stringify({ hooks }));
  return cwd;
}

function invoke(cwd, toolName, toolInput) {
  return spawnSync(process.execPath, [PRE], {
    cwd: ROOT,
    input: JSON.stringify({ cwd, client: 'claude', session_id: 'safety-session', tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8', timeout: 30_000,
  });
}

test.after(() => {
  for (const cwd of fixtures.reverse()) rmSync(cwd, { recursive: true, force: true });
});

test('profiles and user overrides cannot disable safety or response style invariants', () => {
  for (const hook_profile of ['minimal', 'safe', 'full']) {
    const cwd = fixture({ hook_profile, style_gate: false, safety_kernel: false, response_style: false });
    const config = loadConfig(cwd);
    assert.equal(config.hook_profile, hook_profile);
    assert.equal(config.safety_kernel, true);
    assert.equal(config.response_style, true);
    assert.equal(config.style_gate, true);
  }
});

test('minimal profile still blocks raw commits and direct version edits', () => {
  const cwd = fixture({ hook_profile: 'minimal' });
  const commit = invoke(cwd, 'Bash', { command: 'git commit -m unsafe' });
  assert.equal(commit.status, 2, `${commit.stdout}${commit.stderr}`);
  assert.match(`${commit.stdout}${commit.stderr}`, /Qcommit/);

  const version = invoke(cwd, 'Edit', { file_path: join(cwd, 'package.json'), old_string: '"version":"1"', new_string: '"version":"2"' });
  assert.equal(version.status, 2, `${version.stdout}${version.stderr}`);
  assert.match(`${version.stdout}${version.stderr}`, /qe-release-version|Direct version editing/);
});

test('minimal profile still blocks bypass forgery and explicit broad-staging block mode', () => {
  const cwd = fixture({ hook_profile: 'minimal', staging_guard: 'block' });
  const bypass = invoke(cwd, 'Write', { file_path: join(cwd, '.qe', 'state', 'skill-bypass.json'), content: '{}' });
  assert.equal(bypass.status, 2, `${bypass.stdout}${bypass.stderr}`);

  const staging = invoke(cwd, 'Bash', { command: 'git add .' });
  assert.equal(staging.status, 2, `${staging.stdout}${staging.stderr}`);
  assert.match(`${staging.stdout}${staging.stderr}`, /명시 경로|staging/i);
});

test('minimal profile does not block an unrelated harmless command', () => {
  const cwd = fixture({ hook_profile: 'minimal' });
  const result = invoke(cwd, 'Bash', { command: 'pwd' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
