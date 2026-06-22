/**
 * hud/elements/wiki.mjs
 * Qwiki knowledge-layer element — shows the `.qe/wiki/` layer state as a
 * compact "W: <topics>t · <inbox>↓" chunk. Renders nothing when no wiki
 * layer exists, so non-wiki projects see an unchanged HUD.
 *
 * Perf: delegates to wiki-status.mjs (shallow readdir, no recursion,
 * existsSync short-circuit) — safe to run on every redraw.
 */

import { C } from '../colors.mjs';
import { wikiSummary } from '../../wiki-status.mjs';

/**
 * Element render: "W: 5t · 2↓" (5 topics, 2 uncompiled inbox sources),
 * or null when `.qe/wiki/` is absent or empty.
 *
 * @param {{ projectRoot: string, data?: object }} ctx
 * @param {{ paint: Function, dim: Function }} painter
 * @returns {string|null}
 */
export function render(ctx, painter) {
  let summary = null;
  try { summary = wikiSummary(ctx?.projectRoot); } catch { return null; }
  if (!summary) return null;
  const { topics, inbox } = summary;
  // Nothing worth surfacing (no topics, empty inbox) → stay silent.
  if (topics === 0 && inbox === 0) return null;

  const parts = [];
  if (topics > 0) parts.push(`${topics}t`);
  if (inbox > 0) parts.push(painter.paint(C.yellow, `${inbox}↓`)); // 미컴파일 대기 강조
  return `${painter.dim('W:')} ${painter.paint(C.cyan, parts.join(' · '))}`;
}
