---
name: Qutopia
description: Utopia mode — fully autonomous execution. Skips all confirmations and auto-allows tool permissions. Use when the user wants fully autonomous, no-confirmation execution.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep
invocation_trigger: When the user wants fully autonomous, no-confirmation execution mode.
recommendedModel: haiku
---

# Qutopia — Fully Autonomous Execution

## Modes

| Command | Behavior |
|---------|----------|
| `/Qutopia` | Auto mode — classify simple/complex, auto-select work or qa |
| `/Qutopia --work` | Force work mode (spec pipeline, no quality loop) |
| `/Qutopia --qa` | Force qa mode (spec pipeline + quality loop) |
| `/Qutopia --ralph` | Ralph loop — auto-repeat PSE Chain until VERIFY_CHECKLIST is fully complete |
| `/Qutopia --ralph off` | Stop Ralph loop (manual interrupt) |
| `/Qutopia off` | Disable autonomous mode |
| `/Qutopia status` | Show current state |

## What It Does

### 1. Skip Confirmations
Creates `.qe/state/utopia-state.json`:
```json
{
  "enabled": true,
  "mode": "auto|work|qa",
  "activatedAt": "2026-03-20T00:00:00Z"
}
```

When `enabled: true`, ALL skills/agents:
- Skip `AskUserQuestion` — auto-select first (recommended) option
- Auto-approve in Qrun-task, auto-generate in Qgenerate-spec
- Auto-commit via Qcommit after task completion

### 2. Auto-allow Tool Permissions
Merge into `.claude/settings.json`:
```json
{
  "permissions": {
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep",
      "Bash(*)", "Agent(*)", "WebFetch", "WebSearch", "NotebookEdit"
    ]
  }
}
```

### 3. Request Routing

#### Default mode (`/Qutopia`, no flag)

```
Request → Classify complexity → SIMPLE → Execute directly
                              → COMPLEX → Auto-select mode → Spec pipeline
```

### SIMPLE Classification (Single Source of Truth)

A task is classified as SIMPLE when ALL of the following are true:
- Target files ≤ 3
- Single action (one logical operation)
- No architecture decisions required
- Checklist items < 3

SIMPLE tasks execute directly without a formal TASK_REQUEST document.
This is an intentional trade-off for micro-task velocity.
Other documents (PRINCIPLES.md, Qgenerate-spec) reference this definition — do not duplicate.

**COMPLEX** (ANY true): target files > 3, new feature, architecture decisions, checklist items ≥ 3 → enter spec pipeline

**Auto mode selection for COMPLEX requests:**

| Signal | Mode | Reason |
|--------|------|--------|
| `type: code` + has tests (test files exist in project) | **qa** | If test infrastructure exists, leverage quality loop |
| `type: code` + auth/crypto/payment keywords | **qa** | Security-sensitive code requires quality validation |
| `type: code` + no tests | **work** | Quality loop pointless if tests don't exist |
| `type: docs` / `type: analysis` / `type: other` | **work** | Quality loop unnecessary |

Output: `[Utopia] COMPLEX → {mode} mode (reason)`

#### `--work` mode

```
Request → Gate → Qgenerate-spec → Qrun-task → Verify ─┐
                                                        ├→ Pass → Done
                                                        └→ Fail → Diagnose → Re-execute → Verify (retry loop)
```

- State file: `"mode": "work"`, max reinforcements: 50
- Multiple tasks: spawn `Etask-executor` agents in parallel
- Single task: invoke `/Qrun-task {UUID}` in autonomous mode

#### `--qa` mode

```
Request → Gate → Qgenerate-spec → Qrun-task → Qcode-run-task → Verify ─┐
                                                                         ├→ Pass → Done
                                                                         └→ Fail → Diagnose → Re-execute → Verify (retry loop)
```

- State file: `"mode": "qa"`, max reinforcements: 80
- After each task completes:
  - Code tasks: `/Qcode-run-task` (test → review → fix → retest, max 3 cycles)
  - **All tasks: VERIFY_CHECKLIST item-by-item verification is MANDATORY** — each item must be verified with a concrete action (file check, grep, build, test). "Build passed" alone does NOT satisfy verification. This step CANNOT be skipped in --qa mode.
  - Code + security keywords (auth/crypto/payment/JWT/password/secret/token/credential/bcrypt): auto-invoke `Esecurity-officer` before marking verification complete
- Cross-task audit (after ALL tasks complete): see below
- Output QA report (per-task results, overall score)

#### `--ralph` mode (autonomous loop)

Extends `--work` / `--qa` with a **session-level repeat loop**: the Stop hook detects incomplete VERIFY_CHECKLIST items and automatically re-injects the next item until all items are marked `[x]`.

```
Request → Gate → Qgenerate-spec → Qrun-task → Verify ──┐
                                                         │
        ┌────────────────────────────────────────────────┘
        │  (Stop hook detects remaining [ ] items)
        ↓
   Re-inject next item → Qrun-task → Verify ──┐
                                                │
        ┌───────────────────────────────────────┘
        │  (all items [x])
        ↓
     Generate report → Done
```

State file: `.qe/state/ralph-state.json` — persists across stop events.

**Auto mode selection:** `--ralph` auto-picks `work` or `qa` using the same rules as default mode (test presence + security keywords).

**Safety limits:**

| Limit | Default | Behavior |
|-------|---------|----------|
| `maxLoops` | 50 | Hard stop when exceeded |
| `maxPerHour` | 100 | Rate limit per wall-clock hour |
| `maxConsecutiveFailures` | 3 | Circuit breaker — same item failing N times → skip + log |
| Stale guard | 30 min | Auto-expire via persistent-mode stale guard |

