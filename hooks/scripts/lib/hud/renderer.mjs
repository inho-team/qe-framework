/**
 * hud/renderer.mjs
 * Element-based HUD composer. Given a payload, sivsConfig, and render options
 * (preset + noColor), walks the ordered element list and joins the non-null
 * chunks with a dim "│" separator.
 *
 * Separated from `statusline.mjs` (stdin wrapper) so it can be unit-tested
 * without spawning a process.
 */

import { makePainter } from './colors.mjs';
import { resolvePreset } from './presets.mjs';

import * as context from './elements/context.mjs';
import * as rateLimits from './elements/rate-limits.mjs';
import * as model from './elements/model.mjs';
import * as tokens from './elements/tokens.mjs';
import * as sivs from './elements/sivs.mjs';
import * as phase from './elements/phase.mjs';
import * as task from './elements/task.mjs';
import * as modelRatio from './elements/model-ratio.mjs';
import * as wiki from './elements/wiki.mjs';
import * as summary from './elements/summary.mjs';

// Single source of truth for the element registry. Exported so tests can
// validate presets against it without re-listing names by hand (a hand-kept
// list silently goes stale the moment a new element lands, e.g. `wiki`).
export const ELEMENTS = {
  context,
  rateLimits,
  model,
  tokens,
  sivs,
  phase,
  task,
  modelRatio,
  wiki,
  summary,
};

/**
 * Compose the HUD from a named preset.
 *
 * @param {object} data statusLine payload (parsed JSON from stdin)
 * @param {object} sivsConfig parsed .qe/sivs-config.json or {}
 * @param {{ noColor?: boolean, preset?: string, projectRoot?: string }} [opts]
 * @returns {string}
 */
export function render(data, sivsConfig, opts = {}) {
  const painter = makePainter(opts);
  const order = resolvePreset(opts.preset);
  const ctx = {
    data: data || {},
    sivsConfig: sivsConfig || {},
    projectRoot: opts.projectRoot || process.cwd(),
  };

  const parts = [];
  for (const name of order) {
    const el = ELEMENTS[name];
    if (!el || typeof el.render !== 'function') continue;
    const chunk = el.render(ctx, painter);
    if (chunk != null && chunk !== '') parts.push(chunk);
  }

  if (parts.length === 0) return '';
  const sep = painter.dim('│');
  return parts.join(` ${sep} `);
}
