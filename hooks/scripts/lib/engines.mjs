// engines.mjs — SIVS engine registry loader + pool-disjointness guarantee.
//
// The registry (core/engines.json) models each engine as a vendor drawing from a
// pool of providers. The structural independence guarantee SIVS depends on is
// pool-disjointness: a Verify engine's vendor must NOT be in the Implement engine's
// pool, so the model that checks work never shares a provider with the one that
// wrote it. This lets Implement/Verify independence be enforced by config, not trust.

import { existsSync, readFileSync } from './qe-fs.mjs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// hooks/scripts/lib -> package root -> core/engines.json
const DEFAULT_REGISTRY = resolve(MODULE_DIR, '..', '..', '..', 'core', 'engines.json');

// Load the engine registry. Falls back to the built-in claude/codex/fugu registry
// if the file is missing or unreadable (fail-safe, never throws).
export function loadEngines(registryPath = DEFAULT_REGISTRY) {
  const builtin = {
    claude: { type: 'cli', vendor: 'anthropic', pool: ['anthropic'] },
    codex: { type: 'cli', vendor: 'openai', pool: ['openai'] },
    fugu: { type: 'openai-compat', vendor: 'fugu', pool: ['fugu'], experimental: true },
  };
  try {
    if (existsSync(registryPath)) {
      const data = JSON.parse(readFileSync(registryPath, 'utf8'));
      if (data && data.engines && typeof data.engines === 'object') return data.engines;
    }
  } catch { /* fall through to builtin */ }
  return builtin;
}

// Vendor for an engine name (null if unknown).
export function vendorOf(engine, engines = loadEngines()) {
  return engines[engine] ? engines[engine].vendor : null;
}

// Provider pool for an engine name (its vendor if pool is unspecified).
export function poolOf(engine, engines = loadEngines()) {
  const e = engines[engine];
  if (!e) return [];
  return Array.isArray(e.pool) && e.pool.length ? e.pool : (e.vendor ? [e.vendor] : []);
}

// Enforce pool-disjointness between the Implement engine and the Verify engine.
// Returns { ok, reason }. ok=false when the Verify vendor is inside the Implement
// pool (the check would not be independent), or when an engine is unknown.
export function checkPoolDisjoint(implementEngine, verifyEngine, engines = loadEngines()) {
  if (!engines[implementEngine]) return { ok: false, reason: `unknown implement engine: ${implementEngine}` };
  if (!engines[verifyEngine]) return { ok: false, reason: `unknown verify engine: ${verifyEngine}` };
  const implementPool = new Set(poolOf(implementEngine, engines));
  const verifyVendor = vendorOf(verifyEngine, engines);
  if (verifyVendor && implementPool.has(verifyVendor)) {
    return {
      ok: false,
      reason: `verify vendor "${verifyVendor}" is inside implement pool [${[...implementPool].join(', ')}]`
        + ` — Implement/Verify would not be independent`,
    };
  }
  return { ok: true, reason: 'disjoint' };
}
