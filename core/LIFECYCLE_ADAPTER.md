# Lifecycle Adapter

## Purpose

QE lifecycle behavior is written once as generic policy and then rendered through
the active client adapter. Claude and Codex expose different hook primitives, so
shared docs and runtime messages must not assume that a Claude plugin hook is the
only lifecycle surface.

## Generic Event Model

| Generic event | Purpose | Safety-critical? |
| --- | --- | --- |
| `SessionStart` | Inject initialization, routing, memory, profile, and resume context. | no |
| `PreToolUse` | Block unsafe actions and inject execution hints before a tool runs. | yes |
| `PostToolUse` | Record follow-up state after file, shell, or tool activity. | partial |
| `PreCompact` | Preserve handoff context before compaction. | partial |
| `Stop` | Prevent premature session exit while required work remains. | yes |
| `UserPromptSubmit` | Route user intent and prompt-level checks. | partial |
| `Notification` | React to agent completion, Codex materialization, and persistent-mode signals. | partial |
| `TeammateIdle` | Maintain team-worker progress signals where supported. | no |
| `TaskCompleted` | Archive or summarize task completion state. | partial |
| `Status/HUD` | Render compact runtime state for the active session. | no |

## Step-by-Step Contract

1. Write the generic lifecycle rule first.
2. Resolve the active client through runtime environment (`QE_CLIENT`) or install context.
3. Render user-facing QE commands with the active command prefix (`QE_COMMAND_PREFIX`, default `/` for Claude, `$` for Codex).
4. Keep safety-critical checks client-neutral at the policy level.
5. Implement Claude behavior in Claude plugin hooks.
6. Implement Codex behavior through Codex hook fences, wrapper scripts, native config, or command proxies.
7. If a client cannot expose an event, label the behavior `unsupported`, `shim`, or `degraded` instead of claiming parity.
8. Verify with targeted hook/wrapper tests and a static neutrality scan.

## Claude Adapter

1. Claude installs hook entries from `.claude-plugin/plugin.json` and `hooks/hooks.json`.
2. Hook commands execute scripts under `hooks/scripts/`.
3. `PreToolUse` can hard-block by exiting with code 2.
4. `statusLine` is a Claude-native HUD surface and executes `hooks/scripts/statusline.mjs`.
5. Claude user-facing QE commands render as `/Q...`; maintainer-only admin workflows are exposed through `qe-admin-mcp`.

## Codex Adapter

1. Codex assets install under `~/.codex/` when a Codex home exists.
2. Codex hook entries point at `hooks/scripts/codex/lifecycle-codex.mjs`, which forwards payloads to the shared QE hook scripts with `QE_CLIENT=codex` and `QE_COMMAND_PREFIX=$`.
3. Codex `PreToolUse` is the safety-critical parity surface for raw commit, PR creation, version edit, and related hard blocks.
4. Codex has no Claude-style native `statusLine`; report status through normal command output rather than a HUD proxy.
5. Codex user-facing QE commands render as `$Q...`; maintainer-only admin workflows are exposed through `qe-admin-mcp`.

## Fallback Labels

| Label | Meaning |
| --- | --- |
| `native` | The client exposes the event directly and QE runs the matching hook. |
| `wrapper` | QE adapts the client payload and forwards it to a shared hook script. |
| `proxy` | QE exposes equivalent behavior as an explicit command instead of a hook. |
| `shim` | QE approximates the lifecycle behavior through state or prompt/context injection. |
| `unsupported` | The active client does not expose the lifecycle event. |
| `degraded` | The behavior runs but lacks an isolation, timing, or UI primitive available in another client. |

## Execution Harness Lifecycle Labels

Execution Harness labels are sub-events rendered through the generic lifecycle
events above. They are not new top-level lifecycle events, and they do not add a
new completion authority.

