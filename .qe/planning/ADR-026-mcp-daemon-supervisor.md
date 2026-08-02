# ADR-026: Keep Supervisor Scheduling Outside the MCP Process

## Status

Accepted, with the narrow D032 resident-event-producer exception documented in
`docs/SUPERVISOR_EVENT_CONTRACT.md`.

## Context

QE needs periodic health observations, but an MCP server is normally started by
a client session and is not a durable process manager. Letting the MCP process
silently own timers, restart logic, or remediation would make lifecycle,
permissions, and failure recovery depend on an interactive client.

The decision was reviewed through `Qdebate`: a resident MCP daemon is convenient
for a single active session, while an OS-native scheduler has durable ownership,
observable restart semantics, and a clear operator boundary.

## Decision

Use an **OS-native scheduler** as the default owner of timed supervisor work.
The scheduler invokes bounded monitor commands and writes observable event/status
artifacts; QE renders those artifacts during its normal lifecycle hooks.

The MCP server must not start hidden background daemons, perform silent
remediation, write source or client configuration, read secrets/raw environment,
delegate to a runner, or recursively invoke agents/tools.

D032 permits only one explicit exception: an opt-in, single-producer resident
event loop. It is disabled by default, holds an atomic ownership lock, runs only
the fixed safe monitor specifications, appends retained events, and releases its
resources on shutdown. It does not replace the OS-native scheduler as the
default scheduling owner.

## Alternatives Considered

- **Resident MCP daemon for all scheduling** — rejected: session-bound lifetime,
  unclear ownership, and hidden side effects make restart and audit guarantees
  weak.
- **In-process timers without a lock** — rejected: multiple client sessions can
  duplicate monitors and event writes.
- **No periodic monitoring** — rejected: it removes health visibility needed for
  degraded or unsupported-platform guidance.

## Consequences

- Operators configure and observe scheduled monitoring through the operating
  system rather than an opaque client process.
- Supervisor outputs remain bounded, append-only evidence that hooks can render
  without gaining remediation power.
- The D032 exception adds lock, heartbeat, retention, and shutdown complexity;
  it remains opt-in so existing projects keep the external-scheduler behavior.
- Any broader move of scheduling or remediation into MCP requires a new ADR and
  corresponding event-contract and safety-test updates.
