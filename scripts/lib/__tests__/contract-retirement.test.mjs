import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { retireContract } from '../../qe-contract.mjs';
import { existsSync as qeExistsSync, readFileSync as qeReadFileSync } from '../../../hooks/scripts/lib/qe-fs.mjs';
import { readLock } from '../../../hooks/scripts/lib/contract-lock.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qe-contract-retirement-'));
  mkdirSync(join(root, '.qe/contracts/active'), { recursive: true });
  writeFileSync(join(root, '.qe/contracts/active/legacy.md'), '# Legacy\n', 'utf8');
  writeFileSync(join(root, '.qe/contracts/.lock'), JSON.stringify({
    legacy: { hash: 'sha256:abc', approved_at: '2026-01-01T00:00:00.000Z', reason: 'reviewed' },
    current: { hash: 'sha256:def', approved_at: '2026-01-02T00:00:00.000Z', reason: 'keep' },
  }), 'utf8');
  return root;
}

test('retire archives content and approval history while preserving other locks', () => {
  const root = fixture();
  try {
    retireContract('legacy', 'implementation removed', root);
    assert.equal(readFileSync(join(root, '.qe/contracts/archived/legacy.md'), 'utf8'), '# Legacy\n');
    assert.throws(() => readFileSync(join(root, '.qe/contracts/active/legacy.md')), /ENOENT/);

    const record = JSON.parse(readFileSync(join(root, '.qe/contracts/archived/legacy.retirement.json'), 'utf8'));
    assert.equal(record.reason, 'implementation removed');
    assert.equal(record.previous_approval.reason, 'reviewed');

    const lock = JSON.parse(readFileSync(join(root, '.qe/contracts/.lock'), 'utf8'));
    assert.equal(lock.legacy, undefined);
    assert.equal(lock.current.reason, 'keep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retire fails closed on malformed lock and archive collision', () => {
  const malformed = fixture();
  try {
    writeFileSync(join(malformed, '.qe/contracts/.lock'), '{bad', 'utf8');
    assert.throws(() => retireContract('legacy', 'implementation removed', malformed), /Malformed/);
    assert.equal(readFileSync(join(malformed, '.qe/contracts/active/legacy.md'), 'utf8'), '# Legacy\n');
  } finally {
    rmSync(malformed, { recursive: true, force: true });
  }

  const collision = fixture();
  try {
    mkdirSync(join(collision, '.qe/contracts/archived'), { recursive: true });
    writeFileSync(join(collision, '.qe/contracts/archived/legacy.md'), '# Existing archive\n', 'utf8');
    assert.throws(() => retireContract('legacy', 'implementation removed', collision), /already exists/);
    assert.equal(readFileSync(join(collision, '.qe/contracts/active/legacy.md'), 'utf8'), '# Legacy\n');
  } finally {
    rmSync(collision, { recursive: true, force: true });
  }
});

test('repository stale runtime contracts are archived and inactive', () => {
  for (const name of ['gc-analyzer', 'codex-poll-watcher']) {
    assert.equal(qeExistsSync(join(repositoryRoot, `.qe/contracts/active/${name}.md`)), false);
    assert.equal(qeExistsSync(join(repositoryRoot, `.qe/contracts/archived/${name}.md`)), true);
    const record = JSON.parse(qeReadFileSync(
      join(repositoryRoot, `.qe/contracts/archived/${name}.retirement.json`),
      'utf8',
    ));
    assert.equal(record.name, name);
    assert.ok(record.reason);
    assert.ok(record.previous_approval?.hash);
  }

  const lock = readLock(repositoryRoot);
  assert.equal(lock['gc-analyzer'], undefined);
  assert.equal(lock['codex-poll-watcher'], undefined);
});
