# Supervisor Event Contract

Requirements: R1, R2, R4, NFR1, NFR2, NFR3, NFR4, NFR6

## Scope

`qe-mcp` is a supervisor control/status API, not a daemon host. OS-native
schedulers own timed execution, process restart semantics, heartbeat production,
and monitor command invocation. `qe-framework` owns SessionStart/Notification
rendering and user-facing guidance.

Phase 1 and later supervisor surfaces must not introduce internal MCP timers,
resident MCP scheduler loops, hidden background daemon starts, silent
remediation, source writes, client config writes, secret or raw environment
access, runner delegation, or recursive agent/tool invocation.

In short, silent remediation is forbidden.

Existing `auto-refresh` and `qcron` paths are framework-owned housekeeping for
`.qe/analysis`. The supervisor contract does not reuse that hidden scheduler
pattern. Convergence requires a later ADR and phase.

## QE MCP Maintenance Parity Matrix

| Term | Existing QE MCP Boundary | Supervisor Contract |
| --- | --- | --- |
| Scheduling owner | External scheduler only | No MCP timers or daemon loops |
| Permission classes | read-only/report-only/recoverable-write/source-write/config-write/secret/env/runner delegation | Supervisor status is read-only/report-only; ack writes only ack state |
| Recoverable writes | Explicit approval fingerprint | Not part of Phase 1/2 supervisor install dry-run |
| No source/config writes | Forbidden by default | Supervisor reporting cannot modify source or client config |
| No secrets/env access | Forbidden by default | Supervisor checks must not read broad env or secrets |
| No runner delegation | Forbidden by default | Supervisor checks cannot call Codex/Claude runners |
| No recursion | Active-runner trust boundary | Supervisor tools cannot call supervisor or agent tools recursively |

## Event Schema

Supervisor events are JSON objects with:

- `schema`
- `event_id`
- `severity`
- `source`
- `workspace`
- `monitor_id`
- `dedupe_key`
- `first_seen_at`
- `last_seen_at`
- `ack`
- `summary`
- `details`
- `evidence_path`
- `evidence_fingerprint`
- `remediation_hint`

Allowed severities: `INFO`, `WARN`, `FAIL`, `CRITICAL`.

## Dedupe, Ack, And Reopen

The normalized dedupe identity is:

```text
workspace + monitor_id + dedupe_key
```

`source` is an equivalence guard around that identity: the same `dedupe_key`
from a different `source` or different `monitor_id` does not collapse unless a
later contract explicitly declares equivalence.

Rules:

- Same normalized identity collapses into one logical event.
- Repeated ack is a no-op.
- A duplicate after ack stays hidden while severity and evidence fingerprint are
  unchanged.
- Acknowledged events reopen on higher-severity reopen, same-key new-evidence
  reopen, `ack.expires_at` expiry, or manual clear.
- Concurrent append/ack ordering is last-writer-observable.

## Storage

Project-local state:

```text
.qe/state/supervisor/events.jsonl
.qe/state/supervisor/acks.json
.qe/state/supervisor/status.json
.qe/state/supervisor/logs/{monitor_id}.log
.qe/state/supervisor/locks/{monitor_id}.lock
```

Optional global state:

```text
~/.qe/daemon/events.jsonl
~/.qe/daemon/status.json
~/.qe/daemon/logs/{monitor_id}.log
```

Rules:

- Event writes are append-only JSONL.
- Derived status uses atomic temp-and-rename writes.
- Readers fail open for missing, unreadable, locked, truncated, or malformed
  files.
- Per-event serialized max is 16 KiB.
- Event read window max is 256 KiB.
- Log display slice max is 64 KiB.
- Default retention is latest 1,000 events or 30 days.
- Oversized logs are truncated for display and never injected raw into a
  session or MCP response.

## Unsupported Platform Response

Unsupported platform dry-run/status checks return:

```json
{
  "status": "degraded",
  "error_code": "UNSUPPORTED_PLATFORM",
  "platform": "unknown",
  "supported_platforms": ["darwin"],
  "next_step": "Use dry-run/status only or wait for a platform adapter",
  "side_effects": "none"
}
```

Dry-run/status surfaces must not start daemons on unsupported platforms.

## Fixture Strategy

Phase 1 contract tests keep fixtures as inline constants inside
`scripts/check-supervisor-event-contract.mjs`.

The deterministic guard covers valid events, duplicate normalized dedupe key
collapse, same dedupe key with different source/monitor non-collapse, first ack,
repeated ack no-op, duplicate after ack stays hidden, malformed event, missing,
unreadable, locked, truncated, oversized inputs, higher-severity reopen,
same-key new-evidence reopen, and `UNSUPPORTED_PLATFORM` response shape.
