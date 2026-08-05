---
name: Qgoal
description: Explicit single-Goal alias for Qplan. Use when the user enters Qgoal with the active client prefix.
invocation_trigger: When the user enters `/Qgoal {goal}` or `$Qgoal {goal}`.
user_invocable: true
recommendedModel: haiku
---

# Qgoal — Explicit Single-Goal Qplan Alias

Use `/Qgoal {목표}` in Claude or `$Qgoal {목표}` in Codex to request Full SIVS for one Goal. Qgoal delegates the unchanged intent to Qplan; it is not a separate workflow or an automatic natural-language route.

Ordinary requests remain on the native client path even when they are long, mention many files, or contain planning and risk words. QE may recommend Qplan, but only an active-prefix Qplan or Qgoal invocation activates Full SIVS.

Legacy `!direct` and `!full` tokens do not change this contract: explicit Qgoal remains Full SIVS and ordinary prose remains native.

## Execution Procedure

Step 1 — Ensure the shared `QE.md` and active-client instruction pointer exist. The explicit
`/Qgoal` or `$Qgoal` entry bootstrap creates missing files without overwriting user instructions.
Then delegate the original Goal text to Qplan. If UserPromptSubmit injected a `[QE GOAL]`
hint, treat it as workflow admission context, not as authorization.

Step 2 — Resolve the target Plan. Create a one-Goal Plan or add the Goal to an active compatible Plan. If the intent contains multiple independently verifiable outcomes, Qplan may split it into ordered Goals rather than pretending it is atomic.

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

Qplan is the sole owner of tacit-knowledge intake before this pipeline. Qgoal
delegates the original intent and client mode unchanged, then consumes Qplan's
confirmed synthesis or blocker. It must not create a second question inventory,
format progress labels, maintain interview counters, infer skipped material
answers, or reproduce intake state transitions.

Step 4 — Marker handling: a `goalRuntime` marker records explicit workflow admission. It is not a security authorization boundary. If marker persistence fails, retain the Plan as blocked rather than silently executing an internal stage outside the Plan contract.

Step 5 — Report the Plan and current Goal, not a chain of commands. Ask only for material scope, risk, or irreversible decisions.
