---
name: Qgenerate-spec
description: "Generates 3 project spec documents (CLAUDE.md, TASK_REQUEST, VERIFY_CHECKLIST) from a project description. Use when the user wants to start a new project, define task specifications, generate a spec, create a task, or write requirements."
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
| 1 | `CLAUDE.md` | Project root | Project context — goals, constraints, decisions, task list. Must reference `QE_CONVENTIONS.md` for QE rules. |
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
Write drafts using templates from `templates/` directory (`TASK_REQUEST_TEMPLATE.md`, `VERIFY_CHECKLIST_TEMPLATE.md`). For CLAUDE.md, reference `QE_CONVENTIONS.md` (project root) for QE rules (file naming, task status, completion criteria) and include a reference line pointing to it. Replace `{{placeholder}}` with actual content.

### Step 2.5: Spec Verification (Automatic)
After drafting, verify spec quality. **Skip conditions (fast path):** checklist ≤ 3 items OR `type: docs`/`analysis` → skip entirely, proceed to Step 3.

When verification runs, perform **both structural and executability checks in a single pass** (no separate agent spawn for simple tasks):

**Structural criteria (S1-S5):**
1. Single responsibility per item
2. Specific and verifiable (yes/no)
3. TASK_REQUEST/VERIFY_CHECKLIST consistency
4. No constraint conflicts
5. No missing dependencies

**Executability criteria (E1-E4):**

| # | Criterion | Fail Example |
|---|-----------|--------------|
| E1 | Single-action executability | `"API 설계 및 라우트 구현"` — two distinct edits |
| E2 | Output path validity | `→ output: src/utils/helper` — missing extension |
| E3 | Logical ordering | Item 3 references file from Item 5 |
| E4 | Verifiable completion | `"코드를 적절히 리팩토링"` — subjective |

**For complex tasks (8+ items):** Spawn Plan agent (`subagent_type: "Plan"`) for S1-S5 review while self-checking E1-E4 in parallel. Max 2 iterations.

**For simple tasks (4-7 items):** Self-check all 9 criteria without agent spawn. Max 1 iteration.

Any fail → fix automatically. After max iterations, proceed with best version.

### Step 3: Review, Create, and Execute (Single Confirmation)
Show drafts to user and collect feedback with a **single `AskUserQuestion`** offering 3 options:
- **"Generate & Execute"** — create files and immediately run `/Qrun-task {UUID}` (sets `<!-- chained-from: Qgenerate-spec -->` flag so Qrun-task skips its own approval step)
- **"Generate Only"** — create files, do not execute
- **"Needs Revision"** — revise after feedback

On "Generate & Execute" or "Generate Only":
- Auto-create directories (`mkdir -p`)
- Create all spec files
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

Output status summary after file creation:
```
✅ 생성 완료 (spec documents only):
- CLAUDE.md
- .qe/tasks/pending/TASK_REQUEST_{UUID}.md
- .qe/checklists/pending/VERIFY_CHECKLIST_{UUID}.md

❌ 아직 없는 것 (실제 작업 결과물):
- {expected output files from TASK_REQUEST checklist}
```

On "Generate & Execute" → invoke `/Qrun-task {UUID}` immediately.

## Autonomous Mode Support

When called from Qutopia (autonomous mode), Qgenerate-spec:
- Skips all `AskUserQuestion` calls — auto-selects first option
- Auto-proceeds through Steps 1-3 without user confirmation
- Sets `<!-- chained-from: Qgenerate-spec -->` on generated TASK_REQUEST files

See `Qutopia` for autonomous execution modes (`--work`, `--qa`).

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
- **Auto-include by type:**
  - `type: code` → add: "변경된 코드에 보안 취약점(OWASP Top 10)이 없는가", "기존 테스트가 통과하는가"
  - `type: code` + auth/crypto/payment → add: "인증/암호화 구현이 안전한가 (Esecurity-officer 또는 수동 확인)"
  - `type: docs` → add: "문서 내 링크가 유효한가", "용어/포맷이 일관적인가"

## UUID Generation Rules
- 8-character hex (e.g., `a1b2c3d4`)
- Same UUID shared between TASK_REQUEST and VERIFY_CHECKLIST for same task

## Self-Evolving
- After completing tasks, if recurring patterns found, suggest template improvements
- On user approval, reflect patterns in future generation

## Output Format
- Wrap document content in markdown code blocks when displaying
- Pure markdown only, no JSON
