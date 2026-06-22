/**
 * lib/session-resolver.mjs
 *
 * Per-session partitioning for Qcompact / Qresume artifacts. Multiple Claude
 * terminals can run against the same project in parallel, so context snapshots
 * and handoff documents must live under their own session directory instead
 * of a shared flat path that the next terminal would clobber.
 *
 * Layout:
 *   .qe/context/sessions/{sid}/snapshot.md
 *   .qe/context/sessions/{sid}/SNAPSHOT_SUMMARY.md
 *   .qe/context/sessions/{sid}/decisions.md
 *   .qe/context/sessions/{sid}/compact-trigger.json
 *   .qe/handoffs/sessions/{sid}/HANDOFF_{date}_{time}.md
 *
 * The {sid} is an 8-char prefix of the Claude Code session id — short enough
 * for human-friendly directory names, wide enough that practical collision
 * across concurrent project sessions is negligible (<= dozens of sessions).
 *
 * Auto-naming only. There is no user-supplied slug; if the resolver cannot
 * find a session id it falls back to the `_unknown` bucket so writes never
 * fail silently. Pre-partition snapshots are migrated once into `_legacy`
 * the first time a session starts after the upgrade.
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const STATE_FILE = '.qe/state/current-session.json';
const CONTEXT_BASE = '.qe/context';
const HANDOFF_BASE = '.qe/handoffs';
const SESSIONS_SUBDIR = 'sessions';
const LEGACY_BUCKET = '_legacy';
const UNKNOWN_BUCKET = '_unknown';

// Manual `/Qcompact` handoffs are written as HANDOFF_{date}_{time}.md inside
// the handoff bucket. The prefix lets the resolver recognize them generically
// without parsing the date — newest-by-mtime is sufficient for "resume latest".
const HANDOFF_PREFIX = 'HANDOFF_';

// Files we look for inside each session bucket when listing snapshots.
// Migration of pre-partition flat copies of these files lives in
// `lib/legacy-migrator.mjs` so the registry stays in one place.
const SESSION_CONTEXT_FILES = [
  'snapshot.md',
  'SNAPSHOT_SUMMARY.md',
  'decisions.md',
  'compact-trigger.json'
];

// Subset of the above that represents actually-restorable context. A bucket
// holding ONLY `compact-trigger.json` (a pre-compact marker, not a restore
// payload) has nothing meaningful to resume — so the trigger alone must not
// suppress fallback to a real handoff saved under another sid. This is the
// exact case that broke the original /Qcompact → /Qresume handoff.
const SESSION_RESTORABLE_FILES = [
  'snapshot.md',
  'SNAPSHOT_SUMMARY.md',
  'decisions.md'
];

/**
 * Shorten a raw Claude Code session id into the 8-char auto-name used for
 * session directories. Strips hyphens (UUID style) before slicing so the
 * resulting prefix is from the high-entropy head, not the dash region.
 *
 * @param {unknown} raw session id from hook payload or state file
 * @returns {string|null} 8-char `[a-z0-9]` slug, or null when invalid
 */
export function shortenSid(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toLowerCase().replace(/-/g, '').replace(/[^a-z0-9]/g, '');
  if (cleaned.length < 8) return null;
  const sid = cleaned.slice(0, 8);
  return /^[a-z0-9]{8}$/.test(sid) ? sid : null;
}

/**
 * Validate a slug used as an on-disk session directory name. Accepts the
 * 8-char auto-name shape and the two reserved bucket names. Rejects anything
 * that could escape the sessions/ root (`..`, slashes, whitespace).
 *
 * @param {unknown} raw bucket name from caller or directory listing
 * @returns {string|null}
 */
export function normalizeSidBucket(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === LEGACY_BUCKET || s === UNKNOWN_BUCKET) return s;
  return /^[a-z0-9]{8}$/.test(s) ? s : null;
}

