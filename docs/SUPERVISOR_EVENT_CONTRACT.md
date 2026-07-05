# Supervisor Event Contract

Requirements: R1, R2, R4, NFR1, NFR2, NFR3, NFR4, NFR6

## Scope

`qe-mcp` is a supervisor control/status API. OS-native schedulers own timed
execution, process restart semantics, heartbeat production, and monitor command
invocation — EXCEPT for the single opt-in resident event producer sanctioned in
"Resident Event Producer (D032)" below. `qe-framework` owns
SessionStart/Notification rendering and user-facing guidance.

Phase 1 and later supervisor surfaces must not introduce silent
remediation, source writes, client config writes, secret or raw environment
access, runner delegation, or recursive agent/tool invocation.

In short, silent remediation is forbidden.

### Resident Event Producer (opt-in, single-producer) — D032

The original prohibition on "internal MCP timers / resident MCP scheduler loops /
hidden background daemon starts" is relaxed to a **conditional allowance** for an
in-process supervisor event producer, under ALL of the following invariants
(ADR D032). Absent any one of these, the resident loop stays forbidden:

- **Opt-in only.** The loop is inert unless `QE_MCP_SUPERVISOR_DAEMON=on`. Default
  off — existing deployments are byte-for-byte unaffected.
- **Single producer.** Because an MCP server is spawned per client session, at
  most one instance may run the loop. Ownership is held by a single-producer lock
  (`locks/producer.lock`: pid + createdAt + heartbeatAt) acquired with atomic
  `wx`; non-owners stay passive. A dead owner (dead pid, or heartbeat past
  max-age) is stale-reaped so another instance can take over.
- **Graceful shutdown.** The loop clears its interval and releases the lock on
  stdin end/close and SIGTERM/SIGINT. A crash leaves the lock to heartbeat
  max-age reaping.
- **Retention enforced.** The producer owns `events.jsonl` retention (latest
  1,000 events or 30 days) and applies it on every append.
- **No new powers.** The loop may only run the fixed `MONITOR_SPECS` safe
  commands (arg-array, no shell) and append events. All other prohibitions
  (source/config writes, secrets, runner delegation, recursion, silent
  remediation) remain in force.

This is the ONLY sanctioned resident loop. Any other internal timer or hidden
daemon start remains forbidden.

Existing `auto-refresh` and `qcron` paths are framework-owned housekeeping for
`.qe/analysis`. The supervisor contract does not reuse that hidden scheduler
pattern. Convergence requires a later ADR and phase.

## QE MCP Maintenance Parity Matrix

| Term | Existing QE MCP Boundary | Supervisor Contract |
| --- | --- | --- |
| Scheduling owner | External scheduler only | External scheduler, OR one opt-in single-producer resident loop (D032) |
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
