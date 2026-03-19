---
name: Qrun-task
description: "Executes spec-based tasks from TASK_REQUEST and VERIFY_CHECKLIST documents. Use for run task, 태스크 실행, implement this spec, start working on UUID, or execute checklist. Reads spec → summarizes → implements → verifies."
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Task Execution Skill

## Role
Execute tasks and complete verification based on spec documents from `/Qgenerate-spec`.

## Workflow
```
/Qgenerate-spec → /Qrun-task → Read → Summarize → Approve → Execute → Verify → [Supervise] → ✅ Done
```

## Directory Structure
```
.qe/tasks/{pending,in-progress,completed,on-hold}/TASK_REQUEST_*.md
.qe/checklists/{pending,in-progress,completed,on-hold}/VERIFY_CHECKLIST_*.md
.qe/tasks/remediation/REMEDIATION_REQUEST_*.md
```

## Delegation Rule
When checklist has **5+ items**, delegate to `Etask-executor` agent. Main agent tracks progress, state transitions, and verification. After delegation, update timestamps: `- [x] item ✅ (HH:MM)`.

---

## Step 1: Document Discovery

1. Read `CLAUDE.md` for context
2. Glob `.qe/tasks/{pending,in-progress,on-hold}/*.md` for TASK_REQUEST files
3. Backward compat: check project root if `.qe/tasks/` missing
4. Multiple tasks → ask which to run. UUID argument → select directly
5. Multiple UUIDs (space-separated) → sequential execution queue

## Step 2: Summary and Approval

Read TASK_REQUEST + VERIFY_CHECKLIST, show summary:

| `type:` | Banner |
|---------|--------|
| `code` | `⚠️ TYPE: CODE — will CREATE or MODIFY source code` |
| `docs` | `📄 TYPE: DOCS — will CREATE or MODIFY documentation` |
| `analysis` | `🔍 TYPE: ANALYSIS — read-only analysis` |
| `other` | `🔧 TYPE: OTHER` |
| unset | `❓ TYPE: UNSET — review carefully` |

```
[Banner]
## Task Summary: [Name]
**What:** [1-2 sentences]  **How:** [core method]
**Steps** (N items): [list]  **Validation** (M items): [list]
```

Use `AskUserQuestion` for approval. On approve → move files to `in-progress/`, set CLAUDE.md to 🔶.

## Step 3: Execute

Execute checklist items in order. Report: `✅ [1/N] desc - done`. Record `- [x] item ✅ (HH:MM)`.

**Code task**: After Step 3, ask whether to run `/Qcode-run-task` quality loop.

**Intermediate verification**: Every 3 items (or per `<!-- verify-interval: N -->`), check relevant VERIFY_CHECKLIST items. Fix failures before continuing.

## Step 4: Final Verification

Verify all VERIFY_CHECKLIST items. Show pass/fail results. All pass → Step 4.5. Failures → fix and re-verify.

## Step 4.5: Supervision Gate

### Complexity-Based Model Routing

Before invoking supervision, assess task complexity to route the appropriate model:

| Signal | Model |
|--------|-------|
| Checklist ≤ 3 items AND no security-sensitive files | haiku |
| Checklist 4-7 items OR docs/analysis type | haiku (default for supervisors) |
| Checklist 8+ items OR `type: code` with auth/crypto/payment changes | sonnet |
| Architecture-level changes OR cross-cutting concerns | opus |

Pass the recommended model as the `model` parameter when spawning supervisor agents.

### Skip Conditions (Fast Path)

Skip supervision and go to Step 5 if **any** of these are true:
- TASK_REQUEST has `<!-- skip-supervision -->` comment
- `type: docs` or `type: analysis` with **fewer than 5 items**
- `type: other` with **fewer than 3 items**
- Checklist has **only 1 item** (regardless of type, except `type: code` with security-sensitive files)
- All changes are **documentation-only** (only `.md` files changed)

> `type: code` with security-sensitive files (auth, crypto, secrets, payments) is **never auto-skipped**.

### Context Memoization

To avoid redundant context loading in supervision loops:

1. **Before first supervision call**: Build a `supervision_context` summary:
   - Task UUID, name, type
   - Checklist items (numbered, one line each)
   - Changed files list
   - Key constraints from CLAUDE.md (3-5 bullet points max)
   - Verification results summary (pass/fail counts)

2. **Pass `supervision_context` as the prompt** to supervisor agents — do NOT tell them to re-read TASK_REQUEST/VERIFY_CHECKLIST files themselves.

3. **On remediation loop-back**: Update only the changed portions (new files changed, updated verification results). Reuse the rest.

This reduces per-supervision token cost from ~40KB to ~5-8KB.

### Routing

| Task Type | Supervisor(s) |
|-----------|--------------|
| `code` | `Ecode-quality-supervisor` + `Esecurity-officer` |
| `docs` | `Edocs-supervisor` |
| `analysis` | `Eanalysis-supervisor` |
| `other`/unset | `Esupervision-orchestrator` |

### Verdicts

- **PASS** → record in TASK_REQUEST, go to Step 5
- **PARTIAL** → record notes, go to Step 5 (non-blocking)
- **FAIL** → auto-remediate (no user confirmation needed)

### Supervision Loop

Track `supervision_iteration` (max 3). Write `<!-- supervision_iteration: N -->` in TASK_REQUEST for session persistence.

On FAIL:
1. Create `REMEDIATION_REQUEST_{UUID}_{iteration}.md` in `.qe/tasks/remediation/`
2. Delegate to `Etask-executor` with remediation content
3. Loop back to Step 3 (affected items only) → Step 4 → Step 4.5
4. After 3 iterations: escalate to user with Override/Abort/Continue options

## Step 5: Completion

1. Mark all items `[x]` in TASK_REQUEST and VERIFY_CHECKLIST
2. Move files to `completed/`
3. Update CLAUDE.md to ✅
4. `type: code` → call `Ecode-doc-writer`; `type: docs` → call `Edoc-generator`
5. Auto-run `/Qarchive` in background

Report: UUID, items completed, verification passed, changed files.

---

## Special Situations

| Situation | Action |
|-----------|--------|
| No documents | Suggest `/Qgenerate-spec` |
| Task interrupted | Save progress with timestamps, leave in `in-progress/` |
| On hold | Move to `on-hold/`, set ⏸️ |
| Resume | Move to `in-progress/`, continue from last unchecked item |
| Etask-executor crash | Offer Resume/Retry/Abort |
| No CLAUDE.md | Proceed without context, notify user |

## Multiple UUID Execution

Execute sequentially: each task runs Steps 2-5 independently. On failure: ask skip or stop.

## Autonomous Mode (Ultra)

When `.qe/state/ultra{work,qa}-state.json` is active:
- Skip Step 2 approval
- Auto-proceed on judgments
- `--ultraqa`: auto-run code quality loop
- Supervision still runs (autonomous, no user prompts)
- Multiple UUIDs: parallel Etask-executor agents, sequential supervision

## Coding Expert References

Reference `skills/coding-experts/` for language/framework best practices. Catalog: `skills/coding-experts/CATALOG.md`.

## Role Constraints
- Only executes existing spec documents
- Use `/Qgenerate-spec` to create specs
- Do not modify spec content (except checking off items)
