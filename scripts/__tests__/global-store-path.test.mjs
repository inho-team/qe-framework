import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';

import { resolveGlobalQeStorePath } from '../../hooks/scripts/lib/global-store-path.mjs';

test('returns the fixed QE store path below the Node user home', () => {
  const resolved = resolveGlobalQeStorePath();

  assert.equal(resolved, join(homedir(), '.qe', 'qe.db'));
  assert.equal(isAbsolute(resolved), true);
});

test('rejects every non-zero argument count', () => {
  assert.throws(() => resolveGlobalQeStorePath(undefined), TypeError);
  assert.throws(() => resolveGlobalQeStorePath('override'), TypeError);
  assert.throws(() => resolveGlobalQeStorePath(null, 'extra'), TypeError);
});

test('returns the same path from different working directories', { concurrency: false }, () => {
  const originalCwd = process.cwd();
  const first = mkdtempSync(join(tmpdir(), 'qe-global-store-a-'));
  const second = mkdtempSync(join(tmpdir(), 'qe-global-store-b-'));

  try {
    process.chdir(first);
    const firstResult = resolveGlobalQeStorePath();
    process.chdir(second);
    const secondResult = resolveGlobalQeStorePath();

    assert.equal(firstResult, secondResult);
    assert.equal(firstResult, join(homedir(), '.qe', 'qe.db'));
  } finally {
    process.chdir(originalCwd);
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('fails closed when Node reports a relative user home', () => {
  const moduleUrl = new URL('../../hooks/scripts/lib/global-store-path.mjs', import.meta.url).href;
  const source = `
    import { resolveGlobalQeStorePath } from ${JSON.stringify(moduleUrl)};
    try {
      resolveGlobalQeStorePath();
      process.exitCode = 1;
    } catch (error) {
      process.exitCode = error instanceof Error
        && error.message === 'Unable to resolve absolute user home' ? 0 : 2;
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    env: { ...process.env, HOME: 'relative-home', USERPROFILE: 'relative-home' },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
