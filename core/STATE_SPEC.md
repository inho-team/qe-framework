# QE State Management Specification

## State Storage Structure

```
.qe/state/
├── {mode}-state.json              ← Legacy (when no session is specified)
├── current-session.json           ← Project-global last-write-wins pointer
├── harness-lanes.json             ← Project-level harness lane registry
├── sessions-registry.json         ← Active QE terminal sessions
└── sessions/
    └── {sessionId}/
        ├── {mode}-state.json      ← Session-isolated
        └── harness-lanes.json     ← Optional session mirror for harness lanes
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

### Execution Harness State Ownership

Execution Harness state records how a task is being run. It does not decide
whether the task is complete.

Canonical ownership is split by artifact type:

| Artifact | Canonical role |
| --- | --- |
| `.qe/state/` | Runtime session state, active modes, harness lanes, and status inputs. |
| `.qe/planning/` | Plan, phase, roadmap, and goal state. |
| `.qe/tasks/` | TASK_REQUEST lifecycle and task item completion. |
| `.qe/checklists/` | VERIFY_CHECKLIST evidence and verification completion. |
| `.qe/TASK_LOG.md` | Completed-task registry and historical status. |

Adapter-local cache may speed up resume, status projection, or UI rendering. It
must not override `.qe/` state, completed TASK_REQUEST artifacts, completed
VERIFY_CHECKLIST artifacts, or `.qe/TASK_LOG.md`.

Harness lanes are stored in `.qe/state/harness-lanes.json`. A client may also
write `.qe/state/sessions/{sessionId}/harness-lanes.json` as a session mirror.
The session mirror follows the same read, fallback, and staleness rules as other
session-scoped state: read the session path first, fall back to the project-level
file, and treat stale session data as diagnostic input only.

Harness lane writes use the same temp-write + rename pattern as other state
files. Concurrent writers remain last-write-wins. The winning write is not
completion authority; it is only the latest runtime observation.

Missing or corrupt harness lane files are fail-safe. A missing file is treated as
an empty lane list. A corrupt file is ignored for completion claims and should be
reported as `degraded` evidence or a blocked status projection.

Harness lane format:

```json
{
  "lanes": [
    {
      "lane_id": "execution-harness-layer:debf2628:implement",
      "session_id": "019f18e4",
      "plan_slug": "execution-harness-layer",
      "task_uuid": "debf2628",
      "pse_step": "Execute",
      "sivs_stage": "Implement",
      "execution_mode": "durable_lane",
      "owner": "qrun-task",
      "lane_status": "running",
      "evidence_status": "degraded",
      "adapter_rendering": "proxy",
      "promotion_reason": ["multi_step", "requires_resume"],
      "artifact_paths": ["core/STATE_SPEC.md"],
      "evidence_refs": [".qe/checklists/in-progress/VERIFY_CHECKLIST_debf2628.md"],
      "blocked_reason": "",
      "updated_at": "2026-07-01T00:00:00.000Z",
      "source": "Execution Harness",
      "limitations": []
    }
  ]
}
```

Lane record fields:

| Field | Requirement |
| --- | --- |
| `lane_id` | Stable lane identifier, unique within the project-level lane registry. |
| `session_id` | Owning session when known; empty only when the client cannot expose it. |
| `plan_slug` | Named plan slug, or empty for legacy flat plans. |
| `task_uuid` | TASK_REQUEST/VERIFY_CHECKLIST UUID when the lane belongs to a task. |
| `pse_step` | PSE step represented by the lane. |
| `sivs_stage` | SIVS stage represented by the lane. |
| `execution_mode` | Selected harness mode, such as `solo`, `native_subagent`, `wave`, `durable_lane`, or `isolated_workspace`. |
| `owner` | Agent, lane, skill, or lead responsible for the current action. |
| `lane_status` | One of `pending`, `running`, `blocked`, `completed`, `stale`, or `abandoned`. |
| `evidence_status` | One of `pass`, `fail`, `degraded`, or `unsupported`, matching `core/EXECUTION_HARNESS.md`. |
| `adapter_rendering` | One of `native`, `wrapper`, `proxy`, `shim`, `degraded`, or `unsupported`, matching `core/LIFECYCLE_ADAPTER.md`. |
| `promotion_reason` | Reason labels explaining why the lane is not simple solo execution. |
| `artifact_paths` | Files created, modified, checked, or consumed by this lane observation. |
| `evidence_refs` | Checklists, reports, command logs, or links that can be inspected. |
| `blocked_reason` | Required when `lane_status` is `blocked`, `stale`, or `abandoned`. |
| `updated_at` | ISO timestamp for the lane observation. |
| `source` | Tool, hook, adapter, skill, or reviewer that produced the record. |
| `limitations` | Known evidence gaps, degraded behavior, unsupported capability, or cache-only status. |

Harness state uses three separate status axes:

| Axis | Values | Meaning |
| --- | --- | --- |
| `lane_status` | `pending`, `running`, `blocked`, `completed`, `stale`, `abandoned` | Operational lane progress. |
| `evidence_status` | `pass`, `fail`, `degraded`, `unsupported` | Inspectability of the evidence backing the lane. |
| `adapter_rendering` | `native`, `wrapper`, `proxy`, `shim`, `degraded`, `unsupported` | How the active client exposed the lifecycle or status signal. |

These axes must not be collapsed. A lane can be operationally `completed` while
its evidence remains `degraded`, and that is not SIVS completion.

Session binding rules:

- If `session_id` is known, the lane belongs to that session until it completes,
  becomes stale, or is explicitly superseded.
- A stale session cannot claim completion. Resume must re-check the completed
  TASK_REQUEST, completed VERIFY_CHECKLIST, and `.qe/TASK_LOG.md`.
- Unknown `session_id` records may be used for diagnostics, but rebinding them
  to a session must preserve the original `source` and `updated_at` evidence.
- Duplicate `task_uuid` + `plan_slug` active lanes are a conflict unless they
  have distinct `execution_mode` values and non-overlapping artifact paths.
- A stale-owner takeover must mark the previous lane `stale` or `abandoned`
  before the new lane claims ownership.
- Two live sessions claiming the same lane must render as `blocked` with a
  `blocked_reason`; neither session may claim SIVS completion from that state.

Recovery decisions use `hooks/scripts/lib/process-recovery.mjs`. Runtime lane
state remains observational: stale or completed lanes are reverified before any
completion transition, ownership conflicts require an explicit decision, and
only fresh singly owned evidence-backed work may resume directly.

Cache and evidence edge-case rules:

- Corrupt cache is discarded or marked `degraded`; it is never repaired by
  trusting adapter-local state over `.qe/` artifacts.
- Missing canonical TASK_REQUEST or VERIFY_CHECKLIST artifacts block completion
  claims even if a lane says `completed`.
- Unreadable task or checklist files force `evidence_status: "degraded"` or
  `evidence_status: "unsupported"`.
- Unresolved artifact paths and broken evidence refs must stay visible in
  `limitations` and block a pass-style status projection.
- Partial evidence, unresolved evidence, or cache-backed-only evidence prevents
  `LaneCompleted` and `StatusProjected` from rendering as completed/pass. Render
  `blocked`, `degraded`, or `unsupported` with a concrete `blocked_reason` or
  `limitations` entry.

Phase 2 only defines how escalation is represented in state. Full mode resolver
thresholds and selection algorithms are defined later. For now,
`promotion_reason` can record these labels:

| Label | Meaning |
| --- | --- |
| `long_running` | Work is expected to span a long session or multiple stop cycles. |
| `multi_step` | Work has multiple dependent stages that need resumable progress. |
| `conflicting_edits` | Work may overlap with another active lane or dirty file set. |
| `risky_or_experimental` | Work should be isolated before it touches the main tree. |
| `requires_resume` | Work needs explicit handoff or continuation state. |
| `requires_isolation` | Work should run in an isolated workspace before integration. |

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
