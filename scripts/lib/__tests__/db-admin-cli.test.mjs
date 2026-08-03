import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function run(script, args, cwd) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('qe-schema migrate initializes a fresh project and verify accepts it', () => {
  const root = tempRoot('qe-schema-fresh-');
  try {
    const migrated = run('qe-schema.mjs', ['migrate'], root);
    assert.equal(migrated.status, 0, migrated.stderr);
    const migration = JSON.parse(migrated.stdout);
    assert.equal(migration.databaseSchemaVersion, 4);
    assert.deepEqual(migration.missing, []);
    assert.equal(migration.compatible, true);

    const verified = run('qe-schema.mjs', ['verify'], root);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).compatible, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('qe-inspector help is read-only and works without a store', () => {
  const root = tempRoot('qe-inspector-help-');
  try {
    const helped = run('qe-inspector.mjs', ['--help'], root);
    assert.equal(helped.status, 0, helped.stderr);
    assert.match(helped.stdout, /Usage: node scripts\/qe-inspector\.mjs/);
    assert.equal(existsSync(join(root, '.qe', 'inspector.html')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('schema manifest explicitly covers both the current line and v9', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'core', 'store', 'schema-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.frameworkCompatibility.map((item) => item.framework), ['8.3.x', '9.x']);
  assert.ok(manifest.frameworkCompatibility.every((item) => item.schema === 4));
});
