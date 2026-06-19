---
name: Qcode-run-task
description: "Post-implementation quality loop — runs the test → review → fix → retest cycle on code that was just modified, delegating to Eqa-orchestrator by default. Branch points: use THIS after code changes are already on disk and need verification (test failures, type errors, lint hits, coverage gaps); use Qrun-task to EXECUTE a spec/checklist from scratch (this skill runs automatically at the end of its code items); use Qatomic-run for parallel Haiku-wave execution of independent atomic items. Triggered automatically for type:code tasks."
invocation_trigger: When code has been modified and needs a quality loop (test-review-fix).
recommendedModel: haiku
tier: core
---


# Code Quality Verification Loop Skill

## When to Use
- **Use this skill** when: you need to understand or configure the quality verification loop process (test -> review -> fix -> retest cycle definition and procedure)
- **Default execution**: The quality loop is delegated to `Eqa-orchestrator` by default to save main context tokens. The manual step-by-step mode below is for reference and opt-in use only.

## Role
An assistant that ensures quality by performing a **test → review → fix → retest** cycle after code implementation is complete.

> **MANDATORY:** All user confirmations (iteration continue, fix/complete/stop, loop limit) MUST use the `AskUserQuestion` tool. Do NOT output options as plain text — always call the tool.

## Prerequisites
- Step 3 (implementation execution) of `/Qrun-task` is complete
- Task has `type: code` specified in TASK_REQUEST
- TASK_REQUEST and VERIFY_CHECKLIST documents exist

In the primary `Qplan` chain, `/Qcode-run-task` is the verification stage that follows `/Qatomic-run`.

## Workflow Overview

```
Qrun-task Step 3 complete (implementation done)
    ↓
[Qcode-run-task starts]
    ↓
Step 1: Collect context
    ↓
Step 2+3: Test + Review (parallel)
    ├── Ecode-test-engineer (test)
    └── Ecode-reviewer (review)
    ↓
Step 4: Issues found → Fix (Ecode-debugger) → Return to Step 2+3
         No issues → Step 5
    ↓
Step 5: Report results
```

## Loop Limit
- **Maximum iterations: 3**
- Use `AskUserQuestion` to confirm continuation at each iteration
- If 3 iterations are exceeded, delegate judgment to the user and report current state

## Default Execution: Eqa-orchestrator Delegation

**By default, delegate the entire quality loop to the `Eqa-orchestrator` sub-agent via Agent tool.** This is the recommended approach because:
- Saves main context tokens (only final summary returns)
- Eqa-orchestrator internally coordinates Ecode-test-engineer, Ecode-reviewer, and Ecode-debugger
- Supports automatic escalation from MEDIUM to HIGH tier on repeated failures

**Information to pass on delegation:**
- List of changed files (from `git diff --name-only`)
- TASK_REQUEST content (functional goals, constraints)
- VERIFY_CHECKLIST content (validation criteria)
- Project test structure and patterns

**After Eqa-orchestrator returns**, proceed directly to Step 5 (Report Results) using the returned summary.

## Manual Execution Procedure (Opt-in)

### Step 1: Collect Context

Identify changed code and related documents.

1. Read TASK_REQUEST_{UUID}.md to confirm task goals and checklist
2. Read VERIFY_CHECKLIST_{UUID}.md to confirm validation criteria
3. Collect the list of files changed/created during the implementation step
   - Use `git diff --name-only` to check changed files
   - If no changed files, ask the user for target files

**Context summary output:**
```
## Quality Verification Targets

**Task:** [Task name] (UUID)
**Changed files:** N files
- [file list]
**Validation criteria:** M items (see VERIFY_CHECKLIST)
```

### Step 2+3: Test + Review (parallel)

Spawn **both agents in parallel** using a single message with two Agent tool calls:

**Agent 1 — Ecode-test-engineer:**
- List of changed files and paths
- "What is wanted" section from TASK_REQUEST (functional goals)
- Validation criteria from VERIFY_CHECKLIST
- Existing test structure and patterns in the project
- Scope: unit tests, VERIFY_CHECKLIST criteria tests, regression tests

