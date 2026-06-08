# Thinking Modes — Per-Stage Independent Verification

> Defines the three cognitive modes used by the mandatory verification sub-agent
> layer at each SIVS stage. These modes break the **self-reference problem**:
> when the SIVS engine is homogeneous (all-Claude or all-Codex), the verifier
> shares the spec author's blind spots and cannot catch errors introduced at the
> Spec stage. Independence here is achieved structurally — **fresh context +
> adversarial role + a distinct cognitive lens** — not by requiring a different
> engine. See DECISION_LOG D011/D012/D013.

These modes are **stage-neutral definitions**. The Spec stage uses Structural +
Critical; Verify uses Critical; Supervise uses Meticulous. Phase 2 wires Verify
and Supervise; this document is the single source of truth for all three.

---

## Why same-engine sub-agents still break self-reference

A sub-agent on the same model family is not a true independent engine, but it
breaks confirmation bias through three structural levers:

1. **Fresh context** — the sub-agent never saw the author's reasoning chain, so
   it does not inherit the assumptions that produced the error.
2. **Adversarial role** — it is instructed to *find problems*, not confirm
   quality. The default posture is "this is wrong until proven otherwise."
3. **Distinct cognitive lens** — each mode asks a different class of question,
   so blind spots in one lens are covered by another.

This is the dependency-free baseline (works with zero codex install). When codex
is reachable, the single most adversarial agent is upgraded to a genuinely
different engine (cross-model) for maximum independence — see
[spec-gate-protocol.md](./spec-gate-protocol.md).

---

## Mode 1 — Structural (구조적 사고)

**Stage:** Spec
**Posture:** Treat the spec as a structure to be stress-tested for completeness
and internal consistency — independent of whether it is "good."

**Role:** Decompose the spec and check that the structure holds: requirements are
complete, non-contradictory, well-formed, and dependency-correct.

**Key questions:**
- Does every stated goal map to at least one checklist item, and vice versa?
- Are any two requirements or constraints in conflict?
- Are there unstated dependencies, or items that depend on something never produced?
- Is each item single-responsibility and objectively verifiable (yes/no)?
- Are success criteria observable, or are they subjective ("works well")?
- Does the decomposition cover the full intent, or are whole sub-problems missing?

**Adversarial instruction:**
> "Assume the spec's decomposition is incomplete or self-contradictory. Find the
> missing requirement, the contradiction, the dangling dependency, or the
> unverifiable item. Re-derive the requirement set from the stated intent and
> diff it against what the spec actually lists — report every gap."

**Must NOT:**
- Judge implementation quality (that is Verify's job).
- Accept the spec's framing as correct; re-derive independently.
- Pass an item just because it is well-written — check that it is *right*.

---

## Mode 2 — Critical (비판적 사고)

**Stage:** Spec (paired with Structural) and Verify
**Posture:** Devil's advocate. Argue the artifact is wrong and hunt for where it
breaks.

**Role:**
- At **Spec**: attack the spec's *substance* — wrong assumptions, missing error
  cases, edge conditions, scenarios the author did not consider.
- At **Verify**: attack the *implementation* — where does it crash, what input
  breaks it, which test is missing, what silently fails.

**Key questions:**
- What assumption is the artifact built on that might be false?
- What happens at zero, at max, with concurrent access, with malformed input,
  with network/IO failure?
- Which scenario is plausible in production but absent here?
- (Verify) Where does this break? What input crashes it? Which path is untested?

**Adversarial instruction:**
> "Your job is to find problems, not confirm quality. Assume the artifact is
> wrong. Produce concrete failure cases with evidence (file:line, input,
> expected vs actual). A vague concern is not a finding — make it reproducible."

**Must NOT:**
- Soften findings to be agreeable.
- Report only style nits while ignoring substantive failures.
- See other agents' outputs before forming its own verdict.

---

## Mode 3 — Meticulous (꼼꼼한 사고)

**Stage:** Supervise
**Posture:** Precision auditor. Nothing slips through.

**Role:** Line-by-line and cross-cutting quality: regression risk, coverage
sufficiency, residual TODOs, boundary-violation between owned scopes, and whether
the work meets quality (not just completion).

**Key questions:**
- Does any change risk regressing a guarantee established by an earlier phase?
- Is test coverage sufficient for the changed surface, or are there blind spots?
- Are there unresolved TODOs, dead code, or partially-applied changes?
- Were role/ownership boundaries respected?
- Is the work done *well*, or merely done?

**Adversarial instruction:**
> "Audit as if a regression here would ship to production. Go line by line.
> Find the one thing everyone else overlooked. Distinguish 'complete' from
> 'correct and safe to merge'."

**Must NOT:**
- Re-litigate Spec/Verify findings already resolved (focus on merge readiness).
- Pass on vibes — every PASS must be backed by a concrete check.

---

## Mode → SIVS stage map

| SIVS Stage | Modes | Output |
|-----------|-------|--------|
| Spec | Structural + Critical | PASS / WARN / FAIL per [spec-gate-protocol.md](./spec-gate-protocol.md) |
| Verify | Critical | PASS / WARN / FAIL per [verify-gate-protocol.md](./verify-gate-protocol.md) |
| Supervise | Meticulous | PASS / WARN / FAIL per [supervise-gate-protocol.md](./supervise-gate-protocol.md) |
