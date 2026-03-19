# QE State Management Specification

## State Storage Structure

```
.qe/state/
├── {mode}-state.json              ← Legacy (when no session is specified)
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
