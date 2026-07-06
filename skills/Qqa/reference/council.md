# Qqa council — Multi-Agent UI QA Orchestrator

Behavior preserved from `Qqa-council`.

Runs a role-separated QA council over a live web app. Each role is a bounded agent or skill-backed
step with a narrow tool boundary. The council explores for bugs, codifies stable flows into
regression tests, heals failures, and reports findings.

> Core principle: one agent = one bounded role. Explorer must not read source. Reporter writes
> comments only. The full legacy references remain in `../Qqa-council/reference/`.

> Mandatory: all user confirmations must use the QE interaction adapter. Claude uses
> `AskUserQuestion`; Codex uses equivalent concise choices.

## When to Use / Not Use

| Use `Qqa council` | Use instead |
|-------------------|-------------|
| Want explore -> codify -> heal -> report as one loop | `Qqa run` for single-pass scenario gen + run |
| Want a PR-triggered QA bot scaffold | `Qqa plan` for test docs, no execution |
| Want black-box exploratory + regression together | `Qplaywright-expert` for Playwright code only |

## Role Map (Bounded Roles)

| Role | Responsibility | Tool boundary | Backed by |
|------|----------------|---------------|-----------|
| Planner | Design scenarios -> review-ready Markdown | read code + browser | `Qqa plan` / `Qqa run` skill logic |
| Explorer | Black-box explore, bad input, interaction and responsive checks | browser only, no source | `Eqa-explorer` agent |
| Auditor (optional) | Visual pixel-diff + a11y/UX + design-token outliers | read source + browser, read-only, never writes | screenshots + review heuristics |
| Generator | Markdown -> Playwright regression code | read/write code + browser | `Qplaywright-expert` skill |
| Healer | Reproduce failures, patch selectors | read/write code + browser | `Eqa-orchestrator` agent |
| Reporter | Findings -> PR comment | write comment only | `Eqa-orchestrator` (Reporter mode) |

Calling convention:
- `Q*` backings are skills. Invoke them via the skill mechanism.
- `E*` backings are sub-agents. Spawn them via the Agent tool using `subagent_type`.
- Never pass a `Q*` name as an Agent `subagent_type`; it is not in the agent registry.

Pattern: explore expensive once with browser/MCP, regress cheap every time with CLI-runnable tests.

## Preserved Delegation Contract

The council flow must remain:

```text
Planner -> Explorer -> Generator -> Healer -> Reporter
```

Required delegations:
- Planner uses `Qqa plan` or `Qqa run` logic for scenario design and review-ready Markdown.
- Explorer is delegated to `Eqa-explorer`; it is black-box and must not read repository source.
- Generator uses `Qplaywright-expert` to create deterministic CLI-runnable Playwright specs.
- Healer is delegated to `Eqa-orchestrator`; it runs the test -> review -> fix loop and is capped at
  3 iterations. The Healer obeys the **Investigate Iron Law**: no fix without investigation, ≥2
  competing hypotheses with disconfirming evidence, a hypothesis log, and **stop-after-3** — on the
  third failed fix it stops patching and re-opens investigation from the evidence (report the log and
  the next discriminating probe) instead of guessing again. (Same law as `Ecode-debugger`.)
- Reporter is delegated to `Eqa-orchestrator` (Reporter mode); it writes a report and may comment on a PR, but must
  never merge or push.

## Prerequisites (Step 0 — Verify, Never Assume)

Run and report results before proceeding:

```bash
node -v
npx playwright --version 2>/dev/null || echo "PLAYWRIGHT MISSING"
git rev-parse --is-inside-work-tree 2>/dev/null
```

- Target URL is required. Ask the user for the running app URL, for example
  `http://localhost:3000`.
- Do not guess the URL. If none is running, stop and ask the user to start it.
- **Resolve the Eyes transport before Explore** (both engines). Determine the active `engine`
  (see Engine-Neutral Eyes below), then verify + probe via `scripts/lib/eyes-mcp.mjs`:
  `resolveEngine(engine)` → `verifyMcpIdentity(engine)` → `runStartupProbe()` → `resolveBrowserTransport(engine)`.
  Report the resolved transport (`mcp` / `browser-driver`) or the typed stop
  (`MCP_START_FAILED` / `PLAYWRIGHT_NOT_INSTALLED` / `INVALID_ENGINE`). On Codex without a
  `@playwright/mcp` entry, surface the pinned `generateCodexMcpAddGuidance()` string and pause for
  user confirmation — never auto-run it.

## Engine-Neutral Eyes (Dual-Engine Browser)

The browser-touching roles (Planner, Explorer, Auditor, Healer) drive the live app through an
**engine-neutral Eyes layer** so the council runs identically on Claude and Codex. Full contract,
fallback ladder, liveness receipt schema, and safety-gate details live in
[`eyes.md`](./eyes.md). Summary:

- **Engine is injected, never runtime-detected.** The council passes an explicit `engine`
  (`claude` | `codex`) into `runEyesRole` / the Eyes helpers, with `QE_ACTIVE_CLIENT` as the only
  env fallback. Under a rescue delegation, pin `engine` to the layer that actually drives the
  browser. Any other value is rejected with `INVALID_ENGINE`.
- **Both engines drive the browser via Playwright MCP** (identity-matched to `@playwright/mcp`),
  with the unmodified `scripts/lib/browser-driver.mjs` library as the programmatic fallback.
- **Explicit MCP invocation contract** — roles call the Playwright MCP tools by name, not by
  vibe: `browser_navigate` (go to the resolved URL), `browser_snapshot` (accessibility tree for
  black-box assertions), `browser_take_screenshot` (evidence), `browser_console_messages`
  (console capture). A tool error or `MCP_START_FAILED` triggers the fallback ladder, not a silent
  skip.
