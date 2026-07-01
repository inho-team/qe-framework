# Subagent Lifecycle

QE workflows can delegate work to subagents through the active client adapter.
The client runtime owns the actual `spawn_agent`, `wait_agent`, and
`close_agent` primitives; QE owns the orchestration contract around them.

## Required Lifecycle

Any QE workflow that starts subagents must:

1. Track the handle id, role, task item, start time, and expected exit condition.
2. Use `wait_agent` or the active client equivalent to collect completed,
   failed, and timed-out results.
3. After a result is collected, call `close_agent` or the active client
   equivalent for every completed handle before the final report.
4. Report lifecycle status in the final summary: `open handles: 0` or stale
   warnings with handle id, role, and reason.

Close cleanup is best-effort cleanup. If the work result was collected and the
only failure is closing the handle, QE records a warning rather than failing the
whole task.

## Reading Runtime Logs

| Log shape | Meaning | Action |
| --- | --- | --- |
| `Closed ...` | A handle was closed or a close request finished. | Normal when the final report shows `open handles: 0`. |
| `Waiting for ...` | The lead is waiting for a live handle, timeout window, or result materialization. | Normal while the worker is still inside its exit condition. |
| `Waiting for ...` after result collection | The handle may be stale or cleanup may still be pending. | Record stale warning and verify whether the result was collected. |
| Timeout/stale warning | A worker exceeded its exit condition, crashed, or could not be closed cleanly. | Preserve collected evidence; retry or fallback only when the missing result blocks correctness. |

## Normal Delay vs Stale Cleanup

A slow wait is normal when the subagent is still running, tests are still
executing, or the workflow timeout has not elapsed. It needs no user action
unless the task result is blocked.

A stale cleanup warning is needed when the worker has already completed, failed,
or timed out, but the final report cannot confirm `open handles: 0`. This is a
lifecycle hygiene issue. It is not automatically a code failure unless the
subagent result was never collected.

## Current Guard

`scripts/check-subagent-lifecycle.mjs` verifies that the core orchestration
contract and delegation-heavy QE surfaces keep the required lifecycle language:
`wait_agent`, `close_agent`, stale warnings, open handles, and final report
status. It is a deterministic static guard because the repo does not own the
client runtime's live handle registry.
