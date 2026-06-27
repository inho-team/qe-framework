import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cleanupStaleSessions,
  filterActiveSessions,
  readSessionRegistry,
  removeSession,
  upsertSession,
  writeSessionRegistry,
} from '../session-registry.mjs';

function mkroot() {
  return mkdtempSync(join(tmpdir(), 'sess-registry-'));
}

test('readSessionRegistry: missing and corrupt files return empty list', () => {
  const root = mkroot();
  try {
    assert.deepEqual(readSessionRegistry(root), []);
    mkdirSync(join(root, '.qe/state'), { recursive: true });
    writeFileSync(join(root, '.qe/state/sessions-registry.json'), '{ broken');
    assert.deepEqual(readSessionRegistry(root), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('writeSessionRegistry: filters invalid SID entries and writes sessions object', () => {
  const root = mkroot();
  try {
    writeSessionRegistry(root, [
      { sid: 'a1b2c3d4', name: 'one', plan: 'p', lastSeen: new Date().toISOString(), pid: 123 },
      { sid: '../nope', name: 'bad', plan: 'p', lastSeen: new Date().toISOString(), pid: 123 },
    ]);
    const data = JSON.parse(readFileSync(join(root, '.qe/state/sessions-registry.json'), 'utf8'));
    assert.equal(data.sessions.length, 1);
    assert.equal(data.sessions[0].sid, 'a1b2c3d4');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('filterActiveSessions: excludes entries older than two hours', () => {
  const now = Date.now();
  const active = filterActiveSessions([
    { sid: 'aaaaaaaa', name: '', plan: '', lastSeen: new Date(now - 10_000).toISOString(), pid: 1 },
    { sid: 'bbbbbbbb', name: '', plan: '', lastSeen: new Date(now - (3 * 60 * 60 * 1000)).toISOString(), pid: 2 },
  ], now);
  assert.deepEqual(active.map((entry) => entry.sid), ['aaaaaaaa']);
});

test('upsertSession: updates existing sid without duplicates', () => {
  const root = mkroot();
  try {
    upsertSession(root, { sid: 'a1b2c3d4', name: 'first', plan: 'p1', lastSeen: '2026-06-27T00:00:00.000Z', pid: 1 });
    upsertSession(root, { sid: 'a1b2c3d4', name: 'second', plan: 'p2', lastSeen: '2026-06-27T00:01:00.000Z', pid: 2 });
    const sessions = readSessionRegistry(root);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].name, 'second');
    assert.equal(sessions[0].plan, 'p2');
    assert.equal(sessions[0].pid, 2);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('cleanupStaleSessions and removeSession persist filtered registry', () => {
  const root = mkroot();
  const now = Date.now();
  try {
    writeSessionRegistry(root, [
      { sid: 'aaaaaaaa', name: 'a', plan: '', lastSeen: new Date(now - 1000).toISOString(), pid: 1 },
      { sid: 'bbbbbbbb', name: 'b', plan: '', lastSeen: new Date(now - (3 * 60 * 60 * 1000)).toISOString(), pid: 2 },
    ]);

    let sessions = cleanupStaleSessions(root, now);
    assert.deepEqual(sessions.map((entry) => entry.sid), ['aaaaaaaa']);

    sessions = removeSession(root, 'aaaaaaaa');
    assert.deepEqual(sessions, []);
    assert.deepEqual(readSessionRegistry(root), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

