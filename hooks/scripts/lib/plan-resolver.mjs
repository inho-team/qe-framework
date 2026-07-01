/**
 * lib/plan-resolver.mjs
 *
 * Named Plan resolver. A project can carry multiple planning streams under
 * `.qe/planning/plans/{slug}/` simultaneously, so consumer skills
 * need a shared lookup for "which plan does this session care about?".
 *
 * Resolution order:
 *   1. Per-session binding   → .qe/planning/.sessions/{sessionId}.json
 *   2. Project-wide pointer  → .qe/planning/ACTIVE_PLAN  (last-activated slug)
 *   3. Legacy flat layout    → .qe/planning/ROADMAP.md exists, no plans/{slug}/
 *
 * Every lookup is best-effort; failures return null so callers degrade to
 * the legacy flat files instead of surfacing a stack trace.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PLANS_DIR = '.qe/planning/plans';
const SESSIONS_DIR = '.qe/planning/.sessions';
const ACTIVE_POINTER = '.qe/planning/ACTIVE_PLAN';
const FLAT_ROADMAP = '.qe/planning/ROADMAP.md';
const FLAT_STATE = '.qe/planning/STATE.md';

// Memoize (projectRoot, sessionId) → slug|null for the life of the Node
// process. Several skill paths call resolveActivePlanSlug
// multiple times per response; session_id is immutable within a Claude
// session, so the fs reads are redundant. Null results are cached too so
// negative lookups stay cheap. Call clearPlanResolverCache() to reset
// (used by tests; production relies on process termination).
const _slugCache = new Map();
const _cacheKey = (projectRoot, sessionId) => `${projectRoot}:${sessionId || ''}`;

/**
 * Resolve the active plan slug for a session.
 *
 * @param {string} projectRoot absolute project root
 * @param {string|null} [sessionId] active session id
 * @returns {string|null} slug, or null when no named plan applies (caller uses legacy)
 */
export function resolveActivePlanSlug(projectRoot, sessionId) {
  if (!projectRoot) return null;

  const key = _cacheKey(projectRoot, sessionId);
  if (_slugCache.has(key)) return _slugCache.get(key);

  const slug = _resolveActivePlanSlugUncached(projectRoot, sessionId);
  _slugCache.set(key, slug);
  return slug;
}

function _resolveActivePlanSlugUncached(projectRoot, sessionId) {
  // 1. Session-scoped binding
  if (sessionId) {
    const sessionFile = join(projectRoot, SESSIONS_DIR, `${sessionId}.json`);
    if (existsSync(sessionFile)) {
      try {
        const data = JSON.parse(readFileSync(sessionFile, 'utf8'));
        const slug = normalizeSlug(data?.activePlanSlug);
        if (slug && planExists(projectRoot, slug)) return slug;
      } catch {
        // malformed — fall through
      }
    }
  }

  // 2. Project-wide pointer
  const pointer = join(projectRoot, ACTIVE_POINTER);
  if (existsSync(pointer)) {
    try {
      const slug = normalizeSlug(readFileSync(pointer, 'utf8'));
      if (slug && planExists(projectRoot, slug)) return slug;
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Reset the resolver's slug cache. Intended for test isolation — production
 * callers rely on Node process termination to clear entries.
 */
export function clearPlanResolverCache() {
  _slugCache.clear();
}

/**
 * Return the path to the STATE.md for the active plan, or the flat STATE.md
 * fallback when no named plan is resolvable.
 *
 * @param {string} projectRoot
 * @param {string|null} [sessionId]
 * @returns {string|null} absolute path to a readable STATE.md, or null if none exists
 */
export function resolveStatePath(projectRoot, sessionId) {
  if (!projectRoot) return null;
  const slug = resolveActivePlanSlug(projectRoot, sessionId);
  if (slug) {
    const p = join(projectRoot, PLANS_DIR, slug, 'STATE.md');
    if (existsSync(p)) return p;
  }
  const flat = join(projectRoot, FLAT_STATE);
  return existsSync(flat) ? flat : null;
}

/**
 * Return the path to the ROADMAP.md for the active plan, or the flat fallback.
 *
 * @param {string} projectRoot
 * @param {string|null} [sessionId]
 * @returns {string|null}
 */
export function resolveRoadmapPath(projectRoot, sessionId) {
  if (!projectRoot) return null;
  const slug = resolveActivePlanSlug(projectRoot, sessionId);
  if (slug) {
    const p = join(projectRoot, PLANS_DIR, slug, 'ROADMAP.md');
    if (existsSync(p)) return p;
  }
  const flat = join(projectRoot, FLAT_ROADMAP);
  return existsSync(flat) ? flat : null;
}

/**
 * Validate and normalize a plan slug. Only accepts the canonical shape
 * `[a-z0-9][a-z0-9-]{0,63}` — anything that could traverse paths or carry
 * whitespace is rejected so the resolver can't point outside `plans/`.
 *
 * @param {unknown} raw untrusted slug from session file, pointer, or args
 * @returns {string|null} the trimmed slug, or null when invalid
 */
function normalizeSlug(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) return null;
  return s;
}

/**
 * Check whether `.qe/planning/plans/{slug}/` exists on disk. Used to guard
 * against stale session pointers referencing a deleted plan.
 *
 * @param {string} projectRoot
 * @param {string} slug normalized slug
 * @returns {boolean}
 */
function planExists(projectRoot, slug) {
  return existsSync(join(projectRoot, PLANS_DIR, slug));
}
