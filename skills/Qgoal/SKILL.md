---
name: Qgoal
description: Routes an explicit goal, or a clear natural-language goal, to direct handling or the PSE pipeline. Use when the user enters /Qgoal {goal} or states a clear implementation goal.
invocation_trigger: When the user enters `/Qgoal {goal}` or a clear implementation goal in natural language.
user_invocable: true
recommendedModel: haiku
---

# Qgoal — Goal Router

Use `/Qgoal {목표}` to enter a goal explicitly. UserPromptSubmit applies the same deterministic router to clear natural-language goals.

The route payload is advisory: `{ detected, source, goalText, route, reason, instruction }`. `direct` keeps Micro/Small work on the existing direct path. `pipeline` hands Full/Workflow work to PSE as `spec → execute → verify`; Workflow additionally proposes a dynamic workflow. Render subsequent commands using the active client's command prefix.

`!direct` and `!full` may override automatic scale only when they are standalone prompt-edge tokens. Router or state failures are fail-open: preserve normal handling and do not treat a marker as authorization. A missing session ID produces no marker and retains direct guidance.

## Execution Procedure

Step 1 — Resolve the route payload. If UserPromptSubmit already injected a `[QE GOAL]` hint, consume its route; otherwise apply the same router contract to the given goal text. Any router or state failure is fail-open: continue normal handling with no goal behavior.

Step 2 — `direct` route: handle the goal on the existing direct path with no PSE ceremony. If scope grows beyond Micro/Small during the work, re-enter with `!full` or move to Step 3.

Step 3 — `pipeline` route: run the PSE chain — `{adapter.commandPrefix}Qgs {slug}: {goal alias}` → `{adapter.commandPrefix}Qexecute {UUID}` → `{adapter.commandPrefix}Qexecute -verify {UUID}`. When `reason=workflow-scale`, propose a dynamic workflow before starting PSE.

Step 4 — Marker handling: a `goalRuntime` marker is advisory observability only. Never treat it as authorization; a missing marker (absent session id, write failure) changes nothing in Steps 2–3.

Step 5 — Handoff: render the standard `QE_CONVENTIONS.md` handoff using the active client's command prefix.
