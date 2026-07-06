# Qqa run — Scenario Test Skill

Behavior preserved from `Qscenario-test`.

## Role

Generate test scenarios from existing implementations, execute them, and verify results. This is the
verification stage after `Qrun-task` completes: it tests what was built, not builds what was specced.

> Mandatory: all user confirmations must use the QE interaction adapter. Claude uses
> `AskUserQuestion`; Codex uses equivalent concise choices.

## Pipeline Position

```text
Qgenerate-spec -> Qrun-task -> Qqa run
  (what to build)   (build it)   (does it actually work?)
```

## What This Subcommand Borrows

| From | Spirit | Applied As |
|------|--------|------------|
| `Qgenerate-spec` | UUID-based document generation | `SCENARIO_SPEC` + `SCENARIO_CHECKLIST` with shared UUID |
| `Qrun-task` | Spec-driven execution + checklist verification | Execute scenarios step-by-step, check off results |
| Unique to this subcommand | Scenario execution + evidence collection | Actually run the scenarios via browser/API/CLI |

## 3-Document System

| Document | Path | Role |
|----------|------|------|
| `SCENARIO_SPEC_{UUID}.md` | `.qe/scenarios/specs/` | Scenario definitions, Given-When-Then |
| `SCENARIO_CHECKLIST_{UUID}.md` | `.qe/scenarios/checklists/` | Pass/fail criteria per scenario |
| `SCENARIO_REPORT_{UUID}.md` | `.qe/scenarios/reports/` | Execution results + evidence |

Same UUID is shared across all 3 documents for one test session.

## Execution Modes

| Flag | Behavior |
|------|----------|
| default | Generate specs + execute + verify |
| `--dry` | Generate specs only, no execution |
| `--rerun {UUID}` | Re-execute existing `SCENARIO_SPEC` |
| `--browser` | Force browser execution mode |
| `--api` | Force API call execution mode |
| `--cli` | Force CLI execution mode |

### Browser mode (Phase 6 — NOW LIVE)

The real-browser QA loop is implemented in `scripts/lib/browser-driver.mjs` and drives Playwright
on demand. Playwright is an **optional dependency**: if it is not installed, browser mode fails fast
with an actionable install hint (`npm i -D playwright && npx playwright install chromium`). Probe
first with `isBrowserAvailable()`.

Driver API and typical order:

```js
import { isBrowserAvailable, launch, collectConsole, screenshot, snapshot, getPageText, close }
  from '<qe>/scripts/lib/browser-driver.mjs';

if (!(await isBrowserAvailable())) { /* recommend installing playwright, fall back to --api/--cli */ }
const session = await launch({ url, headless: true, storageState: 'auth.json' });
const { messages } = collectConsole(session);      // console.log/error captured for the report
await screenshot(session, 'evidence/step-1.png');  // evidence
const text = await getPageText(session);            // assertions
await close(session);
```

- **Session reuse / auth**: pass `storageState` (a Playwright storageState JSON path or object) for
  authenticated sessions (v1: manual capture). For a persistent profile pass `userDataDir`.
- **Regression naming**: browser regression specs are named `qa-regression-<slug>.spec.ts`
  (via `regressionSpecName(slug)`).
- **Web-project detection**: `detectWebProject(cwd)` flags projects with web deps
  (vite/next/nuxt/react-scripts/…) or config files (index.html/vite.config.*/next.config.*) so SIVS
  can **recommend** `Qqa run --browser` (recommendation only — never auto-run).

Live browser verification (real launch/screenshot/console) requires playwright to be installed; see
the Phase 6 Wave 2 deferred checklist.

## Workflow

### Step 0: Input Resolution

Determine the test target:

| Input | Source |
|-------|--------|
| TASK_REQUEST UUID | Read the spec, derive scenarios from implementation goals |
| Code path | Analyze source files directly |
| URL | Navigate and analyze the live application |
| Natural language | Parse user description |

For `--rerun {UUID}`, skip to Step 2 using the existing `SCENARIO_SPEC`.

### Step 1: Scenario Generation (Spec Phase)

Analyze the target and generate scenarios across 5 categories:

| Category | Focus | Example |
|----------|-------|---------|
| Happy Path | Normal user flow | Login with valid credentials |
| Edge Case | Boundary values, special inputs | Empty string, max length, special chars |
| Error Path | Error handling verification | Wrong password, network timeout |
| Security | Security scenario | XSS input, auth bypass attempt |
| State Transition | Multi-step state changes | Order: create > pay > cancel > refund |

