#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BUILD_BLOCK_MESSAGE,
  DEFAULT_BUILD_MIN_FREE_MB,
  LOCK_BLOCK_MESSAGE,
  MEMORY_BLOCK_MESSAGE,
  acquireBuildLock,
  buildLockOwnerId,
  checkBuildAdmission,
  deriveBuildLockMetadata,
  getBuildThresholdMb,
  isBuildAdmissionDisabled,
  isBuildLockStale,
  isHeavyBuildCommand,
  formatLockBlockDetail,
  parseMeminfo,
  parseVmStat,
  probeAvailableMemory,
  probeMemoryWithConfirmation,
  readBuildLock,
  releaseBuildLock,
} from '../build-admission.mjs';

const OK_READING = { availableMb: 8000, thresholdMb: 1536, source: 'darwin:vm_stat', ok: true };
const LOW_READING = { availableMb: 800, thresholdMb: 1536, source: 'darwin:vm_stat', ok: false };

const PRE_HOOK = fileURLToPath(new URL('../../pre-tool-use.mjs', import.meta.url));
const POST_HOOK = fileURLToPath(new URL('../../post-tool-use.mjs', import.meta.url));

function tempLock(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-build-admission-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, lockPath: path.join(dir, 'build.lock.json') };
}

function runHook(hookPath, payload, env = {}) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('memory probe parses macOS vm_stat free plus inactive pages', () => {
  const vmStat = [
    'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
    'Pages free:                               1000.',
    'Pages inactive:                           3000.',
    'Pages speculative:                        9999.',
    'Pages occupied by compressor:             8000.',
  ].join('\n');
  assert.equal(parseVmStat(vmStat, 4096), 15);
});

test('memory probe reads page size from the vm_stat header when present', () => {
  const vmStat = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                               1000.',
    'Pages inactive:                           3000.',
  ].join('\n');
  // Header says 16384; the arg default (4096) must be overridden by it.
  assert.equal(parseVmStat(vmStat), Math.floor((4000 * 16384) / 1024 / 1024));
  // No header → fall back to the pageSize argument.
  assert.equal(parseVmStat('Pages free: 1000.\nPages inactive: 3000.', 4096), 15);
});

test('darwin probe calls only /usr/bin/vm_stat with no pagesize exec', () => {
  const calls = [];
  const result = probeAvailableMemory({
    platform: 'darwin',
    arch: 'arm64',
    execFileSync: (cmd) => {
      calls.push(cmd);
      return 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 1000.\nPages inactive: 3000.\n';
    },
    env: {},
  });
  assert.deepEqual(calls, ['/usr/bin/vm_stat']);
  assert.equal(result.source, 'darwin:vm_stat');
  assert.equal(result.availableMb, Math.floor((4000 * 16384) / 1024 / 1024));
});

test('darwin probe uses arch page size when the vm_stat header is missing', () => {
  const result = probeAvailableMemory({
    platform: 'darwin',
    arch: 'arm64',
    execFileSync: () => 'Pages free: 1000.\nPages inactive: 3000.\n',
    env: {},
  });
  // No header → must default to 16384 on arm64, not 4096 (no 4x under-report).
  assert.equal(result.availableMb, Math.floor((4000 * 16384) / 1024 / 1024));
});

test('memory probe parses Linux MemAvailable', () => {
  assert.equal(parseMeminfo('MemTotal: 100 kB\nMemAvailable: 2097152 kB\n'), 2048);
});

test('memory probe falls back to os.freemem when platform probe fails', () => {
  const result = probeAvailableMemory({
    platform: 'linux',
    readFileSync: () => { throw new Error('missing meminfo'); },
    freemem: () => 512 * 1024 * 1024,
    env: {},
  });
  assert.deepEqual(result, {
    availableMb: 512,
    thresholdMb: DEFAULT_BUILD_MIN_FREE_MB,
    source: 'fallback:os.freemem',
    ok: false,
  });
});

