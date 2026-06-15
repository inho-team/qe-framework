/**
 * hud/elements/context.mjs
 * Context-window usage element. Reads `context_window.used_percentage`
 * from the statusLine payload and renders a colored "ctx [███░░░░] N%"
 * gauge chunk.
 */

import { usedColor } from '../colors.mjs';

// Number of cells in the context gauge bar.
const GAUGE_CELLS = 7;

/**
 * Extract the context used percentage from the payload.
 * Prefers `used_percentage`; falls back to `100 - remaining_percentage`.
 * @param {object} data
 * @returns {number|null} integer 0–100, or null if unknown
 */
export function pickContextUsed(data) {
  const cw = data?.context_window;
  if (!cw) return null;
  if (typeof cw.used_percentage === 'number') {
    return Math.round(cw.used_percentage);
  }
  if (typeof cw.remaining_percentage === 'number') {
    return Math.round(100 - cw.remaining_percentage);
  }
  return null;
}

/**
 * Element render: returns a colored "ctx [██░░░░░] 32%" gauge chunk, or null
 * to skip. The filled portion is tinted by usage threshold; the brackets and
 * empty cells are dimmed so the bar stays legible without stealing focus.
 * @param {{ data: object }} ctx
 * @param {{ paint: Function, dim: Function }} painter
 * @returns {string|null}
 */
export function render(ctx, painter) {
  const pct = pickContextUsed(ctx.data);
  if (pct === null) return null;
  const filled = Math.max(0, Math.min(GAUGE_CELLS, Math.round((pct / 100) * GAUGE_CELLS)));
  const bar = painter.paint(usedColor(pct), '█'.repeat(filled));
  const empty = painter.dim('░'.repeat(GAUGE_CELLS - filled));
  return `ctx ${painter.dim('[')}${bar}${empty}${painter.dim(']')} ${pct}%`;
}
