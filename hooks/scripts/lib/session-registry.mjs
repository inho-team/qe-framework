/**
 * lib/session-registry.mjs
 * Active-session registry for multi-terminal awareness. This is intentionally
 * a simple JSON file plus atomic rename writes; IPC and file locks are out of
 * scope for this feature.
 */

import { readFileSync, existsSync } from './qe-fs.mjs';
import { join } from 'path';
import { atomicWriteJson } from './state.mjs';

export const SESSIONS_REGISTRY_FILE = '.qe/state/sessions-registry.json';
export const SESSION_STALE_MS = 2 * 60 * 60 * 1000;
export const SID_RE = /^[a-z0-9]{8}$/;

function registryPath(projectRoot) {
  return join(projectRoot, SESSIONS_REGISTRY_FILE);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePid(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * @param {unknown} entry
 * @returns {{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}|null}
 */
export function normalizeRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const sid = normalizeString(entry.sid);
  if (!SID_RE.test(sid)) return null;

  const lastSeen = normalizeString(entry.lastSeen);
  if (!lastSeen || Number.isNaN(new Date(lastSeen).getTime())) return null;

  return {
    sid,
    name: normalizeString(entry.name),
    plan: normalizeString(entry.plan),
    lastSeen,
    pid: normalizePid(entry.pid),
  };
}

/**
 * Read the registry as a filtered list. Missing/corrupt files safely return [].
 *
 * @param {string} projectRoot
 * @returns {Array<{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}>}
 */
export function readSessionRegistry(projectRoot) {
  if (!projectRoot) return [];
  const file = registryPath(projectRoot);
  if (!existsSync(file)) return [];

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const rawEntries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.sessions) ? parsed.sessions : []);
    return rawEntries.map(normalizeRegistryEntry).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {Array<object>} entries
 * @param {number} [nowMs]
 * @returns {Array<{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}>}
 */
export function filterActiveSessions(entries, nowMs = Date.now()) {
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeRegistryEntry)
    .filter(Boolean)
    .filter((entry) => nowMs - new Date(entry.lastSeen).getTime() <= SESSION_STALE_MS)
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

/**
 * Write the registry using the repo's existing atomic JSON helper.
 *
 * @param {string} projectRoot
 * @param {Array<object>} entries
 * @returns {Array<{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}>}
 */
export function writeSessionRegistry(projectRoot, entries) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(normalizeRegistryEntry)
    .filter(Boolean);
  atomicWriteJson(registryPath(projectRoot), { sessions: normalized });
  return normalized;
}

/**
 * Remove stale entries and persist the remaining active registry.
 *
 * @param {string} projectRoot
 * @param {number} [nowMs]
 * @returns {Array<{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}>}
 */
export function cleanupStaleSessions(projectRoot, nowMs = Date.now()) {
  const active = filterActiveSessions(readSessionRegistry(projectRoot), nowMs);
  writeSessionRegistry(projectRoot, active);
  return active;
}

/**
 * Upsert one active session. Invalid SIDs are ignored.
 *
 * @param {string} projectRoot
 * @param {{sid:string,name?:string,plan?:string,lastSeen?:string,pid?:number|null}} entry
 * @returns {Array<{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}>}
 */
export function upsertSession(projectRoot, entry) {
  const normalized = normalizeRegistryEntry({
    sid: entry?.sid,
    name: entry?.name || '',
    plan: entry?.plan || '',
    lastSeen: entry?.lastSeen || new Date().toISOString(),
    pid: entry?.pid ?? process.pid,
  });
  if (!normalized) return filterActiveSessions(readSessionRegistry(projectRoot));

  const existing = filterActiveSessions(readSessionRegistry(projectRoot))
    .filter((item) => item.sid !== normalized.sid);
  const next = [normalized, ...existing];
  writeSessionRegistry(projectRoot, next);
  return next;
}

/**
 * Remove one session by sid and also drop stale entries.
 *
 * @param {string} projectRoot
 * @param {string|null} sid
 * @returns {Array<{sid:string,name:string,plan:string,lastSeen:string,pid:number|null}>}
 */
export function removeSession(projectRoot, sid) {
  const active = filterActiveSessions(readSessionRegistry(projectRoot))
    .filter((entry) => entry.sid !== sid);
  writeSessionRegistry(projectRoot, active);
  return active;
}

