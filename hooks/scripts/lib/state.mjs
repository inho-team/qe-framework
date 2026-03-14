#!/usr/bin/env node
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Get state directory path
 * @param {string} cwd - Project root
 * @param {string} [sessionId] - Optional session ID for isolation
 */
export function getStateDir(cwd, sessionId) {
  if (sessionId) {
    return join(cwd, '.qe', 'state', 'sessions', sessionId);
  }
  return join(cwd, '.qe', 'state');
}

/**
 * Atomic write JSON file (write to tmp, then rename)
 */
export function atomicWriteJson(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = join(dir, `.tmp-${randomBytes(6).toString('hex')}.json`);
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Cleanup tmp file on failure
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

/**
 * Read state for a mode
 * @returns {object|null} State object or null if not found/stale
 */
export function readState(cwd, mode, sessionId) {
  const stateDir = getStateDir(cwd, sessionId);
  const filePath = join(stateDir, `${mode}-state.json`);

  if (!existsSync(filePath)) {
    // Fallback to legacy (non-session) path
    if (sessionId) {
      return readState(cwd, mode, null);
    }
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const state = JSON.parse(raw);

    // Staleness check
    if (state.started_at) {
      const age = Date.now() - new Date(state.started_at).getTime();
      if (age > STALE_MS) return null;
    }

    return state.active ? state : null;
  } catch {
    return null;
  }
}

/**
 * Write state for a mode
 */
export function writeState(cwd, mode, state, sessionId) {
  const stateDir = getStateDir(cwd, sessionId);
  const filePath = join(stateDir, `${mode}-state.json`);

  const data = {
    ...state,
    active: true,
    started_at: state.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    session_id: sessionId || state.session_id || 'unknown',
  };

  atomicWriteJson(filePath, data);
  return data;
}

/**
 * Clear state for a mode
 */
export function clearState(cwd, mode, sessionId) {
  const stateDir = getStateDir(cwd, sessionId);
  const filePath = join(stateDir, `${mode}-state.json`);

  if (existsSync(filePath)) {
    try { unlinkSync(filePath); } catch {}
  }

  // Also try legacy path
  if (sessionId) {
    const legacyPath = join(cwd, '.qe', 'state', `${mode}-state.json`);
    if (existsSync(legacyPath)) {
      try { unlinkSync(legacyPath); } catch {}
    }
  }
}

/**
 * List all active modes
 */
export function listActiveModes(cwd, sessionId) {
  const stateDir = getStateDir(cwd, sessionId);
  if (!existsSync(stateDir)) return [];

  const active = [];
  try {
    const files = readdirSync(stateDir).filter(f => f.endsWith('-state.json'));
    for (const file of files) {
      const mode = file.replace('-state.json', '');
      const state = readState(cwd, mode, sessionId);
      if (state) {
        active.push({ mode, state });
      }
    }
  } catch {}

  return active;
}

/**
 * Read stdin JSON helper
 */
export function readStdinJson() {
  try {
    const input = readFileSync('/dev/stdin', 'utf8');
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/**
 * Get cwd from stdin data
 */
export function getCwd(data) {
  return data?.cwd || data?.directory || process.cwd();
}
