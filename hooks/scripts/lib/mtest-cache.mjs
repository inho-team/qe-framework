import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * qe-admin-mcp skill-test verdict cache.
 *
 * Layout: `.qe/mtest-cache/{hash}.json` where `{hash}` is the sha256 of the
 * SKILL.md content (canonicalised: CRLF→LF, trim trailing whitespace, single
 * trailing LF). This keeps cache lookups content-addressed so unchanged
 * skills reuse their last verdict without re-running the LLM routing
 * simulation.
 *
 * Entry shape:
 *   {
 *     skill_path: string,      // original SKILL.md path for human grep
 *     content_hash: string,    // sha256:<hex>
 *     verdict: string,         // PASS | MISROUTE | UNREACHABLE | CONFLICT | WEAK
 *     accuracy: number,        // 0..1, fraction of prompts that PASSed
 *     timestamp: string        // ISO-8601 UTC
 *   }
 *
 * Defense-in-depth:
 *   - `skillPath` must be a non-empty string that resolves under the repo root
 *     once normalised. Absolute paths outside cwd are rejected.
 *   - `cacheDir` path is derived only from `baseDir ?? process.cwd()`, never
 *     from user input — eliminates path-traversal via the hash key.
 */

const CACHE_DIR = '.qe/mtest-cache';
const VERDICT_ENUM = new Set(['PASS', 'MISROUTE', 'UNREACHABLE', 'CONFLICT', 'WEAK']);

/**
 * Canonicalise SKILL.md text for deterministic hashing.
 * Mirrors canonicalisation used by contract-hash.mjs.
 * @param {string} text
 * @returns {string}
 */
function canonicalize(text) {
  let canonical = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  canonical = canonical
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n');
  canonical = canonical.replace(/\s+$/, '') + '\n';
  return canonical;
}

/**
 * Compute sha256 hash of a SKILL.md file's canonicalised content.
 * @param {string} skillPath — absolute or repo-relative
 * @param {string} [baseDir]
 * @returns {string} `sha256:<64 hex>`
 * @throws if the file cannot be read.
 */
export function computeSkillHash(skillPath, baseDir) {
  assertValidSkillPath(skillPath);
  const resolved = resolveSkillPath(skillPath, baseDir);
  const raw = readFileSync(resolved, 'utf8');
  const canonical = canonicalize(raw);
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * Get the cached verdict for `skillPath`, or null on miss / malformed entry.
 * @param {string} skillPath
 * @param {string} [baseDir]
 * @returns {object | null}
 */
export function getCachedVerdict(skillPath, baseDir) {
  assertValidSkillPath(skillPath);
  let hash;
  try {
    hash = computeSkillHash(skillPath, baseDir);
  } catch {
    return null; // unreadable source => cache miss, not an error
  }

  const cachePath = resolveCachePath(hash, baseDir);
  if (!existsSync(cachePath)) return null;

  try {
    const content = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed.content_hash !== hash) return null; // stale on hash mismatch
    return parsed;
  } catch {
    return null; // graceful fallback: treat malformed cache as miss
  }
}

/**
 * Persist a verdict for `skillPath`. Rewrites any existing entry.
 * @param {string} skillPath
 * @param {{verdict: string, accuracy: number, timestamp?: string}} verdict
 * @param {string} [baseDir]
 * @returns {{cachePath: string, content_hash: string}}
 * @throws on invalid verdict shape.
 */
export function saveVerdict(skillPath, verdict, baseDir) {
  assertValidSkillPath(skillPath);
  if (!verdict || typeof verdict !== 'object') {
    throw new Error('saveVerdict: verdict must be an object');
  }
  if (!VERDICT_ENUM.has(verdict.verdict)) {
    throw new Error(
      `saveVerdict: verdict.verdict must be one of ${[...VERDICT_ENUM].join('|')}, got "${verdict.verdict}"`
    );
  }
  if (typeof verdict.accuracy !== 'number' || verdict.accuracy < 0 || verdict.accuracy > 1) {
    throw new Error('saveVerdict: accuracy must be a number in [0, 1]');
  }

  const hash = computeSkillHash(skillPath, baseDir);
  const cachePath = resolveCachePath(hash, baseDir);
  mkdirSync(path.dirname(cachePath), { recursive: true });

  const entry = {
    skill_path: skillPath,
    content_hash: hash,
    verdict: verdict.verdict,
    accuracy: verdict.accuracy,
    timestamp: verdict.timestamp ?? new Date().toISOString()
  };
  writeFileSync(cachePath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return { cachePath, content_hash: hash };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Throw if `skillPath` is not a safe, non-empty string.
 * Rejects empty strings and NUL bytes that could confuse downstream fs calls.
 * @param {unknown} skillPath
 * @throws {TypeError} when not a non-empty string.
 * @throws {Error} when the string contains a NUL byte.
 */
function assertValidSkillPath(skillPath) {
  if (typeof skillPath !== 'string' || skillPath.length === 0) {
    throw new TypeError('skillPath must be a non-empty string');
  }
  if (skillPath.includes('\0')) {
    throw new Error('skillPath must not contain NUL bytes');
  }
}

/**
 * Resolve a SKILL.md reference to an absolute filesystem path, confining it
 * to `baseDir` when one is supplied (path-traversal defence).
 * @param {string} skillPath — absolute, or relative to `baseDir ?? cwd`.
 * @param {string} [baseDir] — repo root for containment check.
 * @returns {string} normalised absolute path.
 * @throws {Error} if the resolved path escapes `baseDir`.
 */
function resolveSkillPath(skillPath, baseDir) {
  const root = baseDir ?? process.cwd();
  const resolved = path.isAbsolute(skillPath)
    ? path.normalize(skillPath)
    : path.normalize(path.join(root, skillPath));
  // path-traversal defence: resolved path must stay inside root when baseDir given
  if (baseDir && !resolved.startsWith(path.normalize(root) + path.sep) && resolved !== path.normalize(root)) {
    throw new Error(`skillPath escapes baseDir: ${skillPath}`);
  }
  return resolved;
}

/**
 * Derive the on-disk cache file path for a given content hash.
 * Strips the `sha256:` prefix and rejects anything outside `[a-f0-9]{64}` so
 * the filename is content-addressed and cannot traverse directories.
 * @param {string} hash — value returned by {@link computeSkillHash}.
 * @param {string} [baseDir] — repo root; defaults to `process.cwd()`.
 * @returns {string} absolute path under `<baseDir>/.qe/mtest-cache/`.
 * @throws {Error} if `hash` is not a well-formed sha256 hex digest.
 */
function resolveCachePath(hash, baseDir) {
  const root = baseDir ?? process.cwd();
  // hash comes from createHash().digest('hex') prefixed with "sha256:" — strip prefix for filename
  const safeName = hash.replace(/^sha256:/, '').replace(/[^a-f0-9]/g, '');
  if (safeName.length !== 64) {
    throw new Error('computeSkillHash produced a non-conforming digest');
  }
  return path.join(root, CACHE_DIR, `${safeName}.json`);
}

export default { getCachedVerdict, saveVerdict, computeSkillHash };
