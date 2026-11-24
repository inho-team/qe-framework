import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectState, startServer } from '../skills/Qboard/board.mjs';

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-board-'));
  const task = path.join(dir, 'tasks', '2026-11-24-x');
  fs.mkdirSync(task, { recursive: true });
  fs.writeFileSync(path.join(task, 'status.json'), '{ broken');
  return dir;
}

test('collectState returns sessionsError when claude is not on PATH', () => {
  const s = collectState({ QE_HOME: home(), PATH: '', Path: '' });
  assert.deepEqual(s.sessions, []);
  assert.equal(typeof s.sessionsError, 'string');
  assert.ok(s.sessionsError.length > 0);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].name, '2026-11-24-x');
  assert.deepEqual(s.tasks[0].alerts.map((a) => a.code), ['invalid-status']);
  assert.equal(typeof s.at, 'number');
});

test('server serves /api/state JSON', async () => {
  const server = await startServer({ port: 0, env: { QE_HOME: home(), PATH: '', Path: '' } });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.tasks.length, 1);
    assert.deepEqual(body.sessions, []);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('server rejects requests whose Host is not 127.0.0.1 or localhost on its port (DNS rebinding)', async () => {
  const { default: http } = await import('node:http');
  const server = await startServer({ port: 0, env: { QE_HOME: home(), PATH: '', Path: '' } });
  const get = (host) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/state', headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
  try {
    const { port } = server.address();
    assert.equal(await get(`evil.example:${port}`), 403);
    assert.equal(await get(`127.0.0.1:${port + 1}`), 403);
    assert.equal(await get('127.0.0.1'), 403);
    assert.equal(await get(`127.0.0.1:${port}`), 200);
    assert.equal(await get(`localhost:${port}`), 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
