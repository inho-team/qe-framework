/**
 * hud/elements/session-name.mjs
 * Displays the human-readable name for this terminal session. The value lives
 * in `.qe/planning/.sessions/{id}.json` as `sessionName`, alongside the
 * existing activePlanSlug/summary binding data.
 */

import { C } from '../colors.mjs';
import { readSessionName } from '../../session-resolver.mjs';

/**
 * @param {string} projectRoot
 * @param {string|null} [sessionId]
 * @returns {string|null}
 */
export function pickSessionName(projectRoot, sessionId = null) {
  const name = readSessionName(projectRoot, sessionId);
  return name || null;
}

/**
 * Element render: yellow "# <name>", or null when no name is set.
 *
 * @param {{ projectRoot: string, data?: object }} ctx
 * @param {{ paint: Function, dim: Function }} painter
 * @returns {string|null}
 */
export function render(ctx, painter) {
  const sessionId = ctx?.data?.session_id || ctx?.data?.sessionId || null;
  const label = pickSessionName(ctx.projectRoot, sessionId);
  if (!label) return null;
  return `${painter.dim('#')} ${painter.paint(C.yellow, label)}`;
}
