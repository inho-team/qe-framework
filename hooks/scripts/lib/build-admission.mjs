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
// Confirmation sampling for the memory gate. A single vm_stat reading is
// volatile on macOS (free+inactive swings as caches churn), so a lone dip must
// not manufacture a block. We re-sample only when the first reliable reading is
// below threshold, bounded by a small total delay so the happy path stays free.
export const DEFAULT_BUILD_MEM_SAMPLES = 3;
export const DEFAULT_BUILD_MEM_SAMPLE_GAP_MS = 120;
export const MAX_BUILD_MEM_SAMPLE_TOTAL_MS = 400;
// Exec timeout (ms) for the vm_stat probe. Bounds the initial reading — which
// runs before the confirmation deadline — so a hung vm_stat cannot stall tool
// admission indefinitely. On timeout the probe throws and drops to the (never-
// denying) os.freemem fallback, so a lower value trades probe reliability for a
// tighter worst-case latency ceiling.
export const DEFAULT_BUILD_MEM_PROBE_TIMEOUT_MS = 1000;
export const MEMORY_BLOCK_MESSAGE = 'insufficient free memory for a heavy build — wait and retry';
export const LOCK_BLOCK_MESSAGE = 'another heavy build holds the machine build lock — wait and retry';
// Back-compat alias for callers importing the pre-split constant (memory path).
export const BUILD_BLOCK_MESSAGE = MEMORY_BLOCK_MESSAGE;

const LOCK_FILE_NAME = 'qe-framework-build-admission.lock.json';

/**
 * Parse macOS `vm_stat` output into available MB (`free + inactive` pages).
 * Prefers the page size from the vm_stat header when present, else uses the
 * `pageSize` argument.
 *
 * @param {string} text - Raw `vm_stat` stdout.
 * @param {number} [pageSize=4096] - Fallback page size in bytes when no header.
 * @returns {number} Available memory in MB.
 */
export function parseVmStat(text, pageSize = 4096) {
  const str = String(text || '');
  // vm_stat's header reports the page size ("... (page size of 16384 bytes)").
  // Prefer it so the darwin probe needs no separate `pagesize` exec (one fewer
  // PATH-dependent call that could fail and force the unreliable os.freemem
  // fallback). The pageSize argument stays as the fallback / test override.
  const header = str.match(/page size of (\d+) bytes/i);
  const effectivePageSize = header ? Number.parseInt(header[1], 10) : pageSize;
  const values = {};
  for (const line of str.split('\n')) {
    const match = line.match(/^Pages\s+([^:]+):\s+([0-9.]+)/);
    if (!match) continue;
    values[match[1].trim().toLowerCase()] = Number.parseInt(match[2], 10);
  }
  const free = values.free || 0;
  const inactive = values.inactive || 0;
  return Math.floor(((free + inactive) * effectivePageSize) / 1024 / 1024);
}

/**
 * Parse Linux `/proc/meminfo` and return `MemAvailable` in MB.
 *
 * @param {string} text - Raw `/proc/meminfo` contents.
 * @returns {number|null} Available memory in MB, or null if `MemAvailable` absent.
 */
export function parseMeminfo(text) {
  const match = String(text || '').match(/^MemAvailable:\s+(\d+)\s+kB/im);
  if (!match) return null;
  return Math.floor(Number.parseInt(match[1], 10) / 1024);
}

/**
 * Minimum free memory (MB) required to admit a heavy build.
 * `QE_BUILD_MIN_FREE_MB` overrides; invalid/non-positive values fall back to
 * {@link DEFAULT_BUILD_MIN_FREE_MB}.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {number} Threshold in MB (> 0).
 */
export function getBuildThresholdMb(env = process.env) {
  const raw = env.QE_BUILD_MIN_FREE_MB;
  if (raw === undefined || raw === '') return DEFAULT_BUILD_MIN_FREE_MB;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUILD_MIN_FREE_MB;
}

/**
 * Number of memory samples the confirmation probe may take before denying.
 * Includes the first reading. `QE_BUILD_MEM_SAMPLES` overrides; invalid or
 * non-positive values fall back to {@link DEFAULT_BUILD_MEM_SAMPLES}.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {number} Sample count (>= 1).
 */
export function getBuildMemSamples(env = process.env) {
  const raw = env.QE_BUILD_MEM_SAMPLES;
  if (raw === undefined || raw === '') return DEFAULT_BUILD_MEM_SAMPLES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUILD_MEM_SAMPLES;
}

