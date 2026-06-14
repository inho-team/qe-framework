// Adapted from oh-my-claudecode (MIT, © 2025 Yeachan Heo).
// See https://github.com/Yeachan-Heo/oh-my-claudecode for original.
'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

const BLOCKS_FILE = 'context-blocks.json';
const CACHE_FILE = 'context-cache.json';
const CACHE_TTL_MS = 60 * 1000; // statusline fires frequently; 60s is safe staleness
const TAIL_BYTES = 8192; // read last 8 KB of transcript for efficiency

/**
 * Write the authoritative ratio reported by Claude Code (statusline payload's
 * `context_window.used_percentage`) to disk so the Stop hook can consume it.
 * Optionally persists the true context-window limit (200k vs 1M) so the
 * transcript fallback can pick the right denominator even after the cache
 * goes stale. Best-effort — silently skips on any error.
 *
 * @param {string} projectDir project root
 * @param {number} usedPercentage 0..100 from statusline payload
 * @param {number} [limit] true context-window token limit (see deriveContextLimit)
 */
export function writeCachedRatio(projectDir, usedPercentage, limit) {
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
      const prev = readCachedLimit(projectDir);
      if (prev) payload.limit = prev;
    }
    const tmp = join(dir, `.tmp-ctx-${randomBytes(6).toString('hex')}.json`);
    writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    renameSync(tmp, join(dir, CACHE_FILE));
  } catch { /* best-effort */ }
}

/**
 * Persist ONLY the true context-window limit, merging into any existing cache
 * entry without disturbing a fresh ratio/ts. This is the statusline-independent
 * path: when a transcript reading deterministically proves the 1M tier (observed
 * tokens past the 200k base), callers record it here so every later reading in
 * the session — including sub-200k dips after a compaction — uses the right
 * denominator. The limit is TTL-exempt (constant per session), so a bare
 * `{ limit }` entry is valid even with no ratio. No-op when unchanged.
 *
 * @param {string} projectDir project root
 * @param {number} limit true context-window token limit (e.g. 1000000)
 */
export function writeCachedLimit(projectDir, limit) {
  if (!projectDir || typeof limit !== 'number' || limit <= 0) return;
  try {
    const dir = join(projectDir, '.qe', 'state');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = join(dir, CACHE_FILE);
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
 * Read the cached true context-window limit (in tokens) persisted by the
 * statusline alongside the ratio. Unlike {@link readCachedRatio} this does NOT
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
export function readCachedLimit(projectDir) {
  if (!projectDir) return null;
  try {
    const p = join(projectDir, '.qe', 'state', CACHE_FILE);
    if (!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof obj?.limit !== 'number' || obj.limit <= 0) return null;
    return obj.limit;
  } catch { return null; }
}

/**
 * Read an explicitly configured context-window limit, independent of the
 * statusline. This is the escape hatch for setups where the HUD statusline is
 * not wired up: with no statusline, the cache is never populated and the
 * derive/back-solve path never runs, so a 1M run is silently scored against the
 * 200k default and over-warns from ~140k tokens. Precedence:
 *   1. QE_CONTEXT_LIMIT env var (per-shell override)
 *   2. .qe/config.json → hooks.context_window_limit (committed, project-wide)
 *
 * @param {string} projectDir
 * @returns {number|null} configured limit in tokens, or null when unset/invalid.
 */
export function readConfiguredLimit(projectDir) {
  const envVal = process.env.QE_CONTEXT_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
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

/**
 * Derive the true context-window token limit from a statusline `context_window`
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
 * @param {object} cw - the `context_window` object from the statusline payload.
 * @returns {number|null} 200000 or 1000000, or null when underivable.
 */
export function deriveContextLimit(cw) {
  if (!cw || typeof cw !== 'object') return null;
  const pct = cw.used_percentage;
  const input = cw.total_input_tokens;
  if (typeof pct !== 'number' || pct <= 0) return null;
  if (typeof input !== 'number' || input <= 0) return null;
  const raw = input / (pct / 100);
  return raw > 400000 ? 1000000 : 200000;
}

/**
 * Read the cached ratio if present and fresh. Returns null when absent/stale/invalid.
 * @param {string} projectDir
 * @returns {number|null} ratio in [0, 1]
 */
export function readCachedRatio(projectDir) {
  if (!projectDir) return null;
  try {
    const p = join(projectDir, '.qe', 'state', CACHE_FILE);
    if (!existsSync(p)) return null;
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof obj?.ratio !== 'number' || typeof obj?.ts !== 'number') return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return Math.max(0, Math.min(1, obj.ratio));
  } catch { return null; }
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
  if (!modelId || typeof modelId !== 'string') return 200000;
  if (/\[1m\]|-1m\b|1m$/i.test(modelId)) return 1000000;
  return 200000;
}

/**
 * Estimate the context usage ratio (0..1) by reading the transcript file.
 *
 * Walks tail JSONL lines in reverse and returns the ratio from the most
 * recent assistant `message.usage` entry. While walking, also picks up the
 * `message.model` so the limit can be auto-adjusted for 1M-context models
 * (e.g. `claude-opus-4-7[1m]`) — otherwise the reading is 5× too high on
 * 1M models and context-guard blocks early on false "critical" signals.
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
  // 1. Caller-supplied limit (e.g. the statusline-cached true window) is authoritative.
  if (typeof explicitLimit === 'number' && explicitLimit > 0) return explicitLimit;
  // 2. Explicit user override via env beats any id-based guess.
  const envVal = process.env.QE_CONTEXT_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // 3. Best id-based guess: hint first, then the transcript's model field.
  let limit = 200000;
  if (hintModelId) limit = modelIdToLimit(hintModelId);
  else if (transcriptModelId) limit = modelIdToLimit(transcriptModelId);
  // 4. Safety net: Claude Code strips the `[1m]` marker from both the hint and
  // the transcript model field, so a bare id resolves to the 200k base even on
  // a 1M run. A reading already past that base can only be the larger variant
  // (the lineup has no middle tier) — upgrade deterministically. This MUST run
  // even when a hint was given, otherwise the bare-id 200k short-circuits it.
  if (typeof observedTokens === 'number' && observedTokens > limit) {
    limit = 1000000;
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
