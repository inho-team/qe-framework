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
| Verify | High-reasoning critical lead | Create verification evidence and delegate adversarial review/test checks before returning a verdict. |
| Supervise | High-reasoning critical lead | Independently inspect Verify evidence and delegate domain QA before a release-readiness verdict. |

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
