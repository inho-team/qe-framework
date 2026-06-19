# Completion Notifications (opt-in webhook)

QE can POST a best-effort notification to a webhook when a session stops (work complete).
Adapted from oh-my-claudecode's stop callbacks, but as a **single generic webhook** with
zero dependencies and no bundled channel SDKs (see `D022`).

## Enable

Set one environment variable — the webhook URL. If it is unset, notifications are a
complete no-op (no network call):

```bash
export QE_NOTIFY_WEBHOOK="https://hooks.slack.com/services/XXX/YYY/ZZZ"
```

- **https only.** http and other schemes are refused (SSRF / downgrade protection).
- The URL is read **only** from the environment — never store it in the repo, and it is
  never logged or echoed.
- Implementation: `hooks/scripts/lib/notify.mjs`, wired into `hooks/scripts/stop-handler.mjs`.

## Payload

The hook sends a JSON body. It includes `text` and `content` aliases so Slack and Discord
render it out-of-the-box:

```json
{
  "event": "stop",
  "summary": "Session stopped.",
  "cwd": "/path/to/project",
  "ts": "2026-06-19T07:00:00.000Z",
  "text": "[QE] stop: Session stopped.",
  "content": "[QE] stop: Session stopped."
}
```

- `summary` is capped at 1000 chars and carries **summaries only** — never full diffs or
  secrets.
- A 4-second timeout (AbortSignal) bounds the request; any failure is swallowed so the
  stop hook is never blocked or broken.

## Channel examples

| Channel | URL to use as `QE_NOTIFY_WEBHOOK` | Renders |
|---------|-----------------------------------|---------|
| **Slack** | Incoming Webhook URL (`https://hooks.slack.com/services/...`) | `text` field |
| **Discord** | Channel webhook URL (`https://discord.com/api/webhooks/...`) | `content` field |
| **Telegram** | `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>` — note Telegram expects `text` + `chat_id`; for full control front it with a tiny relay that maps the payload | `text` field |
| **Custom** | Any https endpoint | full JSON body |

## What this is NOT

Rate-limit auto-resume (waiting out an API 429 and continuing) is **out of scope** — see
`D023`. QE hooks cannot observe the model's API rate-limit responses (the harness owns the
API loop), and the native `ScheduleWakeup` is `/loop`-coupled and capped at 1 hour, so it
cannot wake at a multi-hour reset. oh-my-claudecode achieves this only because tmux owns
the external `claude` process — an approach QE deliberately does not adopt.
