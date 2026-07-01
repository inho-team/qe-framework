// Adapted from oh-my-claudecode (MIT, © 2025 Yeachan Heo).
// See https://github.com/Yeachan-Heo/oh-my-claudecode for original.
'use strict';

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, randomBytes } from 'crypto';
import { CONTEXT_POLICY_DEFAULTS } from './context-policy.mjs';

const BLOCKS_FILE = 'context-blocks.json';
const CACHE_FILE = 'context-cache.json';
const CACHE_TTL_MS = 60 * 1000; // live context readings are short-lived
const TAIL_BYTES = 8192; // read last 8 KB of transcript for efficiency

function cacheFileForScope(scope) {
  if (!scope || typeof scope !== 'object') return CACHE_FILE;
  const client = typeof scope.client === 'string' && scope.client ? scope.client : 'unknown';
  const sessionId = typeof scope.sessionId === 'string' && scope.sessionId
    ? scope.sessionId
    : (typeof scope.session_id === 'string' && scope.session_id ? scope.session_id : '');
  const modelId = typeof scope.modelId === 'string' && scope.modelId ? normalizeModelId(scope.modelId) : '';
  const key = [client, sessionId || 'no-session', modelId || 'no-model'].join(':');
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `context-cache.${digest}.json`;
}

function cachePath(projectDir, scope) {
  return join(projectDir, '.qe', 'state', cacheFileForScope(scope));
}

/**
 * Write a live context-window ratio to disk so the Stop hook can consume it.
 * Optionally persists the true context-window limit (200k vs 1M) so the
 * transcript fallback can pick the right denominator even after the cache
 * goes stale. Best-effort — silently skips on any error.
 *
 * @param {string} projectDir project root
 * @param {number} usedPercentage 0..100 from a live context-window payload
 * @param {number} [limit] true context-window token limit (see deriveContextLimit)
 */
export function writeCachedRatio(projectDir, usedPercentage, limit, scope) {
  if (!projectDir || typeof usedPercentage !== 'number') return;
  try {
    const dir = join(projectDir, '.qe', 'state');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload = { ratio: usedPercentage / 100, ts: Date.now() };
    if (typeof limit === 'number' && limit > 0) {
      payload.limit = limit;
    } else {
      // Preserve any previously persisted TTL-exempt limit. The window size is
      // constant for the whole session, so a redraw frame that momentarily
      // can't re-derive it (e.g. total_input_tokens absent → deriveContextLimit
      // returns null) must NOT clobber the cached limit by overwriting the file
      // with a bare {ratio, ts}. Dropping it reopens the sub-200k 1M blind spot.
      const prev = readCachedLimit(projectDir, scope);
      if (prev) payload.limit = prev;
    }
    const tmp = join(dir, `.tmp-ctx-${randomBytes(6).toString('hex')}.json`);
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, cachePath(projectDir, scope));
  } catch { /* best-effort */ }
}

/**
 * Persist ONLY the true context-window limit, merging into any existing cache
 * entry without disturbing a fresh ratio/ts. This is the session-guidance
 * path: when a transcript reading deterministically proves the 1M tier (observed
 * tokens past the 200k base), callers record it here so every later reading in
 * the session — including sub-200k dips after a compaction — uses the right
 * denominator. The limit is TTL-exempt (constant per session), so a bare
 * `{ limit }` entry is valid even with no ratio. No-op when unchanged.
 *
 * @param {string} projectDir project root
 * @param {number} limit true context-window token limit (e.g. 1000000)
 */
export function writeCachedLimit(projectDir, limit, scope) {
  if (!projectDir || typeof limit !== 'number' || limit <= 0) return;
  try {
    const dir = join(projectDir, '.qe', 'state');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = cachePath(projectDir, scope);
    let payload = {};
    if (existsSync(p)) {
      try { payload = JSON.parse(readFileSync(p, 'utf8')) || {}; } catch { payload = {}; }
    }
    if (payload.limit === limit) return; // already persisted — avoid churn
    payload.limit = limit;
    const tmp = join(dir, `.tmp-ctx-${randomBytes(6).toString('hex')}.json`);
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, p);
  } catch { /* best-effort */ }
}

