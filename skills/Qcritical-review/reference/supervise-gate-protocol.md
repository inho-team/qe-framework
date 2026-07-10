# Supervise Gate — Protocol

> The **mandatory** Supervise-stage adversarial gate. Invoked by
> `Esupervision-orchestrator` for `type:code` and `type:other` tasks, **only
> after binary Verify has passed**. Its cognitive mode is **Meticulous**
> (꼼꼼한 사고) — see [thinking-modes.md](./thinking-modes.md) Mode 3. On FAIL it
> routes **backward** (DECISION_LOG D014/D015). Engine baseline + codex
> auto cross-model upgrade as in
> [spec-gate-protocol.md](./spec-gate-protocol.md).

## When it runs

- For **`type:code` and `type:other`** tasks. `type:docs` / `type:analysis` skip.
  Type normalization is identical to the Verify gate (missing/unknown type → runs).
- **Precondition: binary Verify has passed.** Consistent with
  `Esupervision-orchestrator` "Will Not supervise tasks that haven't passed
  binary verification". If the Verify gate FAILed, the loop routes backward (to
  Implement/Spec) and never reaches Supervise — so the riskiest (verify-failing)
  code is *fixed and re-verified*, not shipped past Supervise. There is no
  "force-proceed broken code" path: a task either reaches Supervise via a passing
  Verify, or it loops back / escalates to the user.

## Agents (Supervise stage)

The **existing three** Supervise-stage agents (none dropped). All operate in the
Meticulous mode; **Merge Blocker** is the cross-model-upgrade target.

| Agent | Focus |
|-------|-------|
| Merge Blocker | Regression risk, coverage sufficiency, unresolved TODOs, "do not merge" case |
| Merge Advocate | Cost of delay, acceptable residual risk, "ready to merge" case |
| Impartial Judge | Weigh both; which concerns are real vs hypothetical |

For `type:code`, Supervise is the final owner of the **Code Risk Gate**:

- **Merge Blocker** assumes the worst credible production outcome and must try
  to block merge on any unhandled HIGH/CRITICAL risk, hidden residual risk,
  missing rollback story, or unverified assumption.
- **Merge Advocate** may accept risk only when it is explicitly verified,
  mitigated, or deferred with a named rationale.
- **Impartial Judge** classifies each risk as `verified`, `mitigated`,
  `deferred`, or `unknown`; any `unknown` HIGH/CRITICAL risk is FAIL.

Supervise MUST read `.qe/agent-results/risk-proof-{UUID}.md` for `type:code`
tasks. If the report is missing, stale for the UUID, or lacks the `Risk Proof matrix`,
Supervise returns FAIL and routes back to Verify. If `Qrisk-proof` reports FAIL,
Supervise cannot override it with a PASS. WARN may be accepted only when no
HIGH/CRITICAL unknown or evidence-free defer remains.

## Mode scope (vs Verify)