/**
 * Delay between confirmation samples in milliseconds. `QE_BUILD_MEM_SAMPLE_GAP_MS`
 * overrides; invalid or negative values fall back to
 * {@link DEFAULT_BUILD_MEM_SAMPLE_GAP_MS}. The total delay across all samples is
 * additionally capped by {@link MAX_BUILD_MEM_SAMPLE_TOTAL_MS}.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {number} Gap in ms (>= 0).
 */
export function getBuildMemSampleGapMs(env = process.env) {
  const raw = env.QE_BUILD_MEM_SAMPLE_GAP_MS;
  if (raw === undefined || raw === '') return DEFAULT_BUILD_MEM_SAMPLE_GAP_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUILD_MEM_SAMPLE_GAP_MS;
}

/**
 * Exec timeout (ms) for the vm_stat memory probe. `QE_BUILD_MEM_PROBE_TIMEOUT_MS`
 * overrides; invalid or non-positive values fall back to
 * {@link DEFAULT_BUILD_MEM_PROBE_TIMEOUT_MS}. Bounds the worst-case latency of the
 * initial probe, which runs outside the confirmation deadline.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {number} Probe timeout in ms (> 0).
 */
export function getBuildMemProbeTimeoutMs(env = process.env) {
  const raw = env.QE_BUILD_MEM_PROBE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_BUILD_MEM_PROBE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUILD_MEM_PROBE_TIMEOUT_MS;
}

/**
 * Whether the heavy-build gate is disabled via `QE_BUILD_ADMISSION=off`.
 *
 * @param {NodeJS.ProcessEnv} [env] - Environment to read.
 * @returns {boolean} True when the gate is turned off.
 */
export function isBuildAdmissionDisabled(env = process.env) {
  return String(env.QE_BUILD_ADMISSION || '').toLowerCase() === 'off';
}

/**
 * Resolve the machine-global lock file path. Precedence: explicit
 * `options.lockPath` → `QE_BUILD_LOCK_PATH` → `<os.tmpdir()>/{LOCK_FILE_NAME}`.
 *
 * @param {object} [options] - May carry `lockPath`.
 * @returns {string} Absolute lock file path.
 */
export function getBuildLockPath(options = {}) {
  return options.lockPath || process.env.QE_BUILD_LOCK_PATH || join(os.tmpdir(), LOCK_FILE_NAME);
}

/**
 * Compute the lock owner id as a sha256 over ONLY `{cwd, sessionId, pid}` — the
 * fields guaranteed identical between the acquire (PreToolUse) and release
 * (PostToolUse) payloads for the same build.
 *
 * @param {{cwd?:string, sessionId?:string, pid?:number}} [meta] - Identity fields.
 * @returns {string} Hex sha256 owner id.
 */
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

/**
 * Whether a shell command launches a heavy build/test that the gate serializes
 * (gradle/gradlew/mvn/mvnw, or `npm [run] build|test` with optional `:`/`-`
 * suffix). Uses {@link matchesExecutable} so quoted/heredoc data is not matched.
 *
 * @param {string} command - The shell command line.
 * @returns {boolean} True if it is a heavy build command.
 */
