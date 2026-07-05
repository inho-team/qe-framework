'use strict';

import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isProcessAlive } from '../../../scripts/lib/codex_bridge.mjs';
import { matchesExecutable } from './shell-scanner.mjs';

export const DEFAULT_BUILD_MIN_FREE_MB = 1536;
export const DEFAULT_LOCK_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const MEMORY_BLOCK_MESSAGE = 'insufficient free memory for a heavy build — wait and retry';
export const LOCK_BLOCK_MESSAGE = 'another heavy build holds the machine build lock — wait and retry';
// Back-compat alias for callers importing the pre-split constant (memory path).
export const BUILD_BLOCK_MESSAGE = MEMORY_BLOCK_MESSAGE;

const LOCK_FILE_NAME = 'qe-framework-build-admission.lock.json';

export function parseVmStat(text, pageSize = 4096) {
  const values = {};
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^Pages\s+([^:]+):\s+([0-9.]+)/);
    if (!match) continue;
    values[match[1].trim().toLowerCase()] = Number.parseInt(match[2], 10);
  }
  const free = values.free || 0;
  const inactive = values.inactive || 0;
  return Math.floor(((free + inactive) * pageSize) / 1024 / 1024);
}

export function parseMeminfo(text) {
  const match = String(text || '').match(/^MemAvailable:\s+(\d+)\s+kB/im);
  if (!match) return null;
  return Math.floor(Number.parseInt(match[1], 10) / 1024);
}

export function getBuildThresholdMb(env = process.env) {
  const raw = env.QE_BUILD_MIN_FREE_MB;
  if (raw === undefined || raw === '') return DEFAULT_BUILD_MIN_FREE_MB;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUILD_MIN_FREE_MB;
}

export function isBuildAdmissionDisabled(env = process.env) {
  return String(env.QE_BUILD_ADMISSION || '').toLowerCase() === 'off';
}

export function getBuildLockPath(options = {}) {
  return options.lockPath || process.env.QE_BUILD_LOCK_PATH || join(os.tmpdir(), LOCK_FILE_NAME);
}

export function buildLockOwnerId({ cwd = '', sessionId = '', pid = process.ppid || process.pid } = {}) {
  // Ownership MUST hash only fields guaranteed identical between the acquire
  // (PreToolUse) and release (PostToolUse) payloads for the same build, or
  // release fails as not-owner and the lock strands. `command`/`toolUseId`/
  // `transcriptPath` are deliberately excluded: a payload may carry them in one
  // hook but not the other (e.g. PostToolUse omitting tool_use_id), which would
  // silently diverge the ownerId. Those fields are still stored on the lock
  // record for diagnostics — they just do not confer identity.
  const basis = JSON.stringify({ cwd, sessionId, pid });
  return createHash('sha256').update(basis).digest('hex');
}

export function isHeavyBuildCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') return false;
  return (
    matchesExecutable(command, /(?:^|[;&|(\n`])\s*(?:\.\/)?(?:gradlew|gradle|mvnw|mvn)(?:\s|$)/) ||
    matchesExecutable(command, /(?:^|[;&|(\n`])\s*npm\s+(?:run\s+)?(?:build|test)(?::[\w:-]+)?(?:\s|$)/)
  );
}

/**
 * Derive the build-lock ownership metadata from a raw hook payload.
 *
 * Single source of truth shared by PreToolUse (acquire) and PostToolUse
 * (release) so both compute an identical `ownerId`. Deriving these fields in
 * two different places previously let the release path miss the tool's own
 * `workdir`/`cwd`, breaking ownership and stranding the machine-global lock.
 *
 * @param {object} data - Raw hook payload (Claude Code hook JSON).
 * @returns {{cwd: string, command: string, sessionId: string, toolUseId: string, transcriptPath: string}}
 *   Metadata whose hash (see {@link buildLockOwnerId}) identifies the lock owner.
 */
export function deriveBuildLockMetadata(data = {}) {
  const toolInput = (data && (data.tool_input || data.toolInput)) || {};
  return {
    cwd: data.cwd || data.directory || toolInput.workdir || toolInput.cwd || process.cwd(),
    command: toolInput.command || '',
    sessionId: data.session_id || data.sessionId || '',
    toolUseId: data.tool_use_id || data.toolUseId || '',
    transcriptPath: data.transcript_path || data.transcriptPath || '',
  };
}

export function probeAvailableMemory(options = {}) {
  const env = options.env || process.env;
  const thresholdMb = getBuildThresholdMb(env);
  const platform = options.platform || os.platform();
  const runExecFileSync = options.execFileSync || execFileSync;
  const runReadFileSync = options.readFileSync || readFileSync;
  const freemem = options.freemem || (() => os.freemem());

  let availableMb = null;
  let source = 'fallback:os.freemem';

  if (platform === 'darwin') {
    try {
      const pageSizeText = runExecFileSync('pagesize', { encoding: 'utf8', timeout: 1000 });
      const pageSize = Number.parseInt(String(pageSizeText).trim(), 10) || 4096;
      const vmStat = runExecFileSync('vm_stat', { encoding: 'utf8', timeout: 1000 });
      availableMb = parseVmStat(vmStat, pageSize);
      source = 'darwin:vm_stat';
    } catch {
      availableMb = null;
    }
  } else if (platform === 'linux') {
    try {
      availableMb = parseMeminfo(runReadFileSync('/proc/meminfo', 'utf8'));
      if (availableMb !== null) source = 'linux:/proc/meminfo';
    } catch {
      availableMb = null;
    }
  }

  if (!Number.isFinite(availableMb) || availableMb < 0) {
    availableMb = Math.floor(Number(freemem()) / 1024 / 1024);
    source = 'fallback:os.freemem';
  }

  return {
    availableMb,
    thresholdMb,
    source,
    ok: availableMb >= thresholdMb,
  };
}

