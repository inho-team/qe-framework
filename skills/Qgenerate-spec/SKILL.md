---
name: Qgenerate-spec
description: "Generates 3 project spec documents (CLAUDE.md, TASK_REQUEST, VERIFY_CHECKLIST) from a project description. Use when starting a new project, defining task specifications, or when the user says generate spec, create task, 스펙 작성, 태스크 만들어줘, write requirements, or spec. Supports --ultrawork and --ultraqa modes."
user_invocable: true
---

# Project Spec Document Generation Skill

## Role
You are an assistant dedicated to writing project spec documents.
You generate **3 documents** based on the user's project description.

## Role Constraints (Absolute Rules)
- When this skill is invoked, focus exclusively on writing the 3 spec documents.
- Do not perform any actions outside of document writing, such as writing code, fixing bugs, or answering general questions.

## Documents to Generate

| # | Filename | Path | Description |
|---|----------|------|-------------|
| 1 | `CLAUDE.md` | Project root | Project context — goals, constraints, decisions, task list |
| 2 | `TASK_REQUEST_{UUID}.md` | `.qe/tasks/pending/` | Task request — what, how, checklist, notes |
| 3 | `VERIFY_CHECKLIST_{UUID}.md` | `.qe/checklists/pending/` | Verification checklist — validation criteria, additional notes |

- A single task shares the same UUID across both documents.
- Multiple tasks get separate TASK_REQUEST / VERIFY_CHECKLIST pairs.
- Newly generated documents always go in `pending/`.

## Workflow

### Step 1: Collect Information
Ask the user for the information below. Skip items already provided.

Delegation options:
- Complex projects requiring PRD-level planning → delegate to `Epm-planner`
- Tech stack / architecture decisions → delegate to `Edeep-researcher`

Required information:
- **Project name**, **description** (one-paragraph summary)
- **Goals** (1-5 items), **Constraints** (tech stack, performance, security, etc.), **Decisions** (finalized)
- **Task list** — for each task: what, how, steps (checklist), expected output files (optional), notes, type (`code`|`analysis`|`docs`|`other`), validation criteria (checks), verification notes, and optional decision rationale (chosen approach, alternatives, consequences)

### Step 2: Draft Documents
Write drafts using templates from `templates/` directory (`CLAUDE_MD_TEMPLATE.md`, `TASK_REQUEST_TEMPLATE.md`, `VERIFY_CHECKLIST_TEMPLATE.md`). Replace `{{placeholder}}` with actual content.

### Step 2.5: Plan Review (Automatic Verification Loop)
After drafting, automatically verify spec quality using the **Plan agent** (invisible to user).

**Procedure:**
1. Spawn Plan agent via Agent tool (`subagent_type: "Plan"`) with drafted TASK_REQUEST and VERIFY_CHECKLIST content
2. Plan agent evaluates against **5 criteria**: (1) single responsibility per item, (2) specific and verifiable, (3) TASK_REQUEST/VERIFY_CHECKLIST consistency, (4) no constraint conflicts, (5) no missing dependencies
3. Response: `APPROVE` → proceed to Step 3; `REVISE: {items}` → apply revisions and re-submit
4. **Max 3 iterations.** If not approved after 3 rounds, proceed with best version and note unresolved items.

**Plan agent prompt template:**
```
Review the following spec documents against these 5 criteria:
1. Single responsibility: Does each checklist item perform exactly one task?
2. Specificity: Is each item concrete and verifiable (yes/no)?
3. Consistency: Do TASK_REQUEST and VERIFY_CHECKLIST align?
4. No conflicts: Are there contradictions between constraints and checklist?
5. Completeness: Are there missing dependencies or prerequisites?

Respond with APPROVE if all criteria pass.
Otherwise respond with REVISE: followed by specific items to fix.

[TASK_REQUEST content]
[VERIFY_CHECKLIST content]
```

This loop runs identically in both normal and ultra modes.

### Step 2.7: Executability Verification (Automatic)
After Step 2.5 passes, self-check that each checklist item is **practically executable**. No additional agent spawned.

> **Role separation:** Step 2.5 = structural quality; Step 2.7 = executability.

**4 Criteria:**