export function isHeavyBuildCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') return false;
  return (
    matchesExecutable(command, /(?:^|[;&|(\n`])\s*(?:\.\/)?(?:gradlew|gradle|mvnw|mvn)(?:\s|$)/) ||
    matchesExecutable(command, /(?:^|[;&|(\n`])\s*npm\s+(?:run\s+)?(?:build|test)(?:[:\-][\w:-]*)?(?:\s|$)/)
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

/**
 * Read available memory once, preferring a reliable platform source.
 *
 * On macOS reads `free+inactive` pages via `/usr/bin/vm_stat` (`darwin:vm_stat`);
 * on Linux reads `MemAvailable` from `/proc/meminfo` (`linux:/proc/meminfo`).
 * Falls back to `os.freemem()` (`fallback:os.freemem`) when the platform probe is
 * unavailable — a reading {@link checkBuildAdmission} never denies on, because it
 * reports "free" (not "available") memory and is chronically low on macOS. All
 * probe inputs (`platform`, `arch`, `execFileSync`, `readFileSync`, `freemem`,
 * `timeoutMs`, `env`) are injectable for testing.
 *
 * @param {object} [options] - Probe inputs / injection points.
 * @returns {{availableMb:number, thresholdMb:number, source:string, ok:boolean}}
 *   The reading, the active threshold, its source, and whether it clears threshold.
 */
export function probeAvailableMemory(options = {}) {
  const env = options.env || process.env;
  const thresholdMb = getBuildThresholdMb(env);
  const platform = options.platform || os.platform();
  const runExecFileSync = options.execFileSync || execFileSync;
  const runReadFileSync = options.readFileSync || readFileSync;
  const freemem = options.freemem || (() => os.freemem());
  // Per-probe exec timeout. Bounded down by the confirmation sampler so a hung
  // vm_stat on a re-probe cannot blow the overall wall-clock budget.
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.ceil(options.timeoutMs)
    : 1000;

  let availableMb = null;
  let source = 'fallback:os.freemem';

  if (platform === 'darwin') {
    try {
      // Absolute path so a hook subprocess with a stripped PATH still reaches the
      // reliable probe instead of silently dropping to the os.freemem fallback.
      // Page size comes from the vm_stat header (parseVmStat), so no separate
      // `pagesize` exec is needed.
      const vmStat = runExecFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: timeoutMs });
      // parseVmStat prefers the page size in the vm_stat header. The default is
      // only used if that header is ever absent — pick it by arch (Apple Silicon
      // = 16 KiB) so a missing header cannot 4x-under-report and manufacture a
      // false memory denial on arm64.
      const archPageSize = (options.arch || os.arch()) === 'arm64' ? 16384 : 4096;
      availableMb = parseVmStat(vmStat, archPageSize);
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

/**
 * PATH-independent synchronous sleep. Hooks run in a synchronous context, so we
 * block via Atomics.wait on a throwaway SharedArrayBuffer rather than shelling
 * out to `sleep` (which a stripped-PATH subprocess might not reach). Degrades to
 * a no-op if Atomics/SharedArrayBuffer are unavailable — samples then stay
 * spaced only by the probe's own exec time. Never throws.
 *
 * @param {number} ms - Milliseconds to block. Non-positive values return at once.
 */
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* Atomics/SharedArrayBuffer unavailable — skip the delay, never throw. */
  }
}

/**
 * Probe available memory with confirmation re-sampling to absorb transient dips.
 *
 * Fast path: the first reading is returned immediately when it is at/above
 * threshold (`ok`) — the common case pays zero extra latency. An unreliable
 * first reading (os.freemem fallback) is also returned as-is, because
 * {@link checkBuildAdmission} never denies on it and re-sampling would only
 * repeat an untrustworthy value. Only when the first *reliable* reading is below
 * threshold do we re-sample up to `samples` times total, spaced by `gapMs`. The
 * wall-clock deadline of {@link MAX_BUILD_MEM_SAMPLE_TOTAL_MS} (enforced via an
 * injectable `clock`) bounds ONLY the confirmation phase — the sleeps AND the
 * re-probe exec time together — and each re-probe also gets a shrinking exec
 * `timeoutMs` so one hung vm_stat cannot overrun it. Note the initial probe runs
 * BEFORE this deadline starts and uses its own default exec timeout (up to
 * ~1000ms), so worst-case total latency is roughly (first probe) + budget, not
 * the budget alone. The first sample that clears the threshold wins and admits;
 * if every reliable sample is below, the most favorable reliable reading is
 * returned so the denial reflects the best case.
 *
 * @param {object} [options] - Passes through to {@link probeAvailableMemory}. May
 *   also carry `probe`/`sleep`/`clock` (test injection), `samples`, `gapMs`,
 *   `totalBudgetMs`, and `env`.
 * @returns {{availableMb:number, thresholdMb:number, source:string, ok:boolean,
 *   samples:object[], sampleCount:number}} The decisive reading plus the sample trail.
 */
export function probeMemoryWithConfirmation(options = {}) {
  const env = options.env || process.env;
  const probe = options.probe || ((o) => probeAvailableMemory(o));
  const sleep = options.sleep || sleepSync;
  const clock = options.clock || (() => Date.now());
  const maxSamples = Math.max(1, options.samples || getBuildMemSamples(env));
  const gapMs = options.gapMs != null ? options.gapMs : getBuildMemSampleGapMs(env);
  const totalBudgetMs = Number.isFinite(options.totalBudgetMs) && options.totalBudgetMs >= 0
    ? options.totalBudgetMs
    : MAX_BUILD_MEM_SAMPLE_TOTAL_MS;

  // The initial probe runs outside the confirmation deadline, so give it its own
  // configurable exec timeout to cap worst-case admission latency.
  const firstTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : getBuildMemProbeTimeoutMs(env);
  const samples = [];
  const first = probe({ ...options, env, timeoutMs: firstTimeoutMs });
  samples.push(first);
  if (first.ok) {
    return { ...first, samples, sampleCount: samples.length };
  }
  const firstReliable = first.source === 'darwin:vm_stat' || first.source === 'linux:/proc/meminfo';
  if (!firstReliable) {
    return { ...first, samples, sampleCount: samples.length };
  }

  // `best` is the most favorable RELIABLE reading seen. It seeds from `first`
  // (reliable by the branch guard above) and only ever advances to another
  // reliable sample. A retry that drops to the untrustworthy os.freemem fallback
  // (e.g. a transient vm_stat failure) must NOT influence the decision: letting
  // its reading become `best` could hand checkBuildAdmission an unreliable source
  // that skips the denial, admitting a genuinely low machine. So unreliable
  // retries are recorded for diagnostics but never admit and never become `best`.
  const start = clock();
  let best = first;
  for (let i = 1; i < maxSamples; i++) {
    // Wall-clock budget covers BOTH the sleep and the re-probe exec, not just the
    // sleep — so a slow vm_stat cannot push total latency past the deadline.
    let remaining = totalBudgetMs - (clock() - start);
    if (remaining <= 0) break;
    const wait = Math.min(gapMs, remaining);
    if (wait > 0) sleep(wait);
    remaining = totalBudgetMs - (clock() - start);
    if (remaining <= 0) break;
    // Cap this probe's exec time to the remaining budget so it can't overrun.
    const next = probe({ ...options, env, timeoutMs: Math.max(1, Math.min(remaining, 1000)) });
    samples.push(next);
    const nextReliable = next.source === 'darwin:vm_stat' || next.source === 'linux:/proc/meminfo';
    if (nextReliable) {
      if (next.availableMb > best.availableMb) best = next;
      if (next.ok) {
        return { ...next, samples, sampleCount: samples.length };
      }
    }
  }
  // Every reliable sample was below threshold → return a reliable reading so the
  // caller denies. Any unreliable retry is intentionally not the reported value.
  return { ...best, samples, sampleCount: samples.length };
}

/**
 * Human-readable diagnostic for a memory denial: the live numbers a static
 * message hides, so an operator can tell *why* the gate fired instead of
 * guessing (e.g. mistaking it for a stale lock).
 *
 * @param {{availableMb:number, thresholdMb:number, source:string, sampleCount?:number}} memory
 * @returns {string} e.g. `800MB free < 1536MB required (darwin:vm_stat, 3× sampled)`.
 */
export function formatMemoryBlockDetail(memory) {
  if (!memory) return '';
  const sampled = memory.sampleCount ? `, ${memory.sampleCount}× sampled` : '';
  return `${memory.availableMb}MB free < ${memory.thresholdMb}MB required (${memory.source}${sampled})`;
}

/**
 * Human-readable diagnostic for a lock denial: which process holds the machine
 * build lock, for how long, and from where — so a leaked/foreign lock is
 * diagnosable at the point of blocking.
 *
 * @param {object} lock - Either an acquire result (`{lock: record}`) or a raw
 *   lock record with `pid`/`createdAt`/`cwd`.
 * @param {number} [now] - Reference time in ms (injectable for tests).
 * @returns {string} e.g. `held by pid 4242 for 5min cwd /repo` (parts with no
 *   value are omitted).
 */
export function formatLockBlockDetail(lock, now = Date.now()) {
  const rec = lock && lock.lock ? lock.lock : lock;
  if (!rec || typeof rec !== 'object') return '';
  const parts = [];
  if (rec.pid != null) parts.push(`held by pid ${rec.pid}`);
  const createdMs = Date.parse(rec.createdAt || rec.timestamp || '');
  if (Number.isFinite(createdMs)) {
    const ageMin = Math.max(0, Math.round((now - createdMs) / 60000));
    parts.push(`for ${ageMin}min`);
  }
  if (rec.cwd) parts.push(`cwd ${rec.cwd}`);
  return parts.join(' ');
}

/**
 * Read and parse the lock file. Returns null when absent, or a
 * `{malformed:true, path}` sentinel when the JSON is corrupt (so callers can
 * reap it rather than block forever).
 *
 * @param {object} [options] - May carry `lockPath`.
 * @returns {object|null} The lock record, a malformed sentinel, or null.
 */
export function readBuildLock(options = {}) {
  const lockPath = getBuildLockPath(options);
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return { malformed: true, path: lockPath };
  }
}

