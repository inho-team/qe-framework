import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approveContract } from '../../qe-contract.mjs';
import { bumpVersion } from '../../qe-release-admin.mjs';

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

test('contract admin promotes pending content and records its approval', () => {
  const root = tempRoot('qe-contract-admin-');
  try {
    write(join(root, '.qe/contracts/pending/payments.md'), '# Payments\n');
    const result = approveContract('payments', 'reviewed by owner', root);
    assert.match(result.hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(readFileSync(join(root, '.qe/contracts/active/payments.md'), 'utf8'), '# Payments\n');
    const lock = JSON.parse(readFileSync(join(root, '.qe/contracts/.lock'), 'utf8'));
    assert.equal(lock.payments.reason, 'reviewed by owner');
    assert.throws(() => approveContract('payments', 'again', root), /Pending contract not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release admin keeps all version manifests aligned', () => {
  const root = tempRoot('qe-release-admin-');
  try {
    write(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
    write(join(root, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.0.0"}}}\n');
    write(join(root, '.claude-plugin/plugin.json'), '{"name":"qe-framework","version":"1.0.0"}\n');
    write(join(root, '.claude-plugin/marketplace.json'), '{"plugins":[{"name":"qe-framework","version":"1.0.0"}]}\n');
    write(join(root, 'core/store/schema-manifest.json'), '{"currentSchemaVersion":4,"frameworkCompatibility":[{"framework":"2.x","schema":4,"minReadable":1}]}\n');
    assert.equal(bumpVersion('2.3.4-rc.1', root), '2.3.4-rc.1');
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.3.4-rc.1');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'))).version, '2.3.4-rc.1');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'))).plugins[0].version, '2.3.4-rc.1');
    assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'))).version, '2.3.4-rc.1');
    assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages[''].version, '2.3.4-rc.1');
    assert.throws(() => bumpVersion('v2', root), /Invalid semantic version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release admin rejects a version outside the declared store compatibility before writing', () => {
  const root = tempRoot('qe-release-schema-guard-');
  try {
    write(join(root, 'package.json'), '{"name":"fixture","version":"8.3.0"}\n');
    write(join(root, 'package-lock.json'), '{"name":"fixture","version":"8.3.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"8.3.0"}}}\n');
    write(join(root, '.claude-plugin/plugin.json'), '{"name":"qe-framework","version":"8.3.0"}\n');
    write(join(root, '.claude-plugin/marketplace.json'), '{"plugins":[{"name":"qe-framework","version":"8.3.0"}]}\n');
    write(join(root, 'core/store/schema-manifest.json'), '{"currentSchemaVersion":4,"frameworkCompatibility":[{"framework":"8.3.x","schema":4,"minReadable":1}]}\n');

    assert.throws(() => bumpVersion('9.0.0', root), /not covered by core\/store\/schema-manifest\.json/);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '8.3.0');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'))).version, '8.3.0');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'))).plugins[0].version, '8.3.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release admin rejects stale lock metadata before writing any manifest', () => {
  const root = tempRoot('qe-release-lock-guard-');
  try {
    write(join(root, 'package.json'), '{"name":"fixture","version":"8.3.0"}\n');
    write(join(root, 'package-lock.json'), '{"name":"fixture","version":"8.2.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"8.2.0"}}}\n');
    write(join(root, '.claude-plugin/plugin.json'), '{"name":"qe-framework","version":"8.3.0"}\n');
    write(join(root, '.claude-plugin/marketplace.json'), '{"plugins":[{"name":"qe-framework","version":"8.3.0"}]}\n');
    write(join(root, 'core/store/schema-manifest.json'), '{"currentSchemaVersion":4,"frameworkCompatibility":[{"framework":"8.x","schema":4,"minReadable":1}]}\n');

    assert.throws(() => bumpVersion('8.4.0', root), /package-lock\.json root metadata/);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '8.3.0');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'))).version, '8.3.0');
    assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'))).plugins[0].version, '8.3.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('contract admin rolls promotion back when lock update fails', () => {
  const root = tempRoot('qe-contract-rollback-');
  try {
    write(join(root, '.qe/contracts/pending/orders.md'), '# Orders\n');
    write(join(root, '.qe/contracts/.lock'), '{malformed');
    assert.throws(() => approveContract('orders', 'reviewed', root), /Malformed/);
    assert.equal(readFileSync(join(root, '.qe/contracts/pending/orders.md'), 'utf8'), '# Orders\n');
    assert.throws(() => readFileSync(join(root, '.qe/contracts/active/orders.md')), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
