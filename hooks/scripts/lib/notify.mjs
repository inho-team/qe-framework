'use strict';
/**
 * notify.mjs — opt-in completion webhook (Phase 4, D022).
 * Zero-dependency: uses the node built-in global `fetch` (node 18+).
 *
 * Opt-in: if process.env.QE_NOTIFY_WEBHOOK is unset/empty, this is a complete no-op
 * (no network call). Best-effort: any failure is swallowed — a notification must
 * NEVER block or break the main hook flow. Generic JSON payload works with Slack,
 * Discord, Telegram (bot sendMessage), and arbitrary endpoints.
 *
 * The webhook URL is read ONLY from the environment — never hardcoded, never logged.
 */

const TIMEOUT_MS = 4000;

/**
 * Sends a best-effort completion notification to the configured webhook.
 * @param {object} payload
 * @param {string} payload.event   - e.g. "stop", "task-complete", "task-failed".
 * @param {string} payload.summary - short human summary (no secrets, no full diffs).
 * @param {string} [payload.cwd]   - project path.
 * @returns {Promise<boolean>} true if a request was sent and accepted, false otherwise.
 */
export async function notify({ event, summary, cwd } = {}) {
  const url = (process.env.QE_NOTIFY_WEBHOOK || '').trim();
  if (!url) return false;                       // opt-in: no URL → no-op
  if (!/^https:\/\//i.test(url)) return false;  // require https; refuse http/other schemes

  const body = {
    event: String(event || 'event'),
    summary: String(summary || '').slice(0, 1000), // cap; summaries only, never full diffs
    cwd: cwd ? String(cwd) : undefined,
    ts: new Date().toISOString(),
  };
  // Slack/Discord render the `text`/`content` field; include both for convenience.
  const text = `[QE] ${body.event}: ${body.summary}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, text, content: text }),
      redirect: 'error', // refuse redirects — a 30x to http/internal would bypass the https check
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false; // silent — never propagate to the hook
  } finally {
    clearTimeout(timer);
  }
}