test('threshold env parsing accepts positive override and rejects invalid values', () => {
  assert.equal(getBuildThresholdMb({ QE_BUILD_MIN_FREE_MB: '2048' }), 2048);
  assert.equal(getBuildThresholdMb({ QE_BUILD_MIN_FREE_MB: 'nope' }), DEFAULT_BUILD_MIN_FREE_MB);
  assert.equal(getBuildThresholdMb({ QE_BUILD_MIN_FREE_MB: '-1' }), DEFAULT_BUILD_MIN_FREE_MB);
});

test('disable switch recognizes QE_BUILD_ADMISSION=off', () => {
  assert.equal(isBuildAdmissionDisabled({ QE_BUILD_ADMISSION: 'off' }), true);
  assert.equal(isBuildAdmissionDisabled({ QE_BUILD_ADMISSION: 'OFF' }), true);
  assert.equal(isBuildAdmissionDisabled({ QE_BUILD_ADMISSION: 'on' }), false);
});

test('heavy build classifier detects build commands and ignores executable data', () => {
  assert.equal(isHeavyBuildCommand('./gradlew test'), true);
  assert.equal(isHeavyBuildCommand('bash -lc "mvn test"'), true);
  assert.equal(isHeavyBuildCommand('npm run build'), true);
  assert.equal(isHeavyBuildCommand('npm run test'), true);
  assert.equal(isHeavyBuildCommand('npm run build:prod'), true);
  assert.equal(isHeavyBuildCommand('npm run test:unit'), true);
  assert.equal(isHeavyBuildCommand('npm run build-css'), true);
  assert.equal(isHeavyBuildCommand('npm run test-e2e'), true);
  assert.equal(isHeavyBuildCommand('npm run buildx'), false);
  assert.equal(isHeavyBuildCommand('npm run buildinfo'), false);
  assert.equal(isHeavyBuildCommand('npm test -- --runInBand'), true);
  assert.equal(isHeavyBuildCommand('echo "npm test"'), false);
  assert.equal(isHeavyBuildCommand('cat <<EOF\n./gradlew test\nEOF'), false);
  assert.equal(isHeavyBuildCommand('ls && rg build && git status'), false);
});

test('lock acquire and owned release use an injected machine-global path', (t) => {
  const { lockPath } = tempLock(t);
  const metadata = { pid: process.pid, ownerId: 'owner-a', cwd: '/repo', command: 'npm test' };
  const acquired = acquireBuildLock(metadata, { lockPath });
  assert.equal(acquired.acquired, true);
  assert.equal(readBuildLock({ lockPath }).ownerId, 'owner-a');
  assert.equal(releaseBuildLock(metadata, { lockPath }).released, true);
  assert.equal(readBuildLock({ lockPath }), null);
});

test('live holder denies competing acquisition', (t) => {
  const { lockPath } = tempLock(t);
  assert.equal(acquireBuildLock({ pid: process.pid, ownerId: 'owner-a' }, { lockPath }).acquired, true);
  const second = acquireBuildLock({ pid: process.pid, ownerId: 'owner-b' }, { lockPath });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'locked');
});

test('dead holder is stale-reaped using injected liveness semantics', (t) => {
  const { lockPath } = tempLock(t);
  assert.equal(acquireBuildLock({ pid: 12345, ownerId: 'dead' }, { lockPath }).acquired, true);
  const second = acquireBuildLock(
    { pid: process.pid, ownerId: 'new' },
    { lockPath, isProcessAlive: () => false },
  );
  assert.equal(second.acquired, true);
  assert.equal(readBuildLock({ lockPath }).ownerId, 'new');
});

test('malformed lock file does not permanently block admission', (t) => {
  const { lockPath } = tempLock(t);
  fs.writeFileSync(lockPath, '{ nope', 'utf8');
  const acquired = acquireBuildLock({ pid: process.pid, ownerId: 'new' }, { lockPath });
  assert.equal(acquired.acquired, true);
  assert.equal(readBuildLock({ lockPath }).ownerId, 'new');
});

