# SIVS Single-AI Role Model

## Decision

Each QE session uses exactly one active AI client. Claude and Codex are
supported as separate clients, but a SIVS stage never delegates from one client
to the other. The active client owns Spec, Implement, Verify, and Supervise.

This replaces engine routing with role separation. Independence is obtained by
fresh context, non-overlapping responsibilities, and required subagent review;
it is not represented as provider-pool separation.

## Stage contract

| Stage | Owner | Required quality control |
|---|---|---|
| Spec | Main thread | Write TASK_REQUEST and VERIFY_CHECKLIST; run the spec critical gate. |
| Implement | Main thread | Delegate implementation work to bounded subagents; the main thread integrates and verifies their results. |
| Verify | High-reasoning critical lead | Prove the change meets its spec through executable evidence; delegate adversarial test/reproduction checks before returning a verdict. |
| Supervise | High-reasoning critical lead | Consume Verify evidence and decide release readiness from security, business rules, change impact, and operational risk. |

## Verify and Supervise boundary

Verify is an **evidence gate**. It owns checklist traceability, tests, static
checks, failure reproduction, and implementation defects. Its output is a
`VERIFY_CHECKLIST` result plus a findings ledger with commands, outcomes, and
unresolved items.

Supervise is a **release gate**, not a second line-by-line review. It consumes
the Verify ledger and only reopens a file when it changed after Verify or when a
HIGH/CRITICAL risk requires it. Its required decision dimensions are:

1. security and permission boundaries;
2. business invariants, state transitions, and policy rules named in the spec;
3. change impact, rollback, data migration, and operational readiness;
4. residual-risk ownership and release/merge decision.

Supervise returns `PASS`, `WARN`, or `FAIL` with an explicit release decision.
Any unresolved HIGH/CRITICAL security or business-rule risk blocks PASS.

## Configuration

`.qe/sivs-config.json` configures per-stage `model`, `effort`, and optional
`compaction`. It does not select an engine, background runner, or cross-client
fallback. `verify` and `supervise` default to `effort: high`; lowering either
requires an explicit configuration and must be recorded as degraded QA.

## Failure handling

An unavailable subagent does not switch clients. The active lead performs a
role-separated inline review, records `mode=degraded-inline`, and cannot report
a stronger verdict than WARN without the required verification evidence.

## Consequences

- A user chooses Claude *or* Codex for a session; no bridge installation is
  required for SIVS.
- QA remains mandatory through high-reasoning critical leads and subagents.
- Existing engine-routing configuration is rejected with a migration message;
  remove `engine` and `background` fields and retain only supported settings.