/**
 * Resolve the current Claude session's short sid by reading the pointer file
 * the SessionStart hook writes. Returns null when the file is absent or the
 * stored id fails validation — callers fall back to the `_unknown` bucket.
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
export function readCurrentSid(projectRoot) {
  if (!projectRoot) return null;
  const p = join(projectRoot, STATE_FILE);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return shortenSid(data?.session_id ?? data?.sessionId);
  } catch {
    return null;
  }
}

/**
 * Resolve the sid to use for this call: explicit override → state file →
 * `_unknown` bucket. Always returns a writable bucket so writers never have
 * to special-case "no session" — bookkeeping still survives even when the
 * pointer is missing (e.g., hook never ran).
 *
 * @param {string} projectRoot
 * @param {string|null} [overrideSid] short sid passed explicitly by caller
 * @returns {string} bucket name guaranteed to be safe for join()
 */
export function resolveSid(projectRoot, overrideSid) {
  return normalizeSidBucket(overrideSid)
    ?? readCurrentSid(projectRoot)
    ?? UNKNOWN_BUCKET;
}

/**
 * Path to the per-session context directory. Creating the directory is the
 * caller's responsibility — use `ensureSessionDirs` when about to write.
 *
 * @param {string} projectRoot
 * @param {string|null} [sid]
 * @returns {string}
 */
export function getSessionContextDir(projectRoot, sid) {
  const bucket = resolveSid(projectRoot, sid);
  return join(projectRoot, CONTEXT_BASE, SESSIONS_SUBDIR, bucket);
}

/**
 * Path to the per-session handoff directory.
 *
 * @param {string} projectRoot
 * @param {string|null} [sid]
 * @returns {string}
 */
export function getSessionHandoffDir(projectRoot, sid) {
  const bucket = resolveSid(projectRoot, sid);
  return join(projectRoot, HANDOFF_BASE, SESSIONS_SUBDIR, bucket);
}

/**
 * mkdir -p both per-session directories. Returns the resolved sid so the
 * caller can include it in log lines.
 *
 * @param {string} projectRoot
 * @param {string|null} [sid]
 * @returns {{ sid: string, contextDir: string, handoffDir: string }}
 */
export function ensureSessionDirs(projectRoot, sid) {
  const bucket = resolveSid(projectRoot, sid);
  const contextDir = join(projectRoot, CONTEXT_BASE, SESSIONS_SUBDIR, bucket);
  const handoffDir = join(projectRoot, HANDOFF_BASE, SESSIONS_SUBDIR, bucket);
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(handoffDir, { recursive: true });
  return { sid: bucket, contextDir, handoffDir };
}

/**
 * List directory entries without throwing — returns [] for missing or
 * unreadable directories so callers can union multiple roots unconditionally.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function safeReaddir(dir) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Find the most recent `HANDOFF_*.md` inside a handoff bucket directory.
 * Manual `/Qcompact` handoffs land in `.qe/handoffs/sessions/{sid}/`, NOT in
 * the context domain, so resume must look here too — this is the helper that
 * makes a handoff-only bucket discoverable.
 *
 * @param {string} dir absolute path to a handoff session dir
 * @returns {{ path: string, mtimeMs: number } | null}
 */
export function latestHandoffIn(dir) {
  let best = null;
  for (const name of safeReaddir(dir)) {
    if (!name.startsWith(HANDOFF_PREFIX) || !name.endsWith('.md')) continue;
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
    } catch {
      // skip unreadable file
    }
  }
  return best;
}

/**
 * Enumerate available session buckets for `/Qresume --list`, unioned across
 * BOTH domains — `.qe/context/sessions/` (automatic snapshots) and
 * `.qe/handoffs/sessions/` (manual handoffs). A bucket surfaced purely by a
 * durable handoff (no auto-snapshot) is a valid restore target, so it must
 * appear here; the previous context-only scan hid exactly those buckets and
 * was the root cause of `/Qcompact` → `/Qresume` missing each other.
 *
 * @param {string} projectRoot
 * @returns {Array<{ sid: string, mtimeMs: number, hasSnapshot: boolean, hasHandoff: boolean }>}
 */
