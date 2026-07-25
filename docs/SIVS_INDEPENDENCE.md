# SIVS QA Independence

QE uses one active AI client per session. Claude and Codex are supported as
separate clients, but SIVS never delegates a stage between them.

QA independence is enforced through role separation:

- Spec is authored by the main thread and challenged by isolated reviewers.
- Implement is led by the main thread and bounded implementation subagents.
- Verify is a high-reasoning critical lead that creates evidence and calls
  adversarial review/test subagents.
- Supervise is a separate high-reasoning critical lead that reads Verify
  evidence and calls domain QA subagents before release readiness.

Subagent failure does not switch clients. The active client records
`mode=degraded-inline`, and the QA result cannot be stronger than WARN until
delegated evidence is available. See `core/SIVS_SINGLE_AI_MODEL.md`.
