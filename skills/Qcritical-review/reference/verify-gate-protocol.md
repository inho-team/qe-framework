# Verify Gate — Protocol

> The **mandatory** Verify-stage adversarial gate. Invoked by `Qexecute -verify`
> Step 4.9 after implementation, for `type:code` and `type:other` tasks. Its
> cognitive mode is **Critical** (비판적 사고) — see
> [thinking-modes.md](./thinking-modes.md) Mode 2. On FAIL it does NOT dead-end:
> it routes **backward** to the stage that caused the failure (DECISION_LOG
> D014/D015). It follows the single-AI isolated-review contract in
> `core/SIVS_SINGLE_AI_MODEL.md`.

## When it runs

- For **`type:code` and `type:other`** tasks. `type:docs` / `type:analysis` skip.
- **Type normalization:** any task whose `type` is missing or unrecognized (not
  `docs`/`analysis`) is treated as gate-running (code-equivalent). The gate is
  never silently bypassed by an absent/typo'd type.
- No `≤ N items` skip. (R3 — always mandatory for the in-scope types.)

## Agents (Verify stage)

The three Verify-stage agents operate in Critical mode. The Verify lead and
Devil's Advocate use high reasoning effort.

| Agent | Focus | Source |
|-------|-------|--------|
| Devil's Advocate | "Where does it break? What input crashes it? Which test is missing?" | thinking-modes.md Mode 2 |
| Security Auditor | Injection, auth bypass, data leak, OWASP exposure | Qcritical-review verify table |
| Performance Skeptic | Time complexity, scaling, N+1 queries, leaks | Qcritical-review verify table |

For `type:code`, every agent must also inspect the TASK_REQUEST `## Risk Register`.
Low-probability high-impact failures are in scope: data loss/corruption,
permission escalation, concurrency/race conditions, rollback failure, and
unverified assumptions. A HIGH/CRITICAL risk with no mitigation, test, defensive
code path, or explicit defer rationale is a gate FAIL.

## Mode scope (vs Supervise)

Verify (Critical) produces **objective implementation evidence**: checklist
traceability, command/test output, missing error cases, crashes, and untested
paths. It may identify a security or business-rule defect, but does not decide
whether residual risk is acceptable for release — that is the Supervise gate's job
([supervise-gate-protocol.md](./supervise-gate-protocol.md)). This separation
keeps the two gates non-redundant.

For code tasks, Verify must not reduce the Risk Register to a paperwork check.
It must try to reproduce or reason through the worst-case paths and identify
which risks are verified, mitigated, deferred, or still unknown.

## Output schema & aggregation

Reuse the spec-gate JSON schema and 3-agent verdict aggregation verbatim — see
[spec-gate-protocol.md](./spec-gate-protocol.md) §"Agent output schema" and
§"Verdict aggregation". Each finding additionally carries a `root_cause_stage`
field (see Backward routing).

## Single-AI execution

The active client delegates all three roles with isolated contexts. If native
delegation is unavailable, record `mode=degraded-inline`; the verdict cannot be
stronger than WARN until delegated evidence is available. Never invoke another
AI client.

## Backward routing (FAIL is not a dead-end)

A FAIL routes the loop **backward to the stage that caused it** (D014), then the
loop re-enters and re-verifies. The Verify gate's default backward target is
**Implement**.

