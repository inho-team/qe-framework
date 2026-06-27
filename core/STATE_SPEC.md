# QE State Management Specification

## State Storage Structure

```
.qe/state/
├── {mode}-state.json              ← Legacy (when no session is specified)
├── current-session.json           ← Project-global last-write-wins pointer
├── sessions-registry.json         ← Active QE terminal sessions
└── sessions/
    └── {sessionId}/
        └── {mode}-state.json      ← Session-isolated
```

## State File Format

```json
{
  "active": true,
  "started_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "session_id": "session UUID",
  "reinforcement_count": 0,
  "max_reinforcements": 20,
  "original_prompt": "original user request"
}
```

## Core Rules

### Atomic Write
- Write to a temp file first, then replace via rename
- Prevents file corruption from partial writes

### Session Isolation
- If sessionId is present, store under `sessions/{sessionId}/`
- If no sessionId, use the legacy path
- On read, fall back in order: session path → legacy path

### Staleness Guard
- State older than 2 hours (7,200,000 ms) is treated as inactive
- Prevents zombie states from blocking new sessions

### Active Session Registry

`.qe/state/sessions-registry.json` stores best-effort awareness of active QE
terminal sessions. It is separate from `.qe/state/current-session.json`, which
remains a project-global single pointer with last-write-wins behavior.

Registry format:

```json
{
  "sessions": [
    {
      "sid": "a1b2c3d4",
      "name": "API refactor",
      "plan": "auth-refresh",
      "lastSeen": "2026-06-27T12:00:00.000Z",
      "pid": 12345
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| sid | string | Required 8-char session id matching `/^[a-z0-9]{8}$/` |
| name | string | Optional human-readable session name, capped at 48 chars at write time |
| plan | string | Active plan slug for the session, or empty string |
| lastSeen | string | ISO timestamp updated by `SessionStart` |
| pid | number/null | Process id recorded by the hook when available |

Registry reads are fail-safe: a missing or corrupt file is treated as an empty
session list. Invalid SID entries are ignored. Entries whose `lastSeen` is older
than 2 hours are stale and excluded from active-session output; `SessionStart`
and `Stop` both attempt stale cleanup.

The registry intentionally does **not** use IPC, file locks, or inter-session
command delivery. Writes use the existing `atomicWriteJson()` temp-write +
rename pattern only, so concurrent writers remain last-write-wins within this
feature's scope.

### Reinforcement Limit
- Each mode has a max_reinforcements setting (default 20)
- When reinforcement_count reaches max in the Stop hook, blocking is released
- Prevents infinite loops

## Available Modes

| Mode | Description | Stop Blocking | Default max_reinforcements |
|------|-------------|---------------|---------------------------|
| ultrawork | Autonomous parallel task execution | Yes | 50 |
| ultraqa | Autonomous quality verification | Yes | 80 |
| qrun-task | Task execution in progress | Yes | 20 |
| qrefresh | Analysis refresh in progress | Yes | 20 |
| qarchive | Archiving in progress | Yes | 20 |

## Ultra Mode State Extensions

Ultra modes (`ultrawork`, `ultraqa`) extend the base state format with additional fields:

```json
{
  "active": true,
  "mode": "ultrawork | ultraqa",
  "started_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "session_id": "session UUID",
  "reinforcement_count": 0,
  "max_reinforcements": 50,
  "original_prompt": "original user request",
  "task_uuids": ["UUID1", "UUID2"],
  "completed_uuids": [],
  "failed_uuids": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| mode | string | `ultrawork` or `ultraqa` |
| task_uuids | string[] | All task UUIDs to execute |
| completed_uuids | string[] | UUIDs that finished successfully |
| failed_uuids | string[] | UUIDs that failed |

## Threshold Rationale

The `max_reinforcements` limit exists to prevent an autonomous mode from blocking the Stop hook indefinitely if a task loop stalls or enters an unexpected state. Each mode's limit reflects the maximum number of stop-block cycles that its task loop legitimately requires.

| Mode | max_reinforcements | Rationale |
|------|-------------------|-----------|
| ultrawork | 50 | Executes multiple tasks sequentially; each task may need several stop cycles (plan → execute → verify). 50 allows roughly 10 tasks × 5 cycles each without hitting the ceiling under normal conditions. |
| ultraqa | 80 | Runs a per-task QA verification loop on top of execution, meaning each task triggers additional stop cycles for quality checks, retries, and remediation. Higher budget prevents premature loop termination mid-QA. |
| qrun-task | 20 | Single task execution; 20 cycles is sufficient for a standard plan → implement → test → commit flow with moderate retries. |
| qrefresh | 20 | Analysis refresh is bounded — it reads files and writes summaries. 20 cycles covers all analysis targets in a typical project. |
| qarchive | 20 | Archiving is a bounded operation (move files, update index). 20 cycles is generous for any realistic archive task. |

**Rule:** When adding a new mode, set `max_reinforcements` to the number of stop cycles expected in the worst-case honest execution of that mode's loop — not to an arbitrary large number as a safety margin.

## API

```javascript
import { readState, writeState, clearState, listActiveModes } from './lib/state.mjs';

// Read
const state = readState(cwd, 'qrun-task', sessionId);

// Write
writeState(cwd, 'qrun-task', { original_prompt: '...' }, sessionId);

// Delete
clearState(cwd, 'qrun-task', sessionId);

// List active modes
const modes = listActiveModes(cwd, sessionId);
```
