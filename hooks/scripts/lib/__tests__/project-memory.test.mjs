import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addMemory, getActiveMemories } from '../project-memory.mjs';

/** Fresh isolated cwd per test so disk state never leaks. @returns {string} */
function freshCwd() {
  return mkdtempSync(join(tmpdir(), 'qe-mem-'));
}

// --- TTL assignment by priority (regression: issue #6) ---

test('permanent priority → never expires (ttl null, expiresAt null)', () => {
  const cwd = freshCwd();
  try {
    const e = addMemory(cwd, 'keep me forever', 'decision', { priority: 'permanent' });
    assert.equal(e.ttl, null);
    assert.equal(e.expiresAt, null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('high/normal/low priorities get their finite TTLs', () => {
  const cwd = freshCwd();
  try {
    assert.equal(addMemory(cwd, 'h', 'pattern', { priority: 'high' }).ttl, 30 * 24 * 60 * 60);
    assert.equal(addMemory(cwd, 'n', 'pattern', { priority: 'normal' }).ttl, 7 * 24 * 60 * 60);
    assert.equal(addMemory(cwd, 'l', 'pattern', { priority: 'low' }).ttl, 1 * 24 * 60 * 60);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('default priority (none given) falls back to normal 7-day TTL', () => {
  const cwd = freshCwd();
  try {
    assert.equal(addMemory(cwd, 'd', 'pattern', {}).ttl, 7 * 24 * 60 * 60);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('unknown priority falls back to normal (not destroyed by ?? on null)', () => {
  const cwd = freshCwd();
  try {
    assert.equal(addMemory(cwd, 'u', 'pattern', { priority: 'bogus' }).ttl, 7 * 24 * 60 * 60);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('permanent entry survives getActiveMemories (not pruned as expired)', () => {
  const cwd = freshCwd();
  try {
    addMemory(cwd, 'forever', 'convention', { priority: 'permanent' });
    const active = getActiveMemories(cwd);
    assert.equal(active.length, 1);
    assert.equal(active[0].priority, 'permanent');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
