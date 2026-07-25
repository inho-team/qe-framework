---
name: Qqa
description: "Unified QA entry point for planning test documentation, running single-pass scenarios, and orchestrating the multi-agent QA council."
user_invocable: false
metadata:
  author: inho
  version: "1.0.0"
invocation_trigger: "When the user asks for QA planning, scenario/E2E execution, or the QA council."
recommendedModel: sonnet
---

# Qqa

Unified QA entry point. It preserves the behavior of the existing QA skills while exposing a single
command surface:

```bash
Qqa <plan|run|council> [args]
```

The original skills remain valid and coexist:
- `Qqa-test-planner`
- `Qscenario-test`
- `Qqa-council`

## Subcommands

| Subcommand | Reference | Summary |
|------------|-----------|---------|
| `plan` | [`reference/plan.md`](reference/plan.md) | Generate test plans, manual test cases, regression suites, Figma verification notes, and bug report templates. Use this for QA documentation without executing the target. |
| `run` | [`reference/run.md`](reference/run.md) | Generate scenario specs from a TASK_REQUEST, code path, URL, or description; execute browser/API/CLI scenarios once; verify and report results. Browser QA loop (Playwright) is **live** via `scripts/lib/browser-driver.mjs` (Phase 6): `--browser` drives Playwright on demand (optional dependency; `detectWebProject` recommends it; regression specs named `qa-regression-<slug>.spec.ts`). |
| `council` | [`reference/council.md`](reference/council.md) | Run the role-separated QA council: Planner -> Explorer -> Generator -> Healer -> Reporter, with bounded agent/tool contracts and optional PR automation. |

## Routing

### `Qqa plan [target]`

Use when the requested output is QA documentation:
- Test plan
- Manual test cases
- Regression suite
- Figma design verification checklist
- Bug report template

Load and follow [`reference/plan.md`](reference/plan.md). Do not execute the system under test unless
the user switches to `Qqa run` or `Qqa council`.

### `Qqa run [target|--rerun UUID] [--dry] [--browser|--api|--cli]`

Use when the request is scenario testing, E2E scenario execution, user-flow verification, or
acceptance testing. Load and follow [`reference/run.md`](reference/run.md).

This subcommand preserves `Qscenario-test` behavior: generate `SCENARIO_SPEC`, generate
`SCENARIO_CHECKLIST`, execute scenarios once in browser/API/CLI mode, and write a `SCENARIO_REPORT`.

### `Qqa council [url] [mode]`

Use when the request is a role-separated multi-agent QA loop over a live web app, exploratory QA plus
regression codification, or a PR-triggered QA bot. Load and follow
[`reference/council.md`](reference/council.md).

The council must preserve bounded roles:
- Planner invokes `Qqa plan` or `Qqa run` logic as a skill-backed planning step.
- Explorer is `Eqa-explorer`, browser-only, no source.
- Generator uses `Qplaywright-expert`.
- Healer is `Eqa-orchestrator`.
- Reporter is a mode within `Eqa-orchestrator`.

Never pass a `Q*` skill name as an Agent `subagent_type`; `Q*` entries are skills, `E*` entries are
agents.

## Selection Rules

| User intent | Choose |
|-------------|--------|
| "Create a test plan", "generate test cases", "regression suite", "bug report template" | `Qqa plan` |
| "Run scenarios", "E2E", "acceptance test", "verify this flow once" | `Qqa run` |
| "QA council", "AI QA", "exploratory + regression", "PR QA bot" | `Qqa council` |

## Compatibility

- Keep using the original skills when directly invoked.
- Do not delete or shim `Qqa-test-planner`, `Qscenario-test`, or `Qqa-council` in this phase.
- `Qqa run` is single-pass scenario execution. Long-lived browser QA loops belong to the later Phase
  6 extension.
