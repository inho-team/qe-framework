# Harness Engineering Metrics Specification

> Defines the 6 core metrics for measuring harness effectiveness.
> Based on: `.qe/planning/research/harness-engineering-insights-2026.md`

---

## Metric 1: Task Resolution Rate

- **Description**: Percentage of tasks that reach "completed" status
- **Formula**: `completed_tasks / total_tasks * 100`
- **Collection**: TaskCompleted hook (increment completed), TaskCreated hook (increment total)
- **Normal Range**: 85-100%
- **Warning Threshold**: Below 70%
- **Interpretation**: Low rate suggests specs are too ambitious or verification is too strict

## Metric 2: Code Churn Rate

- **Description**: Average lines changed per task (lower is better — indicates clean first-pass implementation)
- **Formula**: `total_lines_changed / completed_tasks`
- **Collection**: PostToolUse hook (track Write/Edit line changes), TaskCompleted (aggregate)
- **Normal Range**: 50-200 lines/task
- **Warning Threshold**: Above 500 lines/task
- **Interpretation**: High churn suggests poor spec quality or excessive trial-and-error

## Metric 3: Verification Tax

- **Description**: Ratio of verification time to implementation time
- **Formula**: `total_verify_ms / total_implement_ms`
- **Collection**: Qexecute -verify (verify duration), Qexecute (implement duration)
- **Normal Range**: 0.1-0.5 (10-50% of implementation time)
- **Warning Threshold**: Above 1.0 (verification takes longer than implementation)
- **Interpretation**: High tax may indicate insufficient spec clarity or overly aggressive test requirements

## Metric 4: Harness Constraint Effect

- **Description**: Quality delta between constrained (hooks active) and unconstrained execution
- **Formula**: `(pass_rate_with_hooks - pass_rate_without_hooks) / pass_rate_without_hooks * 100`
- **Collection**: Manual measurement via A/B comparison (hooks enabled vs disabled)
- **Normal Range**: +10-30% improvement
- **Warning Threshold**: Negative (hooks reduce quality)
- **Interpretation**: Measured during harness tuning; not collected automatically per session

## Metric 5: Defect Escape Rate

- **Description**: Percentage of tasks that pass verification but later require fixes
- **Formula**: `tasks_with_post_verify_fixes / verified_tasks * 100`
- **Collection**: TaskCompleted (track re-opened tasks), PostToolUse (detect edits to completed files)
- **Normal Range**: 0-5%
- **Warning Threshold**: Above 15%
- **Interpretation**: High escape rate suggests verification criteria are too lenient

## Metric 6: Pass@1 Rate

- **Description**: Percentage of tasks that pass all verification on first attempt
- **Formula**: `first_attempt_passes / total_verified_tasks * 100`
- **Collection**: Qexecute -verify or TaskCompleted payload (explicit verification attempt count; pass@1 = attempt 1 success)
- **Normal Range**: 60-80%
- **Warning Threshold**: Below 40%
- **Interpretation**: Low pass@1 suggests specs need more detail or implementation quality is poor

---

## Storage

All metrics are stored in unified-state under the `harnessMetrics` namespace:

```json
{
  "harnessMetrics": {
    "tasksTotal": 0,
    "tasksCompleted": 0,
    "tasksPassAt1": 0,
    "tasksPassAt1Observed": 0,
    "totalLinesChanged": 0,
    "totalImplementMs": 0,
    "totalVerifyMs": 0,
    "defectEscapes": 0,
    "sessionStartedAt": "ISO-8601"
  }
}
```

## Collection Points

| Hook/Skill | Metrics Updated |
|------------|----------------|
| TaskCreated | tasksTotal++ |
| TaskCompleted | tasksCompleted++, tasksPassAt1 only when an explicit attempt count is present |
| PostToolUse (Write/Edit) | totalLinesChanged |
| Qexecute | totalImplementMs |
| Qexecute -verify | totalVerifyMs, pass@1 tracking |
| SessionEnd | Final aggregation, telemetry flush |

## Collection Coverage

The schema is broader than the events every client exposes. Treat a metric as
measured only when its listed event has actually populated it:

| Signal | Current automatic evidence | Limitation |
|--------|----------------------------|------------|
| Task completion | `TaskCompleted` | Total-task creation must be emitted by the plan runtime. |
| Pass@1 | Explicit attempt count on `TaskCompleted` | Missing attempt counts are recorded as unknown, never as a first pass. |
| Delegation dispatch | `PreToolUse` `Task`/`Agent` requests | Records requests and selected model, not worker completion, queue time, or elapsed time. |
| Churn, implementation/verification time, defect escape | No portable event emitter yet | Do not use the target ranges as measured results until the active client emits these events. |

This distinction prevents policy telemetry from being mistaken for proof that a
parallel workflow was faster or successful. Runtime-specific lifecycle timing
may be added when the client exposes reliable start/stop events.

## Metric 7: Delegation Dispatch Mix

- **Description**: Count delegated-work requests by agent and selected model tier.
- **Collection**: PreToolUse for `Task` and `Agent`; emits `delegation_requested` telemetry.
- **Interpretation**: Use it to audit whether Wave and QA delegation follow the
  routing policy. It is dispatch evidence only, not worker completion or latency.
  Do not claim a speedup without lifecycle timing from the active client runtime.
