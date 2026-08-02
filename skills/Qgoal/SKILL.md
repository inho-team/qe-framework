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

Step 1 — Ensure the shared `QE.md` and active-client instruction pointer exist. The explicit
`/Qgoal` or `$Qgoal` entry bootstrap creates missing files without overwriting user instructions.
Then resolve the route payload. If UserPromptSubmit already injected a `[QE GOAL]` hint, consume
its route; otherwise apply the same router contract to the given goal text. Any router or state
failure is fail-open: continue normal handling with no goal behavior.

Step 2 — Resolve the target Plan. A direct route becomes a one-Goal Micro Plan; a pipeline route becomes a multi-Goal Plan. If an active Plan explicitly accepts the goal as in-scope, add it as a pending Goal rather than creating an unrelated workflow. A Goal is atomic: one user-visible outcome, bounded file scope, explicit non-goals, and dependencies. Split broad requests (for example UI + API + migration + deployment) into ordered Goals before execution.

Step 3 — Enter `Qplan` and run the selected Goal's internal pipeline. `Qgoal` must
carry the Goal through this sequence before reporting it complete:

```text
Qplan knowledge preflight
  → Qgenerate-spec (TASK_REQUEST + VERIFY_CHECKLIST)
  → Qexecute {UUID} (implementation)
  → Qexecute -verify {UUID} (test, review, fix, retest)
  → Qplan completion evidence and verified knowledge write-back
```

`Qgenerate-spec` and both `Qexecute` stages are internal components of the Qgoal path;
they are not separate user commands or optional handoffs. Preserve the active
Plan/Goal and generated UUID across the stages. If spec generation, execution,
or verification fails, keep the Goal active or blocked with its evidence rather
than continuing to another Goal.

Step 4 — Marker handling: a `goalRuntime` marker is advisory observability only. Never treat it as authorization; a missing marker (absent session id, write failure) changes nothing in Steps 2–3.

Step 5 — Report the Plan and current Goal, not a chain of commands. Ask only for material scope, risk, or irreversible decisions.