/**
 * Read the cached true context-window limit (in tokens) persisted alongside
 * the ratio. Unlike {@link readCachedRatio} this does NOT
 * enforce the staleness TTL: a model's window size is constant for the whole
 * session, so an "old" limit is still correct. This is what lets the transcript
 * fallback in context-guard / context-monitor pick the right denominator
 * (200k vs 1M) even when Claude Code has stripped the `[1m]` marker from the
 * model id AND token usage is still below 200k — the exact blind spot where the
 * id-based and observed-tokens heuristics both fail.
 *
 * @param {string} projectDir
 * @returns {number|null} limit in tokens, or null when absent/invalid.
 */
export function readCachedLimit(projectDir, scope) {
  if (!projectDir) return null;
  try {
    const p = cachePath(projectDir, scope);
    if (!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof obj?.limit !== 'number' || obj.limit <= 0) return null;
    return obj.limit;
  } catch { return null; }
}

/**
 * Read an explicitly configured context-window limit, independent of the
 * live payload. This is the escape hatch for setups where the cache is not
 * populated and the
 * derive/back-solve path never runs, so a 1M run is silently scored against the
 * 200k default and over-warns from ~140k tokens. Precedence:
 *   1. QE_CONTEXT_LIMIT env var (per-shell override)
 *   2. .qe/config.json → hooks.context_window_limit (committed, project-wide)
 *
 * @param {string} projectDir
 * @param {{includeProjectConfig?: boolean}} [opts]
 * @returns {number|null} configured limit in tokens, or null when unset/invalid.
 */
export function readConfiguredLimit(projectDir, opts = {}) {
  const envVal = process.env.QE_CONTEXT_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (opts.includeProjectConfig === false) return null;
  if (!projectDir) return null;
  try {
    const p = join(projectDir, '.qe', 'config.json');
    if (!existsSync(p)) return null;
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    const v = cfg?.hooks?.context_window_limit ?? cfg?.context_window_limit;
    if (typeof v === 'number' && v > 0) return v;
  } catch { /* best-effort */ }
  return null;
}

function collectJsonlFiles(dir, out = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectJsonlFiles(full, out);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
    }
  } catch {
    return out;
  }
  return out;
}

function extractCodexWindow(file, threadId) {
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    let found = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const payload = entry?.payload;
      if (!payload || typeof payload !== 'object') continue;
      if (threadId && payload.turn_id && payload.turn_id !== threadId) continue;
      const value = typeof payload.info?.model_context_window === 'number'
        ? payload.info.model_context_window
        : payload.model_context_window;
      if (typeof value === 'number' && value > 0) found = value;
    }
    return found;
  } catch {
    return null;
  }
}

