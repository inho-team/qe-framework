# Execution Harness Layer

## Purpose

The Execution Harness Layer defines how QE runs work without changing what QE
counts as complete.

This layer absorbs useful runtime patterns as QE-owned concepts: execution mode
selection, durable lanes, isolated workspaces, status projection, and evidence
collection. It does not define a new product surface, dependency, or completion
authority.

## Layer Position

Execution Harness sits below PSE and SIVS:

```text
PSE Chain
└─ SIVS Loop
   ├─ Spec
   ├─ Implement
   │  └─ Execution Harness may choose how work runs
   ├─ Verify
   │  └─ Execution Harness may supply evidence
   └─ Supervise
      └─ QE decides quality and completion
```

SIVS owns the stage contract. The harness only chooses the runtime shape for
executing or observing that contract.

## Allowed Terms

| Term | Meaning |
| --- | --- |
| Execution Harness | QE-owned runtime layer that chooses how a SIVS stage is executed or observed. |
| Execution Mode | A selected runtime shape such as solo execution, native subagent execution, wave execution, durable lane, or isolated workspace. |
| Durable Lane | A resumable execution lane with explicit ownership, status, and evidence. It is useful for long-running or multi-step work. |
| Isolated Workspace | A workspace separated from the main tree for risky, conflicting, or experimental edits. |
| Status Projection | A read-only display of current PSE/SIVS/harness state. It is never completion proof. |
| Evidence Collector | The part of a harness mode that records verifiable outputs for Verify and Supervise. |

## Forbidden Semantics

Execution Harness must not introduce external runtime names as QE user-facing
semantics, support targets, comparisons, or forbidden examples. Capability
patterns are allowed; external product identity is not part of this layer.

Execution Harness must not treat non-QE state as completion authority. Runtime
state, worker state, status output, and adapter-local cache can help resume or
diagnose work, but `.qe/` artifacts remain canonical for plan, stage,
verification, supervision, and completion state.

Execution Harness must not treat operational completion as SIVS completion. A
lane can finish, a worker can report done, and a status projection can look
healthy while the task still fails Verify or Supervise.

## Completion Authority

Harness completion means the selected execution mode finished its operational
work. It answers questions like:

- Did the lane finish?
- Did the command return?
- Did the expected files change?
- Did the status projection advance?

SIVS completion means the task passed the QE completion contract. It requires:

- TASK_REQUEST items completed.
- VERIFY_CHECKLIST items answered with concrete evidence.
- Supervise requirements satisfied when the task requires supervision.
- Post-verification bookkeeping recorded after the evidence is complete.

When these conflict, SIVS wins. Harness status is evidence input, not the
verdict.

## Evidence Contract

Each harness mode that claims progress or completion must emit evidence that
Verify and Supervise can consume. The minimum evidence record contains:

| Field | Requirement |
| --- | --- |
| `mode` | The selected execution mode. |
| `owner` | The lane, agent, or lead responsible for the action. |
| `stage` | The SIVS stage the evidence belongs to. |
| `status` | One of `pass`, `fail`, `degraded`, or `unsupported`. |
| `artifact_paths` | Paths created, modified, checked, or consumed. Non-empty when file changes are claimed. |
| `command_or_check` | A rerunnable command, or a path/link that can be opened directly. |
| `result` | Observed output or verdict. It must not be only an intention or summary. |
| `timestamp` | ISO-8601 timestamp for the observation. |
| `source` | The tool, hook, lane, or reviewer that produced the evidence. |
| `limitations` | Known gaps, degraded behavior, or unsupported capabilities. |

Status projection may render these fields compactly, but projection is not a
replacement for evidence. If evidence cannot be reproduced or inspected, it must
be marked `degraded` or `unsupported`.

## Mode Resolver Contract

The mode resolver recommends how a SIVS stage should run. It does not decide
whether the stage is complete.

Resolver input source precedence is fixed by artifact class:

1. Active TASK_REQUEST and VERIFY_CHECKLIST artifacts.
2. `.qe/TASK_LOG.md`.
3. `.qe/planning/` plan, phase, roadmap, and goal state.
4. `.qe/state/harness-lanes.json`.
5. Session mirror state under `.qe/state/sessions/{sessionId}/`.
6. Adapter-local cache.

Sources 4-6 are advisory. They can explain how work is running, but they cannot
override active task/checklist artifacts, completed artifacts, `.qe/TASK_LOG.md`,
or planning state.

Resolver inputs:

| Input | Meaning |
| --- | --- |
| task shape | Single action, multi-step task, independent wave, or cross-file workflow. |
| risk | Whether the work is destructive, experimental, security-sensitive, or hard to reverse. |
| dirty/shared files | Whether target files are already dirty or shared with another active lane. |
| session staleness | Whether the active session, lane owner, or mirror state is stale. |
| evidence availability | Whether the required artifact paths, checks, and results can be produced. |
| client capability | Whether the active client supports the requested lifecycle/status surface. |
| canonical artifact status | Whether TASK_REQUEST, VERIFY_CHECKLIST, plan state, and task log agree. |

Resolver outputs:

| Output | Meaning |
| --- | --- |
| `execution_mode` | Recommended runtime shape. |
| `promotion_reason` | One or more Phase 2 reason labels. |
| `limitations` | Known degraded behavior or unsupported capability. |
| required evidence | Evidence the selected mode must produce before Verify or Supervise can pass. |

## Promotion Thresholds

Solo execution is the default. The resolver promotes only when the SIVS contract
is better protected by a heavier mode.

| Mode | Use when |
| --- | --- |
| `solo` | The task is small, local, low-risk, and does not need resumable state. |
| `native_subagent` | A bounded independent subtask can run without owning the global plan. |
| `wave` | Multiple checklist items are independent and have non-overlapping write scopes. |
| `durable_lane` | Work is long-running, multi-step, stale-recovery oriented, or requires resume state. |
| `isolated_workspace` | Work is risky, experimental, conflicts with dirty/shared files, or requires integration after isolation. |

Promotion reasons reuse the Phase 2 vocabulary from `core/STATE_SPEC.md`:

- `long_running`
- `multi_step`
- `conflicting_edits`
- `risky_or_experimental`
- `requires_resume`
- `requires_isolation`

Do not add new promotion reason labels in this contract without first updating
the state specification and validation plan.

## Failure And Remediation Routing

Harness failures route back into SIVS. They do not create a separate remediation
path.

| Condition | SIVS result |
| --- | --- |
| Missing canonical TASK_REQUEST or VERIFY_CHECKLIST | Verify FAIL. |
| Incomplete TASK_REQUEST or VERIFY_CHECKLIST | Verify FAIL. |
| Evidence status is `fail` | Verify FAIL. |
| Evidence status is `degraded` or `unsupported` | Verify cannot pass; record degraded or unsupported evidence. |
| Artifact paths or evidence refs are unresolved | Verify cannot pass; record missing evidence and rerun after repair. |
| Lane is stale or ownership conflicts | Return to Implement/runtime remediation, then re-enter Verify. |
| Supervise-only quality concern | Use existing Supervise `WARN` or `FAIL` outcomes. |

Backward routing follows the existing SIVS documents:

- `.qe/planning/DECISION_LOG.md` defines gate FAIL as backward routing rather
  than a dead end.
- `skills/Qcritical-review/reference/supervise-gate-protocol.md` defines
  nearest-first Supervise FAIL routing: Verify -> Implement -> Spec.

Harness state may recommend a likely cause stage, but it cannot bypass Spec,
Implement, Verify, or Supervise.

`REMEDIATION_REQUEST` is generated only after Supervise FAIL according to the
existing remediation protocol. Harness status and Verify FAIL do not directly
create remediation requests.

## Validation Guardrails

Validation must prove the SIVS contract, not only the harness operation.

- Harness completion never replaces VERIFY_CHECKLIST completion.
- Status projection is not completion proof.
- A lane reporting `completed` is only operationally complete.
- Evidence claims must include `artifact_paths`, `command_or_check`, `result`,
  and `limitations`.
- Missing, degraded, unsupported, cache-only, or unresolved evidence cannot be
  rendered as pass-style completion.
- Post-verification bookkeeping happens only after the verification evidence is
  complete.

## Migration Guardrails

Migration work is scan/document only unless a later task explicitly approves
edits.

- Existing runtime language should be mapped to QE-owned terms before rewriting
  user-facing docs or skills.
- Do not bulk-rewrite skills or docs in this phase.
- Do not add dependencies.
- Do not edit versions.
- Do not rename published commands, skills, agents, or entrypoints.
- Do not introduce external runtime names as QE semantics, support targets,
  comparisons, or forbidden examples.

## Execution Order

Harness contract changes are authored in this order:

1. Define the source contract in `core/EXECUTION_HARNESS.md`.
2. Connect philosophy and convention documents to the source contract.
3. Add discoverability links after the final path and concept name are stable.
4. Verify newly added links from the Markdown file that contains each link.
5. Record completion bookkeeping only after verification is complete.

For runtime use, the harness chooses the lightest mode that preserves the SIVS
contract. Durable lanes and isolated workspaces are escalation paths, not the
default.

## Non-Goals

- No new external dependency.
- No replacement for PSE Chain or SIVS Loop.
- No new completion authority.
- No user-facing support matrix for external runtimes.
- No implementation of state managers, workers, or status renderers in this
  contract document.
