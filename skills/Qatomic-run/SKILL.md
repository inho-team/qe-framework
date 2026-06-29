---
name: Qatomic-run
description: "Parallel Haiku-wave engine — partitions a TASK_REQUEST into independent atomic items and dispatches them concurrently to multiple Haiku teammates, merging results through a Lead session. Branch points: use THIS when the checklist has MANY (>=5) independent atomic items with non-overlapping file ownership and low complexity; use Qrun-task for sequential execution of non-atomic or order-dependent items; use Qcode-run-task after code lands to run the test-review-fix loop. Canonical PSE path: /Qplan → /Qgs → /Qatomic-run → /Qcode-run-task."
invocation_trigger: "When a TASK_REQUEST contains many atomic items that can be executed in parallel by low-reasoning agents."
recommendedModel: sonnet
tier: core
---

# Qatomic-run — Haiku Wave Execution Engine

## Role
A coordination skill that orchestrates multiple **Haiku Teammates** to execute atomic checklist items in parallel. It acts as the "Lead" session that partitions work and merges results.

## Client Adapter Compatibility

- **Claude**: use Agent Teams / Agent tool as described below.
- **Codex native**: use native Codex subagents through the installed agent TOML.
- **Codex client adapter**: if the active Codex runtime lacks subagent dispatch, preserve the role contract with role-separated inline execution and mark the fallback explicitly.
- **Command rendering**: user-visible handoffs use `adapter.commandPrefix` (`/Q...` for Claude, `$Q...` for Codex).

## Workflow

### Step 1: Atomic Partitioning
Read the `TASK_REQUEST` and identify items suitable for parallel execution:
- No inter-dependencies (or dependencies are already met).
- Low complexity (single file edits, text changes, simple logic).
- Non-overlapping file ownership.

### Step 2: Wave Initiation
Create an **Agent Team** through the agent adapter:
- Claude: use the `Agent` tool.
- Codex: use native Codex subagents through the client adapter; otherwise preserve the role contract with role-separated inline execution.
- Dispatch Haiku Teammates through a per-wave cap of `min(cpuCount - 2, 3)`; on low-core machines the effective runtime cap is clamped to at least 1.
- Queue additional atomic items FIFO. A queued item starts only after an active teammate completes.
- Assign **one Haiku Teammate per active atomic item** within that cap.
- **Atomic Commits**: Teammates MUST perform a `git commit` immediately after completing their specific item.
- **Technical Summary**: Teammates MUST create `SUMMARY_{Item#}.md` under the active plan's phase directory — resolve the slug via `.qe/state/current-session.json` → `.qe/planning/.sessions/{session_id}.json` → `.qe/planning/ACTIVE_PLAN`, then write to `.qe/planning/plans/{slug}/phases/{X}/SUMMARY_{Item#}.md`. Legacy projects with no slug resolvable write to `.qe/planning/phases/{X}/SUMMARY_{Item#}.md`.
- Set teammates to `haiku` model for maximum speed and efficiency.

### Step 3: Result Synthesis
As Haiku teammates complete their tasks:
- Lead session (Opus/Sonnet) reads all `SUMMARY_*.md` files.
- Synthesize changes without re-reading entire files unless a merge conflict occurs.
- Aggregate all changes into the main working branch.

### Step 4: Post-Execution Gate
After all atomic items are done, determine the next step based on task type:
- The Lead session runs exactly one full build/test verification after all wave workers complete and results are synthesized.
- The Lead-owned full build/test verification is subject to the PreToolUse build admission gate; if blocked for low memory or a competing build, wait and retry instead of launching another build.
- Workers MUST NOT invoke `{adapter.commandPrefix}Qcode-run-task` or project build/test commands directly.
- **`type: code`** → the single Lead-owned verification handoff is `{adapter.commandPrefix}Qcode-run-task` for test → review → fix quality loop.
- **`type: docs` / `type: analysis` / deletion-heavy tasks** → run SIVS Loop verification (VERIFY_CHECKLIST check + supervision) directly, skip `/Qcode-run-task`.

## Execution Rules
- **Wave**: Group independent items from `TASK_REQUEST` into execution waves. Wave N+1 starts only after Wave N is verified.
- **File Ownership**: No two teammates can modify the same file within the same wave. Lead (Sonnet) must partition files before spawning.
- **Haiku-First**: Always use `haiku` for teammates. If an item requires Sonnet, it's not "Atomic" and should be handled by standard `/Qrt`.
- **Context Integrity**: Use `ContextMemo` to ensure teammates have current state without redundant I/O.

## Worktree Isolation (`--worktree`, opt-in)

By default Qatomic-run executes waves **in-place** on the current working tree. When invoked with `--worktree`, each wave item is dispatched with the Agent tool's `isolation: "worktree"` parameter, so every teammate works on its own throwaway git worktree instead of the live tree. (Source: adopted from Superpowers' worktree stage — see `D018` in `.qe/planning/DECISION_LOG.md`.)

- **No new runtime code** — this reuses the existing `Agent(..., { isolation: "worktree" })` capability. `--worktree` only flips that flag on per-item dispatch.
- **opt-in**: in-place is always the default. Isolation engages only when `--worktree` is passed explicitly.
- Worktrees are auto-removed if a teammate leaves them unchanged; merge surviving changes back through the Lead session at Step 3 (Result Synthesis).

### worktree vs in-place — selection guide

