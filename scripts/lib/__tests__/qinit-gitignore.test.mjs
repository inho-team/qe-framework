import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('Qinit gitignore template includes local collected skills using a separate fixture', () => {
  const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const qinit = readFileSync(join(repoRoot, 'skills', 'Qinit', 'SKILL.md'), 'utf8');
  const match = qinit.match(/```gitignore\n([\s\S]*?)```/);
  assert.ok(match, 'Qinit gitignore block exists');
  assert.match(match[1], /^\.claude\/skills\/$/m);

  const dir = mkdtempSync(join(tmpdir(), 'qe-qinit-gitignore-'));
  try {
    writeFileSync(join(dir, '.gitignore'), match[1], 'utf8');
    const fixtureGitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.match(fixtureGitignore, /^\.claude\/skills\/$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
