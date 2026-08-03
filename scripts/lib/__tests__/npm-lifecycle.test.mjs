import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  runPackageLifecycle,
  runPackageLifecycleCli,
} from '../../npm-lifecycle.mjs';
import {
  SUPPORTED_PACKAGE_PLATFORMS,
  verifyPackedInstallMatrix,
} from '../../check-packaged-install.mjs';

const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

test('npm install and uninstall lifecycle use a Node entrypoint without a host shell', () => {
  for (const name of ['postinstall', 'preuninstall']) {
    const command = packageJson.scripts[name];
    assert.match(command, /^node \.\/scripts\/package-lifecycle\.mjs /);
    assert.doesNotMatch(command, /\b(?:sh|bash|zsh|cmd|powershell)\b/i);
  }
});

test('postinstall deterministically dispatches both supported client installers', () => {
  const calls = [];
  const result = runPackageLifecycle('postinstall', {
    installClaudeAssets: () => calls.push('claude'),
    installCodexAssets: () => calls.push('codex'),
    uninstallClaudeAssets: () => calls.push('uninstall'),
  });
  assert.deepEqual(calls, ['claude', 'codex']);
  assert.deepEqual(result.invoked, ['installClaudeAssets', 'installCodexAssets']);
});

test('preuninstall dispatches only the supported uninstall operation', () => {
  const calls = [];
  const result = runPackageLifecycle('preuninstall', {
    installClaudeAssets: () => calls.push('claude'),
    installCodexAssets: () => calls.push('codex'),
    uninstallClaudeAssets: () => calls.push('uninstall'),
  });
  assert.deepEqual(calls, ['uninstall']);
  assert.deepEqual(result.invoked, ['uninstallClaudeAssets']);
});

test('unknown lifecycle actions fail closed in the programmatic API', () => {
  assert.throws(() => runPackageLifecycle('publish', {}), /unsupported package lifecycle action/);
});

test('CLI boundary degrades to the documented manual install path', () => {
  const warnings = [];
  const result = runPackageLifecycleCli(['unknown'], (...parts) => warnings.push(parts.join(' ')));
  assert.equal(result.skipped, true);
  assert.match(warnings[0], /lifecycle action/);
});

test('packed install matrix covers darwin, linux, and win32 with one lifecycle contract', () => {
  assert.deepEqual(SUPPORTED_PACKAGE_PLATFORMS, ['darwin', 'linux', 'win32']);
  const provenance = {
    files: [
      { path: 'bin/qe-framework-install.mjs' },
      { path: 'scripts/package-lifecycle.mjs' },
    ],
    installContract: {
      bin: { 'qe-framework-install': './bin/qe-framework-install.mjs' },
      postinstall: packageJson.scripts.postinstall,
      preuninstall: packageJson.scripts.preuninstall,
    },
  };
  assert.equal(verifyPackedInstallMatrix(provenance).ok, true);
  provenance.files = provenance.files.filter(({ path }) => path !== 'scripts/package-lifecycle.mjs');
  const failure = verifyPackedInstallMatrix(provenance);
  assert.equal(failure.ok, false);
  assert.ok(failure.errors.every((error) => error.includes('package lifecycle entrypoint is missing')));
});
