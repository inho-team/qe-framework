---
name: Qrun-task
description: "Executes spec-based tasks from TASK_REQUEST and VERIFY_CHECKLIST documents. Use when running a task, implementing a spec, starting work on a UUID, or executing a checklist. Reads spec, summarizes, implements, and verifies. Korean: '작업 실행', '체크리스트', '태스크 실행'. Chinese: '执行任务', '检查清单'. Japanese: 'タスク実行', 'チェックリスト'. Arabic: 'تنفيذ المهمة'. Hindi: 'कार्य चलाएं'. Spanish: 'ejecutar tarea'. Portuguese: 'executar tarefa'. French: 'exécuter tâche'. German: 'Aufgabe ausführen'. Russian: 'выполнить задачу'. Indonesian: 'jalankan tugas'."
---

# Task Execution Skill

## Role
Execute tasks and complete verification based on spec documents from `/Qgenerate-spec`.

> **MANDATORY:** All user confirmations MUST use the `AskUserQuestion` tool. Do NOT output options as plain text — always call the tool.

## Workflow
```
/Qgenerate-spec → /Qrun-task → Read → Summarize → Approve → Execute → Verify → ✅ Done
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

**Chained execution skip:** If TASK_REQUEST contains `<!-- chained-from: Qgenerate-spec -->`, skip the approval prompt (user already approved in Qgenerate-spec). Remove the comment after reading.

Otherwise, use `AskUserQuestion` for approval. On approve → move files to `in-progress/`, set CLAUDE.md to 🔶.

## Step 3: Execute

Execute checklist items in order. Report: `✅ [1/N] desc - done`. Record `- [x] item ✅ (HH:MM)`.

**Code task**: After Step 3, ask whether to run `/Qcode-run-task` quality loop.

**Intermediate verification**: Every 3 items (or per `<!-- verify-interval: N -->`), check relevant VERIFY_CHECKLIST items. Fix failures before continuing.

## Step 4: Final Verification

Verify all VERIFY_CHECKLIST items. Show pass/fail results. All pass → Step 5. Failures → fix and re-verify (max 2 retries, then escalate to user).

## Step 4.5: Supervision Gate

After verification, run the Supervision Gate to get expert-level quality assessment.

**skip-supervision conditions** (skip if ALL true):
- Task is `type: docs` or `type: analysis` with fewer than 5 items
- Single-item tasks
- MD-only changes

**never skip-supervision for `type: code` tasks** — code always goes through the gate.

Track `supervision_iteration` counter in `.qe/state/session-stats.json` to persist across session compactions. Increment on each supervision round.

1. Invoke `Esupervision-orchestrator` with task context and verification results
2. If grade is PASS → proceed to Step 5
3. If grade is PARTIAL → apply suggested improvements, re-verify
4. If grade is FAIL → save REMEDIATION_REQUEST, re-execute failed items via Etask-executor

**Agent Trigger Check:** After supervision, check `.qe/agent-triggers/` for trigger files written by agents during execution:
1. Glob `.qe/agent-triggers/*.trigger.md`
2. For each trigger: spawn the target agent with the provided context (in parallel if multiple)
3. Delete processed trigger files
4. If triggered agents produce new findings, append to verification results

Skip agent triggers if no trigger files exist.

## Step 5: Completion

1. Mark all items `[x]` in TASK_REQUEST and VERIFY_CHECKLIST
2. Move files to `completed/`
3. Update CLAUDE.md to ✅
4. `type: code` → call `Ecode-doc-writer`; `type: docs` → call `Edoc-generator`
5. Auto-run `/Qarchive` in background
6. Clean up `.qe/agent-results/` (delete result files older than current task)

Report: UUID, items completed, verification passed, changed files.

### Next Task Prompt

After completion, check for remaining tasks:
1. Read CLAUDE.md task table — find tasks with status `진행 전` or `🔲`
2. Also check `.qe/tasks/pending/` for queued TASK_REQUEST files
3. If next tasks exist, use `AskUserQuestion` to prompt:
   - List upcoming tasks (UUID + name)
   - Ask: "다음 작업을 실행하려면 `/Qrun-task {UUID}`를 실행해주세요."
4. If no remaining tasks, skip this step

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

**Parallel by default.** Spawn separate `Etask-executor` agents concurrently (one per UUID). Each task runs Steps 2-5 independently.

Sequential fallback only when tasks have explicit inter-dependencies (e.g., task B's input is task A's output).

On failure: skip failed task, continue others, report all failures at end.

## Autonomous Mode (Ultra)

When `.qe/state/ultra{work,qa}-state.json` is active:
- Skip Step 2 approval
- Auto-proceed on judgments
- `--ultraqa`: auto-run code quality loop
- Multiple UUIDs: parallel Etask-executor agents

## Coding Expert References

Reference `skills/coding-experts/` for language/framework best practices. Catalog: `skills/coding-experts/CATALOG.md`.

## Role Constraints
- Only executes existing spec documents
- Use `/Qgenerate-spec` to create specs
- Do not modify spec content (except checking off items)