test('max-age makes unknown-pid lock stale', () => {
  const lock = { pid: 'bad', createdAt: new Date(0).toISOString() };
  assert.deepEqual(
    isBuildLockStale(lock, { now: 10_000, maxAgeMs: 1000 }),
    { stale: true, reason: 'max-age' },
  );
  assert.deepEqual(
    isBuildLockStale({ pid: 'bad' }, { now: 10_000, maxAgeMs: 1000 }),
    { stale: true, reason: 'invalid-timestamp' },
  );
});

test('checkBuildAdmission blocks below threshold before acquiring lock', (t) => {
  const { lockPath } = tempLock(t);
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-a', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MIN_FREE_MB: '2048' },
      // Reliable probe reading 1024 MB (< threshold) — the gate must deny.
      platform: 'linux',
      readFileSync: () => 'MemAvailable: 1048576 kB\n',
    },
  );
  assert.equal(result.admitted, false);
  assert.equal(result.reason, 'memory');
  assert.equal(result.message, MEMORY_BLOCK_MESSAGE);
  assert.equal(fs.existsSync(lockPath), false);
});

test('checkBuildAdmission does not deny on the unreliable os.freemem fallback', (t) => {
  const { lockPath } = tempLock(t);
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-a', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MIN_FREE_MB: '2048' },
      // Unknown platform forces the os.freemem fallback; 100 MB is far below the
      // threshold, but the fallback reading is untrustworthy so it must NOT block.
      platform: 'test',
      freemem: () => 100 * 1024 * 1024,
    },
  );
  assert.equal(result.memory.source, 'fallback:os.freemem');
  assert.equal(result.admitted, true);
  assert.notEqual(result.reason, 'memory');
  assert.equal(result.memorySkipped, true);
});

test('checkBuildAdmission allows when disabled without taking lock', (t) => {
  const { lockPath } = tempLock(t);
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-a', command: 'npm test' },
    { lockPath, env: { QE_BUILD_ADMISSION: 'off' } },
  );
  assert.equal(result.admitted, true);
  assert.equal(result.disabled, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('checkBuildAdmission fails open when the lock path cannot be written', (t) => {
  const { dir } = tempLock(t);
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-a', command: 'npm test' },
    {
      lockPath: dir,
      env: { QE_BUILD_MIN_FREE_MB: '1' },
      platform: 'test',
      freemem: () => 4096 * 1024 * 1024,
    },
  );
  assert.equal(result.admitted, true);
  assert.equal(result.failOpen, true);
  assert.equal(result.reason, 'lock-write-failed');
});

test('pre-tool-use blocks heavy build below threshold and leaves no lock', (t) => {
  const { dir, lockPath } = tempLock(t);
  const res = runHook(PRE_HOOK, {
    cwd: dir,
    session_id: 'session-a',
    tool_use_id: 'tool-a',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  }, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '999999999',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /insufficient free memory for a heavy build — wait and retry/);
  assert.equal(fs.existsSync(lockPath), false);
});

test('pre-tool-use blocks heavy build on live competing lock', (t) => {
  const { dir, lockPath } = tempLock(t);
  acquireBuildLock({ pid: process.pid, ownerId: 'competitor' }, { lockPath });
  const res = runHook(PRE_HOOK, {
    cwd: dir,
    session_id: 'session-b',
    tool_use_id: 'tool-b',
    tool_name: 'Bash',
    tool_input: { command: './gradlew test' },
  }, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '1',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /another heavy build holds the machine build lock — wait and retry/);
  assert.equal(readBuildLock({ lockPath }).ownerId, 'competitor');
});

test('pre-tool-use allows after stale reap and post-tool-use releases successful build', (t) => {
  const { dir, lockPath } = tempLock(t);
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 99999999,
    ownerId: 'dead',
    createdAt: new Date().toISOString(),
  }));
  const payload = {
    cwd: dir,
    session_id: 'session-c',
    tool_use_id: 'tool-c',
    tool_name: 'Bash',
    tool_input: { command: 'npm run build' },
  };
  const pre = runHook(PRE_HOOK, payload, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '1',
  });
  assert.equal(pre.status, 0);
  assert.equal(readBuildLock({ lockPath }).sessionId, 'session-c');

  const post = runHook(POST_HOOK, { ...payload, exit_code: 0, tool_response: 'ok' }, {
    QE_BUILD_LOCK_PATH: lockPath,
  });
  assert.equal(post.status, 0);
  assert.equal(readBuildLock({ lockPath }), null);
});