**Context pressure handling:**
When `tool_calls > 200` in a single loop iteration, the loop automatically:
1. Invokes `/Qcompact` to compress context
2. Resumes from the next remaining item with the preserved ralph-state

**Progress output** (every loop cycle):
```
[Ralph] 7/12 done (58%) — Loop #4
```

**Final report** (on completion): `.qe/state/ralph-report.json` with total loops, duration, skipped/failed counts.

**Mutual exclusion:** `--ralph` is **mutually exclusive** with `--work` and `--qa` flags. Internally it selects one of them automatically. Specifying `--ralph --work` is an error.

**Manual interrupt:** `/Qutopia --ralph off` clears ralph-state and exits persistent mode immediately.

### Retry Loop (both work and qa)

Automatically diagnose and re-execute on verification failure. Repeats until success with safety limits.

```
Verify failed
  → Step 1: Diagnose — analyze failed items, categorize root causes
  → Step 2: Strategy — determine response per cause
  → Step 3: Re-execute — re-run failed items only
  → Step 4: Re-verify — verify again
  → Pass? → Done
  → Fail? → retry_count < max? → return to Step 1
                                → max reached → Escalate
```

#### Diagnosis (Step 1)

Analyze failed VERIFY_CHECKLIST items and categorize root causes:

| Root Cause | Response | Example |
|------------|----------|---------|
| **Implementation gap** | Re-run the checklist item | File not created, function unimplemented |
| **Implementation error** | Use Ecode-debugger to diagnose, then fix | Test failure, runtime error |
| **Spec conflict** | Revise checklist item, then re-run | Conflicting requirements |
| **Environment issue** | Fix environment, then re-run | Missing dependency, permission denied |

#### Retry Limits

| Mode | Max Retries | Max Total Time | Escalation |
|------|-------------|----------------|------------|
| work | 3 | — | Report failure to user + choices (Retry/Abort/Override) |
| qa | 5 | — | Report failure to user + QA report |

#### Retry State Tracking

Record retry state in `.qe/state/utopia-state.json`:
```json
{
  "retry": {
    "count": 2,
    "failed_items": ["VERIFY item 3", "VERIFY item 5"],
    "last_diagnosis": "implementation error — test assertion mismatch",
    "history": [
      {"attempt": 1, "failed": 3, "fixed": 1},
      {"attempt": 2, "failed": 2, "fixed": 1}
    ]
  }
}
```

#### Approach Escalation

If the same item fails twice consecutively, change approach:
- 1st attempt: retry with same method
- 2nd attempt: use Ecode-debugger to analyze root cause, try different approach
- 3rd attempt (work) / 5th attempt (qa): escalate to user

Output per retry:
```
[Utopia] Retry #{n} — {failed_count} items failed → diagnosis: {cause}
[Utopia] Re-executing: {item list}
```

### Pre-execution Gate

Before entering spec pipeline (--work/--qa or COMPLEX routing), check prompt specificity:

| Signal | Example |
|--------|---------|
| File path | `.ts`, `src/` |
| Function/class name | camelCase, PascalCase |
| Issue/PR number | `#N`, `PR N` |
| Error reference | `TypeError` |
| Code block | Triple backticks |
| Numbered steps | `1. ... 2. ...` |

**Decision:**
- Anchor found or word count > 20 → proceed
- No anchor + ≤ 20 words → redirect to Qgenerate-spec Step 1 for scoping
- `force:` or `!` prefix → bypass gate

### Cross-task Audit (--qa only)

After ALL tasks in a session complete, run cross-task consistency check:

1. Read all completed VERIFY_CHECKLISTs from current session
2. Check for:
   - **File conflicts**: multiple tasks modified the same file — verify final state is consistent
   - **Translation gaps**: if any task added UI strings, verify ko.ts/en.ts coverage
   - **Style drift**: if any task modified CSS/styles, verify design token consistency
3. Report findings in QA report. FAIL items → fix before final completion.

## Common Rules (all modes)
- **Skill priority**: Even in autonomous mode, if a registered skill covers the action (e.g., Mcreate-skill for skill creation, Qcommit for git commit, Mcreate-agent for agent creation), invoke the skill instead of raw tool calls. QE_CONVENTIONS.md override map always applies.
- **State management**: create before execution, clear after completion
- **Reinforcement**: stop signals blocked up to max_reinforcements
- **Parallel execution**: multiple Etask-executor agents concurrently
- **Error handling**: log failure, skip to next task, report all at end
- **No intermediate user prompts** after activation
- **Progress output**: periodic reports (e.g., "3/7 tasks complete")
- **Ralph loop**: When `--ralph` is active, the Stop hook blocks premature termination until VERIFY_CHECKLIST is fully complete. See `--ralph` mode section for safety limits.

## Execution Procedure

### Enable
1. Create `.qe/state/utopia-state.json` with mode
2. Read `.claude/settings.json` (create if not exists)
3. Merge `permissions.allow` (preserve existing)
4. Report: `Utopia mode ON ({mode}) — autonomous pipeline active`

### Disable (`/Qutopia off`)
1. Update state file: `enabled: false`
2. Remove `permissions.allow` from settings
3. Report: `Utopia mode OFF — confirmations restored`

## Safety
- Does NOT skip destructive git operations (force push, reset --hard)
- Does NOT skip file deletion outside .qe/
- Spec pipeline creates audit trail even in autonomous mode
- User can always `/Qutopia off`

## How Skills Check Utopia Mode
```
Read .qe/state/utopia-state.json
If enabled: true → skip AskUserQuestion, auto-select first option
If enabled: false or missing → normal behavior
```