Supervise (Meticulous) judges **merge/release readiness**, not implementation
correctness. Allowed: release-blocking risk from already-passed verify evidence,
unresolved/residual findings carried from Verify, regression-test sufficiency,
boundary/ownership violations, packaging/docs readiness. Disallowed: launching
*new* implementation-correctness attacks (that is the Verify gate's scope) —
unless a correctness issue is surfaced as a release-readiness blocker, in which
case it routes back to Verify (see Backward routing). This keeps Supervise from
duplicating Verify.

For code tasks, release readiness includes whether the final report honestly
names residual risks and unverified assumptions. A PASS that hides an unresolved
risk is invalid even when tests pass.

Risk Proof report evidence outranks prose. Supervise must check that every
HIGH/CRITICAL risk is `verified-safe`, `mitigated`, or
`deferred-with-owner`; `unknown` is release-blocking.

## Output schema & aggregation

Reuse the spec-gate JSON schema and 3-agent verdict aggregation — see
[spec-gate-protocol.md](./spec-gate-protocol.md). Each finding carries a
`root_cause_stage` field. The orchestrator's existing grade mapping applies:
Qcritical FAIL → supervision FAIL; WARN → PARTIAL; PASS → no impact.

## Engine routing & cross-model failure fallback

Identical policy to the Verify gate: same-engine baseline (all 3 agents
`general-purpose`); auto-upgrade **Merge Blocker** to `codex:codex-rescue` when
codex is reachable; on codex error/timeout re-run that agent on Claude, mark
`degraded` → at least WARN; double failure → WARN-blocked + audit
`reason=double-failure`. The upgrade never blocks the mandatory gate.

## Backward routing (FAIL is not a dead-end)

A Supervise FAIL walks **backward up the chain** to the nearest causing stage
(D014), then re-enters the loop.

1. **Root-cause attribution (D015):** each FAIL finding sets
   `root_cause_stage: "verify" | "implement" | "spec"`.
2. **Routing order — Verify → Implement → Spec (nearest-first):**
   - `verify` (insufficient/incorrect verification, missed regression) → back to
     **Verify**.
   - `implement` (code defect that only surfaces at merge-readiness) → back to
     **Implement**.
   - `spec` (the work is correct but the spec/intent was wrong) → back to
     **Spec**.
3. **Unclear cause → nearest-first:** start at **Verify**; escalate further up
   only if the re-run FAILs again.
4. **Loop bound:** the gate does not self-loop. It honors the orchestrator's
   "escalate after 3 iterations". After 3 rounds still FAIL → **escalate to the
   user**.

## Edge inputs

- **Empty diff** → **PASS** `reason=empty-diff`. Emptiness via
  `getChangedFiles(cwd)` from `hooks/scripts/lib/changed-files.mjs`
  (working-tree + staged + untracked reconciled; gate runs unless `isEmpty`).
- **Missing VERIFY_CHECKLIST** → **WARN**, proceed using TASK_REQUEST goals.

## Audit

Each run appends one atomic line via `appendGateAudit(cwd, 'supervise', entry)`
from `hooks/scripts/lib/gate-audit.mjs` to the shared
`.qe/agent-results/supervise-gate.log` (single `O_APPEND` write, no interleave):

```
{ISO-8601} | supervise | verdict={PASS|WARN|FAIL} | agents={n} | crossmodel={true|false|degraded} | route={verify|implement|spec|-} | uuid={UUID}
```

## Findings pipeline — consume Verify findings (Phase 2 / R002)

Supervise reads the Verify findings stream
(`.qe/agent-results/verify-findings-{UUID}.jsonl`, via
`hooks/scripts/lib/findings-ledger.mjs` `readFindings`/`foldFindings`) and injects
the folded canonical findings into its input, so it does **not** re-run
domain-audit analysis on files Verify already reviewed. This removes the real
cross-stage duplication (`Ecode-reviewer`/`Ecode-test-engineer` running in both
`-verify` and Supervise) and is where the Supervise call-budget reduction comes
from (6–7 → 4–5; see DECISION_LOG D-55a051bd-1). It does NOT drop domain
coverage — the findings are carried forward, not discarded.

- **already-reviewed skip (freshness-gated):** a finding may be treated as
  already-reviewed (skip re-analysis) only when the target `file` is **unchanged
  since Verify recorded it** — i.e. the path is NOT in the changed set from
  `getChangedFiles(cwd)` (git working-tree + staged + untracked). Any file that
  changed after Verify is in the set and is re-analyzed, so a skip can never hide
  new/changed code.
- **status→risk-proof mapping (direction-pinned, no soft-downgrade):** when
  injecting into G4 (`Erisk-proof-auditor`): `resolved → verified-safe|mitigated`,
  `waived → deferred-with-owner` (requires the same owner+rationale that
  `deferred-with-owner` demands — supplied by the finding's `waived_by`/`rationale`),
  `escalated → block/route` (never softened; surfaces as `unknown`/blocking),
  `open → unknown` (unreviewed is not safe).
- Supervise must still fold and honor the invariant: an `open`/unresolved finding
  carried from Verify blocks a PASS just as `unknown` HIGH/CRITICAL does.