test('post-tool-use releases failed build but light command cannot release another lock', (t) => {
  const { dir, lockPath } = tempLock(t);
  const payload = {
    cwd: dir,
    session_id: 'session-d',
    tool_use_id: 'tool-d',
    tool_name: 'Bash',
    tool_input: { command: './gradlew test' },
  };
  const pre = runHook(PRE_HOOK, payload, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '1',
  });
  assert.equal(pre.status, 0);
  assert.ok(readBuildLock({ lockPath }));

  const light = runHook(POST_HOOK, {
    ...payload,
    tool_input: { command: 'git status' },
    exit_code: 0,
    tool_response: 'clean',
  }, { QE_BUILD_LOCK_PATH: lockPath });
  assert.equal(light.status, 0);
  assert.ok(readBuildLock({ lockPath }));

  const failed = runHook(POST_HOOK, { ...payload, exit_code: 1, tool_response: 'FAILED' }, {
    QE_BUILD_LOCK_PATH: lockPath,
  });
  assert.equal(failed.status, 0);
  assert.equal(readBuildLock({ lockPath }), null);
});

test('pre-tool-use allows heavy build when QE_BUILD_ADMISSION=off', (t) => {
  const { dir, lockPath } = tempLock(t);
  const res = runHook(PRE_HOOK, {
    cwd: dir,
    session_id: 'session-e',
    tool_use_id: 'tool-e',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  }, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_ADMISSION: 'off',
    QE_BUILD_MIN_FREE_MB: '999999999',
  });
  assert.equal(res.status, 0);
  assert.equal(fs.existsSync(lockPath), false);
});

test('deriveBuildLockMetadata reads tool workdir when payload omits cwd', () => {
  const meta = deriveBuildLockMetadata({
    session_id: 's',
    tool_use_id: 't',
    tool_input: { command: 'npm run build', workdir: '/tmp/wd' },
  });
  assert.equal(meta.cwd, '/tmp/wd');
  assert.equal(meta.command, 'npm run build');
  assert.equal(meta.sessionId, 's');
  assert.equal(meta.toolUseId, 't');
});

test('release succeeds when payload omits cwd but carries tool workdir (ownerId parity regression)', (t) => {
  const { dir, lockPath } = tempLock(t);
  // Payload intentionally omits data.cwd; the tool carries its own workdir.
  // Before the parity fix, pre derived cwd from tool workdir while post fell back
  // to process.cwd(), so ownerId diverged and release left the lock stranded.
  const payload = {
    session_id: 'session-parity',
    tool_use_id: 'tool-parity',
    tool_name: 'Bash',
    tool_input: { command: 'npm run build', workdir: dir },
  };
  const pre = runHook(PRE_HOOK, payload, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '1',
  });
  assert.equal(pre.status, 0);
  assert.equal(readBuildLock({ lockPath }).sessionId, 'session-parity');

  const post = runHook(POST_HOOK, { ...payload, exit_code: 0, tool_response: 'ok' }, {
    QE_BUILD_LOCK_PATH: lockPath,
  });
  assert.equal(post.status, 0);
  assert.equal(readBuildLock({ lockPath }), null);
});

test('release succeeds when post payload omits tool_use_id present at acquire', (t) => {
  const { dir, lockPath } = tempLock(t);
  // Ownership must not depend on tool_use_id: PostToolUse may omit a field the
  // PreToolUse payload carried. If it were part of the ownerId, release would
  // fail as not-owner and strand the lock.
  const base = {
    session_id: 'session-tuid',
    tool_name: 'Bash',
    tool_input: { command: 'npm run build', workdir: dir },
  };
  const pre = runHook(PRE_HOOK, { ...base, tool_use_id: 'tuid-acquire' }, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '1',
  });
  assert.equal(pre.status, 0);
  assert.ok(readBuildLock({ lockPath }));

  // Post intentionally omits tool_use_id (and thus differs from acquire).
  const post = runHook(POST_HOOK, { ...base, exit_code: 0, tool_response: 'ok' }, {
    QE_BUILD_LOCK_PATH: lockPath,
  });
  assert.equal(post.status, 0);
  assert.equal(readBuildLock({ lockPath }), null);
});

