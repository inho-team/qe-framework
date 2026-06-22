/**
 * hud/presets.mjs
 * Named element-order presets for the HUD. Users pick a preset at Qhud install
 * time; the statusline wrapper reads the preset name from its CLI args.
 *
 * Add a new preset by adding a key here. Unknown names fall back to `session`.
 */

export const PRESETS = {
  // Default — matches v6.6.3 behavior. Session health focus.
  session: ['context', 'rateLimits', 'model', 'tokens', 'sivs'],

  // Minimal — just the planning/task state the user cares about most.
  focused: ['context', 'phase', 'task', 'sivs'],

  // QE-native — PSE chain status foregrounded.
  qe: ['sivs', 'phase', 'task'],

  // Model mix — show session token distribution across Opus/Sonnet/Haiku/Codex.
  mix: ['context', 'modelRatio', 'sivs'],

  // Full — every element we know about. Use when you have a wide terminal.
  full: ['context', 'rateLimits', 'model', 'tokens', 'modelRatio', 'phase', 'task', 'sivs'],

  // Wiki — Qwiki knowledge-layer focus: planning phase + `.qe/wiki/` status.
  // Opt-in only; existing presets are intentionally left unchanged so the
  // default HUD never surfaces wiki state on non-wiki projects.
  wiki: ['context', 'phase', 'wiki', 'sivs'],
};

export const DEFAULT_PRESET = 'session';

/**
 * Resolve a preset name to an ordered element list. Falls back to `session`.
 * @param {string|undefined} name
 * @returns {string[]}
 */
export function resolvePreset(name) {
  const key = typeof name === 'string' ? name.trim() : '';
  return PRESETS[key] ?? PRESETS[DEFAULT_PRESET];
}