Auto-detect execution mode from target type:
- UI components / URL -> `--browser`
- REST endpoints / API spec -> `--api`
- CLI tools / scripts -> `--cli`
- Mixed -> user chooses

Generate `SCENARIO_SPEC_{UUID}.md`:

```markdown
# Scenario Spec — {Target Name}
UUID: {uuid}
Source: {TASK_REQUEST UUID | code path | URL | description}
Mode: {browser | api | cli}

## Prerequisites
- {environment setup, test accounts, server state}

## Scenarios

### S-01 | Happy Path | {Title}
- Given: {precondition}
- When: {action}
- Then: {expected result}

### S-02 | Error Path | {Title}
- Given: {precondition}
- When: {action}
- Then: {expected result}
```

Generate `SCENARIO_CHECKLIST_{UUID}.md`:

```markdown
# Scenario Checklist — {Target Name}
UUID: {uuid}

- [ ] S-01: {verifiable assertion}
- [ ] S-01: {second assertion if needed}
- [ ] S-02: {verifiable assertion}
```

Present to the user via `AskUserQuestion` or Codex equivalent:
- Execute: proceed to Step 2
- Edit: revise scenarios
- Save only: write files and stop, same as `--dry`

### Step 2: Scenario Execution (Run Phase)

Execute each scenario sequentially. For each scenario:

1. Set up Given preconditions.
2. Execute When actions using the appropriate mode.
3. Verify Then assertions against actual results.
4. Collect evidence: screenshots, response bodies, console logs, exit codes.
5. Mark `SCENARIO_CHECKLIST` item as `[x]` pass or `[x] FAIL` fail.

| Mode | Tools |
|------|-------|
| `--browser` | Chrome MCP tools, browser plugin, or equivalent browser automation |
| `--api` | Bash with curl/httpie or project HTTP client |
| `--cli` | Bash commands |

Progress reporting after each scenario:

```text
S-01 | Happy Path | Login -> PASS
S-02 | Error Path | Wrong password -> FAIL (no error message shown)
```

On failure, record failure details but continue executing remaining scenarios.

### Step 3: Verification & Report (Verify Phase)

After all scenarios complete:

1. Review `SCENARIO_CHECKLIST`; count pass/fail/skip.
2. Generate `SCENARIO_REPORT_{UUID}.md`.
3. Ask for final disposition.

Report format:

```markdown
# Scenario Report — {Target Name}
UUID: {uuid}
Date: {date}
Source: {origin}

## Summary
- Total: {N} scenarios ({M} assertions)
- Pass: {X} | Fail: {Y} | Skip: {Z}

## Results

### S-01 | Happy Path | {Title} — PASS
- Given: {what was set up}
- When: {what was done}
- Then: {expected} -> Actual: {actual}
- Evidence: {screenshot path / response snippet}

### S-02 | Error Path | {Title} — FAIL
- Given: {what was set up}
- When: {what was done}
- Then: {expected} -> Actual: {actual}
- Failure reason: {root cause analysis}
- Evidence: {screenshot path / response snippet}

## Failed Scenarios Summary
| ID | Category | Title | Failure Reason |
|----|----------|-------|----------------|
| S-02 | Error Path | Wrong password | Error message not rendered |
```

Final verdict:
- All pass -> "All scenarios passed. Archive results?"
- Failures exist -> "N scenarios failed. Re-run failed only / File bug report / Accept as-is?"

### Step 4: Re-run or Close

- Re-run failed: execute only failed scenarios again, max 2 retries.
- File bug report: generate bug report per `Qqa plan` bug report format.
- Accept: archive all documents to `.qe/scenarios/archive/`.

## Qrun-task Integration

When called from the `Qrun-task` pipeline with a TASK_REQUEST UUID:
- Read TASK_REQUEST to understand what was implemented.
- Derive scenarios from checklist items and implementation goals.
- Report results back so `Qrun-task` can use pass/fail in verification.

When called independently:
- User provides code path, URL, or description.
- Run full standalone execution.

## Autonomous Mode

When `.qe/state/ultra{work,qa}-state.json` is active:
- Skip all `AskUserQuestion` calls.
- Auto-execute all scenarios.
- Auto-archive on completion.

## Role Constraints

- Does not write implementation code; use `Qrun-task`.
- Does not generate implementation specs; use `Qgenerate-spec`.
- Does not generate test documentation only; use `Qqa plan`.
- Does not run unit test loops; use `Qcode-run-task`.
- Only generates scenarios, executes them, and reports results.
