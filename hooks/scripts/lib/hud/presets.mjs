/**
 * hud/presets.mjs
 * Named element-order presets for the HUD. Users pick a preset at Qhud install
 * time; the statusline wrapper reads the preset name from its CLI args.
 *
 * Add a new preset by adding a key here. Unknown names fall back to `session`.
 */

export const PRESETS = {
  // Default — uniform 2-row layout for every session:
  //   row 1: <session name>  │ ctx gauge       │ SIVS
  //   row 2: 5h/7d quotas     │ model
  // The `newline` marker splits the rows; Claude Code renders each as its own
  // status row. `tokens` was dropped from the default to keep both rows tight.
  session: ['sessionName', 'context', 'sivs', 'newline', 'rateLimits', 'model'],

  // Minimal — the session summary + planning/task state the user cares about
  // most. `summary` leads so a multi-terminal user sees "what is this session
  // doing" first; it self-skips until set, so the preset degrades to the old
  // ctx · phase · task · sivs shape on sessions with no summary.
  focused: ['sessionName', 'summary', 'context', 'phase', 'task', 'sivs'],

  // QE-native — session summary + PSE chain status foregrounded.
  qe: ['sessionName', 'summary', 'sivs', 'phase', 'task'],

  // Model mix — show session token distribution across Opus/Sonnet/Haiku/Codex.
  mix: ['sessionName', 'context', 'modelRatio', 'sivs'],

  // Full — every element we know about. Use when you have a wide terminal.
  full: ['sessionName', 'summary', 'context', 'rateLimits', 'model', 'tokens', 'modelRatio', 'phase', 'task', 'sivs'],

  // Wiki — Qwiki knowledge-layer focus: planning phase + `.qe/wiki/` status.
  // Opt-in only; existing presets are intentionally left unchanged so the
  // default HUD never surfaces wiki state on non-wiki projects.
  wiki: ['sessionName', 'context', 'phase', 'wiki', 'sivs'],
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
