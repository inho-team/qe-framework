# Qexecute Execution Protocol

This reference contains the detailed execution and verification rules delegated
from `Qexecute/SKILL.md`. The entry skill remains authoritative for routing and
hard gates; this document supplies the operational detail.

## TDD applicability

Call `judgeTddPolicy()` from
`hooks/scripts/lib/qexecute-tdd-policy.mjs` with task type, available test
runner, testable logic, config/docs-only scope, and test infrastructure.
Exclusions win over inclusion signals. Docs/analysis, config-only work, or
missing test infrastructure records `formatExclusionHandoff()` and skips TDD.
Module errors fail open with an explicit handoff note.

When `apply=true`, enforce RED → GREEN → REFACTOR:

1. Write the smallest behavioral test and prove it fails for the expected reason.
2. Add the minimum implementation and prove the test passes.
3. Refactor only while the focused and regression suites remain green.

At completion, require a corresponding test file, fresh command output, and a
post-refactor pass. A bare test claim is not evidence.

## Sequential and wave execution

Sequential execution preserves checklist order and verifies every three items
unless the spec sets another interval. Wave execution requires at least five
items, topological width of two or more, and non-overlapping output ownership.
Cap active workers at `min(cpuCount - 2, 3)`, clamped to at least one.

Use worktree isolation for parallel writers. If isolation is unavailable or
outputs overlap, fall back to sequential. Workers never commit or run the final
project-wide verification; the Lead synthesizes results and runs it once.
Every delegated task follows `core/AGENT_DELEGATION_CONTRACT.md` and returns a
`qe-agent-result-v1` envelope.

## Final verification

Verify every checklist item with concrete evidence: file existence, behavioral
test, build, security review, or visual evidence as appropriate. Run the
cross-phase regression gate for code. Auth, crypto, payment, credential, or
secret changes require `Esecurity-officer`.

For code, supervision is mandatory:

1. `Esupervision-orchestrator` performs domain audit and aggregation.
2. `Qcritical-review --stage supervise` owns adversarial merge readiness.
3. WARN is remediated and rechecked; FAIL creates a structured remediation
   request and routes only failed items back to execution.
4. Relevant `handoffs[]` must resolve through the agent registry.

## Verify quality loop

`-verify` delegates test → review → fix → retest to `Eqa-orchestrator`, with a
maximum of three iterations. The test and review first passes receive the same
source evidence but not each other's verdict. Required gates are regression,
smoke, Nyquist coverage, comment coverage, adversarial Verify, and Risk Proof.

The final report must state Facts, Verification, Residual Risks, and Assumptions.
Use `none` explicitly when a section is empty.

## Lifecycle cleanup

The Lead owns every handle. Call `wait_agent`, then `close_agent`, and record
`completed`, `failed`, `timed-out`, or `stale`. The final report states
`open handles: 0`; otherwise it lists a stale warning with handle, role, item,
and timeout reason.