| Situation | Mode | Why |
|-----------|------|-----|
| Two+ items must touch the **same file** in one wave | `--worktree` | Isolation removes the file-ownership constraint that otherwise forces serialization |
| **Experimental / risky** changes that may be discarded | `--worktree` | Keeps the live working tree clean; discard = drop the worktree |
| Wave items have **non-overlapping file ownership** (the normal case) | in-place (default) | No isolation overhead; simpler merge |
| Single-file or trivial doc edits | in-place (default) | Worktree setup cost (~disk + setup latency) not worth it |

## SIVS Engine Routing

Before spawning Haiku teammates, resolve SIVS engine routing:

1. Read `.qe/sivs-config.json` from the project root (via `scripts/lib/codex_bridge.mjs` → `loadSivsConfig()`).
2. Call `resolveEngine("implement", config)`. If Codex is installed and no explicit config overrides it, Implement resolves to Codex by default.
   - **`"claude"`**: Proceed with the standard Haiku swarm execution. No changes.
   - **`"codex"`**: Delegate implementation to Codex via codex-plugin-cc instead of Haiku swarm:
     1. If available: invoke the returned command with the full TASK_REQUEST checklist as a single task. Codex handles all items internally (no wave splitting needed).
     2. If NOT available: show warning and fallback to standard Haiku swarm execution.
3. Check for legacy config: call `detectLegacyConfig()`. If non-null, display migration warning.

**Note**: When using Codex engine, wave-based parallelism is not used — Codex handles task partitioning internally. The Verify stage (validation) and quality loop (`/Qcode-run-task`) still run after Codex completes.

**Codex Materialization Check (Mandatory after Codex Done):**
Codex may return `Done` before files are actually written (async companion pattern). The notification hook (`notification.mjs`) handles initial detection and writes state to `unified-state.json` under the `codex_materialization` key.

**After every Codex `Done`, execute this sequence:**

1. **Read unified state** — check `.qe/state/unified-state.json` → `codex_materialization` field:
   - `status: "completed"` → files written. Run `git diff --stat`, proceed to **Verify**.
   - `status: "failed"` → report error, offer retry or Claude fallback.
   - `status: "crashed"` → companion PID was confirmed dead before materialization. Enter the abnormal-termination retry path immediately: retry Codex once through the existing SIVS route, then fallback to standard execution if the same task/worker/item has already retried.
   - `status: "running"` → poll watcher active, proceed to step 2.
   - Field missing → proceed to step 2.

2. **Read signal file** — `cat .qe/agent-results/codex-ready.signal 2>/dev/null`:
   - `"detected": true` → files written. Run `git diff --stat`, proceed to **Verify**.
   - `"crashed": true` or `"status": "crashed"` → companion process died before materialization. Enter the one-retry/fallback path immediately; do not wait for the 1h timeout.
   - File not found → watcher still polling. Wait 30s, re-read. Repeat up to 120 times (1h).
   - `"timeout": true` → no changes after 1h. Go to step 3.

3. **Fallback** — use the interaction adapter:
   - "Codex companion did not produce file changes after 1 hour."
   - (a) Keep waiting +1h  (b) Retry with Codex  (c) Implement with Claude  (d) Check Codex process

Results are logged to `.qe/agent-results/codex-materialization.md` automatically.

**Fallback guarantee**: Missing `.qe/sivs-config.json` → all stages default to Claude. Zero impact on existing workflows.

## Will
- Orchestrate parallel execution via Agent Teams
- Monitor Haiku teammate performance
- Synthesize results and handle merges

## Handoff
After all Wave items are complete, resolve the active plan's ROADMAP (session binding → `.qe/planning/ACTIVE_PLAN` → flat fallback) and display execution summary + handoff. Read `.qe/planning/plans/{slug}/ROADMAP.md` when a slug resolves; fall back to flat `.qe/planning/ROADMAP.md` for legacy projects. Use the standard handoff format from `QE_CONVENTIONS.md` (vertical table, `[x]`/`[>]`/`[ ]` markers, single code block, lines under 60 chars).

### Execution Summary (always show before handoff)
```
Execution Complete: {TaskName}
  Type: {code / docs / analysis}
  Waves: {N}
  Items: {X}/{Y} completed
  Teammates: {Z}
```

### When `type: code`
```
{slug} · Phase {X}: {PhaseName} — Implementation complete

Roadmap
  [x] Phase 1: {Name1}
  [>] Phase {X}: {PhaseName}
  [ ] Phase {X+1}: {NextName}

PSE: [x] Plan [x] Spec [x] Execute [>] Verify

{TaskDescription — 다음 작업 내용 한 줄 요약}
Next: {adapter.commandPrefix}Qcode-run-task {UUID}
```

### When `type: docs` / `type: analysis` / deletion-heavy
After performing SIVS verification inline (VERIFY_CHECKLIST check + supervision gate):
```
{slug} · Phase {X}: {PhaseName} — Complete

Roadmap
  [x] Phase 1: {Name1}
  [>] Phase {X+1}: {NextName}
  [ ] Phase {X+2}: {FutureName}

PSE: [x] Plan [x] Spec [x] Execute [x] Complete

{NextPhaseDescription — 다음 Phase 작업 내용 한 줄 요약}
{Next label — 사용자 입력 언어로, 예: "다음:" / "Next:"}: {adapter.commandPrefix}Qgs {slug}: {짧은 별칭, 최대 6단어}
```
(Fallback line 금지 — `Qgs`는 `Qgenerate-spec`의 alias이므로 중복이다. Legacy flat-file projects drop the `{slug} · ` prefix and use `{adapter.commandPrefix}Qgs Phase {X+1}: {짧은 별칭}`.)
When all Phases are complete:
```
All phases done. Finalize with /Qcommit
```

## Will Not
- Implement complex architectural changes (handle via standard **Etask-executor**)
- Bypass the quality loop
- Skip the handoff