/**
 * Decide whether an existing lock is stale and may be reaped. Stale when
 * malformed, timestamp invalid, older than `maxAgeMs`, the holding pid is
 * confirmed dead, or the pid liveness is unknown AND past max age.
 *
 * @param {object} lock - The lock record (or malformed sentinel).
 * @param {object} [options] - May carry `now`, `maxAgeMs`, `isProcessAlive`.
 * @returns {{stale:boolean, reason:string}} Verdict and its reason code.
 */
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

/**
 * Best-effort unlink of the lock file. Treats an already-absent file as success.
 *
 * @param {string} lockPath - Lock file path.
 * @returns {boolean} True if the file is gone after the call.
 */
function unlinkLock(lockPath) {
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return !existsSync(lockPath);
  }
}

/**
 * Atomically acquire the machine-global build lock (O_EXCL `wx` write). If the
 * file already exists, reaps it when {@link isBuildLockStale} says so and retries
 * once; otherwise reports the live holder.
 *
 * @param {object} [metadata] - Owner fields (`pid`, `ownerId`, `cwd`, `command`,
 *   `sessionId`, `toolUseId`).
 * @param {object} [options] - May carry `lockPath`, `now`, `isProcessAlive`, etc.
 * @returns {{acquired:boolean, reason?:string, lock?:object, lockPath:string, error?:string}}
 *   Acquisition result.
 */
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

