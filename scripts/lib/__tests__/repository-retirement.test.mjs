import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');

const retiredPaths = [
  'scripts/audit_io.mjs',
  'scripts/audit_skills.mjs',
  'scripts/benchmark-qgen.sh',
  'scripts/run_audit.mjs',
  'scripts/verify-memo.mjs',
  'scripts/lib/artifact_text_normalizer.mjs',
  'scripts/lib/provider_adapters.mjs',
  'scripts/preuninstall.mjs',
  'dist/skills/qe-framework/SKILL.md',
  'dist/skills/qe-framework/assets/example_asset.txt',
  'dist/skills/qe-framework/references/example_reference.md',
  'dist/skills/qe-framework/scripts/example_script.cjs',
];

test('retired scripts and placeholder assets stay absent', () => {
  for (const relativePath of retiredPaths) {
    assert.equal(existsSync(resolve(root, relativePath)), false, `${relativePath} must remain retired`);
  }
});

test('package entrypoints do not name a retired path', () => {
  const manifest = JSON.stringify(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')));
  for (const relativePath of retiredPaths) {
    assert.equal(manifest.includes(relativePath), false, `${relativePath} must not be a package entrypoint`);
  }
});

test('public docs define the supported package boundary and retired-path migration', () => {
  for (const relativePath of ['README.md', 'docs/INSTALL.md']) {
    const content = readFileSync(resolve(root, relativePath), 'utf8');
    assert.match(content, /qe-framework-install/);
    assert.match(content, /qe-framework-uninstall/);
    assert.match(content, /deep paths are internal and unsupported/);
    assert.match(content, /npm run check:all/);
    assert.match(content, /npm run qe:query -- analysis/);
    assert.match(content, /scripts\/preuninstall\.mjs/);
  }
});