| Harness label | Meaning | Generic rendering path |
| --- | --- | --- |
| `HarnessModeSelected` | A SIVS stage selected an execution mode. | `PostToolUse`, `Notification`, or command output |
| `DurableLaneStarted` | A resumable lane was created or resumed. | `PostToolUse`, `Notification`, or `Status/HUD` |
| `LaneProgressRecorded` | The lane recorded a new runtime observation. | `PostToolUse` or command output |
| `EvidenceCollected` | The lane recorded inspectable evidence for Verify or Supervise. | `PostToolUse`, `Notification`, or command output |
| `LaneBlocked` | The lane cannot continue without remediation, ownership resolution, or missing evidence. | `Stop`, `Notification`, or `Status/HUD` |
| `LaneCompleted` | The lane finished operational work. | `Notification`, `TaskCompleted`, or command output |
| `StatusProjected` | QE rendered a read-only view of PSE/SIVS/harness state. | `Status/HUD` or command output/proxy |

Harness label payloads should point back to `core/STATE_SPEC.md` lane records
when a lane exists. If no lane record exists, the lifecycle message must be
treated as a transient observation and must not claim completion.

### Harness Label Mapping

Mode selection, progress, evidence collection, block state, and operational
completion may be observed through different generic events depending on the
client. The generic policy stays the same:

1. Record the label as evidence or status input.
2. Preserve the active command prefix in user-facing messages.
3. Mark the adapter rendering as `native`, `wrapper`, `proxy`, `shim`,
   `degraded`, or `unsupported`.
4. Defer completion authority to TASK_REQUEST, VERIFY_CHECKLIST, and Supervise.

`StatusProjected` uses a native status/HUD surface when the client exposes one.
When no native surface exists, render the projection as command output or another
explicit proxy. A proxy projection is valid status output, but it is not parity
with a native HUD and must not be described that way.

### Degraded And Unsupported Harness Behavior

Clients that cannot expose a native lifecycle or status surface must label that
behavior explicitly:

- Use `degraded` when QE can report the behavior but lacks the native timing,
  isolation, or UI primitive.
- Use `unsupported` when the behavior cannot be observed or represented.
- Record the missing capability in `limitations`.
- Do not claim SIVS completion, parity, or successful evidence collection from a
  degraded or unsupported lifecycle signal alone.

### Partial Evidence Rendering

`EvidenceCollected` only means evidence was observed. It does not mean the
evidence is complete, readable, or sufficient.

If evidence is unresolved, degraded, unsupported, cache-backed only, or points to
missing artifacts:

- `LaneCompleted` must not be rendered as pass-style completion.
- `StatusProjected` must include `pending_evidence` or `blocked_reason`.
- The lane should render as `blocked`, `degraded`, or `unsupported`.
- The gap must be visible through `limitations`.

### Status Projection Fields

Status projection is a read-only view of current state. It must include these
fields when available:

| Field | Meaning |
| --- | --- |
| `pse_step` | Current PSE step. |
| `sivs_stage` | Current SIVS stage. |
| `lane_status` | Operational lane status from `core/STATE_SPEC.md`. |
| `owner` | Agent, lane, skill, or lead responsible for the current action. |
| `pending_evidence` | Evidence still required before Verify or Supervise can pass. |
| `blocked_reason` | Reason the lane or projection cannot advance. |
| `artifact_paths` | Files created, modified, checked, or consumed by the lane. |
| `updated_at` | ISO timestamp for the projected observation. |
| `source` | Tool, hook, adapter, skill, or reviewer that produced the projection. |
| `limitations` | Known degraded behavior, unsupported capability, or evidence gap. |

Projection is never a substitute for VERIFY_CHECKLIST completion or Supervise
evidence. It may summarize state; it cannot decide completion.

## Verification

Run these checks after lifecycle changes:

```bash
node --test hooks/scripts/lib/__tests__/codex-lifecycle-wrapper.test.mjs
node --test hooks/scripts/lib/__tests__/session-resolver.test.mjs
node scripts/check-hook-falsepositive.mjs
node scripts/check-client-neutrality.mjs
npm run qe:validate
git diff --check
```

For installer-related lifecycle changes, also run:

```bash
node --test scripts/lib/__tests__/codex-install.test.mjs
```