test('buildLockOwnerId ignores command/toolUseId/transcriptPath, keys on cwd+session+pid', () => {
  const a = buildLockOwnerId({ cwd: '/r', sessionId: 's', pid: 1, command: 'npm test', toolUseId: 'x', transcriptPath: '/t/a' });
  const b = buildLockOwnerId({ cwd: '/r', sessionId: 's', pid: 1, command: 'npm run build', toolUseId: 'y', transcriptPath: '/t/b' });
  assert.equal(a, b);
  const different = buildLockOwnerId({ cwd: '/other', sessionId: 's', pid: 1 });
  assert.notEqual(a, different);
});

test('probeMemoryWithConfirmation returns after one sample when the first reading passes', () => {
  let calls = 0;
  const result = probeMemoryWithConfirmation({
    env: { QE_BUILD_MEM_SAMPLES: '3' },
    probe: () => { calls += 1; return { ...OK_READING }; },
    sleep: () => { throw new Error('happy path must not sleep'); },
  });
  assert.equal(calls, 1);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.ok, true);
});

test('a passing first memory sample admits without re-probing (zero added latency)', (t) => {
  const { lockPath } = tempLock(t);
  let calls = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-ok', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MEM_SAMPLES: '3' },
      probe: () => { calls += 1; return { ...OK_READING }; },
      sleep: () => { throw new Error('happy path must not sleep'); },
    },
  );
  assert.equal(result.admitted, true);
  assert.equal(calls, 1);
  assert.equal(result.memory.sampleCount, 1);
});

test('a transient memory dip does not block when a later sample recovers', (t) => {
  const { lockPath } = tempLock(t);
  const readings = [{ ...LOW_READING }, { ...OK_READING }, { ...OK_READING }];
  let i = 0;
  let slept = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-dip', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MEM_SAMPLES: '3' },
      probe: () => readings[Math.min(i++, readings.length - 1)],
      sleep: () => { slept += 1; },
    },
  );
  assert.equal(result.admitted, true);
  assert.notEqual(result.reason, 'memory');
  assert.equal(i, 2); // first (low) + one confirmation (ok) — stops on recovery
  assert.equal(slept, 1); // one gap before the recovering sample
});

test('sustained low memory blocks and the block detail carries the live numbers', (t) => {
  const { lockPath } = tempLock(t);
  let calls = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-low', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MEM_SAMPLES: '3' },
      probe: () => { calls += 1; return { ...LOW_READING }; },
      sleep: () => {},
    },
  );
  assert.equal(result.admitted, false);
  assert.equal(result.reason, 'memory');
  assert.equal(result.message, MEMORY_BLOCK_MESSAGE); // base constant unchanged
  assert.equal(calls, 3); // first + 2 confirmations, all below threshold
  assert.match(result.detail, /800MB free < 1536MB required/);
  assert.match(result.detail, /darwin:vm_stat/);
  assert.match(result.detail, /3× sampled/);
  assert.equal(fs.existsSync(lockPath), false);
});

test('the unreliable os.freemem fallback is not re-sampled and never denies', (t) => {
  const { lockPath } = tempLock(t);
  let calls = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-fb', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MIN_FREE_MB: '2048', QE_BUILD_MEM_SAMPLES: '3' },
      platform: 'test',
      freemem: () => { calls += 1; return 100 * 1024 * 1024; },
      sleep: () => { throw new Error('fallback must not re-sample'); },
    },
  );
  assert.equal(result.admitted, true);
  assert.equal(result.memorySkipped, true);
  assert.equal(result.memory.source, 'fallback:os.freemem');
  assert.equal(result.memory.sampleCount, 1);
  assert.equal(calls, 1);
});

