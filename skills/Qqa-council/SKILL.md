---
name: Qqa-council
description: "Orchestrates a multi-agent QA council (Planner → Explorer → Generator → Healer → Reporter) over a running web app: exploratory black-box testing finds bugs, core flows get codified into Playwright regression tests, failures get self-healed, and findings post back as a PR comment. Use for 'QA council', 'run AI QA', 'exploratory + regression QA', 'PR QA bot', 'set up automated UI QA'. Distinct from Qscenario-test (single-pass scenario gen+run) and Qqa-test-planner (writes test docs, no execution) — this skill runs a role-separated, bounded-agent QA loop end to end and can scaffold a PR-triggered GitHub Actions runner."
metadata:
  author: inho
  version: "1.1.0"
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

## Role Map (bounded roles)

| Role | Responsibility | Tool boundary | Backed by |
|------|---------------|---------------|-----------|
| **Planner** | Design scenarios → review-ready Markdown | read code + browser | `Qqa-test-planner` / `Qscenario-test` (skill) |
| **Explorer** | Black-box explore, bad input, event/interaction + responsive checks | **browser only, NO source** | `Eqa-explorer` (agent) |
| **Auditor** _(optional)_ | Visual pixel-diff + a11y/UX + design-token outliers | read source + browser, **read-only, never writes** | `Qvisual-qa` + `Qweb-design-guidelines` + `Qdesign-audit` (skill) |
| **Generator** | Markdown → Playwright regression code | read/write code + browser | `Qplaywright-expert` (skill) |
| **Healer** | Reproduce failures, patch selectors | read/write code + browser | `Eqa-orchestrator` (agent) |
| **Reporter** | Findings → PR comment | write comment only | `Eqa-reporter` (agent) |

> **Calling convention (do not violate):** `Q*` backings are **skills** — invoke them via the **Skill**
> tool. `E*` backings are **sub-agents** — spawn them via the **Agent** tool (`subagent_type`). Never
> pass a `Q*` name as an `Agent` `subagent_type` — it is not in the agent registry and the call fails
> with "Agent type not found".

Pattern: **explore expensive once (MCP), regress cheap every time (CLI).** Explorer uses Playwright
MCP for live adaptation; Generator emits CLI-runnable `.spec` files for low-cost CI reruns.

> **Why an Auditor?** Explorer reasons over the accessibility tree, which does **not** encode pixels
> or motion — so spacing/alignment outliers, low-level layout breakage, and CSS animations are blind
> spots. The optional Auditor closes them by delegating to existing visual/a11y skills. It is a
> **white-box, read-only** role (it reads source) and therefore must stay *separate* from the
> black-box Explorer — never merge the two.

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
   Add **`+visual`** (e.g. `explore+visual`, `full+visual`) to also run the optional **Auditor** pass
   (Step 3.5). Default is OFF to keep the fast ~10-min explore path; turn it on when spacing/layout,
   accessibility, or design-consistency matter.
3. **Critical flows** to prioritize (e.g. login, member management, sending).
4. **Project guardrails** — multitenancy / RBAC / audit-log to verify? (see `reference/guardrails.md`).

> **Safety gate (FAIL if violated):** if the URL looks like production or real PII may be present,
> STOP and require explicit written confirmation. MCP sends page content to the API.

### Step 2 — Plan (Planner)
Invoke skill `Qqa-test-planner` (or `Qscenario-test` for codified flows) via the **Skill** tool to
design scenarios. Output a review-ready Markdown scenario list. **Pause for user review** before any
execution.

### Step 3 — Explore (Explorer, black-box)
For `explore`/`full`: spawn agent `Eqa-explorer` via the **Agent** tool (browser-only, no source). It probes the live URL with
bad input, edge cases, responsive breakpoints, and — if requested — the guardrail scenarios. It
returns a findings list (each: title, repro steps, severity, screenshot path). It MUST NOT read repo
source.

### Step 3.5 — Visual & A11y pass (Auditor, optional — only when `+visual`)
Runs **after** Explore and is **read-only** (the Auditor never writes source). It covers Explorer's
pixel/motion/heuristic blind spots by composing three existing skills:
- **Visual diff** → `Qvisual-qa` — screenshots the live URL and diffs vs a baseline to catch spacing,
  alignment, color, font, and layout-shift regressions. _First run has no baseline → it captures the
  baseline only; regression value starts on the 2nd run. Note this in the report._
- **A11y / UX heuristics** → `Qweb-design-guidelines` — audits the UI against the Vercel Web Interface
  Guidelines: keyboard reachability, focus states, contrast, `prefers-reduced-motion`, etc.
- **Design-token outliers** → `Qdesign-audit` — static source scan for font-size / spacing / color
  outliers that signal inconsistent styling.

Merge the Auditor findings into the same findings list the Explorer produced (tag `source: auditor`).
**Bounded-role rule:** the Auditor reads source and runs in its own step — it must NOT feed white-box
knowledge back into the black-box Explorer, and it never edits code (fixes belong to Generator/Healer).

### Step 4 — Codify (Generator)
For each confirmed exploratory finding worth a regression test, invoke skill `Qplaywright-expert` via
the **Skill** tool to write a CLI-runnable `*.spec.ts` (Page Object Model). Keep tests deterministic
and selector-stable.

### Step 5 — Regress + Heal
Run the existing/new suite (`npx playwright test`). On failure, spawn agent `Eqa-orchestrator` via the
**Agent** tool (test→review→fix loop) acting as Healer to reproduce and propose selector/code patches
— capped at 3 iterations. Healer proposes; it does not silently merge.

### Step 6 — Report (Reporter)
Spawn agent `Eqa-reporter` via the **Agent** tool to assemble a structured report (bugs found, tests added, heals applied,
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
6. Auditor (`+visual`) wrote/edited source, or its white-box findings were fed back into the
   black-box Explorer → **FAIL** (role-boundary violation).

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
- Visual screenshot diffing only → `Qvisual-qa` standalone. (The council can invoke it as the
  optional Auditor pass via `+visual`; reach for it directly when a pixel diff is *all* you need.)

## References
- `reference/agents.md` — full role specs and tool boundaries
- `reference/github-actions.md` — PR-trigger workflow scaffold
- `reference/guardrails.md` — parametrized multitenancy/RBAC/audit-log scenario templates