/**
 * Release the build lock only if the caller owns it (matching `ownerId` AND
 * `pid`). A malformed lock is unlinked; a foreign lock is left untouched.
 *
 * @param {object} [metadata] - Owner fields used to recompute the owner id.
 * @param {object} [options] - May carry `lockPath`.
 * @returns {{released:boolean, reason:string, lock?:object, lockPath:string}} Result.
 */
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

/**
 * Top-level heavy-build admission decision. Order: disabled switch → memory gate
 * (confirmation-sampled; denies only on a reliable below-threshold reading) →
 * machine-global lock (fail-open on write error, deny on a live holder). Denials
 * carry a `detail` string with the live diagnostic numbers.
 *
 * @param {object} [metadata] - Lock owner metadata (see {@link deriveBuildLockMetadata}).
 * @param {object} [options] - Probe/lock injection points and `env`.
 * @returns {{admitted:boolean, reason?:string, message?:string, detail?:string,
 *   memory:object|null, lock:object|null, disabled?:boolean, failOpen?:boolean,
 *   memorySkipped?:boolean}} The admission verdict.
 */
export function checkBuildAdmission(metadata = {}, options = {}) {
  const env = options.env || process.env;
  if (isBuildAdmissionDisabled(env)) {
    return { admitted: true, disabled: true, memory: null, lock: null };
  }

  // Confirmation sampling absorbs a lone macOS free+inactive dip so a healthy
  // machine is not falsely blocked; a passing first reading still costs nothing.
  const memory = probeMemoryWithConfirmation({ ...options, env });
  // Only deny on a trustworthy reading. The os.freemem fallback reports "free"
  // (not "available") memory — chronically low on macOS — so denying on it would
  // manufacture false blocks whenever the reliable probe (vm_stat / /proc/meminfo)
  // is unavailable. When the probe is unreliable we skip the memory denial; the
  // lock below still serializes concurrent heavy builds.
  const memoryProbeReliable = memory.source === 'darwin:vm_stat' || memory.source === 'linux:/proc/meminfo';
  if (memoryProbeReliable && !memory.ok) {
    // detail carries the live numbers so the block is self-diagnosing.
    return { admitted: false, reason: 'memory', message: MEMORY_BLOCK_MESSAGE, detail: formatMemoryBlockDetail(memory), memory };
  }
  // memorySkipped: an unreliable probe reported below threshold but we did NOT
  // deny (see comment above). Surfaced so callers can make the bypass visible.
  const memorySkipped = !memoryProbeReliable && !memory.ok;

  const lock = acquireBuildLock(metadata, options);
  if (!lock.acquired && lock.reason === 'write-failed') {
    return { admitted: true, failOpen: true, reason: 'lock-write-failed', memory, lock, memorySkipped };
  }
  if (!lock.acquired) {
    // detail names the holding pid/age/cwd so a foreign or leaked lock is
    // diagnosable at the block instead of being mistaken for a memory issue.
    return { admitted: false, reason: 'lock', message: LOCK_BLOCK_MESSAGE, detail: formatLockBlockDetail(lock, options.now), memory, lock };
  }

  return { admitted: true, disabled: false, memory, lock, memorySkipped };
}