**Agent 2 — Ecode-reviewer:**
- List of changed files and paths
- Notes from TASK_REQUEST (constraints)

**Collect results from both** before proceeding to Step 4:

**Collect review results:**
```
## Review Results (Iteration N/3)

### Critical (must fix)
- [file:line] description

### Warning (recommended fix)
- [file:line] description

### Suggestion (improvement proposal)
- [file:line] description
```

### Step 4: Judgment and Fix
Assess based on combined test and review results.

### Step 4.5: Phase Goal Alignment (QE Verifier Logic)
... (omitted) ...

### Step 4.6: Regression Gate
... (omitted) ...

### Step 4.8: Cross-Phase Regression Gate
Before declaring the Phase complete, verify prior phases have not regressed:
1. Resolve the active plan (session binding → `.qe/planning/ACTIVE_PLAN` → flat fallback) and read `.qe/planning/plans/{slug}/ROADMAP.md` (or flat `.qe/planning/ROADMAP.md` for legacy projects) to identify completed phases
2. For each completed phase, re-verify key items from its VERIFY_CHECKLIST (in `.qe/checklists/completed/`)
3. Focus on: file existence, test suite passes, build success
4. If regression found, report and block completion until fixed
5. Implementation: `hooks/scripts/lib/regression-gate.mjs` provides `buildRegressionPlan()`, `checkPriorPhaseTests()`, `formatRegressionReport()`

**Skip conditions:**
- Phase 1 (no prior phases to regress)
- Non-code tasks (`type: docs` or `type: analysis`)

### Step 4.85: Smoke Test Gate
After all review/regression gates pass, verify that the code changes actually work in the real system — not just that they compile or pass self-review.

