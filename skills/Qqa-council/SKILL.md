---
name: Qqa-council
description: "Orchestrates a multi-agent QA council (Planner → Explorer → Generator → Healer → Reporter) over a running web app: exploratory black-box testing finds bugs, core flows get codified into Playwright regression tests, failures get self-healed, and findings post back as a PR comment. Use for 'QA council', 'run AI QA', 'exploratory + regression QA', 'PR QA bot', 'set up automated UI QA'. Distinct from Qscenario-test (single-pass scenario gen+run) and Qqa-test-planner (writes test docs, no execution) — this skill runs a role-separated, bounded-agent QA loop end to end and can scaffold a PR-triggered GitHub Actions runner."
metadata:
  author: inho
  version: "1.0.0"
  invocation_trigger: "When the user wants a role-separated multi-agent QA loop (explore → codify → heal → report) over a live web app, or a PR-triggered QA bot."
  recommendedModel: sonnet
---

# QA Council — Multi-Agent UI QA Orchestrator

Runs a **role-separated QA council** over a live web app. Each role is a **bounded agent** with a
narrow tool boundary — no "super agent". The council explores for bugs, codifies stable flows into
regression tests, heals failures, and reports findings.

> **Core principle (do not violate):** one agent = one bounded role. Explorer must NOT read source
> (true black-box). Reporter writes comments only. See `reference/agents.md`.

> **MANDATORY:** All user confirmations MUST use the `AskUserQuestion` tool.

## When to Use / Not Use

| Use this skill | Use instead |
|----------------|-------------|
| Want explore → codify → heal → report as one loop | `Qscenario-test` — single-pass scenario gen + run |
| Want a PR-triggered QA bot scaffold | `Qqa-test-planner` — writes test docs, no execution |
| Want black-box exploratory + regression together | `Qplaywright-expert` — writes Playwright code only |

## Role Map (bounded agents)

| Role | Responsibility | Tool boundary | Backed by |
|------|---------------|---------------|-----------|
| **Planner** | Design scenarios → review-ready Markdown | read code + browser | `Qqa-test-planner` / `Qscenario-test` |
| **Explorer** | Black-box explore, bad input, responsive checks | **browser only, NO source** | `Eqa-explorer` (new) |
| **Generator** | Markdown → Playwright regression code | read/write code + browser | `Qplaywright-expert` |
| **Healer** | Reproduce failures, patch selectors | read/write code + browser | `Eqa-orchestrator` (test→fix loop) |
| **Reporter** | Findings → PR comment | write comment only | `Eqa-reporter` (new) |

Pattern: **explore expensive once (MCP), regress cheap every time (CLI).** Explorer uses Playwright
MCP for live adaptation; Generator emits CLI-runnable `.spec` files for low-cost CI reruns.

## Prerequisites (Step 0 — verify, never assume)

Run and report results before proceeding:

```bash
node -v                                            # Node present
npx playwright --version 2>/dev/null || echo "PLAYWRIGHT MISSING"
git rev-parse --is-inside-work-tree 2>/dev/null    # in a repo
```

- **Target URL is required.** Ask the user for the running app URL (e.g. `http://localhost:3000`).
  Do NOT guess. If none is running, stop and ask the user to start it (`! <run command>`).
- **Playwright MCP preferred** for Explorer (accessibility-tree based). Fall back to `agent-browser`
  (`/Qagent-browser`) only if MCP is unavailable.

## Workflow

### Step 1 — Scope (collaborative)
Use `AskUserQuestion` to fix scope. Required answers:
1. **Target URL** + environment (must be a non-production, synthetic-data env — see guardrails).
2. **Mode** — `explore` (find new bugs), `regress` (run existing suite), or `full` (both).
3. **Critical flows** to prioritize (e.g. login, member management, sending).
4. **Project guardrails** — multitenancy / RBAC / audit-log to verify? (see `reference/guardrails.md`).

> **Safety gate (FAIL if violated):** if the URL looks like production or real PII may be present,
> STOP and require explicit written confirmation. MCP sends page content to the API.

### Step 2 — Plan (Planner)
Delegate scenario design to `Qqa-test-planner` (or `Qscenario-test` for codified flows). Output a
review-ready Markdown scenario list. **Pause for user review** before any execution.

### Step 3 — Explore (Explorer, black-box)
For `explore`/`full`: spawn `Eqa-explorer` (browser-only, no source). It probes the live URL with
bad input, edge cases, responsive breakpoints, and — if requested — the guardrail scenarios. It
returns a findings list (each: title, repro steps, severity, screenshot path). It MUST NOT read repo
source.

### Step 4 — Codify (Generator)
For each confirmed exploratory finding worth a regression test, delegate to `Qplaywright-expert` to
write a CLI-runnable `*.spec.ts` (Page Object Model). Keep tests deterministic and selector-stable.

### Step 5 — Regress + Heal
Run the existing/new suite (`npx playwright test`). On failure, delegate to `Eqa-orchestrator`
(test→review→fix loop) acting as Healer to reproduce and propose selector/code patches — capped at
3 iterations. Healer proposes; it does not silently merge.

### Step 6 — Report (Reporter)
Delegate to `Eqa-reporter` to assemble a structured report (bugs found, tests added, heals applied,
guardrail verdicts) and, when in a PR context, post it as a single PR comment via `gh`. **Never
auto-merge.** Final merge is a human decision.

### Step 7 — (Optional) CI scaffold
If the user wants PR automation, scaffold `.github/workflows/qa-council.yml` from
`reference/github-actions.md` (uses `anthropics/claude-code-action`, Explorer tools locked to
browser-only via `--allowedTools`). Confirm before writing the workflow file.

## Validation (Required — every run)
1. Explorer accessed repo source → **FAIL** (black-box violation).
2. Ran against production / real PII without explicit confirmation → **FAIL**.
3. Auto-merged or pushed without human approval → **FAIL**.
4. Reported "done" but VERIFY items unchecked / no findings artifact written → **FAIL**.
5. Reused an existing skill's job done manually instead of delegating → **FAIL**.

## Roadmap (don't build all 5 roles day one)
1. Playwright MCP self-QA (Explorer only) — ~10 min, immediate value.
2. Planner + Generator codify core flows into CLI tests.
3. Wire the suite into PR-trigger (Step 7).
4. Split Explorer/Healer/Reporter as the suite stabilizes.

## Quick Reference
```
"Run an AI QA council on http://localhost:3000 — explore mode"
"Set up a PR-triggered QA bot for this repo"
"Explore for bugs then codify the login flow into a regression test"
"QA council: verify tenant isolation and RBAC on the staging URL"
```

## Never Use For
- Pure test-doc generation with no execution → `Qqa-test-planner`.
- A single scenario gen+run pass → `Qscenario-test`.
- Writing Playwright code only → `Qplaywright-expert`.
- Visual screenshot diffing only → `Qvisual-qa`.

## References
- `reference/agents.md` — full role specs and tool boundaries
- `reference/github-actions.md` — PR-trigger workflow scaffold
- `reference/guardrails.md` — parametrized multitenancy/RBAC/audit-log scenario templates
