// Adapted from oh-my-claudecode (MIT, © 2025 Yeachan Heo).
// See https://github.com/Yeachan-Heo/oh-my-claudecode for original.
'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from './qe-fs.mjs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

const TRACKER_FILE = 'iteration-tracker.json';

/**
 * Atomic JSON write.
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
 * Read the tracker map from disk.
 * @param {string} stateDir
 * @returns {{ [sessionId: string]: { count: number, lastActivity: number } }}
 */
function readTracker(stateDir) {
  const filePath = join(stateDir, TRACKER_FILE);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write the tracker map to disk.
 * @param {string} stateDir
 * @param {object} tracker
 */
function writeTracker(stateDir, tracker) {
  atomicWrite(join(stateDir, TRACKER_FILE), tracker);
}

/**
 * Record a new iteration for the session.
 * Increments count and updates lastActivity to the current epoch (seconds).
 *
 * @param {string} sessionId
 * @param {string} stateDir
 * @returns {{ count: number, lastActivity: number }}
 */
export function recordIteration(sessionId, stateDir) {
  const now = Math.floor(Date.now() / 1000);
  const tracker = readTracker(stateDir);

  const existing = tracker[sessionId];
  tracker[sessionId] = {
    count: existing ? existing.count + 1 : 1,
    lastActivity: now,
  };

  writeTracker(stateDir, tracker);
  return { ...tracker[sessionId] };
}

/**
 * Get the current state for a session, or null if not found.
 *
 * @param {string} sessionId
 * @param {string} stateDir
 * @returns {{ count: number, lastActivity: number } | null}
 */
export function getState(sessionId, stateDir) {
  const tracker = readTracker(stateDir);
  return tracker[sessionId] ?? null;
}

/**
 * Reset iteration tracking for a session.
 *
 * @param {string} sessionId
 * @param {string} stateDir
 */
export function resetSession(sessionId, stateDir) {
  const tracker = readTracker(stateDir);
  delete tracker[sessionId];
  writeTracker(stateDir, tracker);
}