1. **Root-cause attribution (D015):** each FAIL finding sets
   `root_cause_stage: "implement" | "spec"`. The agent attributes the cause
   (e.g. "the spec itself is wrong/ambiguous" → `spec`; "the code doesn't match
   a correct spec" → `implement`).
2. **Routing:**
   - Any finding with `root_cause_stage: spec` → route back to **Spec**
     (regenerate the spec via the spec gate), since spec defects poison
     everything downstream.
   - Otherwise → route back to **Implement** (re-implement; this is the existing
     `Qexecute -verify` fix loop).
3. **Unclear cause → nearest-first:** if attribution is ambiguous, go to the
   **nearest** upstream stage first (Implement). Only if re-implementation FAILs
   again does the cause escalate to Spec.
4. **Loop bound:** the gate does **not** self-loop. It honors the caller's
   `Qexecute -verify` 3-round cap. After 3 rounds still FAIL → **escalate to the
   user** (do not auto-proceed).
5. **Depth limit (Phase 3 / R005 — code-computed, protocol-enforced):** before
   re-entering after a FAIL, call `recordAndCheck(cwd, uuid, 'reentry', '<from-stage>')`
   from `hooks/scripts/lib/loop-guard.mjs`. The limit (default 5,
   `QE_SIVS_DEPTH_LIMIT` override) is computed in code; if it returns `blocked`,
   do **not** re-enter — emit a user **escalation handoff** stating: the depth
   budget is exhausted (`count`/`limit`), the unresolved findings, and a
   recommended next action. This layer is protocol-enforced (the code computes the
   limit; the gate obeys it), distinct from the deterministic hook block on the
   remediation counter.

### Qexecute `-utopia` (autonomous, non-interactive)
The gate still runs for `type:code`/`other` in `-utopia` (the work-path skip
applies only to docs/analysis). It runs non-interactively: WARN is
auto-accepted and logged; FAIL re-enters the fix loop within the 3-round cap; on
cap exhaustion with FAIL the task is **not** marked complete — it is left
`needs-attention` with a blocking marker for the next session (no silent
auto-proceed past a FAIL). `-utopia -verify` mode is mandatory as before.

## Verification Evidence Requirement (R005)

<!-- Attribution: methodology adapted from obra/superpowers verification-before-completion
     (MIT License, 2024). Rewritten in QE/SIVS terminology without copying original prose. -->

A completion or PASS verdict for `type:code`/`other` tasks **requires verification
command execution evidence from the current turn**. Report-only completion without
evidence is not acceptable when a code diff is present.

### What counts as evidence

**Bash `toolUseResult` (same turn):**
- Success: `is_error` field is absent AND `interrupted !== true`.
- Failure: `is_error: true`. An `is_error`-absent result does not imply test passage —
  the allowed-command trace must appear.
- The command must appear in the allowlist before it is accepted as evidence.

**Agent `toolUseResult` (same turn):**
- The result text must contain an allowlist command trace **and** a PASS/FAIL summary.
- A bare Agent completion report (e.g. "작업 완료") without command trace is **not** evidence.
- Subagent reports claiming completion must be independently verified via VCS diff and
  test evidence — a subagent report alone does not satisfy the evidence requirement.

**Allowlist (closed-world):**
- `npm run qe:validate`
- `node scripts/check-all.mjs`
- `node --test <path>`
- A leading `cd X &&` prefix is stripped before matching. Multi-command chains,
  `npm --prefix`, subshells, or chained `&&` beyond the single leading `cd X &&` strip
  do not match.

**Producer rule:** any subagent that executes allowlist verification commands must echo
the command name(s) and PASS/FAIL summary in its final result text so the evidence
gate can recognise it.

### Grading (Stop-hook enforcement)

The Stop hook enforces this contract via `hooks/scripts/lib/verification-evidence-gate.mjs`
and the `verification_evidence_gate` config key (`'warn'` default, `'block'`, `false`).
See `hooks/scripts/lib/config.mjs` for the `code_risk_stop_gate` precedent and the
phased-rollout rationale.

### Same-turn boundary

Evidence scope is confined to the current turn: transcript events that appear after the
last real human user message (same boundary used by `extractLastAssistantText` in
`hooks/scripts/lib/style-gate.mjs`). Evidence from previous turns does not carry over.

## Edge inputs

- **Empty diff** → **PASS** `reason=empty-diff` (nothing to attack). Emptiness is
  determined by `getChangedFiles(cwd)` from
  `hooks/scripts/lib/changed-files.mjs`, which reconciles working-tree + staged +
  untracked — the gate runs unless **all three** are empty (`isEmpty === true`),
  so it cannot be bypassed by staging/committing the change.
  **The verification evidence requirement does not apply to empty-diff turns** —
  this PASS is preserved unconditionally.
- **Missing VERIFY_CHECKLIST** → **WARN**, proceed using TASK_REQUEST goals.

## Audit

Each run appends one atomic line via `appendGateAudit(cwd, 'verify', entry)` from
`hooks/scripts/lib/gate-audit.mjs` to the shared `.qe/agent-results/verify-gate.log`.
The helper uses a single `O_APPEND` write so concurrent multi-UUID gate runs do
not interleave:

```
{ISO-8601} | verify | verdict={PASS|WARN|FAIL} | agents={n} | mode={delegated|degraded-inline} | route={implement|spec|-} | uuid={UUID}
```

## Findings pipeline (Verify → Supervise, Phase 2 / R002)

The gate audit above is a per-run **verdict summary** (no finding ids). Separately,
the Verify gate persists its individual findings to an **append-only event
stream** so downstream gates can reuse them instead of re-analyzing the same code
(the real cross-stage duplication — Verify and Supervise both run
`Ecode-reviewer`/`Ecode-test-engineer` on the same diff; see DECISION_LOG
D-55a051bd-1).

- **Artifact:** `.qe/agent-results/verify-findings-{UUID}.jsonl`, one JSON event
  per line. Distinct from `verify-gate.log`. Written via
  `hooks/scripts/lib/findings-ledger.mjs` → `appendFinding(cwd, uuid, event)`
  (`O_APPEND`, no whole-file rewrite → parallel agents never lose writes).
- **Event schema:** `{ id, gate, severity, status, file, ts, rationale?, waived_by? }`
  where `status ∈ {open, resolved, waived, escalated}`. A `waived` event MUST
  carry `rationale` + `waived_by` (else it is a silent drop, not a waiver).
- **Clean marker:** a run with zero findings writes an affirmative
  `markClean(cwd, uuid, gate)` line (`{clean:true,...}`). **Absence of the
  artifact is NOT clean** — it means the gate crashed before writing; the reader
  reports `absent` distinctly from `clean`.
- **Canonical fold (reader contract):** one id yields multiple events across
  gates; the single canonical record is a projection, never stored.
  `foldFindings(events)` computes it: canonical status = the id's highest-
  precedence **terminal** event, precedence **escalated > waived > resolved**; no
  terminal → `open`; `owner_gate` = the gate that wrote the winning terminal (ts
  tiebreak among equal precedence). A lower gate's `escalated` is never masked by
  a later `waive`.
- **Invariant (enforced by `scripts/check-findings-pipeline.mjs`):** at pipeline
  end every finding folds to exactly one terminal (resolved/waived/escalated); an
  id still `open` = vanished/forgotten = violation. Legitimate closures never
  false-positive.