test('lock block detail reports the holding pid, age, and cwd', (t) => {
  const { lockPath } = tempLock(t);
  const createdAt = new Date(1_000_000).toISOString();
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 4242, ownerId: 'holder', createdAt, cwd: '/repo/x' }));
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'contender', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MIN_FREE_MB: '1' },
      platform: 'linux',
      readFileSync: () => 'MemAvailable: 8388608 kB\n', // 8192 MB → memory passes on first sample
      now: 1_000_000 + 5 * 60_000,
      isProcessAlive: () => true,
    },
  );
  assert.equal(result.admitted, false);
  assert.equal(result.reason, 'lock');
  assert.equal(result.message, LOCK_BLOCK_MESSAGE); // base constant unchanged
  assert.match(result.detail, /held by pid 4242/);
  assert.match(result.detail, /for 5min/);
  assert.match(result.detail, /cwd \/repo\/x/);
});

test('pre-tool-use surfaces the memory diagnostic numbers in the block message', (t) => {
  const { dir, lockPath } = tempLock(t);
  const res = runHook(PRE_HOOK, {
    cwd: dir,
    session_id: 'session-diag',
    tool_use_id: 'tool-diag',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  }, {
    QE_BUILD_LOCK_PATH: lockPath,
    QE_BUILD_MIN_FREE_MB: '999999999',
    QE_BUILD_MEM_SAMPLES: '1', // keep the subprocess fast; still exercises the detail path
  });
  assert.equal(res.status, 2);
  // Base message preserved (back-compat) AND enriched with live numbers.
  assert.match(res.stderr, /insufficient free memory for a heavy build — wait and retry/);
  assert.match(res.stderr, /MB free < 999999999MB required/);
  assert.equal(fs.existsSync(lockPath), false);
});

test('an unreliable fallback retry cannot flip a sustained reliable-low reading to admit', (t) => {
  const { lockPath } = tempLock(t);
  // First sample: reliable vm_stat, below threshold. Second sample: a transient
  // vm_stat failure drops to os.freemem fallback reading a HIGHER (but still
  // below-threshold) number. The fallback must NOT become the reported reading,
  // or checkBuildAdmission would skip the denial and admit a genuinely low box.
  const readings = [
    { availableMb: 700, thresholdMb: 1536, source: 'darwin:vm_stat', ok: false },
    { availableMb: 1200, thresholdMb: 1536, source: 'fallback:os.freemem', ok: false },
    { availableMb: 750, thresholdMb: 1536, source: 'darwin:vm_stat', ok: false },
  ];
  let i = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-flip', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MEM_SAMPLES: '3' },
      probe: () => readings[Math.min(i++, readings.length - 1)],
      sleep: () => {},
    },
  );
  assert.equal(result.admitted, false);
  assert.equal(result.reason, 'memory');
  // Reported reading must be a RELIABLE source (never the fallback outlier).
  assert.equal(result.memory.source, 'darwin:vm_stat');
  assert.equal(fs.existsSync(lockPath), false);
});

test('formatLockBlockDetail handles a raw record and omits missing fields without throwing', () => {
  const full = formatLockBlockDetail({ pid: 7, createdAt: new Date(0).toISOString(), cwd: '/r' }, 5 * 60_000);
  assert.match(full, /held by pid 7/);
  assert.match(full, /for 5min/);
  assert.match(full, /cwd \/r/);
  // Missing everything → empty string, no throw. Null → empty string, no throw.
  assert.equal(formatLockBlockDetail({}, 0), '');
  assert.equal(formatLockBlockDetail(null, 0), '');
  // pid only, no timestamp/cwd.
  assert.equal(formatLockBlockDetail({ pid: 9 }, 0), 'held by pid 9');
});

test('confirmation sampling stops re-probing once the wall-clock budget is exhausted', (t) => {
  const { lockPath } = tempLock(t);
  // An injected clock that jumps 500ms per read — past the 400ms default budget —
  // proves the deadline covers wall time (not just sleep) and halts re-probing.
  let calls = 0;
  let clockMs = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-budget', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MEM_SAMPLES: '5' }, // would take 5 samples if unbounded
      probe: () => { calls += 1; return { availableMb: 500, thresholdMb: 1536, source: 'darwin:vm_stat', ok: false }; },
      sleep: () => {},
      clock: () => { const v = clockMs; clockMs += 500; return v; },
    },
  );
  assert.equal(result.reason, 'memory'); // still denies (reliable low)
  // Deterministic clock trips the budget before the first re-probe, so ONLY the
  // initial probe runs. Exactly 1 (not <=2) rules out a "never re-probes at all"
  // impl passing by accident — the companion sustained-low test (calls===3 with a
  // generous budget) proves re-probing does happen when the budget allows.
  assert.equal(calls, 1);
});