export function readBuildLock(options = {}) {
  const lockPath = getBuildLockPath(options);
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return { malformed: true, path: lockPath };
  }
}

export function isBuildLockStale(lock, options = {}) {
  if (!lock || lock.malformed) return { stale: true, reason: 'malformed' };
  const now = options.now || Date.now();
  const maxAgeMs = options.maxAgeMs || DEFAULT_LOCK_MAX_AGE_MS;
  const createdAtMs = Date.parse(lock.createdAt || lock.timestamp || '');
  if (!Number.isFinite(createdAtMs)) {
    return { stale: true, reason: 'invalid-timestamp' };
  }
  if (Number.isFinite(createdAtMs) && now - createdAtMs > maxAgeMs) {
    return { stale: true, reason: 'max-age' };
  }

  const pid = Number(lock.pid);
  const alive = (options.isProcessAlive || isProcessAlive)(pid);
  if (alive === false) return { stale: true, reason: 'dead-pid' };
  if (alive === null && Number.isFinite(createdAtMs) && now - createdAtMs > maxAgeMs) {
    return { stale: true, reason: 'unknown-pid-max-age' };
  }
  return { stale: false, reason: alive === true ? 'live-pid' : 'unknown-pid' };
}

function unlinkLock(lockPath) {
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return !existsSync(lockPath);
  }
}

export function acquireBuildLock(metadata = {}, options = {}) {
  const lockPath = getBuildLockPath(options);
  const now = options.now || Date.now();
  const pid = metadata.pid || process.ppid || process.pid;
  const ownerId = metadata.ownerId || buildLockOwnerId({ ...metadata, pid });
  const record = {
    version: 1,
    pid,
    ownerId,
    createdAt: new Date(now).toISOString(),
    cwd: metadata.cwd || '',
    command: metadata.command ? String(metadata.command).slice(0, 500) : '',
    sessionId: metadata.sessionId || '',
    toolUseId: metadata.toolUseId || '',
  };

  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
      return { acquired: true, lockPath, lock: record };
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        return { acquired: false, reason: 'write-failed', error: err?.message, lockPath };
      }
      const existing = readBuildLock({ ...options, lockPath });
      const stale = isBuildLockStale(existing, options);
      if (stale.stale) {
        if (!unlinkLock(lockPath)) {
          return { acquired: false, reason: 'write-failed', error: `unable to reap stale lock: ${stale.reason}`, lockPath };
        }
        continue;
      }
      return { acquired: false, reason: 'locked', lock: existing, lockPath };
    }
  }
  return { acquired: false, reason: 'locked-race', lock: readBuildLock({ ...options, lockPath }), lockPath };
}

export function releaseBuildLock(metadata = {}, options = {}) {
  const lockPath = getBuildLockPath(options);
  const existing = readBuildLock({ ...options, lockPath });
  if (!existing) return { released: false, reason: 'missing', lockPath };
  if (existing.malformed) {
    unlinkLock(lockPath);
    return { released: true, reason: 'malformed', lockPath };
  }

  const pid = metadata.pid || process.ppid || process.pid;
  const ownerId = metadata.ownerId || buildLockOwnerId({ ...metadata, pid });
  const ownsLock = existing.ownerId === ownerId && Number(existing.pid) === Number(pid);
  if (!ownsLock) return { released: false, reason: 'not-owner', lock: existing, lockPath };

  unlinkLock(lockPath);
  return { released: true, reason: 'owner', lockPath };
}

export function checkBuildAdmission(metadata = {}, options = {}) {
  const env = options.env || process.env;
  if (isBuildAdmissionDisabled(env)) {
    return { admitted: true, disabled: true, memory: null, lock: null };
  }

  const memory = probeAvailableMemory({ ...options, env });
  // Only deny on a trustworthy reading. The os.freemem fallback reports "free"
  // (not "available") memory — chronically low on macOS — so denying on it would
  // manufacture false blocks whenever the reliable probe (vm_stat / /proc/meminfo)
  // is unavailable. When the probe is unreliable we skip the memory denial; the
  // lock below still serializes concurrent heavy builds.
  const memoryProbeReliable = memory.source === 'darwin:vm_stat' || memory.source === 'linux:/proc/meminfo';
  if (memoryProbeReliable && !memory.ok) {
    return { admitted: false, reason: 'memory', message: MEMORY_BLOCK_MESSAGE, memory };
  }
  // memorySkipped: an unreliable probe reported below threshold but we did NOT
  // deny (see comment above). Surfaced so callers can make the bypass visible.
  const memorySkipped = !memoryProbeReliable && !memory.ok;

  const lock = acquireBuildLock(metadata, options);
  if (!lock.acquired && lock.reason === 'write-failed') {
    return { admitted: true, failOpen: true, reason: 'lock-write-failed', memory, lock, memorySkipped };
  }
  if (!lock.acquired) {
    return { admitted: false, reason: 'lock', message: LOCK_BLOCK_MESSAGE, memory, lock };
  }

  return { admitted: true, disabled: false, memory, lock, memorySkipped };
}