**Why this gate exists**: Self-referential verification (Claude reviewing Claude's code) suffers from self-preferential bias. Code that looks correct to review may fail when actually executed. This gate requires external ground truth.

**Procedure:**

1. For each changed `.mjs` file, run: `node -c {file}` (syntax check) AND `echo '{}' | node {file}` (execution test for hooks)
2. For changed JSON files (plugin.json, schema), run: `node -e 'JSON.parse(require("fs").readFileSync("{file}","utf8"))'`
3. For new modules with exports, run: `node -e 'import("./{file}").then(m => console.log(Object.keys(m)))'`
4. For plugin changes, verify: `claude plugin install` would accept the manifest (check against known valid fields)
5. For hook changes, test with sample input: `echo '{"cwd":"/tmp"}' | node hooks/scripts/{handler}.mjs`

**Failure handling:**
- Any execution error → treat as Step 4 failure, enter fix loop
- Syntax errors → Critical, must fix before proceeding
- Runtime errors on sample input → Warning, investigate before proceeding

**Skip conditions:**
- `type: docs` or `type: analysis` tasks
- Changes to `.md` files only (no executable code)

### Step 4.7: Nyquist Audit (Gap Discovery)
Even if tests pass, perform a **Coverage Gap Audit**:
1. Review implementation vs. Requirements.
2. **Identify**: Are there any "Ghost Requirements" (implied but not tested)?
3. **Audit**: Do the tests cover edge cases (null inputs, network timeouts, etc.)?
4. If gaps are found, add them to the **Decimal Phase** list for the next iteration.

**Pass criteria:**
- 0 test failures (Current + Prior phases)
- 0 review Critical items
- 100% Alignment with Phase Goal and Requirements

**On pass:** → Proceed to Step 5

**On failure:**

1. Report discovered issues to the user
2. Confirm with `AskUserQuestion`:
   - "Fix and re-verify" → proceed with fix
   - "Complete as-is" → proceed to Step 5 (Warning/Suggestion can be ignored)
   - "Stop" → report current state and exit

3. If a fix is needed:
   - Delegate the fix to the `Ecode-debugger` sub-agent via Agent tool
   - Pass on delegation: test failure details + review Critical items + related code
   - After fix is complete, **return to Step 2 (test)** → loop counter +1

4. **When loop counter reaches 3:**
   ```
   ## Loop Limit Reached (3/3)

   Issues not yet resolved:
   - [remaining issue list]

   User judgment is required.
   ```
   - Confirm with `AskUserQuestion`: "Additional attempt" / "Complete as-is" / "Manual fix"

### Step 4.8: Comment Coverage Gate
After test+review, verify documentation coverage of changed code:
1. Run `checkComments()` from `hooks/scripts/lib/comment-checker.mjs` on all changed files
2. Report format: "Comment coverage: {documented}/{total} ({coverage}%)"
3. **Threshold: 80% minimum** for public functions, classes, and exported symbols
4. **Below 80%**: Warn and list undocumented items (optional fix)
5. **Below 50%**: Flag as FAIL in verification (blocks completion)

**Skip conditions:**
- Type: `docs` or `analysis` tasks
- Test-only files or internal utilities marked with `@internal` JSDoc

**On failure (below 50%):**
- Report uncovered items to the user
- Delegate documentation fix to `Ecode-debugger` with coverage report
- After fix, re-run comment checker and return to verification
- If coverage reaches 80%+, proceed to Step 5

### Step 4.86: Native Verification Alternatives

Before running the self-referential QA loop, consider these Claude Code native alternatives that eliminate self-preferential bias:

**Option A — `/goal` (Recommended for bias-free verification)**
Set a completion condition evaluated by a separate lightweight model:
```
/goal all tests pass and no lint errors, or stop after 10 turns
```
The `/goal` evaluator is a different model from the one doing the work, which breaks the self-preferential bias that caused the 27-hook incident. See [/goal docs](https://code.claude.com/docs/en/goal).

**Option B — `claude ultrareview` (External code review)**
Run a cloud-hosted multi-agent code review:
```bash
claude ultrareview --timeout 10
```
This is an external review service, not self-review. Use when the changes are substantial enough to warrant independent verification.

**When to use native vs PSE verification:**
- Simple code changes (≤3 files): PSE Qcode-run-task is sufficient
- Complex changes with external dependencies: Use `/goal` with measurable condition
- Large refactors or PR-ready code: Use `ultrareview` for independent review

### Step 4.9: Adversarial Gate

After all verification passes (Steps 4–4.8), run the **mandatory Verify gate** —
an adversarial stress-test before final completion. This is the SIVS Verify-stage
self-reference defense; full protocol:
`skills/Qcritical-review/reference/verify-gate-protocol.md`.

**Applies to `type:code` AND `type:other`** (R3 — always mandatory; no `≤ N items`
skip). **Skip only** `type: docs`/`analysis`. Any missing/unrecognized type is
normalized to gate-running (never silently bypassed). In Utopia `--work` the gate
still runs for code/other (the `--work` skip applies only to docs/analysis) and
runs non-interactively; `--qa` is mandatory as before.

**Procedure:**

1. Invoke `/Qcritical-review --stage verify` with:
   - Changed files list (from Step 1)
   - TASK_REQUEST goals and constraints
   - VERIFY_CHECKLIST validation criteria
2. Qcritical-review spawns the three Verify-stage agents (Critical mode) —
   **Devil's Advocate** (cross-model when codex reachable), **Security Auditor**,
   **Performance Skeptic** — that stress-test:
   - Unhandled edge cases in the implementation
   - Assumptions that were never validated
   - Security implications of the changes
   - Regression risks for adjacent functionality
3. Results feed back into judgment (FAIL routes **backward**, not a dead-end —
   DECISION_LOG D014/D015):

| Verdict | Action |
|---------|--------|
| **PASS** | Proceed to Step 5 (Report) |
| **WARN** | Interactive: ask user "Fix and re-verify" / "Accept warnings" / "Stop". Non-interactive (Utopia `--work`): auto-accept + log. |
| **FAIL** | **Backward routing.** Per-finding `root_cause_stage`: `spec` → regenerate the spec (Spec gate) and restart; otherwise → **Implement** (fix loop via Ecode-debugger, return to Step 2). Unclear cause → nearest-first (Implement). Honors the 3-round Loop Limit; after 3 rounds still FAIL → escalate to user (Utopia `--work`: leave `needs-attention` with a blocking marker, never silent auto-proceed). |

**Output:**
```
[Adversarial Gate] PASS — no critical issues found
```
or
```
[Adversarial Gate] WARN — 2 edge cases identified:
- {issue 1}
- {issue 2}
```

### Step 4.10: Contract Conformance Gate

After the adversarial gate passes (Step 4.9), run contract conformance verification for any business-logic contracts stored under `.qe/contracts/active/`. This gate protects user-defined business logic from "vibe coding" drift by comparing each contract against its implementation and tests via LLM judge.

**Skip conditions (fast path):**
- No `.qe/contracts/active/*.md` files exist → skip entirely.
- `type: docs` / `type: analysis` tasks (no code to verify).

**Procedure:**

1. Invoke `/Qverify-contract --all` (see `skills/Qverify-contract/SKILL.md`).
2. The skill lists active contracts, computes 3-hash cache keys, returns cached verdicts on hit, or invokes the `Econtract-judge` agent on miss.
3. Collect aggregated output: `N PASS, M FAIL`.
4. Results feed back into judgment:

| Verdict | Action |
|---------|--------|
| **ALL PASS** | Proceed to Step 5 (Report) |
| **Any FAIL** | Treat as Step 4 failure — show findings to user via `AskUserQuestion`: "Fix contract drift" / "Accept as-is (accept FAIL)" / "Stop". On "Fix", delegate to `Ecode-debugger` with the failing contract findings and return to Step 2 (loop counter +1). |

**Output example:**
```
[Contract Gate] PASS — 7/7 contracts honored by implementation
```
or
```
[Contract Gate] FAIL — 2 contracts have drift:
  - sivs-enforcer: Implementation does not handle SIVS_BLOCK_REASON as stated in contract (critical)
  - user-service: Missing DuplicateEmailError handling (critical)
```

**Why this gate exists**: Tests verify BEHAVIOR; contracts verify INTENT. A passing test can still silently drift from the contract's declared invariants after an AI refactor. This gate catches that class of regression. (See `docs/contract-layer.md`.)

### Step 5: Report Results

Summarize and report final results.

```markdown
## Quality Verification Complete: [Task Name]

**UUID:** {UUID}
**Iterations:** N/3
**Final status:** Pass / Partial pass (user approved)

### Test Results
- Passed: X / Failed: Y

### Review Results
- Critical: 0 / Warning: N / Suggestion: M

### Fix History
| Iteration | Issue Found | Fix Applied |
|-----------|-------------|-------------|
| 1         | [issue]     | [fix]       |
| 2         | [issue]     | [fix]       |

### Changed Files (final)
- [file list]
```

## Qrun-task Integration

This skill can be called independently as `/Qcode-run-task`, or it can be automatically triggered from Qrun-task.

### Independent Call
```
/Qcode-run-task {UUID}
```
- References TASK_REQUEST and VERIFY_CHECKLIST for the given UUID
- Changed files are auto-detected via git diff

### Triggered from Qrun-task
- Automatically entered after Qrun-task Step 3 is complete when `type: code`
- Uses the changed file list already collected by Qrun-task
- Returns to Qrun-task Step 4 (final verification) after quality verification is complete

## Coding Expert References

During quality verification, reference expert skills matching the project's tech stack:
- `coding-experts/languages/` — Language-specific coding standards
- `coding-experts/quality/` — Testing/security/review guidelines
- Full catalog: `skills/coding-experts/CATALOG.md`

## Role Constraints
- This skill focuses exclusively on the **test, review, and fix loop**
- Does not add new features or change requirements
- Fix scope is limited to resolving discovered issues
