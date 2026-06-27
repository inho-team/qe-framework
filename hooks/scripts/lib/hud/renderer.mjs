/**
 * hud/renderer.mjs
 * Element-based HUD composer. Given a payload, sivsConfig, and render options
 * (preset + noColor), walks the ordered element list and joins the non-null
 * chunks with a dim "│" separator.
 *
 * A preset may contain the special `'newline'` marker to split the HUD across
 * multiple terminal rows (Claude Code renders each output line as its own
 * status row). Elements before a marker form one row; elements after it form
 * the next. Presets with no marker render exactly one line (back-compat).
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
import * as sessionName from './elements/session-name.mjs';
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
  sessionName,
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

  const sep = painter.dim('│');

  // Walk the element order into one or more rows, split on the `newline` marker.
  const rows = [];
  let parts = [];
  for (const name of order) {
    if (name === 'newline') {
      rows.push(parts);
      parts = [];
      continue;
    }
    const el = ELEMENTS[name];
    if (!el || typeof el.render !== 'function') continue;
    const chunk = el.render(ctx, painter);
    if (chunk != null && chunk !== '') parts.push(chunk);
  }
  rows.push(parts);

  // Join each row's chunks; drop rows that came out empty (e.g. a second row
  // whose elements all self-skipped) so the HUD never shows a blank line.
  return rows
    .map((rowParts) => rowParts.join(` ${sep} `))
    .filter((line) => line !== '')
    .join('\n');
}
