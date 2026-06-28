#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER = resolve(__dirname, '..', 'codex-poll-watcher.mjs');
const DEAD_PID = 999999;

function mkGitProject() {
  const root = mkdtempSync(join(tmpdir(), 'qe-poll-watcher-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  writeFileSync(join(root, 'tracked.txt'), 'baseline\n');
  writeFileSync(join(root, '.gitignore'), '.qe/\n');
  execFileSync('git', ['add', 'tracked.txt', '.gitignore'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: root, stdio: 'ignore' });
  mkdirSync(join(root, '.qe', 'agent-results'), { recursive: true });
  return root;
}

function runWatcher(root, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [WATCHER, root, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`watcher exited ${code}: ${stderr}`));
    });
  });
}

test('codex-poll-watcher: dead pid writes crashed signal within one short poll interval', async (t) => {
  const root = mkGitProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const started = Date.now();
  await runWatcher(root, ['--interval', '0.1', '--timeout', '5', '--pid', String(DEAD_PID)]);
  const elapsedMs = Date.now() - started;

  const signalPath = join(root, '.qe', 'agent-results', 'codex-ready.signal');
  assert.equal(existsSync(signalPath), true);
  const signal = JSON.parse(readFileSync(signalPath, 'utf8'));
  assert.equal(signal.detected, false);
  assert.equal(signal.crashed, true);
  assert.equal(signal.status, 'crashed');
  assert.equal(signal.pid, DEAD_PID);
  assert.ok(elapsedMs < 1500, `expected fast crash detection, got ${elapsedMs}ms`);
});

test('codex-poll-watcher: invalid pid preserves diff-only timeout behavior', async (t) => {
  const root = mkGitProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  await runWatcher(root, ['--interval', '0.1', '--timeout', '0.25', '--pid', 'invalid']);

  const signalPath = join(root, '.qe', 'agent-results', 'codex-ready.signal');
  assert.equal(existsSync(signalPath), true);
  const signal = JSON.parse(readFileSync(signalPath, 'utf8'));
  assert.equal(signal.timeout, true);
  assert.equal(signal.crashed, undefined);
  assert.equal(signal.status, undefined);
});