- **Fallback ladder (no infinite fallback):** Playwright MCP (startup-probe passed) →
  `browser-driver` library → typed stop. Fallback keeps the same `evidence/<engine>/` directory.
- **3-state liveness receipt** distinguishes *engine unavailable* / *ran-but-not-executed
  (soft no-op)* / *ran-with-no-findings* — an empty findings list is never read as a clean pass.
- **Per-capture safety gate:** the non-prod URL check re-runs on the resolved `page.url()` before
  each capture (blocks server/SPA/iframe redirect-to-prod), on both engines.

Black-box contract is preserved on both engines: MCP browser tools observe the running app only and
must not read repository source.

## Workflow

### Step 1 — Scope (Collaborative)

Use `AskUserQuestion` or Codex equivalent to fix scope. Required answers:

1. Target URL + environment. It must be non-production with synthetic data.
2. Mode: `explore`, `regress`, or `full`. Add `+visual` to run the optional Auditor pass.
3. Critical flows to prioritize.
4. Project guardrails, such as multitenancy, RBAC, and audit-log checks.

Safety gate: if the URL looks like production or real PII may be present, stop and require explicit
written confirmation. MCP sends page content to the API.

### Step 2 — Plan (Planner)

Invoke `Qqa plan` or `Qqa run` logic as a skill-backed planning step to design scenarios. Output a
review-ready Markdown scenario list. Pause for user review before execution.

### Step 3 — Explore (Explorer, Black-Box)

For `explore` or `full`, spawn `Eqa-explorer` via the Agent tool. **Pass the resolved `engine` and
Eyes transport into the spawn** (the receiving point for engine injection) so the Explorer drives
the browser through the same Playwright MCP contract on either engine. It probes the live URL with
bad input, edge cases, responsive breakpoints, interaction checks, and requested guardrail
scenarios, using `browser_navigate` / `browser_snapshot` / `browser_take_screenshot` /
`browser_console_messages`.

Explorer output: findings list with title, repro steps, severity, screenshot path (under
`evidence/<engine>/`), and area, plus the run's liveness receipt so an empty findings list is
distinguishable from an engine that never executed.

Hard rule: Explorer must not read repo source (holds on both engines).

### Step 3.5 — Visual & A11y Pass (Optional Auditor)

Only run when mode includes `+visual`. The Auditor runs after Explore and is read-only. It covers
spacing/alignment outliers, layout shift, contrast, keyboard/focus, reduced-motion behavior, and
design-token drift.

Merge Auditor findings into the same findings list with `source: auditor`.

Bounded-role rule: Auditor reads source and runs in its own step; its white-box knowledge must not
feed back into the black-box Explorer, and it never edits code.

### Step 4 — Codify (Generator)

For each confirmed exploratory finding worth a regression test, invoke `Qplaywright-expert` via the
skill mechanism to write a CLI-runnable `*.spec.ts`, preferably using Page Object Model patterns and
stable selectors.

### Step 5 — Regress + Heal

Run the suite:

```bash
npx playwright test
```

On failure, spawn `Eqa-orchestrator` via Agent as Healer. It reproduces the failure and proposes
selector/code patches, capped at 3 iterations. Healer proposes; it does not silently merge.

### Step 6 — Report (Reporter)

Spawn `Eqa-orchestrator` via Agent in Reporter mode to assemble a structured report:
- Bugs found
- Tests added
- Heals applied
- Guardrail verdicts
- Merge recommendation

In a PR context, Reporter may post a single PR comment via `gh`. It must never auto-merge or push.

### Step 7 — Optional CI Scaffold

If the user wants PR automation, scaffold `.github/workflows/qa-council.yml` from the legacy
reference `../Qqa-council/reference/github-actions.md`. Confirm before writing the workflow file.

## Legacy Reference Summary

The original detailed references remain authoritative and are intentionally not deleted:

- `../Qqa-council/reference/agents.md`: full role specs and tool boundaries. It defines Planner,
  Explorer, Auditor, Generator, Healer, Reporter, and repeats the `Q*` skill vs `E*` agent calling
  convention.
- `../Qqa-council/reference/github-actions.md`: PR-trigger workflow scaffold using
  `anthropics/claude-code-action`, browser-only allowed tools for Explorer, and PR-comment-only
  reporting.
- `../Qqa-council/reference/guardrails.md`: parametrized multitenancy, RBAC, and audit-log scenarios
  with the synthetic-data-only safety rule.

## Validation (Required Every Run)

Fail the run if any of these occur:

1. Explorer accessed repository source.
2. Run targeted production or real PII without explicit confirmation.
3. Auto-merged or pushed without human approval.
4. Reported "done" but VERIFY items were unchecked or no findings artifact was written.
5. Reused an existing skill's job manually instead of delegating to the backing skill or agent.
6. Auditor in `+visual` mode wrote/edited source, or its white-box findings were fed back into the
   black-box Explorer.

## Roadmap

1. Playwright MCP self-QA, Explorer only.
2. Planner + Generator codify core flows into CLI tests.
3. Wire the suite into PR trigger.
4. Split Explorer/Healer/Reporter as the suite stabilizes.

## Quick Reference

```text
"Run an AI QA council on http://localhost:3000 — explore mode"
"Set up a PR-triggered QA bot for this repo"
"Explore for bugs then codify the login flow into a regression test"
"QA council: verify tenant isolation and RBAC on the staging URL"
```

## Never Use For

- Pure test-doc generation with no execution -> `Qqa plan`
- A single scenario gen+run pass -> `Qqa run`
- Writing Playwright code only -> `Qplaywright-expert`
- Visual screenshot diffing only -> `Qvisual-qa` standalone