| # | Criterion | Check Question | Fail Example |
|---|-----------|---------------|--------------|
| E1 | Single-action executability | Can an agent complete this with a single focused edit/command? | `"API 설계 및 라우트 구현"` — two distinct edits |
| E2 | Output path validity | Does `→ output:` path have valid directory and extension? | `→ output: src/utils/helper` — missing extension |
| E3 | Logical ordering | Does each item's input exist by execution time? | Item 3 references file from Item 5 |
| E4 | Verifiable completion | Can completion be confirmed objectively (yes/no)? | `"코드를 적절히 리팩토링"` — subjective |

**Procedure:**
1. Evaluate every checklist item against E1-E4
2. All pass → proceed to Step 3
3. Any fail → fix automatically, re-verify (**max 2 retries**)
4. After 2 retries with remaining failures → proceed with best version, note unresolved items

**Failure format:**
```
[EXECUTABILITY FAIL]
- Item: "{{ checklist item text }}"
- Criterion: E{{ number }} — {{ criterion name }}
- Reason: {{ specific reason }}
- Fix: {{ proposed correction }}
```

Runs identically in normal and ultra modes.

### Step 3: Review and Revise
- Show drafts to user and collect feedback. Refine progressively.
- Use **`AskUserQuestion` tool**: "Generate" (proceed) or "Needs revision" (revise after feedback)

### Step 4: Create Files
Create files after user selects "Generate".
- Auto-create directories (`mkdir -p`)
- If existing `TASK_REQUEST_*.md` / `VERIFY_CHECKLIST_*.md` found in project root, suggest migrating to `.qe/tasks/pending/` and `.qe/checklists/pending/`
- **On initial setup**, if `.claude/settings.json` and `.mcp.json` don't exist, suggest creating with defaults
- **Automatic `.gitignore` management:** Add missing entries under `# Claude Code` section:
  ```gitignore
  # Claude Code
  .claude/settings-local.json
  .qe/tasks/
  .qe/checklists/
  TASK_REQUEST_*.md
  VERIFY_CHECKLIST_*.md
  ANALYSIS_*.md

  # Oh My ClaudeCode
  .omc/
  ```

### Step 5: Suggest Immediate Execution

Output status summary:
```
✅ 생성 완료 (spec documents only):
- CLAUDE.md
- .qe/tasks/pending/TASK_REQUEST_{UUID}.md
- .qe/checklists/pending/VERIFY_CHECKLIST_{UUID}.md

❌ 아직 없는 것 (실제 작업 결과물):
- {expected output files from TASK_REQUEST checklist}

스펙 문서는 "무엇을 할지"의 계획서입니다.
실제 {작업 결과물}는 /Qrun-task 실행 후 생성됩니다.
```

Adapt by task type: `docs` → "실제 문서는 아직 작성되지 않았습니다.", `code` → "실제 코드는...", `analysis` → "실제 분석 결과는..."

Then use **`AskUserQuestion` tool**: "지금 실행" (execute `/Qrun-task {UUID}`) or "나중에 직접 실행"

## Pre-execution Gate

When `--ultrawork`, `--ultraqa`, or Utopia mode triggers autonomous execution, check prompt specificity. Vague prompts redirect to normal Qgenerate-spec flow (Step 1-5).

### Gate Logic

> **Can an AI generate a meaningful spec from this prompt alone?**

**1. Target anchors** (task subject explicitly named):

| Signal Type | Pattern |
|---|---|
| File path | `.ts`, `.py`, `src/` |
| Function/class name | camelCase, PascalCase, snake_case |
| Issue/PR number | `#N`, `issue N`, `PR N` |
| Error reference | `TypeError`, `Error:` |
| Code block | Triple backticks |
| Numbered steps | `1. ... 2. ...` |
| Escape prefix | `force:` or `!` at start |

**2. Scope anchor** — no specific target, but scope is unambiguous (semantic judgment):
- `전수 조사해` on known codebase → full codebase scope. **Present.**
- `성능 개선해줘` → which part? **Absent.**

**3. Decision rule:**
```
Target anchor found          → Gate passes
Scope anchor inferred        → Gate passes
Neither found, word count > 20 → Gate passes (detailed enough)
Neither found, word count ≤ 20 → Gate fires
```

