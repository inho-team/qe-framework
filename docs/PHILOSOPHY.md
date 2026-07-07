# QE Philosophy

## Why QE Exists

QE Framework is built around a simple idea:

- work without a plan becomes guessing
- a spec without verification becomes optimism
- verification without supervision becomes self-grading

The framework exists to force explicit handoffs between these stages.

## The PSE Chain

QE uses the Plan -> Spec -> Execute loop as the default path:

```text
Claude: /Qplan -> /Qgs -> /Qexecute
Codex:  $Qplan -> $Qgs -> $Qexecute
```

That is followed by the quality gate:

```text
Claude: /Qexecute -verify
Codex:  $Qexecute -verify
```

Together, the canonical flow is:

```text
Claude: /Qplan -> /Qgs -> /Qexecute -> /Qexecute -verify
Codex:  $Qplan -> $Qgs -> $Qexecute -> $Qexecute -verify
```

## Design Principles

- Separation of responsibility: planning, implementation, review, and final judgment should not collapse into one step.
- Minimal interruption: ask the user only when the decision is genuinely high value.
- Evidence over confidence: reports, artifacts, and verification outputs matter more than fluent prose.
- Reproducibility: state should be written into `.qe/` artifacts rather than left implicit in session context.
- Backward compatibility: existing single-model flows should continue to work unless the user opts into role-separated or tiered orchestration.

## Role Model

QE treats these as distinct responsibilities:

- `planner`: defines spec, scope, and acceptance criteria
- `implementer`: changes code or other project artifacts
- `reviewer`: evaluates quality and regressions independently
- `supervisor`: makes the final pass/fail/remediation decision

In `single-model`, one runner may own every role.
In `hybrid`, `multi-model`, or `tiered-model`, these roles can be split across different runners or model tiers.

## Why `/Qexecute` Exists

`/Qexecute` is not just “parallel execution”.
It is the default implementer-stage entry point in the canonical QE workflow.

- In `single-model`, it uses the Haiku Wave execution path.
- In `hybrid`, `multi-model`, or `tiered-model`, it should prefer the configured implementer runner.

That makes `/Qexecute` the bridge between the original single-client system and the newer role-based orchestration model.

## Why Multi-Model Exists

Multi-model support exists to reduce a specific failure mode:

- the same model planning the work
- implementing the work
- reviewing its own implementation
- approving its own output

QE avoids that by making roles explicit and by persisting outputs as handoff artifacts.

## Practical Philosophy

QE is not trying to make every workflow more complicated.
It is trying to make complex work more explicit.

If the project is small and one runner is enough, use `single-model`.
If the workflow benefits from stronger judgment with lower execution cost, use `tiered-model`.
If the workflow benefits from provider-level role separation, use `hybrid` or `multi-model`.
