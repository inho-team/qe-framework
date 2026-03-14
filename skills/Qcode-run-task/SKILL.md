---
name: Qcode-run-task
description: Performs a test → review → fix → retest quality verification loop after code task completion. Automatically triggered from Qrun-task for type: code tasks.
---
> Shared principles: see core/PRINCIPLES.md


# Code Quality Verification Loop Skill

## Role
An assistant that ensures quality by performing a **test → review → fix → retest** cycle after code implementation is complete.

## Prerequisites
- Step 3 (implementation execution) of `/Qrun-task` is complete
- Task has `type: code` specified in TASK_REQUEST
- TASK_REQUEST and VERIFY_CHECKLIST documents exist

## Workflow Overview

```
Qrun-task Step 3 complete (implementation done)
    ↓
[Qcode-run-task starts]
    ↓
Step 1: Collect context
    ↓
Step 2: Test (Ecode-test-engineer)
    ↓
Step 3: Review (Ecode-reviewer)
    ↓
Step 4: Issues found → Fix (Ecode-debugger) → Return to Step 2
         No issues → Step 5
    ↓
Step 5: Report results
```

## Loop Limit
- **Maximum iterations: 3**
- Use `AskUserQuestion` to confirm continuation at each iteration
- If 3 iterations are exceeded, delegate judgment to the user and report current state

The entire quality loop can be delegated to the `Eqa-orchestrator` sub-agent to save main context tokens. Eqa-orchestrator internally coordinates Ecode-test-engineer and Ecode-reviewer.

## Execution Procedure

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

### Step 2: Test

Delegate tests to the `Ecode-test-engineer` sub-agent via the Agent tool.

**Information to pass on delegation:**
- List of changed files and paths
- "What is wanted" section from TASK_REQUEST (functional goals)
- Validation criteria from VERIFY_CHECKLIST
- Existing test structure and patterns in the project

**Test scope:**
- Write/run unit tests for changed code
- Tests corresponding to VERIFY_CHECKLIST validation criteria
- Run regression tests if existing tests are present

**Collect test results:**
```
## Test Results (Iteration N/3)

- Passed: X
- Failed: Y
- Failed items:
  - [test name] - [failure reason]
```

### Step 3: Review

Delegate code review to the `Ecode-reviewer` sub-agent via the Agent tool.

**Information to pass on delegation:**
- List of changed files and paths
- Notes from TASK_REQUEST (constraints)
- Step 2 test results (including failed items)

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

**Pass criteria:**
- 0 test failures
- 0 review Critical items

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

## Role Constraints
- This skill focuses exclusively on the **test, review, and fix loop**
- Does not add new features or change requirements
- Fix scope is limited to resolving discovered issues
