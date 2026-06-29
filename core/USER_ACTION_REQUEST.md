# User Action Request Protocol

User Action Request (UAR) is the QE artifact for work that Claude or Codex
cannot complete without a human performing an external action.

Use a UAR instead of burying the request in chat when the action is:

- outside the model's authority, such as OAuth, login, 2FA, billing, console UI,
  `/hooks` trust approval, or hardware/device access;
- sensitive, such as entering a secret or approving an irreversible operation;
- a human acceptance check that blocks a claim of completion;
- useful to track across sessions.

## Storage

```text
.qe/user-actions/
  pending/
  done/
  blocked/
```

Each request is one Markdown file. The filename starts with a stable timestamp
and slug, for example:

```text
.qe/user-actions/pending/20260629-113000-approve-codex-hooks.md
```

## Document Shape

```markdown
# User Action Request: Approve Codex hooks

Status: pending
ID: 20260629-113000-approve-codex-hooks
Blocking: yes
Requested by: Codex
Client: codex
Created: 2026-06-29T02:30:00.000Z
Category: permissions

## Why This Is Needed

Codex requires the user to review and trust hook definitions.

## Action

Open Codex and run:

```text
/hooks
```

Approve the QE hook bundle.

## Expected Result

Codex shows the QE hook bundle as trusted.

## How To Report Back

Reply with `done: hooks trusted`, or paste the error.

## If Blocked

Run `qe-framework-install`, then retry `/hooks`.
```

## Status Rules

- `pending`: waiting for the user.
- `done`: user completed the action; the agent may resume blocked work.
- `blocked`: user attempted the action but could not complete it.

Move files between status directories instead of duplicating them. When changing
status, preserve the original content and append a resolution note with the time.

## Agent Rules

- Create a UAR when a required external action cannot be performed by the active
  client.
- Say whether the request is blocking.
- If `Blocking: yes`, stop the dependent workflow until the user reports
  completion or the UAR is moved to `done`.
- If `Blocking: no`, continue best-effort and mention the pending request in
  the final report.
- Never ask the user to put secrets into a UAR. The UAR may say where to enter a
  secret, but the secret itself must stay outside the repository.
