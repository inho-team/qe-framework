# Positioning FAQ

Where QE fits, and why it is not the same thing as the tools it is often compared to.
All counts below are the current, measured framework footprint (2026-07):
**12 skills** and **12 agents** in the standalone QE Framework package.
Optional MCP servers and local skill packs are configured separately per user or
project.

## Why not gstack?

gstack gives an agent "eyes" (real browser control). QE is **not** trying to replace
that. When browser tooling is available, Qexecute can use it as explicit Verify evidence;
QE no longer ships a separate always-on browser agent. The difference is scope:

- **gstack** = a capability (drive a browser).
- **QE** = a **quality gate** around the whole coding loop (spec → implement →
  verify → supervise), of which browser QA is one Verify signal among many
  (tests, review, security, contracts).

QE uses browser "eyes" as *evidence for the Verify stage*, not as the product. If you
only want browser automation, use a browser tool directly; if you want a coding loop
that can *check itself with eyes*, that is QE.

## Why not Fugu (or any single stronger model)?

A stronger single model does not remove the core problem SIVS solves: **a model
grading its own work shares its own blind spots.** Fugu is supported only as an
*experimental* engine (`core/engines.json`, `openai-compat` type, keys env-only) and
only inside the independence guarantee — e.g. the `implement-fugu-verify-claude`
profile, where Fugu implements and a *different* vendor verifies.

- QE's value is the **cross-model gate**, not the identity of any one model.
- Swapping in a better model makes each stage better; it does **not** make
  self-verification trustworthy. Independence still has to come from a second vendor.
- See [`SIVS_INDEPENDENCE.md`](SIVS_INDEPENDENCE.md) for the enforced guarantee.

Fugu — like any OpenAI-compatible endpoint — is reachable only as an experiment-only,
env-gated engine through the opt-in `qe_run_openai_compat_agent` tool, never as a
default. QE does **not** gate this on a benchmark: the cross-model independence
guarantee is already satisfied by two independent vendors (Claude + Codex), so no
single-model comparison is needed to justify keeping any one model non-default.

## So what *is* QE, in one line?

A transparent, auditable, cross-model quality gate for coding agents — plain files
and skills, an enforced Implement/Verify independence boundary, and a logged audit
trail, rather than a black-box orchestrator you have to trust.
