# Independent Integrity Review

## Verdict

**FAIL — the bounded lane improved its control contract, but neither observed
smoke attempt is valid under the preregistered ceilings.** Preserve both
committed-revision outcomes; do not select the completed attempt as a passing
retry.

## Verified improvements

- **Machine-enforced micro admission: PASS.** The ledger issues a session- and
  digest-bound plan-controller admission only after validating 1–2 work items,
  at most three paths, no unresolved material decision, and no high-impact risk.
  Caller-supplied provenance and hidden risk paths are rejected.
- **Artifact contract consistency: PASS.** Formal Goals require TASK_REQUEST and
  VERIFY_CHECKLIST evidence. Admitted bounded micro Goals use immutable acceptance,
  independent machine re-execution, completion evidence, and Goal alignment.
- **Revision binding: PASS at prompt level.** Full actors are instructed to use
  the archived repository revision's `skills/Qplan/SKILL.md` as normative; native
  actors remain unbound. Actor compliance is evidenced operationally, not by a
  cryptographic read attestation.
- **Regression integrity: PASS.** Focused ledger/canonical tests passed 48/48,
  harness tests passed 16/16, and all 41 repository guards passed.

## Committed smoke evidence

Both observed Full-durable attempts used revision
`b0903899007a7405aa8929d5a7a1c6f0a7c3c087`, the same task, model, effort,
sandbox, and 600-second ceiling.

| Artifact | Outcome | Wall time | Model evidence | Patch | Hidden score |
|---|---:|---:|---:|---:|---:|
| `smoke.json` | BUDGET INVALID | 457.395 s | 2,318,389 input / 14,056 output tokens | 1,401 bytes | PASS |
| `failure.json` | TIMEOUT | 600.051 s | no completed usage event | non-empty | not run |

The completed attempt reached implementation, public test, independent
verification, Goal alignment, and Runtime Controller lifecycle, and its hidden
acceptance passed. It nevertheless consumed 2,318,389 input tokens, 4.64 times
the shared 500,000-token ceiling. The smoke runner recorded `status: valid`
because its single-cell path returns before the balanced evaluator's budget
check; under the preregistered protocol the attempt is invalid. The timed-out
attempt implemented a plausible patch but escalated to a formal successor and
was still running the three-reviewer Spec gate when the wall-time ceiling
expired.

## Decision

The implementation and regression evidence support a materially stronger
bounded-assurance control contract. Operability improvement is not established:
the prior revision's only observed smoke timed out with zero patch, while the new
revision produced one hidden-acceptance pass outside the token budget and one
wall-time timeout with a non-empty patch. Both new attempts are invalid under the
shared ceilings. The sample is also too small to establish a success-rate or
efficiency improvement. The balanced 20-cell pilot and 240-run main study remain
blocked.

## Recommended next change

First, make the single-cell smoke path apply the same token, wall-time, and patch
ceilings as the balanced evaluator so it cannot emit `status: valid` for an
over-budget run. Keep the immutable bounded contract, but distinguish a
within-contract implementation defect from a contract/risk failure. Permit one
bounded fix-and-reverify cycle for the former; create a formal successor only for
scope, acceptance, or high-impact risk changes. Then require two consecutive
isolated, budget-valid Full-durable smoke passes before reopening the balanced
pilot.

Independent reviewer: `critical_review` (fresh review, no code edits).
