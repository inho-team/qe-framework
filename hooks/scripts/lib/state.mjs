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
 * Get unified state path
 */
export function getUnifiedStatePath(cwd) {
  return join(cwd, '.qe', 'state', 'unified-state.json');
}

/**
 * Read unified state (stats, intent, feedback, etc.)
 */
export function readUnifiedState(cwd) {
  const filePath = getUnifiedStatePath(cwd);
  if (!existsSync(filePath)) return {};

  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Write unified state atomically
 */
export function writeUnifiedState(cwd, state) {
  const filePath = getUnifiedStatePath(cwd);
  atomicWriteJson(filePath, state);
}

const MEMO_FILE_LIMIT = 10 * 1024; // 10KB
const MEMO_TOTAL_LIMIT = 100 * 1024; // 100KB

/**
 * Initialize memo structure if needed
 */
function ensureMemo(state) {
  if (!state.memo) state.memo = { files: {}, meta: {}, total_size: 0, blocked_reads: 0 };
  if (!state.memo.meta) state.memo.meta = {};
  if (state.memo.blocked_reads === undefined) state.memo.blocked_reads = 0;
  return state.memo;
}

/**
 * Update ContextMemo with file content and metadata
 */
export function updateContextMemo(state, filePath, content) {
  const memo = ensureMemo(state);

  if (content.length > MEMO_FILE_LIMIT) return;

  // Evict old entries if total size exceeded
  const contentSize = Buffer.byteLength(content, 'utf8');
  while (memo.total_size + contentSize > MEMO_TOTAL_LIMIT) {
    const firstKey = Object.keys(memo.files)[0];
    if (!firstKey) break;
    memo.total_size -= Buffer.byteLength(memo.files[firstKey], 'utf8');
    delete memo.files[firstKey];
    delete memo.meta[firstKey];
  }

  memo.files[filePath] = content;
  memo.meta[filePath] = {
    readAt: Date.now(),
    modifiedSince: false,
    contentSize
  };
  memo.total_size += contentSize;
}

/**
 * Get ContextMemo for a file
 */
export function getContextMemo(state, filePath) {
  return state?.memo?.files?.[filePath] || null;
}

/**
 * Get ContextMemo metadata for a file
 */
export function getContextMemoMeta(state, filePath) {
  return state?.memo?.meta?.[filePath] || null;
}

/**
 * Check if a file has a valid (non-stale) memo cache entry.
 * Returns true if the file was previously read AND has not been modified since.
 */
export function isMemoValid(state, filePath) {
  const meta = state?.memo?.meta?.[filePath];
  if (!meta) return false;
  return !meta.modifiedSince && !!state?.memo?.files?.[filePath];
}

/**
 * Mark a file as modified in the memo cache.
 * Called by post-tool-use when Write/Edit targets a cached file.
 */
export function markMemoModified(state, filePath) {
  const memo = ensureMemo(state);
  if (memo.meta[filePath]) {
    memo.meta[filePath].modifiedSince = true;
  }
  // Also remove cached content since it's now stale
  if (memo.files[filePath]) {
    memo.total_size -= Buffer.byteLength(memo.files[filePath], 'utf8');
    delete memo.files[filePath];
  }
}

/**
 * Increment the blocked reads counter
 */
export function incrementBlockedReads(state) {
  const memo = ensureMemo(state);
  memo.blocked_reads = (memo.blocked_reads || 0) + 1;
  return memo.blocked_reads;
}

/**
 * Get the blocked reads count
 */
export function getBlockedReads(state) {
  return state?.memo?.blocked_reads || 0;
}

/**
 * Invalidate ContextMemo for a file (full removal)
 */
export function invalidateContextMemo(state, filePath) {
  if (state?.memo?.files?.[filePath]) {
    state.memo.total_size -= Buffer.byteLength(state.memo.files[filePath], 'utf8');
    delete state.memo.files[filePath];
  }
  if (state?.memo?.meta?.[filePath]) {
    delete state.memo.meta[filePath];
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
 * Get the default legacy Claude project instruction file path.
 *
 * New client-neutral code should prefer `.qe/TASK_LOG.md` for task state and
 * discover project instruction artifacts (`CLAUDE.md`, `AGENTS.md`, or a
 * QE-managed equivalent) at the call site. This helper remains for legacy task
 * table fallback compatibility.
 */
export function getClaudePath(cwd) {
  return join(cwd, 'CLAUDE.md');
}

/**
 * Get the legacy project instruction fallback path used when `.qe/TASK_LOG.md`
 * is absent. Kept separate from getTaskRegistryPath so callers do not need to
 * name a Claude-specific file when they only need a fallback registry.
 */
export function getLegacyInstructionFallbackPath(cwd) {
  return getClaudePath(cwd);
}

/**
 * Get task registry path, preferring `.qe/TASK_LOG.md` over legacy `CLAUDE.md`
 */
export function getTaskRegistryPath(cwd) {
  const taskLogPath = join(cwd, '.qe', 'TASK_LOG.md');
  if (existsSync(taskLogPath)) return taskLogPath;
  return getLegacyInstructionFallbackPath(cwd);
}

/**
 * Parse a markdown task table into objects
 */
export function parseTaskTable(filePath) {
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const tasks = [];
    let inTable = false;

    for (const line of lines) {
      if (line.includes('| Status | UUID |') || line.includes('| UUID | Status |')) {
        inTable = true;
        continue;
      }
      if (inTable && line.includes('|') && !line.includes('---')) {
        const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
        if (parts.length >= 2) {
          tasks.push({
            status: parts[0],
            uuid: parts[1],
            name: parts[2] || '',
            line
          });
        }
      } else if (inTable && line.trim() === '') {
        inTable = false;
      }
    }
    return tasks;
  } catch {
    return [];
  }
}

/**
 * Parse the active task registry into objects
 */
export function parseClaudeTaskTable(cwd) {
  return parseTaskTable(getTaskRegistryPath(cwd));
}

/**
 * Update task status in a markdown task registry table
 */
export function updateTaskStatus(filePath, uuid, newStatus) {
  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let updated = false;

    const newLines = lines.map(line => {
      if (line.includes(`| ${uuid} |`) || line.includes(` ${uuid} `)) {
        const parts = line.split('|');
        if (parts.length >= 3) {
          if (parts[1].trim().length <= 3) {
            parts[1] = ` ${newStatus} `;
          } else if (parts[2].trim().length <= 3) {
            parts[2] = ` ${newStatus} `;
          }
          updated = true;
          return parts.join('|');
        }
      }
      return line;
    });

    if (updated) {
      writeFileSync(filePath, newLines.join('\n'), 'utf8');
    }
    return updated;
  } catch {
    return false;
  }
}

/**
 * Update task status in the active task registry
 */
export function updateClaudeStatus(cwd, uuid, newStatus) {
  return updateTaskStatus(getTaskRegistryPath(cwd), uuid, newStatus);
}

/**
 * Get current working directory
 */
export function getCwd() {
  return process.cwd();
}

/**
 * Get a namespace from unified state. Returns the namespace object,
 * or an empty object if the namespace does not exist.
 *
 * @param {object} state - Unified state object (from readUnifiedState)
 * @param {string} ns - Namespace key (e.g., 'ralph', 'utopia', 'sivs')
 * @returns {object} The namespace data
 */
export function getNamespace(state, ns) {
  if (!state || !ns) return {};
  return state[ns] || {};
}

/**
 * Set a namespace in unified state and persist to disk.
 * Merges the data into state[ns] and writes the full state.
 *
 * @param {string} cwd - Project root directory
 * @param {object} state - Unified state object (from readUnifiedState)
 * @param {string} ns - Namespace key
 * @param {object} data - Data to set in the namespace
 */
export function setNamespace(cwd, state, ns, data) {
  if (!state || !ns) return;
  state[ns] = data;
  writeUnifiedState(cwd, state);
}
