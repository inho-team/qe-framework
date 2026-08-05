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
   reasoning effort, tools, starting commit, prompt, and ceilings identical.
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
