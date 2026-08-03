import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runPackageLifecycle } from '../../package-lifecycle.mjs';
import {
  SUPPORTED_PACKAGE_PLATFORMS,
  verifyPackedInstallMatrix,
} from '../../check-packaged-install.mjs';

const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

test('npm lifecycle commands are host-neutral Node entrypoints', () => {
  assert.equal(packageJson.scripts.postinstall, 'node ./scripts/package-lifecycle.mjs postinstall installClaudeAssets installCodexAssets');
  assert.equal(packageJson.scripts.preuninstall, 'node ./scripts/package-lifecycle.mjs preuninstall uninstallClaudeAssets');
  assert.doesNotMatch(packageJson.scripts.postinstall, /\b(?:sh|bash|zsh|cmd|powershell)\b/i);
  assert.doesNotMatch(packageJson.scripts.preuninstall, /\b(?:sh|bash|zsh|cmd|powershell)\b/i);
});

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`${platform} uses the same deterministic lifecycle dispatcher`, () => {
    const invoked = [];
    const handlers = {
      installClaudeAssets: () => invoked.push('installClaudeAssets'),
      installCodexAssets: () => invoked.push('installCodexAssets'),
      uninstallClaudeAssets: () => invoked.push('uninstallClaudeAssets'),
    };
    assert.deepEqual(runPackageLifecycle('postinstall', handlers), {
      action: 'postinstall', invoked: ['installClaudeAssets', 'installCodexAssets'],
    });
    assert.deepEqual(runPackageLifecycle('preuninstall', handlers), {
      action: 'preuninstall', invoked: ['uninstallClaudeAssets'],
    });
    assert.deepEqual(invoked, [
      'installClaudeAssets', 'installCodexAssets', 'uninstallClaudeAssets',
    ]);
    assert.ok(SUPPORTED_PACKAGE_PLATFORMS.includes(platform));
  });
}

test('unknown lifecycle action fails before invoking installer handlers', () => {
  const invoked = [];
  const handlers = {
    installClaudeAssets: () => invoked.push('installClaudeAssets'),
    installCodexAssets: () => invoked.push('installCodexAssets'),
    uninstallClaudeAssets: () => invoked.push('uninstallClaudeAssets'),
  };
  assert.throws(() => runPackageLifecycle('publish', handlers), /unsupported package lifecycle action/);
  assert.deepEqual(invoked, []);
});

test('packed-install matrix accepts all declared platforms with the Node lifecycle', () => {
  const provenance = {
    files: [
      { path: 'bin/qe-framework-install.mjs' },
      { path: 'bin/qe-framework-uninstall.mjs' },
      { path: 'scripts/package-lifecycle.mjs' },
    ],
    installContract: {
      bin: packageJson.bin,
      postinstall: packageJson.scripts.postinstall,
      preuninstall: packageJson.scripts.preuninstall,
    },
  };
  const result = verifyPackedInstallMatrix(provenance);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.results.map(({ platform }) => platform), ['darwin', 'linux', 'win32']);
});
