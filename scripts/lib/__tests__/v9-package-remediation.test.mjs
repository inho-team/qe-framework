import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), 'utf8'));
}

test('package policy excludes test trees while preserving runtime assets', () => {
  const pkg = readJson('package.json');
  assert.ok(pkg.files.includes('!**/__tests__/**'));

  const run = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  assert.equal(run.status, 0, run.stderr);
  const [pack] = JSON.parse(run.stdout);
  const paths = pack.files.map(({ path }) => path);
  assert.equal(paths.some((path) => path.includes('/__tests__/')), false);
  for (const required of [
    '.claude-plugin/plugin.json',
    'hooks/scripts/lib/store-sqlite.mjs',
    'scripts/qe-release-admin.mjs',
    'skills/Qplan/SKILL.md',
  ]) assert.ok(paths.includes(required), `missing runtime asset: ${required}`);
});

test('lockfile is reproducible and aligned with package metadata', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  assert.ok(lock.lockfileVersion >= 3);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.packages[''].optionalDependencies.playwright, pkg.optionalDependencies.playwright);
  assert.equal(pkg.engines.node, '>=22.5.0');
  assert.equal(lock.packages[''].engines.node, pkg.engines.node);
});

test('v9 distribution ownership is explicit and does not imply public npm publication', () => {
  const install = readFileSync(resolve(ROOT, 'docs/INSTALL.md'), 'utf8');
  assert.match(install, /supported public distribution channel is the GitHub-backed Claude\s+marketplace/i);
  assert.match(install, /public npm registry is optional/i);
  assert.match(install, /explicit release decision/i);
});
