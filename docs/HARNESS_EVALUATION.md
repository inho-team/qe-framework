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
# Run this twice successfully against the same clean captured commit.
node scripts/run-harness-pilot.mjs --smoke --concurrency 1

# Execute serially to avoid cross-cell resource interference.
node scripts/run-harness-pilot.mjs --execute --concurrency 1

# Re-verify persisted evidence later without invoking a model or mutating it.
node scripts/verify-harness-pilot.mjs .qe/runtime/harness-pilot/codex
```

Active smoke and execute modes require a clean tracked worktree, capture `HEAD`,
and load the frozen fixture bytes from that commit rather than from the live
working tree. The active pilot clones the same captured QE repository revision and materializes each
synthetic task in a temporary per-cell path named
`<taskId>-<condition>/<taskId>/`. The baseline is a sanitized archive with no
git history, hidden fixture, or prior evaluation output. It uses the same Codex model, reasoning
effort, workspace sandbox, token ceilings, wall-time ceiling, and user task text
across conditions. A preregistered condition-specific treatment prefix varies
the assurance and persistence instructions intentionally. Native conditions disable QE plugins, hooks, goals, project
instructions, skill routing, and multi-agent control surfaces before executing
directly. Full SIVS conditions retain those surfaces and invoke `$Qgoal`, which
enters the repository's Plan-owned Goal path. The runner passes the frozen task
category into that scale decision instead of asking the actor to infer it from
prose. A preregistered `micro-fix` is a disposable harness cell whose treatment
boundary requires Goal/Plan entry but forbids QE artifact creation, other QE
skills, subagents, and repository-wide checks. It works only in `pilot-task/`,
runs the public test named by the frozen task, and stops. This is an
intent-to-treat exposure rule, not evidence that the actor persisted or completed
the production Qplan lifecycle. Other categories still pass through the Qplan
scale gate, but only Qgoal and Qplan entry are mandatory. Additional QE skills,
subagents, repository-wide checks, and unrelated-file work are never mandatory
for the harness treatment and are used only when the user task itself cannot be
completed or verified without them. The conclusion-first response contract remains mandatory in
every Full cell. The treatment remains bound
to the QE implementation and contracts in the sanitized repository revision,
including `skills/Qgoal/SKILL.md` and `skills/Qplan/SKILL.md`; a globally
installed skill copy is not normative for the actor run.

This is an intent-to-treat assignment. The Full arm is defined by its exact
prompt and enabled QE surfaces, not by an actor-controlled claim about which
internal lane it followed. Success and smoke admission therefore do not prove
lane compliance. The smoke establishes runner operability for one
preregistered Full-durable cell; treatment efficacy across task categories is a
claim reserved for the balanced study. Smoke observations are excluded from
that study's dataset.
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

The default output is the harness-owned runtime directory
`.qe/runtime/harness-pilot/codex/`. A repository-internal override is accepted
only below `.qe/runtime/`; an external override must be absolute and point to a
new dedicated leaf or a directory already carrying the repository-bound
ownership marker. Existing unmarked external directories, including empty ones,
are rejected. Filesystem
root, the user's home, the repository root, symlinked path components, and
unowned non-empty directories are rejected. One no-follow owner lock serializes
all smoke and execute mutations. A live or malformed lock fails closed; only a
provably dead local owner is quarantined and recovered automatically.
For a malformed or ownerless lock, preserve the directory for diagnosis and
manually quarantine it only after confirming that no harness process is active;
the runner will not delete it. Lock authority is local-host only and does not
coordinate separate machines over a distributed filesystem.
Programmatic callers of the exported operation seam must also provide the live
lock authority returned for that exact output root; the CLI supplies it
automatically.

Smoke admission is durable state, not a command-line assertion. Before each
model launch the runner atomically appends a canonical `started` event to
`smoke-history.json`; a validated terminal event is appended only after scoring.
An interruption therefore remains visible. `--execute` starts no actor unless
the final two adjacent attempts are successful `full-sivs-durable` runs bound to
the same captured revision, cell identity, and runtime budget.
The canonical journal has a 1 MiB defensive read bound. If a long-lived pilot
reaches it, preserve that runtime directory as evidence, select a fresh
harness-owned output directory, and establish two new smoke successes there.

For a qualification run, start from zero matching attempts for the captured
revision and cell. Invoke smoke twice sequentially in the same controlling
launcher, and invoke it a third time neither to rescue a failure nor to seek a
favorable adjacent pair. The second invocation is allowed only after the first
CLI has returned with its actor child closed or killed. If the controlling
launcher itself is lost and leaves one canonical attempt, mark that revision's
qualification protocol incomplete; do not resume it, and qualify a new revision
instead. Any non-success among the two attempts leaves admission false. This is
an audited operator procedure for the pilot, not a new claim that the admission
function enforces an attempt quota or crash recovery.

Outputs are published as follows:

- `smoke-history.json`: append-only canonical attempt journal used for admission.
- `smoke.json`: atomic compatibility view of the latest completed smoke attempt.
- `.pilot-execute-claim.json`: write-once execute claim binding the captured
  revision, fixture, schedule, budget, and qualifying smoke attempts. Its
  presence permanently consumes that output root for smoke and execute; it also
  prevents automatic stale-lock recovery.
- `.pilot-execute-cells/<index>/started.json` and `terminal.json`: write-once
  per-cell lifecycle evidence. The started record is durable before actor
  launch; terminal failure evidence retains an observed actor result when one
  exists.
- `.pilot-execute-terminal.json`: write-once invocation outcome and exact
  completed/failed/unstarted index partition. A claim without this record is a
  deliberately visible nonterminal invocation, not permission to retry.
- `generations/<id>/`: immutable `runtime.json`, `results.json`, `report.json`,
  and `RUN.md`, followed by a hash manifest.
- `current.json`: authoritative atomic pointer to one complete generation.
- `failure.json`: optional non-authoritative compatibility diagnostic. Execute
  status is determined only from the claim and invocation/cell evidence above.

Result readers must resolve `current.json`, verify its manifest hash, and then
verify each artifact hash. Top-level legacy result files are not authoritative.
The execute CLI performs this independent persisted-evidence verification before
reporting success; the read-only verifier command above is the canonical check
for later automation and operator review. `nonterminal` and `corrupt` are never
successful classifications.
Atomic publication uses create-exclusive temporary files, file sync, rename,
and directory sync. If the platform cannot establish directory durability, the
runner fails with `PILOT_DURABILITY_UNCERTAIN` instead of claiming publication.
Execute claim and lifecycle records use a stricter no-replace hard-link commit;
there is no overwrite or rename fallback. A failure after the link becomes
visible but before its directory sync completes is durability-uncertain and the
root remains consumed. These guarantees assume a local filesystem with normal
hard-link and fsync semantics; unsupported or distributed filesystems fail
closed and are not claimed to be crash-safe.

The pilot has one repetition and validates treatment isolation, measurement,
and scoring mechanics only. It cannot establish QE effectiveness. Promotion or
deletion decisions require the full preregistered study with at least 20 tasks
and three repetitions.
