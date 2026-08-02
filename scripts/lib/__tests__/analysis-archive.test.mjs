import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const cli = join(repositoryRoot, 'scripts/qe.mjs');

const retired = new Map([
  ['dependencies.json', 'a25f06a931df'],
  ['entry-points.md', '2014f3780c1c'],
  ['file-tree.json', 'f8c9405355b9'],
  ['git-history.json', 'cf75ded4e1c4'],
  ['import-map.json', '24c8fd740f1a'],
  ['project-inventory.json', '0cb6fe186cd6'],
  ['project-map.json', 'da8574e50f04'],
  ['project-structure.md', 'f901e6cc107f'],
  ['project-summary.md', '8d7a9a0bdaac'],
  ['tech-stack.md', '18f3fbd071a6'],
]);

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, '--cwd', root, ...args], { encoding: 'utf8' });
}

test('archive-analysis preserves bytes and fails closed on unsafe input or collisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'qe-analysis-archive-'));
  try {
    mkdirSync(join(root, '.qe/analysis'), { recursive: true });
    writeFileSync(join(root, '.qe/analysis/legacy.md'), '# Legacy\n', 'utf8');
    const archived = run(root, 'archive-analysis', 'legacy.md');
    assert.equal(archived.status, 0, archived.stderr);
    assert.equal(readFileSync(join(root, '.qe/analysis/archive/legacy.md'), 'utf8'), '# Legacy\n');
    assert.throws(() => readFileSync(join(root, '.qe/analysis/legacy.md')), /ENOENT/);

    writeFileSync(join(root, '.qe/analysis/current.md'), '# Current\n', 'utf8');
    writeFileSync(join(root, '.qe/analysis/archive/current.md'), '# Existing\n', 'utf8');
    const collision = run(root, 'archive-analysis', 'current.md');
    assert.notEqual(collision.status, 0);
    assert.equal(readFileSync(join(root, '.qe/analysis/current.md'), 'utf8'), '# Current\n');

    const traversal = run(root, 'archive-analysis', '../outside.md');
    assert.notEqual(traversal.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only the audited legacy records are archived in the repository', () => {
  for (const [name, expectedHashPrefix] of retired) {
    assert.equal(run(repositoryRoot, 'exists', `.qe/analysis/${name}`).stdout.trim(), '0', `${name} must leave the live root`);
    const archived = run(repositoryRoot, 'read', `.qe/analysis/archive/${name}`);
    assert.equal(archived.status, 0, archived.stderr);
    const actualHash = createHash('sha256').update(archived.stdout).digest('hex');
    assert.equal(actualHash.startsWith(expectedHashPrefix), true, `${name} bytes must be preserved`);
  }

  assert.equal(run(repositoryRoot, 'exists', '.qe/analysis/architecture.md').stdout.trim(), '1');
  assert.equal(run(repositoryRoot, 'exists', '.qe/analysis/file-retirement-audit.md').stdout.trim(), '1');
});