export function listSessionBuckets(projectRoot) {
  if (!projectRoot) return [];
  const contextRoot = join(projectRoot, CONTEXT_BASE, SESSIONS_SUBDIR);
  const handoffRoot = join(projectRoot, HANDOFF_BASE, SESSIONS_SUBDIR);

  /** @type {Map<string, { sid: string, mtimeMs: number, hasSnapshot: boolean, hasHandoff: boolean }>} */
  const buckets = new Map();
  const ensure = (sid) => {
    let b = buckets.get(sid);
    if (!b) {
      b = { sid, mtimeMs: 0, hasSnapshot: false, hasHandoff: false };
      buckets.set(sid, b);
    }
    return b;
  };

  // Context domain: a valid-named bucket counts even when empty (mtime 0).
  for (const name of safeReaddir(contextRoot)) {
    if (!normalizeSidBucket(name)) continue;
    const dir = join(contextRoot, name);
    const b = ensure(name);
    for (const f of SESSION_CONTEXT_FILES) {
      const p = join(dir, f);
      if (!existsSync(p)) continue;
      try {
        const st = statSync(p);
        if (st.mtimeMs > b.mtimeMs) b.mtimeMs = st.mtimeMs;
        if (f === 'snapshot.md') b.hasSnapshot = true;
      } catch {
        // skip unreadable file
      }
    }
  }

  // Handoff domain: only counts a bucket that actually holds a handoff file.
  for (const name of safeReaddir(handoffRoot)) {
    if (!normalizeSidBucket(name)) continue;
    const latest = latestHandoffIn(join(handoffRoot, name));
    if (!latest) continue;
    const b = ensure(name);
    b.hasHandoff = true;
    if (latest.mtimeMs > b.mtimeMs) b.mtimeMs = latest.mtimeMs;
  }

  const out = [...buckets.values()];
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * Single source of truth for what a resume should load — used by BOTH the
 * Qresume skill and Qcompact's RESUME workflow so their behavior cannot
 * diverge again. Resolves the active sid, gathers its context files and latest
 * handoff across both domains, and — only when the active sid is empty in both
 * AND no explicit `--from` was given — falls back to the newest other bucket.
 *
 * @param {string} projectRoot
 * @param {string|null} [overrideSid] explicit `--from {sid}` target
 * @returns {{
 *   sid: string,
 *   requestedSid: string,
 *   source: 'active' | 'fallback' | 'empty',
 *   fellBackFrom: string | null,
 *   contextDir: string,
 *   contextFiles: string[],
 *   handoffDir: string,
 *   latestHandoff: string | null,
 *   isEmpty: boolean
 * }}
 */
export function resolveResumeContext(projectRoot, overrideSid) {
  const requestedSid = resolveSid(projectRoot, overrideSid);
  const explicit = normalizeSidBucket(overrideSid) != null;

  const describe = (sid) => {
    const contextDir = join(projectRoot, CONTEXT_BASE, SESSIONS_SUBDIR, sid);
    const handoffDir = join(projectRoot, HANDOFF_BASE, SESSIONS_SUBDIR, sid);
    const contextFiles = SESSION_CONTEXT_FILES
      .map((f) => join(contextDir, f))
      .filter((p) => existsSync(p));
    const hasRestorable = SESSION_RESTORABLE_FILES
      .some((f) => existsSync(join(contextDir, f)));
    const latest = latestHandoffIn(handoffDir);
    return {
      sid,
      contextDir,
      handoffDir,
      contextFiles, // includes compact-trigger.json so the caller can still read it
      latestHandoff: latest ? latest.path : null,
      // ...but a lone compact-trigger.json does NOT count as restorable.
      isEmpty: !hasRestorable && !latest,
    };
  };

  const active = describe(requestedSid);
  // Honor an explicit --from even when empty: the user asked for that bucket.
  if (!active.isEmpty || explicit) {
    return {
      ...active,
      requestedSid,
      source: active.isEmpty ? 'empty' : 'active',
      fellBackFrom: null,
    };
  }

  // Active sid empty in both domains — fall back to the newest other bucket.
  // listSessionBuckets unions handoff-only buckets, so a durable handoff saved
  // under a prior sid (the exact failure that motivated this) is reachable.
  const candidates = listSessionBuckets(projectRoot).filter((b) => b.sid !== requestedSid);
  if (candidates.length === 0) {
    return { ...active, requestedSid, source: 'empty', fellBackFrom: null };
  }
  const fallback = describe(candidates[0].sid);
  return { ...fallback, requestedSid, source: 'fallback', fellBackFrom: requestedSid };
}
