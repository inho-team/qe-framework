# Verify Gate — Protocol

> The **mandatory** Verify-stage adversarial gate. Invoked by `Qexecute -verify`
> Step 4.9 after implementation, for `type:code` and `type:other` tasks. Its
> cognitive mode is **Critical** (비판적 사고) — see
> [thinking-modes.md](./thinking-modes.md) Mode 2. On FAIL it does NOT dead-end:
> it routes **backward** to the stage that caused the failure (DECISION_LOG
> D014/D015). Engine baseline + codex auto cross-model upgrade per
> [spec-gate-protocol.md](./spec-gate-protocol.md) §"Engine routing".

## When it runs

- For **`type:code` and `type:other`** tasks. `type:docs` / `type:analysis` skip.
- **Type normalization:** any task whose `type` is missing or unrecognized (not
  `docs`/`analysis`) is treated as gate-running (code-equivalent). The gate is
  never silently bypassed by an absent/typo'd type.
- No `≤ N items` skip. (R3 — always mandatory for the in-scope types.)

## Agents (Verify stage)

The **existing three** Verify-stage agents (none dropped). All operate in the
Critical mode; **Devil's Advocate** is the cross-model-upgrade target.

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

Verify (Critical) attacks **implementation correctness**: assumptions, missing
error cases, crashes, untested paths, security/perf defects in the code itself.
It does NOT judge merge/release readiness — that is the Supervise gate's job
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

## Engine routing & cross-model failure fallback

- **Baseline (always):** all 3 agents are same-engine sub-agents
  (`general-purpose`).
- **Auto-upgrade:** if codex is reachable (`getCodexPluginInfo()` /
  `isCodexReachable()`), route **Devil's Advocate** to `codex:codex-rescue`.
- **Cross-model failure fallback:** if the codex sub-agent errors or times out,
  log `crossmodel=false` with the reason, **re-run that one agent on Claude
  (`general-purpose`)**, and mark the gate result `degraded` → at least **WARN**
  (the strongest critic ran same-engine, so independence is reduced; never let a
  optional upgrade silently PASS as if cross-model). An optional upgrade
  **never blocks** the mandatory gate.
- **Double failure:** if the Claude re-run also errors, the gate result is
  **WARN-blocked** (NOT PASS) requiring explicit user override, with an audit
  line `reason=double-failure`.

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

### Qexecute `-utopia` (autonomous, non-interactive)
The gate still runs for `type:code`/`other` in `-utopia` (the work-path skip
applies only to docs/analysis). It runs non-interactively: WARN is
auto-accepted and logged; FAIL re-enters the fix loop within the 3-round cap; on
cap exhaustion with FAIL the task is **not** marked complete — it is left
`needs-attention` with a blocking marker for the next session (no silent
auto-proceed past a FAIL). `-utopia -verify` mode is mandatory as before.

## Edge inputs

- **Empty diff** → **PASS** `reason=empty-diff` (nothing to attack). Emptiness is
  determined by `getChangedFiles(cwd)` from
  `hooks/scripts/lib/changed-files.mjs`, which reconciles working-tree + staged +
  untracked — the gate runs unless **all three** are empty (`isEmpty === true`),
  so it cannot be bypassed by staging/committing the change.
- **Missing VERIFY_CHECKLIST** → **WARN**, proceed using TASK_REQUEST goals.

## Audit

Each run appends one atomic line via `appendGateAudit(cwd, 'verify', entry)` from
`hooks/scripts/lib/gate-audit.mjs` to the shared `.qe/agent-results/verify-gate.log`.
The helper uses a single `O_APPEND` write so concurrent multi-UUID gate runs do
not interleave:

```
{ISO-8601} | verify | verdict={PASS|WARN|FAIL} | agents={n} | crossmodel={true|false|degraded} | route={implement|spec|-} | uuid={UUID}
```
