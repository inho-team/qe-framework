# Supervise Gate — Protocol

> The **mandatory** Supervise-stage adversarial gate. Invoked by
> `Esupervision-orchestrator` for `type:code` and `type:other` tasks, **only
> after binary Verify has passed**. Its cognitive mode is **Meticulous**
> (꼼꼼한 사고) — see [thinking-modes.md](./thinking-modes.md) Mode 3. On FAIL it
> routes **backward** (DECISION_LOG D014/D015). It is the single-AI release
> gate defined in `core/SIVS_SINGLE_AI_MODEL.md`.

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

The three Supervise-stage agents operate in Meticulous mode. The Supervise lead
and Merge Blocker use high reasoning effort.

| Agent | Focus |
|-------|-------|
| Merge Blocker | Security, business-invariant, regression, rollback, and operational blockers |
| Merge Advocate | Evidence-backed residual risk, mitigation, and release value |
| Impartial Judge | Release decision, risk owner, and route to Verify/Implement/Spec |

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

Supervise (Meticulous) judges **merge/release readiness**, not a second full
implementation review. It consumes Verify evidence and checks: security and
permission boundaries, business invariants/state transitions/policy rules,
change impact, rollback/data migration, operational readiness, and explicit
residual-risk ownership. It may re-open only files changed after Verify or a
HIGH/CRITICAL risk path. New implementation correctness attacks route back to
Verify rather than being duplicated here.

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

## Single-AI execution

The active client delegates the three roles in isolated contexts. It must run
`Esecurity-officer` for security-sensitive changes and a business-rule review
against the spec's explicit invariants. If delegation is unavailable, record
`mode=degraded-inline`; do not report PASS without later delegated evidence.

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
5. **Depth limit (Phase 3 / R005 — code-computed, protocol-enforced):** before
   routing backward after a FAIL, call `recordAndCheck(cwd, uuid, 'reentry', '<from-stage>')`
   from `hooks/scripts/lib/loop-guard.mjs`. The limit (default 5,
   `QE_SIVS_DEPTH_LIMIT` override) is code-computed; on `blocked`, do **not**
   re-enter — emit a user **escalation handoff** naming the exhausted depth budget
   (`count`/`limit`), the unresolved findings, and a recommended next action. The
   remediation-round cap (3) is separately enforced deterministically by the
   PreToolUse hook on `REMEDIATION_REQUEST_{UUID}_{N}.md` writes.

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
