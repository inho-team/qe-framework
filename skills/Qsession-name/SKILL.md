---
name: Qsession-name
description: Set, show, and list QE multi-terminal session names using the active session registry. Use when the user invokes /Qsession-name or wants to identify concurrent terminals.
user_invocable: true
recommendedModel: haiku
---

# Qsession-name — Session Name & Active Sessions

Manage the human-readable name for the current QE session and inspect other active sessions.

## Subcommands

| Command | Behavior |
|---|---|
| `/Qsession-name` | Show the current session name, or a clear unset message. |
| `/Qsession-name set <name>` | Save `<name>` for the current session, capped at 48 characters. |
| `/Qsession-name list` | Print active sessions from `.qe/state/sessions-registry.json`, excluding stale entries. |

## Execution

### Step 1: Parse

Read the text after `/Qsession-name`.

- Empty input → `show`
- Prefix `set ` → `set`
- Exact `list` → `list`
- Anything else → print usage:

```text
Usage:
  /Qsession-name
  /Qsession-name set <name>
  /Qsession-name list
```

### Step 2: Show Current Name

Run this from the project root:

```bash
node --input-type=module - <<'NODE'
import { readCurrentSessionId, readCurrentSid, readSessionName } from './hooks/scripts/lib/session-resolver.mjs';

const cwd = process.cwd();
const sessionId = readCurrentSessionId(cwd);
const sid = readCurrentSid(cwd);
if (!sid) {
  console.log('[!] No active session id found. Re-open the project session so SessionStart can write .qe/state/current-session.json.');
  process.exit(0);
}

const name = readSessionName(cwd, sessionId || sid);
if (name) {
  console.log(`[Session] name:${name} sid:${sid}`);
} else {
  console.log(`[Session] no name set for sid:${sid}. Set one with /Qsession-name set <name>.`);
}
NODE
```

### Step 3: Set Current Name

Use the user-provided `<name>` as a single string. Do not preserve surrounding quotes. The helper applies the 48-character cap.

```bash
SESSION_NAME='<name>'
node --input-type=module - <<'NODE'
import { readCurrentSessionId, readCurrentSid, writeSessionName } from './hooks/scripts/lib/session-resolver.mjs';

const cwd = process.cwd();
const sessionId = readCurrentSessionId(cwd);
const sid = readCurrentSid(cwd);
if (!sid) {
  console.log('[!] No active session id found. Re-open the project session so SessionStart can write .qe/state/current-session.json.');
  process.exit(0);
}

const input = process.env.SESSION_NAME || '';
const result = writeSessionName(cwd, input, sessionId || sid);
console.log(`[✓] Session name set: "${result.sessionName}" sid:${sid}`);
NODE
```

If the saved name is empty after trimming, report:

```text
[✓] Session name cleared for sid:<sid>.
```

### Step 4: List Active Sessions

Run:

```bash
node --input-type=module - <<'NODE'
import { cleanupStaleSessions } from './hooks/scripts/lib/session-registry.mjs';

const sessions = cleanupStaleSessions(process.cwd());
if (sessions.length === 0) {
  console.log('No active QE sessions found.');
  process.exit(0);
}

for (const s of sessions) {
  console.log(`sid:${s.sid} name:${s.name || '(unnamed)'} plan:${s.plan || '(none)'} lastSeen:${s.lastSeen} pid:${s.pid ?? '(unknown)'}`);
}
NODE
```

## Guarantees

- Session names are stored in `.qe/planning/.sessions/{id}.json` as `sessionName`.
- Writes merge with existing binding data and preserve `activePlanSlug`, `summary`, and unknown fields.
- Active-session listing reads `.qe/state/sessions-registry.json`, filters invalid SIDs, and excludes entries stale for more than 2 hours.
- Missing or corrupt registry files are treated as an empty active-session list.
- This skill does not use IPC, file locks, or `.qe/state/current-session.json` as the multi-session list.

