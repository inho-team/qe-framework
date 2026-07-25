// Adapted from oh-my-claudecode (MIT, © 2025 Yeachan Heo).
// See https://github.com/Yeachan-Heo/oh-my-claudecode for original.
'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from './qe-fs.mjs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

const WINDOW_SECONDS = 3600; // 1-hour sliding window
const COUNTERS_FILE = 'retry-counters.json';

/**
 * Atomic JSON write: write to tmp then rename to avoid corruption.
 * @param {string} filePath
 * @param {object} data
 */
function atomicWrite(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, filePath);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

/**
 * Read the counters map from disk. Returns {} on missing/corrupt file.
 * @param {string} stateDir
 * @returns {{ [signature: string]: { count: number, windowStart: number } }}
 */
function readCounters(stateDir) {
  const filePath = join(stateDir, COUNTERS_FILE);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write the counters map to disk.
 * @param {string} stateDir
 * @param {{ [signature: string]: { count: number, windowStart: number } }} counters
 */
function writeCounters(stateDir, counters) {
  atomicWrite(join(stateDir, COUNTERS_FILE), counters);
}

/**
 * Record a failure for the given command signature.
 * Resets the window if the existing entry is older than WINDOW_SECONDS.
 *
 * @param {string} commandSignature - Unique identifier for the command.
 * @param {string} stateDir - Path to the .qe/state directory.
 * @returns {{ count: number, windowStart: number }}
 */
export function recordFailure(commandSignature, stateDir) {
  const now = Math.floor(Date.now() / 1000);
  const counters = readCounters(stateDir);

  const existing = counters[commandSignature];
  if (!existing || now - existing.windowStart > WINDOW_SECONDS) {
    // Start a fresh window
    counters[commandSignature] = { count: 1, windowStart: now };
  } else {
    counters[commandSignature].count += 1;
  }

  writeCounters(stateDir, counters);
  return { ...counters[commandSignature] };
}

/**
 * Get the current failure count for a signature (0 if unknown or expired).
 *
 * @param {string} commandSignature
 * @param {string} stateDir
 * @returns {number}
 */
export function getCount(commandSignature, stateDir) {
  const now = Math.floor(Date.now() / 1000);
  const counters = readCounters(stateDir);
  const entry = counters[commandSignature];
  if (!entry) return 0;
  if (now - entry.windowStart > WINDOW_SECONDS) return 0;
  return entry.count;
}

/**
 * Reset the counter for a command signature.
 *
 * @param {string} commandSignature
 * @param {string} stateDir
 */
export function resetCounter(commandSignature, stateDir) {
  const counters = readCounters(stateDir);
  delete counters[commandSignature];
  writeCounters(stateDir, counters);
}
