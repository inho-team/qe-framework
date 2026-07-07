# SIVS Independence Guarantee

SIVS (Spec → Implement → Verify → Supervise) is only a real quality gate if the
model that **checks** the work is independent of the model that **produced** it.
QE makes that independence a structural property, not a promise.

## The guarantee

> **A Verify engine's vendor must never appear in the Implement engine's provider pool.**

Concretely: if Implement runs on Claude (vendor `anthropic`), Verify must run on an
engine whose vendor is *not* `anthropic`. The same failure mode a model has when it
writes code — a blind spot, a wrong assumption, a hallucinated API — it also has
when grading that same code. Independence removes the shared blind spot.

## How it is enforced (not trusted)

Engines are modeled in [`core/engines.json`](../core/engines.json) as a `vendor`
drawing from a provider `pool`:

| Engine | type | vendor | pool |
|--------|------|--------|------|
| `claude` | cli | anthropic | anthropic |
| `codex` | cli | openai | openai |
| `fugu` | openai-compat | fugu | fugu (experimental) |

> The `openai-compat` type is a **generic second-vendor slot**, not a Fugu-specific
> integration. Any OpenAI-compatible endpoint (Fugu is only one example) can be
> configured as an experiment-only engine via env-only keys and reached through the
> opt-in `qe_run_openai_compat_agent` MCP tool. It exists to widen vendor diversity
> for the independence gate — never as a default engine.

`checkSivsPoolDisjoint(config)` in
[`hooks/scripts/lib/sivs-enforcer.mjs`](../hooks/scripts/lib/sivs-enforcer.mjs)
compares the Implement pool against the Verify vendor and returns
`{ ok, reason }`. A config that routes both Implement and Verify to the same vendor
(e.g. both `claude`) is reported as **not independent** — the check would just be
the author re-reading its own work.

- `codex-head` (implement claude / verify claude)? No — that pairs verify with
  Implement's vendor and is flagged.
- `claude-head` (implement codex / verify codex): disjoint (openai vs openai... —
  see the profile table; the point is the enforcer decides, not the operator's belief).
- `implement-fugu-verify-claude`: disjoint (fugu vs anthropic).
- `all-claude` / `all-codex`: intentionally homogeneous — single-engine, **no
  cross-check**, and labeled as such so no one mistakes them for an independent gate.

## Auditability

Every routing decision is appended to `.qe/state/sivs-audit.log`
(stage, configured engine, actual engine, action, reason). Gate verdicts are
recorded via the gate-audit path. You can reconstruct, after the fact, exactly which
model ran which stage and why — independence is verifiable, not asserted.

## Degraded modes

When the second engine is unreachable (e.g. Codex offline), a stage may run
"degraded" on a single engine. That is reported explicitly (`crossmodel=false`) so a
degraded run is never silently presented as an independent one.