> Korean word count: 20 Korean words ~ 35+ English words in specificity.

**On Gate fire:** Inform user with redirect message; invoke Qgenerate-spec Step 1.

**Gate bypass:** `force:` or `!` prefix → skip gate entirely.

## Ultra Modes

### `--ultrawork`
Spec generation → single confirmation → autonomous parallel execution.

1. Steps 1-2.7: Same as normal
2. Step 3: Show drafts → single confirmation ("Approve & Execute" / "Needs revision")
3. Step 4: Create files
4. **Step 5 (auto-execute):**
   a. Write `.qe/state/ultrawork-state.json`: `{ active, mode, started_at, session_id, reinforcement_count: 0, max_reinforcements: 50, original_prompt, task_uuids }`
   b. **Multiple tasks:** spawn separate `Etask-executor` agents in parallel (one per task)
   c. **Single task:** invoke `/Qrun-task {UUID}` in autonomous mode
   d. Run VERIFY_CHECKLIST for each task
   e. **Supervision gate (per task):** route by type: `code` → `Ecode-quality-supervisor` + `Esecurity-officer`; `docs` → `Edocs-supervisor`; `analysis` → `Eanalysis-supervisor`; `other` → skip. PASS/PARTIAL → complete; FAIL → generate `REMEDIATION_REQUEST`, invoke `Etask-executor`, re-run once (escalate if still FAIL)
   f. Clear state file, output completion report

### `--ultraqa`
Same as `--ultrawork` plus full quality verification loop.

1. State file: `"mode": "ultraqa"`, `"max_reinforcements": 80`
2. After each task's `Etask-executor` completes:
   a. **Quality loop** (code only): `/Qcode-run-task` (test → review → fix → retest, max 3 cycles)
   b. **Supervision gate**: same routing as ultrawork, with `supervision_iteration` counter
   c. **PASS/PARTIAL**: record verdict, mark complete
   d. **FAIL**: generate REMEDIATION_REQUEST → Etask-executor → re-run quality/supervision. **Max 3 supervision rounds**, then escalate.
3. **Cross-task audit**: verify all checklists, inter-task consistency, supervision pass
4. Output comprehensive QA report (per-task results, supervision verdicts, cross-task consistency, overall score)

### Ultra Mode Common Rules
- **State management**: create before execution, clear after completion
- **Reinforcement**: Stop hook checks state file; stop signals blocked up to `max_reinforcements`
- **Parallel execution**: Agent tool spawns multiple `Etask-executor` agents concurrently
- **Error handling**: log failure, skip to next task, report all at end
- **No intermediate user prompts** after initial confirmation
- **Progress output**: periodic reports (e.g., "3/7 tasks complete")

## Document Writing Rules

### Language Matching (Required)
TASK_REQUEST and VERIFY_CHECKLIST must match the user's language.
- Korean user → Korean documents; English user → English documents; mixed/unclear → English
- **Scope:** TASK_REQUEST and VERIFY_CHECKLIST only. Internal framework files stay English. CLAUDE.md follows user language but not strictly enforced.

### CLAUDE.md
- Single Source of Truth; read by AI every session
- Task list includes UUID, task name, status; completed tasks (✅) need not be referenced

### TASK_REQUEST
- Clearly separate "what" from "how"
- Checklist items as `- [ ]`, specific and verifiable (no vague expressions)
- **Output files (optional):** append `→ output: {file-path}` to checklist items
- **Granularity:** single responsibility, yes/no verifiable, completable within 30 min; split if exceeded
- **`## How to Run` section required** with `/Qrun-task {UUID}` command
- **ADR section (optional):** include when 2+ viable design alternatives exist; omit for simple tasks

### VERIFY_CHECKLIST
- Each criterion answerable as yes/no
- Task complete when all items checked
- Include note to update CLAUDE.md task list to ✅

## UUID Generation Rules
- 8-character hex (e.g., `a1b2c3d4`)
- Same UUID shared between TASK_REQUEST and VERIFY_CHECKLIST for same task

## Self-Evolving
- After completing tasks, if recurring patterns found, suggest template improvements
- On user approval, reflect patterns in future generation

## Output Format
- Wrap document content in markdown code blocks when displaying
- Pure markdown only, no JSON
