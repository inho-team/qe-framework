/**
 * hud/elements/summary.mjs
 * Session-summary element — a free-form one-liner describing what THIS session
 * is working on, so a user juggling several terminals can tell them apart at a
 * glance. Reads the `summary` field from the per-session binding file
 * `.qe/planning/.sessions/{sessionId}.json` (the same file that already carries
 * `activePlanSlug`), keyed by the statusline payload's session_id.
 *
 * Unlike `phase`/`task` (which derive state from plan/task files), this is set
 * explicitly by the user via `/Qhud summary "<text>"` — it captures intent that
 * no on-disk artifact records. Renders nothing until a summary is set, so the
 * default HUD is never affected.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { C, safe } from '../colors.mjs';

const SESSIONS_DIR = '.qe/planning/.sessions';
const MAX_SUMMARY_LABEL = 48;
// Claude Code session ids are UUIDs. Validate the shape before interpolating
// into a file path so a malformed/hostile payload field can't traverse out of
// the .sessions/ directory (e.g. "../../etc/passwd").
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the session summary string from the per-session binding file.
 *
 * @param {string} projectRoot absolute project root
 * @param {string|null} [sessionId] Claude Code session id from the payload
 * @returns {string|null} the summary label, or null when unset / unavailable
 */
export function pickSessionSummary(projectRoot, sessionId = null) {
  if (!projectRoot || !sessionId) return null;
  if (!SESSION_ID_RE.test(String(sessionId))) return null;
  const file = join(projectRoot, SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(file)) return null;

  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }

  const raw = safe(typeof data?.summary === 'string' ? data.summary : '').trim();
  if (!raw) return null;

  let label = raw;
  if (label.length > MAX_SUMMARY_LABEL) {
    label = label.slice(0, MAX_SUMMARY_LABEL - 1) + '…';
  }
  return label;
}

/**
 * Element render: cyan "» <summary>", or null when no summary is set.
 *
 * @param {{ projectRoot: string, data?: object }} ctx
 * @param {{ paint: Function, dim: Function }} painter
 * @returns {string|null}
 */
export function render(ctx, painter) {
  const sessionId = ctx?.data?.session_id || ctx?.data?.sessionId || null;
  const label = pickSessionSummary(ctx.projectRoot, sessionId);
  if (!label) return null;
  return `${painter.dim('»')} ${painter.paint(C.cyan, label)}`;
}