export function readNativeCodexWindow() {
  const home = process.env.CODEX_HOME || (process.env.HOME ? join(process.env.HOME, '.codex') : '');
  if (!home) return null;
  const sessionsDir = join(home, 'sessions');
  if (!existsSync(sessionsDir)) return null;
  const threadId = process.env.CODEX_THREAD_ID || '';
  const files = collectJsonlFiles(sessionsDir)
    .map((file) => {
      try { return { file, mtime: statSync(file).mtimeMs }; } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 40);
  for (const { file } of files) {
    const value = extractCodexWindow(file, threadId);
    if (value) return value;
  }
  return null;
}

/**
 * Whether a model id is concrete enough to key a durable limit on. Rejects
 * empty/absent ids and Claude Code's `<synthetic>` placeholder (used for
 * injected non-model messages), which must never be persisted as a real tier.
 *
 * @param {string|undefined|null} id
 * @returns {boolean}
 */
function isUsableModelId(id) {
  return typeof id === 'string' && id.length > 0 && id !== '<synthetic>';
}

/**
 * Read a DURABLE, model-keyed context-window limit auto-detected in a prior
 * session. Unlike {@link readCachedRatio}/{@link readCachedLimit}, this lives in
 * the committed-style `.qe/config.json` (not the volatile `.qe/state/` cache),
 * so it survives a full state-folder wipe (`/Qsweep`, manual cleanup) — the
 * exact event that otherwise forces re-detection from scratch and reopens the
 * "1M run scored against 200k" false-pressure window.
 *
 * Keyed by model id so a later switch to a genuinely 200k model does NOT inherit
 * a stale 1M limit. The model id from the hooks payload is already `[1m]`-stripped
 * (e.g. `claude-opus-4-8`), so the key is the stripped form on both write and read.
 *
 * Precedence note for callers: this sits BELOW the manual `context_window_limit`
 * override (see {@link readConfiguredLimit}) — a human-set value always wins.
 *
 * @param {string} projectDir
 * @param {string} modelId hooks-payload model id (stripped form)
 * @returns {number|null} detected limit in tokens, or null when absent/invalid.
 */
export function readDetectedLimit(projectDir, modelId) {
  if (!projectDir || !isUsableModelId(modelId)) return null;
  try {
    const p = join(projectDir, '.qe', 'config.json');
    if (!existsSync(p)) return null;
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    const map = cfg?.hooks?.context_window_limits;
    if (!map || typeof map !== 'object') return null;
    // Fast path: exact key. Otherwise match marker-insensitively so a key set
    // from the env-visible `[1m]` form (e.g. `claude-opus-4-8[1m]`) still resolves
    // the `[1m]`-stripped lookup the hooks payload actually carries.
    const direct = map[modelId];
    if (typeof direct === 'number' && direct > 0) return direct;
    const want = normalizeModelId(modelId);
    for (const [k, v] of Object.entries(map)) {
      if (normalizeModelId(k) === want && typeof v === 'number' && v > 0) return v;
    }
  } catch { /* best-effort */ }
  return null;
}

/**
 * Persist a DETERMINISTICALLY detected context-window limit to the durable,
 * model-keyed `.qe/config.json` store read by {@link readDetectedLimit}. This is
 * the backbone of self-correction: once any consumer proves the true tier
 * (payload back-solve, or an observed token count past the 200k base), it is
 * remembered across sessions AND across state-folder wipes, so the detection
 * happens once rather than every cold start.
 *
 * Merge-safe (preserves other `hooks` keys and top-level config), atomic, and a
 * no-op when the value is unchanged. Callers pass only the confidently-resolved
 * tier (e.g. 1000000) — never
 * a guessed default. Best-effort: silently skips on any error or unusable id.
 *
 * @param {string} projectDir
 * @param {string} modelId hooks-payload model id (stripped form)
 * @param {number} limit detected limit in tokens (e.g. 1000000)
 */
export function writeDetectedLimit(projectDir, modelId, limit) {
  if (!projectDir || !isUsableModelId(modelId)) return;
  if (typeof limit !== 'number' || limit <= 0) return;
  try {
    const p = join(projectDir, '.qe', 'config.json');
    let cfg = {};
    if (existsSync(p)) {
      try { cfg = JSON.parse(readFileSync(p, 'utf8')) || {}; } catch { cfg = {}; }
    }
    if (!cfg.hooks || typeof cfg.hooks !== 'object') cfg.hooks = {};
    const map = (cfg.hooks.context_window_limits && typeof cfg.hooks.context_window_limits === 'object')
      ? cfg.hooks.context_window_limits
      : {};
    // Canonicalize the key: store under the marker-stripped form so a value set
    // from any source (hooks payload, transcript, or a human copying the
    // env-visible `[1m]` id) collapses to ONE entry — never a silent mismatch.
    const key = normalizeModelId(modelId);
    let changed = false;
    for (const k of Object.keys(map)) {
      if (k !== key && normalizeModelId(k) === key) { delete map[k]; changed = true; }
    }
    if (map[key] === limit && !changed) return; // already canonical — avoid churn
    map[key] = limit;
    cfg.hooks.context_window_limits = map;
    atomicWrite(p, cfg);
  } catch { /* best-effort */ }
}

/**
 * Derive the true context-window token limit from a live `context_window`
 * payload by back-solving `limit = total_input_tokens / (used_percentage/100)`
 * and snapping to the nearest canonical tier.
 *
 * Claude Code reports `used_percentage` against the REAL window (1M for `[1m]`
 * models) but strips the `[1m]` marker from the model id, so this back-solve is
 * the only reliable in-band signal of which tier is active. The current Claude
 * lineup has exactly two tiers (200k / 1M) with no middle ground, so we snap to
 * a tier rather than trust the raw quotient (which carries rounding noise from
 * the integer percentage). The 400k split sits in the empty gap between tiers,
 * so even worst-case percentage rounding can't push one tier across it.
 *
 * @param {object} cw - the `context_window` object from a live payload.
 * @returns {number|null} 200000 or 1000000, or null when underivable.
 */
export function deriveContextLimit(cw) {
  if (!cw || typeof cw !== 'object') return null;
  const pct = cw.used_percentage;
  const input = cw.total_input_tokens;
  if (typeof pct !== 'number' || pct <= 0) return null;
  if (typeof input !== 'number' || input <= 0) return null;
  const raw = input / (pct / 100);
  return raw > CONTEXT_POLICY_DEFAULTS.tier_split_tokens
    ? CONTEXT_POLICY_DEFAULTS.extended_window_tokens
    : CONTEXT_POLICY_DEFAULTS.default_window_tokens;
}

/**
 * Resolve the limit for a live context frame.
 *
 * Live payload back-solving wins over stored values because stored cache/config can
 * be stale from a previous model tier. This prevents a stale 200k file from
 * pinning a current 1M session to the wrong denominator.
 *
 * @param {string} projectDir project root
 * @param {object} cw live context_window payload
 * @param {string} [modelId] hooks-payload model id
 * @returns {number|null}
 */
export function resolveLiveContextLimit(projectDir, cw, modelId, scope) {
  return deriveContextLimit(cw)
    ?? readConfiguredLimit(projectDir, { includeProjectConfig: false })
    ?? readDetectedLimit(projectDir, modelId)
    ?? readCachedLimit(projectDir, scope)
    ?? null;
}

// Points by which the live payload must exceed the transcript reading
// before we treat the payload as stale (the post-/clear / post-compact case).
// Normal sessions track within a few points, so a 15-point gap is well clear of
// rounding/timing noise yet small enough to catch a real reset.
export const STALE_DISPLAY_MARGIN = 15;

/**
 * Reconcile the percentage from two sources: a live payload reading and a
 * transcript-derived reading.
 *
 * After `/clear` (or `/compact`) Claude Code can keep reporting the pre-reset
 * percentage for a while, while the fresh transcript already reflects the real,
 * lower fill. This is deflate-only: when the payload sits `margin`+ points ABOVE
 * the transcript, the payload is stale → return the transcript value; otherwise
 * the payload wins (it is normally the more authoritative, model-aware reading).
 * It never inflates a payload reading, so a healthy high-context session is left
 * untouched.
 *
 * @param {number} payloadPct integer 0–100 from a live payload, or null
 * @param {number} transcriptPct integer 0–100 derived from the transcript, or null
 * @param {number} [margin] override the staleness threshold (points)
 * @returns {number|null} the percentage to display
 */
export function reconcileDisplayPercentage(payloadPct, transcriptPct, margin = STALE_DISPLAY_MARGIN) {
  if (typeof payloadPct !== 'number') return (typeof transcriptPct === 'number') ? transcriptPct : null;
  if (typeof transcriptPct !== 'number') return payloadPct;
  return (payloadPct - transcriptPct >= margin) ? transcriptPct : payloadPct;
}

/**
 * Read the cached ratio if present and fresh. Returns null when absent/stale/invalid.
 * @param {string} projectDir
 * @returns {number|null} ratio in [0, 1]
 */
export function readCachedRatio(projectDir, scope) {
  if (!projectDir) return null;
  try {
    const p = cachePath(projectDir, scope);
    if (!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof obj?.ratio !== 'number' || typeof obj?.ts !== 'number') return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return Math.max(0, Math.min(1, obj.ratio));
  } catch { return null; }
}

/**
 * Drop the cached usage ratio while preserving the TTL-exempt window limit.
 *
 * The ratio cache is scoped by client/session/model and exists only as a
 * <60s bridge of the current live reading to the Stop hook / auto-compaction
 * monitor. At a session boundary — most importantly
 * `/clear`, which resets the conversation to ~0 while Claude Code keeps
 * reporting the pre-clear percentage for one more frame — that cached ratio is
 * stale-high and would make context-guard / context-monitor raise false
 * context-pressure warnings or blocks. Removing it forces those consumers to
 * fall back to transcript-based estimation, which reflects the real (cleared)
 * state. The `limit` field is kept because the model's window size is constant
 * across a `/clear` and still serves as the transcript-fallback denominator.
 *
 * Best-effort: silently no-ops when the cache is absent or unreadable.
 *
 * @param {string} projectDir project root
 */
export function invalidateCachedRatio(projectDir, scope) {
  if (!projectDir) return;
  try {
    const p = cachePath(projectDir, scope);
    if (!existsSync(p)) return;
    let obj;
    try { obj = JSON.parse(readFileSync(p, 'utf8')); } catch { obj = null; }
    const limit = (obj && typeof obj.limit === 'number' && obj.limit > 0) ? obj.limit : null;
    if (limit === null) {
      // Nothing worth keeping — remove the whole file so no stale ratio survives.
      try { unlinkSync(p); } catch { /* best-effort */ }
      return;
    }
    // Preserve only the session-constant limit; drop ratio/ts.
    const dir = join(projectDir, '.qe', 'state');
    const tmp = join(dir, `.tmp-ctx-${randomBytes(6).toString('hex')}.json`);
    writeFileSync(tmp, JSON.stringify({ limit }), 'utf8');
    renameSync(tmp, p);
  } catch { /* best-effort */ }
}

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
 * Read blocks map from disk.
 * @param {string} stateDir
 * @returns {{ [sessionId: string]: number }}
 */
function readBlocks(stateDir) {
  const filePath = join(stateDir, BLOCKS_FILE);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write blocks map to disk.
 * @param {string} stateDir
 * @param {object} blocks
 */
function writeBlocks(stateDir, blocks) {
  atomicWrite(join(stateDir, BLOCKS_FILE), blocks);
}

/**
 * Map a Claude model id to its context-window token limit.
 * Recognizes explicit `[1m]`, `-1m`, or trailing `1m` markers as the 1M variant;
 * everything else (including unknown ids) falls back to 200k.
 *
 * @param {string|undefined|null} modelId
 * @returns {number} token limit
 */
export function modelIdToLimit(modelId) {
  if (!modelId || typeof modelId !== 'string') return CONTEXT_POLICY_DEFAULTS.default_window_tokens;
  if (/\[1m\]|-1m\b|1m$/i.test(modelId)) return CONTEXT_POLICY_DEFAULTS.extended_window_tokens;
  return CONTEXT_POLICY_DEFAULTS.default_window_tokens;
}

/**
 * Canonicalize a model id for keying the durable limit store. Claude Code strips
 * the 1M window marker from BOTH the hooks payload and the transcript model
 * field, but humans (and the model-facing env string) keep it — so a key set
 * from one source must still match a lookup from another, or the detection
 * silently mismatches and a 1M run over-warns forever. Drops a trailing
 * `[1m]` / `-1m` / `1m` marker; passes other ids (and non-strings) through.
 *
 * @param {string|undefined|null} modelId
 * @returns {string|undefined|null} marker-stripped id
 */
export function normalizeModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') return modelId;
  return modelId.replace(/\s*(?:\[1m\]|-1m|1m)$/i, '').trim();
}

/**
 * Estimate the context usage ratio (0..1) by reading the transcript file.
 *
 * Walks tail JSONL lines in reverse and returns the ratio from the most
 * recent assistant `message.usage` entry. While walking, also picks up the
 * `message.model` as a secondary limit hint. NOTE: Claude Code strips the
 * `[1m]` marker from the transcript model field too (it records the bare
 * `claude-opus-4-8`), so below 200k the marker is NOT recoverable from the
 * transcript — the >200k deterministic upgrade and the cached/configured limit
 * are the real signals for telling a low-fill 1M run from a 200k run.
 *
 * Limit precedence:
 *   1. explicit `modelLimit` argument (number)
 *   2. explicit `opts.modelId` (string) resolved via modelIdToLimit
 *   3. QE_CONTEXT_LIMIT environment variable
 *   4. model id discovered in the transcript
 *   5. 200000 default
 *
 * @param {string} transcriptPath - Path to the Claude Code transcript file.
 * @param {number|{modelId?: string, modelLimit?: number}} [opts] -
 *   Back-compat: a bare number is treated as an explicit modelLimit.
 * @returns {number} Ratio between 0 and 1. Returns 0 if no usage entry found.
 */
export function estimateUsageRatio(transcriptPath, opts) {
  const u = estimateUsage(transcriptPath, opts);
  return u ? u.ratio : 0;
}

/**
 * Like {@link estimateUsageRatio} but also returns the raw token count and the
 * resolved context-window limit, so callers can persist a deterministically
 * detected 1M tier (see {@link writeCachedLimit}). This is what lets a session
 * that has crossed 200k once stay correctly scored even when a later reading
 * (e.g. after a compaction) dips back below 200k.
 *
 * @param {string} transcriptPath - Path to the Claude Code transcript file.
 * @param {number|{modelId?: string, modelLimit?: number}} [opts] -
 *   Back-compat: a bare number is treated as an explicit modelLimit.
 * @returns {{ ratio: number, tokens: number, limit: number }|null}
 *   null when the file is missing or no usable usage entry is found.
 */
export function estimateUsage(transcriptPath, opts) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;

  const explicitLimit = typeof opts === 'number'
    ? opts
    : (opts && typeof opts === 'object' ? opts.modelLimit : undefined);
  const hintModelId = (opts && typeof opts === 'object') ? opts.modelId : undefined;

  try {
    const stat = statSync(transcriptPath);
    let readLength = Math.min(TAIL_BYTES, stat.size);
    let position = stat.size - readLength;
    let tail = readTail(transcriptPath, position, readLength);

    // Expand window once if the tail doesn't contain any usage block.
    if (!/"usage"\s*:/.test(tail) && stat.size > TAIL_BYTES) {
      readLength = Math.min(TAIL_BYTES * 8, stat.size);
      position = stat.size - readLength;
      tail = readTail(transcriptPath, position, readLength);
    }

    // Walk lines end-to-start. The first line may be cut mid-line at the
    // byte-window boundary — malformed entries are simply skipped.
    const lines = tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line[0] !== '{') continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const usage = entry?.message?.usage;
      if (!usage) continue;
      const tokens = (usage.input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0)
        + (usage.cache_creation_input_tokens ?? 0);
      if (tokens <= 0) continue;

      const limit = resolveLimit({
        explicitLimit,
        hintModelId,
        transcriptModelId: entry?.message?.model,
        observedTokens: tokens,
      });
      return { ratio: Math.min(tokens / limit, 1), tokens, limit };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the context-window token limit for a usage reading, applying the
 * precedence documented on {@link estimateUsageRatio}: explicit limit →
 * hinted model id → QE_CONTEXT_LIMIT env → transcript model id → 200k default.
 * As a last-resort safety net, an observed token count already past the base
 * limit deterministically upgrades to the 1M tier (the lineup has no middle
 * tier), but this only fires above 200k — below it, a cached/explicit limit is
 * the only way to tell a low-fill 1M run from a 200k run.
 *
 * @param {object} args
 * @param {number} [args.explicitLimit] caller-supplied limit (highest priority)
 * @param {string} [args.hintModelId] model id hint resolved via modelIdToLimit
 * @param {string} [args.transcriptModelId] model id discovered in the transcript
 * @param {number} [args.observedTokens] live token count, for the >limit upgrade
 * @returns {number} resolved token limit
 */
function resolveLimit({ explicitLimit, hintModelId, transcriptModelId, observedTokens }) {
  // 1. Caller-supplied limit (e.g. the cached true window) is authoritative.
  if (typeof explicitLimit === 'number' && explicitLimit > 0) return explicitLimit;
  // 2. Explicit user override via env beats any id-based guess.
  const envVal = process.env.QE_CONTEXT_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // 3. Best id-based guess: take the LARGER of the hook hint and the transcript
  // model id. A stripped id (200k) from one source must not shadow a sibling
  // source that still carries the `[1m]` marker (1M). Claude Code currently
  // strips both, so this resolves to 200k today — but it future-proofs the day
  // either source keeps the marker, instead of letting a stripped hint win.
  const hintLimit = hintModelId ? modelIdToLimit(hintModelId) : 0;
  const txLimit = transcriptModelId ? modelIdToLimit(transcriptModelId) : 0;
  let limit = Math.max(hintLimit, txLimit, CONTEXT_POLICY_DEFAULTS.default_window_tokens);
  // 4. Safety net: Claude Code strips the `[1m]` marker from both the hint and
  // the transcript model field, so a bare id resolves to the 200k base even on
  // a 1M run. A reading already past that base can only be the larger variant
  // (the lineup has no middle tier) — upgrade deterministically. This MUST run
  // even when a hint was given, otherwise the bare-id 200k short-circuits it.
  if (typeof observedTokens === 'number' && observedTokens > limit) {
    limit = CONTEXT_POLICY_DEFAULTS.extended_window_tokens;
  }
  return limit;
}

/**
 * Read `length` bytes from `filePath` starting at byte `position`.
 * @param {string} filePath
 * @param {number} position
 * @param {number} length
 * @returns {string} UTF-8 decoded slice.
 */
function readTail(filePath, position, length) {
  const buf = Buffer.alloc(length);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buf, 0, length, position);
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8');
}

/**
 * Increment the block count for a session and return the new count.
 *
 * @param {string} sessionId
 * @param {string} stateDir
 * @returns {number} New block count.
 */
export function recordBlock(sessionId, stateDir) {
  const blocks = readBlocks(stateDir);
  blocks[sessionId] = (blocks[sessionId] ?? 0) + 1;
  writeBlocks(stateDir, blocks);
  return blocks[sessionId];
}

/**
 * Reset block counter for a session.
 *
 * @param {string} sessionId
 * @param {string} stateDir
 */
export function resetBlocks(sessionId, stateDir) {
  const blocks = readBlocks(stateDir);
  delete blocks[sessionId];
  writeBlocks(stateDir, blocks);
}

/**
 * Get the current block count for a session (0 if not found).
 *
 * @param {string} sessionId
 * @param {string} stateDir
 * @returns {number}
 */
export function getBlockCount(sessionId, stateDir) {
  const blocks = readBlocks(stateDir);
  return blocks[sessionId] ?? 0;
}
