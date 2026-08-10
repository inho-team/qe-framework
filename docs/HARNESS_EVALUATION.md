# Progressive Assurance Harness Evaluation

Use a paired 2×2 experiment to measure assurance and controller effects without
confounding them. Every task and repetition runs under all four conditions with
the same model, prompt, tools, repository snapshot, token ceilings, and wall-time
ceiling.

| Condition | Assurance | Runtime persistence |
|---|---|---|
| `native-ephemeral` | native | none |
| `native-durable` | native | Runtime Controller |
| `full-sivs-ephemeral` | explicit Full SIVS | none |
| `full-sivs-durable` | explicit Full SIVS | Runtime Controller |

This factorial design separates the Full SIVS effect, the controller effect,
and their interaction. It avoids comparing a lightweight native run with a
simultaneously longer, multi-agent, durable run and incorrectly attributing the
whole difference to “the harness.”

## Protocol

1. Freeze at least 20 representative tasks before testing; include micro fixes,
   feature work, debugging, and high-risk changes. Use at least three repetitions.
2. Randomize condition order per task and repetition. Keep model/version,
   reasoning effort, starting commit, task text, sandbox, and ceilings identical.
   Treat QE plugins, hooks, goals, project instructions, and multi-agent surfaces
   as part of the Full SIVS treatment; disable those control surfaces in native arms.
3. Score success from a hidden executable acceptance suite. Record escaped
   defects and human corrections independently from the agent that ran the task.
4. Record actual input/output tokens and wall time. A run exceeding any shared
   ceiling is invalid, not silently granted more budget.
5. Publish all four condition means, paired factor effects, failures, exclusions,
   and task-level data. Do not collapse the result into one universal score.

The primary metric is task success. Secondary metrics are escaped defects,
human corrections, token use, and wall time. Report confidence intervals or a
paired bootstrap for real studies; the included script validates the design and
computes descriptive means and factorial contrasts, but does not manufacture
statistical certainty from a small sample.

## Input and command

```json
{
  "schema": 1,
  "budget": { "maxInputTokens": 20000, "maxOutputTokens": 8000, "maxWallSeconds": 900 },
  "runs": [
    {
      "taskId": "auth-01",
      "repetition": 1,
      "condition": "native-ephemeral",
      "result": {
        "success": true,
        "escapedDefects": 0,
        "humanCorrections": 1,
        "inputTokens": 12000,
        "outputTokens": 3500,
        "wallSeconds": 420
      }
    }
  ]
}
```

Each `taskId` + `repetition` pair must contain exactly one run for every
condition. Evaluate a completed dataset with:

```bash
node scripts/evaluate-harness.mjs results.json
```

The JSON output contains per-condition means plus `assurance`, `controller`,
and `interaction` contrasts. Positive success contrast is better; negative
defect, correction, token, and time contrasts are better.

## Five-task pilot

Before paying for the full 20-task, three-repetition study, validate the runner
with the frozen five-task pilot:

```bash
# Inspect the randomized 20-cell schedule without making model calls.
node scripts/run-harness-pilot.mjs --dry-run

# Gate the study on the first preregistered Full-durable cell.
node scripts/run-harness-pilot.mjs --smoke --concurrency 1

# Execute serially to avoid cross-cell resource interference.
node scripts/run-harness-pilot.mjs --execute --concurrency 1
```

The active pilot clones the same QE repository revision and materializes each
synthetic task under `pilot-task/`. The baseline is a sanitized archive with no
git history, hidden fixture, or prior evaluation output. It uses the same Codex model, reasoning
effort, workspace sandbox, token ceilings, wall-time ceiling, and task text
across conditions. Native conditions disable QE plugins, hooks, goals, project
instructions, skill routing, and multi-agent control surfaces before executing
directly. Full SIVS conditions retain those surfaces and invoke `$Qplan`
while explicitly binding behavior to the QE implementation and contracts in the
sanitized repository revision, including `skills/Qplan/SKILL.md`; a globally
installed skill copy is not normative for the actor run.
Durable arms are wrapped by the adopted Runtime Controller and are
valid only when admission, initialize, active, terminal, and audit-digest
evidence is present. Ephemeral arms must contain no Controller evidence.
This measures Controller-backed persistence as an external execution envelope;
it does not claim that the Controller schedules or recovers the actor's internal
model steps.
Codex's unavoidable shared base context remains common to every arm.
Hidden acceptance commands remain in the frozen fixture and are executed by the
runner after the acting model exits; they are never included in the actor prompt.

The runner requires a real `turn.completed` usage event. Authentication errors,
client startup failures, and other zero-token exits invalidate the pilot instead
of being counted as unsuccessful task runs.

Outputs are written under `evals/harness-pilot/codex/`:

- `results.json`: balanced evaluator input plus raw per-run provenance, patches,
  usage, and hidden-score hashes.
- `report.json`: descriptive four-condition means and factorial contrasts.
- `RUN.md`: compact human-readable summary.
- `smoke.json`: one valid preregistered smoke cell; it is never treated as a
  balanced effectiveness report.
- `failure.json`: written instead of a dataset when any actor lacks a completed
  model turn; invalid pilots stop immediately and never run the hidden scorer.

The pilot has one repetition and validates treatment isolation, measurement,
and scoring mechanics only. It cannot establish QE effectiveness. Promotion or
deletion decisions require the full preregistered study with at least 20 tasks
and three repetitions.
