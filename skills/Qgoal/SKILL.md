---
name: Qgoal
description: Routes an explicit goal or natural-language intent into the active Plan-owned Goal queue. Use when the user enters /Qgoal {goal} or states a clear implementation goal.
invocation_trigger: When the user enters `/Qgoal {goal}` or a clear implementation goal in natural language.
user_invocable: true
recommendedModel: haiku
---

# Qgoal — Plan Intake Router

Use `/Qgoal {목표}` to state an intent explicitly. UserPromptSubmit applies the same deterministic router to clear natural-language goals. A Goal is owned by a Plan; it is not a separate user workflow.

The route payload is advisory: `{ detected, source, goalText, route, reason, instruction }`. Both direct and pipeline routes enter `Qplan`; Qplan decides whether to create a Micro Plan, add to the active Plan, or create a full roadmap and then advances Goals internally.

`!direct` and `!full` may override automatic scale only when they are standalone prompt-edge tokens. Router or state failures are fail-open: preserve normal handling and do not treat a marker as authorization. A missing session ID produces no marker and retains direct guidance.

## Execution Procedure

Step 1 — Resolve the route payload. If UserPromptSubmit already injected a `[QE GOAL]` hint, consume its route; otherwise apply the same router contract to the given goal text. Any router or state failure is fail-open: continue normal handling with no goal behavior.

Step 2 — Resolve the target Plan. A direct route becomes a one-Goal Micro Plan; a pipeline route becomes a multi-Goal Plan. If an active Plan explicitly accepts the goal as in-scope, add it as a pending Goal rather than creating an unrelated workflow.

Step 3 — Enter `Qplan`. Qplan owns the sequential Goal loop: knowledge preflight → spec → execute → verify → verified knowledge write-back. Do not render or require `Qgs`, `Qexecute`, or Qwiki commands.

Step 4 — Marker handling: a `goalRuntime` marker is advisory observability only. Never treat it as authorization; a missing marker (absent session id, write failure) changes nothing in Steps 2–3.

Step 5 — Report the Plan and current Goal, not a chain of commands. Ask only for material scope, risk, or irreversible decisions.