test('confirmation re-probe receives a shrinking exec timeout bounded by the budget', () => {
  // The confirmation path must hand each re-probe a positive timeoutMs no larger
  // than the remaining budget, so a hung vm_stat cannot overrun the deadline.
  const timeouts = [];
  let clockMs = 0;
  probeMemoryWithConfirmation({
    env: { QE_BUILD_MEM_SAMPLES: '3' },
    totalBudgetMs: 400,
    gapMs: 0,
    clock: () => { const v = clockMs; clockMs += 50; return v; },
    sleep: () => {},
    probe: (o) => {
      if (o.timeoutMs != null) timeouts.push(o.timeoutMs);
      return { availableMb: 500, thresholdMb: 1536, source: 'darwin:vm_stat', ok: false };
    },
  });
  assert.ok(timeouts.length >= 2, 'at least two re-probes should run to compare');
  for (const t of timeouts) {
    assert.ok(t > 0 && t <= 400, `re-probe timeout ${t} must be in (0, budget]`);
  }
  // Strictly shrinking: each re-probe gets less headroom than the previous one as
  // the wall-clock budget is consumed. A broken impl passing a fixed value fails.
  for (let k = 1; k < timeouts.length; k++) {
    assert.ok(timeouts[k] < timeouts[k - 1], `timeout must shrink: ${timeouts[k - 1]} -> ${timeouts[k]}`);
  }
});

test('sleepSync degrades to a no-op path without breaking sampling (default sleep)', (t) => {
  const { lockPath } = tempLock(t);
  // Exercise the REAL sleepSync (no injected sleep) on the deny path with gap 0
  // so the loop runs its sleep branch guard without adding wall-clock.
  let calls = 0;
  const result = checkBuildAdmission(
    { pid: process.pid, ownerId: 'owner-realsleep', command: 'npm test' },
    {
      lockPath,
      env: { QE_BUILD_MEM_SAMPLES: '2', QE_BUILD_MEM_SAMPLE_GAP_MS: '0' },
      probe: () => { calls += 1; return { availableMb: 500, thresholdMb: 1536, source: 'linux:/proc/meminfo', ok: false }; },
    },
  );
  assert.equal(result.admitted, false);
  assert.equal(result.reason, 'memory');
  assert.equal(calls, 2);
});

test('memory and lock blocks return distinct, reason-specific messages', (t) => {
  const memLock = tempLock(t);
  const memory = checkBuildAdmission(
    { pid: process.pid, ownerId: 'm', command: 'npm test' },
    { lockPath: memLock.lockPath, env: { QE_BUILD_MIN_FREE_MB: '2048' }, platform: 'linux', readFileSync: () => 'MemAvailable: 1048576 kB\n' },
  );
  assert.equal(memory.reason, 'memory');
  assert.equal(memory.message, MEMORY_BLOCK_MESSAGE);

  const lockDir = tempLock(t);
  acquireBuildLock({ pid: process.pid, ownerId: 'holder' }, { lockPath: lockDir.lockPath });
  const locked = checkBuildAdmission(
    { pid: process.pid, ownerId: 'contender', command: 'npm test' },
    { lockPath: lockDir.lockPath, env: { QE_BUILD_MIN_FREE_MB: '1' }, platform: 'test', freemem: () => 4096 * 1024 * 1024 },
  );
  assert.equal(locked.reason, 'lock');
  assert.equal(locked.message, LOCK_BLOCK_MESSAGE);

  assert.notEqual(MEMORY_BLOCK_MESSAGE, LOCK_BLOCK_MESSAGE);
});
