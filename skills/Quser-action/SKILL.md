---
name: Quser-action
description: Create and track User Action Request artifacts for external steps Claude or Codex cannot perform directly, such as OAuth, 2FA, hook trust approval, secrets entry, console UI work, or human acceptance checks. Use when the agent needs the user to do something outside the model.
invocation_trigger: When a workflow depends on user-run external action, manual approval, browser/console login, hook trust, secret entry, or human acceptance verification.
recommendedModel: haiku
tier: core
---

# Quser-action — User Action Request Tracker

## Role

Create and manage User Action Request (UAR) documents under
`.qe/user-actions/`. A UAR is the durable handoff for work the active client
cannot complete by itself.

See `core/USER_ACTION_REQUEST.md` for the canonical artifact contract.

## When To Use

Create a UAR when the user must perform an external step:

- approve Codex `/hooks` trust;
- complete OAuth/login/2FA;
- enter or rotate a secret in a secure UI;
- approve billing/admin-console settings;
- run a local GUI/device action the agent cannot access;
- perform a human acceptance check that blocks completion.

Do not use UAR for ordinary clarifying questions. Use the QE interaction adapter
for questions; use UAR for external actions.

## CLI Interface

```text
/Quser-action [subcommand] [args]
$Quser-action [subcommand] [args]
```

| Subcommand | Behavior |
|------------|----------|
| `create` | Create a pending UAR from the provided title/action details |
| `list` | List all UARs, or `--status pending|done|blocked` |
| `done <id>` | Move a UAR to `done` |
| `blocked <id>` | Move a UAR to `blocked` |
| `show <id>` | Print the matching UAR path and content |

## Execution Procedure

### `create`

Collect these fields:

- `title`: short human-readable action name.
- `reason`: why the agent cannot complete this itself.
- `action`: exact user steps.
- `expectedResult`: what success looks like.
- `howToReport`: what the user should reply with.
- `ifBlocked`: fallback if the user cannot complete it.
- `blocking`: default `true`.
- `client`: `claude`, `codex`, or `unknown`.
- `category`: `permissions`, `auth`, `secret`, `console`, `acceptance`, or `general`.

Run the helper from the project root:

```bash
node --input-type=module - <<'NODE'
import { createUserActionRequest } from './scripts/lib/user_action_request.mjs';

const request = createUserActionRequest(process.cwd(), {
  title: process.env.UAR_TITLE,
  reason: process.env.UAR_REASON,
  action: process.env.UAR_ACTION,
  expectedResult: process.env.UAR_EXPECTED,
  howToReport: process.env.UAR_REPORT,
  ifBlocked: process.env.UAR_BLOCKED,
  blocking: process.env.UAR_BLOCKING !== 'false',
  requestedBy: process.env.UAR_REQUESTED_BY || 'QE',
  client: process.env.UAR_CLIENT || 'unknown',
  category: process.env.UAR_CATEGORY || 'general',
});
console.log(`[UAR] created ${request.id}`);
console.log(request.filePath);
NODE
```

Then report only:

```text
User action required: <title>
Path: <filePath>
Blocking: yes|no
```

### `list`

Run:

```bash
node --input-type=module - <<'NODE'
import { listUserActionRequests } from './scripts/lib/user_action_request.mjs';

const status = process.env.UAR_STATUS || undefined;
for (const item of listUserActionRequests(process.cwd(), { status })) {
  console.log(`${item.status}\t${item.id}\t${item.title}\t${item.filePath}`);
}
NODE
```

### `done <id>` / `blocked <id>`

Run:

```bash
node --input-type=module - <<'NODE'
import { updateUserActionStatus } from './scripts/lib/user_action_request.mjs';

const result = updateUserActionStatus(process.cwd(), process.env.UAR_ID, process.env.UAR_STATUS, {
  note: process.env.UAR_NOTE || '',
});
console.log(`[UAR] ${result.status} ${result.id}`);
console.log(result.filePath);
NODE
```

## Rules

- Store UARs only under `.qe/user-actions/`.
- Never put secrets in a UAR. Say where the user should enter the secret.
- Use `Blocking: yes` when the dependent workflow cannot proceed honestly.
- For non-blocking UARs, continue best-effort and include the pending path in
  the final report.
- Preserve the UAR file content when moving between statuses; append status
  updates instead of replacing the document.

## Will

- Create durable user-action artifacts.
- Track pending/done/blocked action status.
- Give Claude and Codex one shared way to ask for external user work.

## Will Not

- Store credentials or sensitive values.
- Replace normal clarification questions.
- Pretend the agent completed an external action that still depends on the user.
