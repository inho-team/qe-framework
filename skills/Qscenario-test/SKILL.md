---
name: Qscenario-test
description: Generates scenario specs from existing implementations, executes them (browser/API/CLI), and verifies results. Use for scenario testing, E2E scenarios, user flow verification, or acceptance testing.
user_invocable: true
metadata: 
author: inho
version: 1.0.0
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

# Scenario Test Skill

## Role
Generate test scenarios from existing implementations, execute them, and verify results.
This is the **verification stage** after Qrun-task completes — it tests what was built, not builds what was specced.

> **MANDATORY:** All user confirmations MUST use the QE interaction adapter. Claude uses `AskUserQuestion`; Codex uses equivalent concise choices.

## Pipeline Position

```
Qgenerate-spec → Qrun-task → Qscenario-test
  (what to build)   (build it)   (does it actually work?)
```

## What This Skill Borrows (Spirit, Not Function)

| From | Spirit | Applied As |
|------|--------|------------|
| Qgenerate-spec | UUID-based document generation | SCENARIO_SPEC + SCENARIO_CHECKLIST with shared UUID |
| Qrun-task | Spec-driven execution + checklist verification | Execute scenarios step-by-step, check off results |
| Unique to this skill | Scenario execution + evidence collection | Actually run the scenarios via browser/API/CLI |

## 3-Document System

| Document | Path | Role |
|----------|------|------|
| `SCENARIO_SPEC_{UUID}.md` | `.qe/scenarios/specs/` | Scenario definitions (Given-When-Then) |
| `SCENARIO_CHECKLIST_{UUID}.md` | `.qe/scenarios/checklists/` | Pass/fail criteria per scenario |
| `SCENARIO_REPORT_{UUID}.md` | `.qe/scenarios/reports/` | Execution results + evidence |

Same UUID is shared across all 3 documents for one test session.

---

## Execution Modes

| Flag | Behavior |
|------|----------|
| (default) | Generate specs + execute + verify |
| `--dry` | Generate specs only (no execution) |
| `--rerun {UUID}` | Re-execute existing SCENARIO_SPEC |
| `--browser` | Force browser execution mode |
| `--api` | Force API call execution mode |
| `--cli` | Force CLI execution mode |

---

## Workflow

### Step 0: Input Resolution

Determine the test target:

| Input | Source |
|-------|--------|
| TASK_REQUEST UUID | Read the spec, derive scenarios from implementation goals |
| Code path | Analyze source files directly |
| URL | Navigate and analyze the live application |
| Natural language | Parse user description |

For `--rerun {UUID}`: skip to Step 2 using existing SCENARIO_SPEC.

### Step 1: Scenario Generation (Spec Phase)

Analyze the target and generate scenarios across 5 categories:

| Category | Focus | Example |
|----------|-------|---------|
| **Happy Path** | Normal user flow | Login with valid credentials |
| **Edge Case** | Boundary values, special inputs | Empty string, max length, special chars |
| **Error Path** | Error handling verification | Wrong password, network timeout |
| **Security** | Security scenario | XSS input, auth bypass attempt |
| **State Transition** | Multi-step state changes | Order: create > pay > cancel > refund |

**Auto-detect execution mode** from target type:
- UI components / URL → `--browser`
- REST endpoints / API spec → `--api`
- CLI tools / scripts → `--cli`
- Mixed → user chooses

**Generate SCENARIO_SPEC_{UUID}.md:**

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

**Generate SCENARIO_CHECKLIST_{UUID}.md:**

```markdown
# Scenario Checklist — {Target Name}
UUID: {uuid}

- [ ] S-01: {verifiable assertion}
- [ ] S-01: {second assertion if needed}
- [ ] S-02: {verifiable assertion}
```

**Present to user via `AskUserQuestion`:**
- "Execute" — proceed to Step 2
- "Edit" — revise scenarios
- "Save only" — write files, stop (same as `--dry`)

### Step 2: Scenario Execution (Run Phase)

Execute each scenario sequentially. For each scenario:

1. **Set up** Given preconditions
2. **Execute** When actions using the appropriate mode:

| Mode | Tools |
|------|-------|
| `--browser` | Chrome MCP tools (navigate, click, form_input, read_page) |
| `--api` | Bash (curl/httpie) or project HTTP client |
| `--cli` | Bash commands |

3. **Verify** Then assertions against actual results
4. **Collect evidence**: screenshots, response bodies, console logs, exit codes
5. **Mark** SCENARIO_CHECKLIST item as `[x]` (pass) or `[x] FAIL` (fail)

**Progress reporting** after each scenario:
```
S-01 | Happy Path | Login → PASS
S-02 | Error Path | Wrong password → FAIL (no error message shown)
```

**On failure**: record failure details but continue executing remaining scenarios (do not stop).

### Step 3: Verification & Report (Verify Phase)

After all scenarios complete:

1. Review SCENARIO_CHECKLIST — count pass/fail/skip
2. Generate SCENARIO_REPORT_{UUID}.md:

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
- Then: {expected} → Actual: {actual}
- Evidence: {screenshot path / response snippet}

### S-02 | Error Path | {Title} — FAIL
- Given: {what was set up}
- When: {what was done}
- Then: {expected} → Actual: {actual}
- Failure reason: {root cause analysis}
- Evidence: {screenshot path / response snippet}

## Failed Scenarios Summary
| ID | Category | Title | Failure Reason |
|----|----------|-------|----------------|
| S-02 | Error Path | Wrong password | Error message not rendered |
```

3. **Final verdict via `AskUserQuestion`:**
   - All pass → "All scenarios passed. Archive results?"
   - Failures exist → "N scenarios failed. Re-run failed only / File bug report / Accept as-is?"

### Step 4: Re-run or Close

- **Re-run failed**: execute only failed scenarios again (max 2 retries)
- **File bug report**: generate bug report per Qqa-test-planner format
- **Accept**: archive all documents to `.qe/scenarios/archive/`

---

## Qrun-task Integration

When called from Qrun-task pipeline (TASK_REQUEST UUID provided):
- Reads TASK_REQUEST to understand what was implemented
- Derives scenarios from checklist items + implementation goals
- Reports results back — Qrun-task can use pass/fail in its own verification step

When called independently:
- User provides code path, URL, or description
- Full standalone execution

## Autonomous Mode

When `.qe/state/ultra{work,qa}-state.json` is active:
- Skip all `AskUserQuestion` calls
- Auto-execute all scenarios
- Auto-archive on completion

## Role Constraints
- Does NOT write implementation code (use Qrun-task)
- Does NOT generate implementation specs (use Qgenerate-spec)
- Does NOT generate test documentation only (use Qqa-test-planner)
- Does NOT run unit test loops (use Qcode-run-task)
- ONLY generates scenarios, executes them, and reports results
