# Hook Runtime Audit

Reviewed: 2026-08-02

## Decision

QE should keep the lifecycle events that protect an observable user outcome,
remove two registered events whose behavior is duplicated or semantically
incorrect, and reduce synchronous work in every turn- or tool-frequency path.
The machine-readable source of this decision is
`hooks/hook-inventory.json`; `scripts/check-hook-architecture.mjs` prevents the
manifests and this inventory from drifting apart.

The decisions were applied in the same hardening plan. Both Claude manifests,
the Codex installer projection, runtime scripts, tests, and operational docs now
share the inventory below.

## Primary-source constraints

- [Claude Code hooks](https://code.claude.com/docs/en/hooks) defines hook
  `timeout` values in **seconds**, recommends fast `SessionStart` handlers, and
  documents exit `2` as the intentional blocking signal. Matching before spawn
  is part of the configuration model.
- [Codex hooks](https://developers.openai.com/codex/hooks) requires explicit
  trust for non-managed command hooks, launches matching hooks concurrently,
  and currently documents `PreToolUse`, `PermissionRequest`, `PostToolUse`,
  `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`,
  `SessionStart`, `SubagentStart`, and `SessionEnd`. It does not document
  Claude-specific `Notification`, `TeammateIdle`, or `TaskCompleted` events.
- [Node child processes](https://nodejs.org/api/child_process.html) documents
  synchronous child-process calls as blocking and provides bounded `timeout`
  and `maxBuffer` controls. Shell execution must not receive unsanitized input.
- [GitHub webhook practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
  recommends subscribing only to required events, filtering by event/action,
  returning promptly, and treating redelivery as normal. These are applicable
  delivery principles even though QE hooks are local lifecycle callbacks.
- [OpenTelemetry instrumentation](https://opentelemetry.io/docs/concepts/instrumentation/)
  provides the basis for bounded duration/outcome telemetry instead of
  unstructured hot-path logging.

## Measured baseline

`node scripts/perf_hooks.mjs` was run for 50 iterations on 2026-08-02 after
hardening. On Node v23.6.0 / Apple M3 Pro, the recorded local result is 91 ms
p95 for a plain prompt hook and 40 ms p95 for PreToolUse. The pre-hardening
plain-prompt baseline was 93 ms. These values are comparison baselines, not
portable performance guarantees.

The Claude and Codex manifests now use the same explicit budgets: 5 seconds for
SessionStart, PostToolUse, and Stop; 3 seconds for PreToolUse,
UserPromptSubmit, TeammateIdle, and TaskCompleted. The Codex child adapter has a
4.5 second internal bound so it cannot outlive the enclosing 5 second budget.

## Registered-event decision table

| Event | Verdict | User outcome | Main reason / required change |
| --- | --- | --- | --- |
| `SessionStart` | keep (hardened) | Restore minimal QE session and Plan context | Removed synchronous Git, sweep, and skill-budget scans; normalized timeout units. |
| `PreToolUse` | keep (hardened) | Block destructive or contract-breaking operations | Preserved match-all for Read/Agent/AskUserQuestion coverage and bounded the timeout. |
| `PreCompact` | remove | No unique outcome demonstrated | Compact-aware `SessionStart` already resets memo state and restores context; this path duplicates work. |
| `PostToolUse` | keep (hardened) | Admit builds and emit bounded feedback | Matcher and timeout now bound the supported local-tool surface. |
| `Stop` | keep (hardened) | Prevent false completion | Uses `last_assistant_message` first; removed webhook I/O and advisory Git subprocesses. |
| `UserPromptSubmit` | keep (hardened) | Route explicit intent and bootstrap minimal Plan context | Local deterministic routing; no prompt network, profile write, or naming worker. |
| `Notification` | remove | No reliable QE outcome | The implementation misclassifies notification semantics, starts a long watcher, and has no current Codex event equivalent. |
| `TeammateIdle` | keep (hardened) | Reject idle only for concrete assigned work | Claude-only; intentional blocks use stderr with exit 2. |
| `TaskCompleted` | keep (hardened) | Enforce paired verification completion | Claude-only; admission and advisory output use their documented protocols. |

## Unregistered entrypoints

| Entrypoint | Verdict | Evidence |
| --- | --- | --- |
| `hooks/scripts/context-guard.mjs` | remove | No manifest, import, runtime caller, or active contract; `context-monitor.mjs` owns the live pressure path. |
| `hooks/scripts/codex/pre-tool-use-codex.mjs` | remove | No manifest, installer, or runtime caller; `lifecycle-codex.mjs` delegates to the shared PreToolUse entrypoint. |
| `hooks/scripts/context-monitor.mjs` | keep | Dynamically imported by PreToolUse and covered by context-limit tests. |
| `hooks/scripts/codex/lifecycle-codex.mjs` | keep (hardened) | Required Codex adapter with explicit timeout, kill signal, and output buffer bound. |
| `hooks/scripts/lib/session-namer.mjs` | remove | No caller after prompt admission became deterministic. |
| `hooks/scripts/lib/codex-poll-watcher.mjs` | remove | Its Notification-owned caller was removed. |
| `hooks/scripts/lib/codex-result-handler.mjs` | remove | Its Notification-owned caller was removed. |
| `hooks/scripts/lib/notify.mjs` | remove | Blocking Stop hooks must not own optional network delivery. |

## Removal and hardening gates

Before removing a path, update both hook manifests, installer projections,
documentation, focused tests, and the inventory in one change. Before changing
a blocking hook, prove the positive block case and known false-positive cases.
Codex installation must preserve unowned or locally modified destination files;
repository cleanup is not authorization to recursively prune generic user
directories. The hardened installer enforces this with
`~/.codex/.qe-owned-assets.json`: cleanup requires both a recorded path and a
matching SHA-256, removes files individually, preserves modified/unowned
content, and refuses to activate an unowned hook-entry collision.

## Reproduction

```sh
node --test hooks/scripts/lib/__tests__/hook-runtime-audit.test.mjs
node scripts/check-hook-architecture.mjs
node scripts/perf_hooks.mjs
node scripts/check-all.mjs
```
