---
name: Qgenerate-spec
description: "Generates 3 project spec documents (CLAUDE.md, TASK_REQUEST, VERIFY_CHECKLIST) from a project description. Use when starting a new project, defining task specifications, or when the user says 'generate spec', 'create task', 'write requirements', or 'spec'. Supports --ultrawork and --ultraqa modes for autonomous execution."
user_invocable: true
---
> Shared principles: see core/PRINCIPLES.md


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
- If there are multiple tasks, generate a separate TASK_REQUEST / VERIFY_CHECKLIST pair for each.
- Newly generated documents are always saved in the `pending/` directory.

## Workflow

### Step 1: Collect Information
Ask the user for the information below. Skip items already provided.

For complex projects or those requiring PRD-level planning, you can delegate to the `Epm-planner` agent for detailed requirements analysis.

For tech stack selection or architecture decisions, you can delegate to the `Edeep-researcher` agent for technical research and comparative analysis.

- **Project name**: Official name of the project
- **Project description**: One-paragraph summary
- **Goals**: What this project aims to achieve (1–5 items)
- **Constraints**: Things that must be respected — tech stack, performance, security, etc.
- **Decisions**: Technical or business decisions already finalized
- **Task list**: Tasks to be performed. For each task:
  - What is wanted (what)
  - How it will be built (how)
  - Implementation checklist (steps)
  - Expected output files (outputs) — file paths produced or modified by each checklist item (optional)
  - Notes (notes)
  - Task type (type): `code` | `analysis` | `docs` | `other`
  - Validation criteria (checks)
  - Verification notes (verifyNotes)
  - Decision rationale (optional) — only when design alternatives exist:
    - Chosen approach and why (chosen_approach, why_chosen)
    - Alternatives considered with rejection reasons (alternatives)
    - Consequences of the decision (consequences)

### Step 2: Draft Documents
Write drafts of the 3 documents from the collected information.
- Refer to template files in this skill's `templates/` directory:
  - `templates/CLAUDE_MD_TEMPLATE.md`
  - `templates/TASK_REQUEST_TEMPLATE.md`
  - `templates/VERIFY_CHECKLIST_TEMPLATE.md`
- Replace `{{placeholder}}` in templates with actual content.

### Step 2.5: Plan Review (Automatic Verification Loop)
After drafting documents in Step 2, automatically verify the spec quality using the **Plan agent** before presenting to the user. This step is invisible to the user — only the refined result is shown in Step 3.

**Procedure:**
1. Spawn a Plan agent via the Agent tool with `subagent_type: "Plan"` and pass the drafted TASK_REQUEST and VERIFY_CHECKLIST content.
2. The Plan agent evaluates the spec against **5 verification criteria**:
   - (1) Each checklist item follows the single responsibility principle
   - (2) Each item is specific and verifiable (no vague expressions)
   - (3) VERIFY_CHECKLIST and TASK_REQUEST are consistent with each other
   - (4) No conflicts between constraints and checklist items
   - (5) No missing dependencies or prerequisites
3. The Plan agent responds with one of:
   - `APPROVE` — spec passes all criteria, proceed to Step 3
   - `REVISE: {specific revision items}` — spec needs changes
4. On `REVISE`: apply the suggested revisions to the draft, then re-submit to the Plan agent for re-evaluation.
5. **Maximum 3 iterations.** If the spec does not receive `APPROVE` after 3 rounds, proceed to Step 3 with the best version available and note the unresolved items for the user.

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

**Ultra Modes compatibility:** This verification loop runs in both normal and ultra modes. In ultra modes, the loop operates identically — it does not skip or auto-approve. The loop is an internal quality gate, not a user interaction point.

### Step 2.7: Executability Verification (Automatic)
After Step 2.5 (structural/completeness review) passes, verify that each checklist item is **practically executable** by an implementation agent. This is a self-check within Qgenerate-spec — no additional agent is spawned.

> **Role separation from Step 2.5:** Step 2.5 checks *structural quality* (single responsibility, specificity, consistency). Step 2.7 checks *executability* — whether the plan can actually be carried out without ambiguity or failure at runtime.

**4 Verification Criteria:**

| # | Criterion | Check Question | Fail Example |
|---|-----------|---------------|--------------|
| E1 | Single-action executability | Can an agent complete this item with a single focused edit or command (not "is it one responsibility")? | `"API 설계 및 라우트 구현"` — requires two distinct file edits that cannot be done atomically |
| E2 | Output path validity | Does the `→ output:` path have a valid directory and consistent extension? | `→ output: src/utils/helper` — missing extension; `→ output: nonexistent-dir/foo.ts` — directory does not exist in project |
| E3 | Logical ordering | Does each item's input exist by the time it executes (no forward dependency)? | Item 3 references a file created in Item 5 |
| E4 | Verifiable completion | Can an agent objectively confirm this item is done (yes/no) without subjective judgment? | `"코드를 적절히 리팩토링"` — "적절히" is subjective |

**Procedure:**
1. Iterate through every checklist item in TASK_REQUEST and evaluate against E1–E4.
2. For each item, produce a pass/fail verdict per criterion.
3. If **all items pass all 4 criteria** → proceed to Step 3.
4. If **any item fails** → apply fixes automatically, then re-verify (retry loop).

**Retry Loop:**
- **Maximum 2 retries.** On each retry, fix only the failing items and re-run the full E1–E4 check.
- After 2 retries, if failures remain, proceed to Step 3 with the best version and attach unresolved items as a note to the user.

**Failure Feedback Format:**
When a criterion fails, record it in the following structured format before applying fixes:

```
[EXECUTABILITY FAIL]
- Item: "{{ checklist item text }}"
- Criterion: E{{ number }} — {{ criterion name }}
- Reason: {{ specific reason for failure }}
- Fix: {{ proposed correction }}
```

Example:
```
[EXECUTABILITY FAIL]
- Item: "API 엔드포인트 설계 및 라우트 구현"
- Criterion: E1 — Single-action executability
- Reason: Contains two distinct actions (설계 + 구현) that should be separate items
- Fix: Split into "API 엔드포인트 설계 → output: docs/api-design.md" and "API 라우트 구현 → output: src/routes/api.ts"

[EXECUTABILITY FAIL]
- Item: "헬퍼 함수 작성 → output: src/utils/helper"
- Criterion: E2 — Output path validity
- Reason: Missing file extension in output path
- Fix: Change to "→ output: src/utils/helper.ts"
```

After applying fixes, log:
```
[EXECUTABILITY RETRY {{ n }}/2]
- Fixed items: {{ count }}
- Remaining failures: {{ count or "none" }}
```

**Ultra Modes compatibility:** This verification runs in both normal and ultra modes. It does not skip or auto-approve. It operates as an internal gate after Step 2.5 and before user review.

### Step 3: Review and Revise
- Show the drafts to the user and collect feedback.
- Incorporate any revision requests.
- **Perfection is not required on the first try.** Refine progressively through conversation.
- After presenting the draft, use the **`AskUserQuestion` tool** to get confirmation:
  - Options: "Generate" (proceed to file creation), "Needs revision" (revise after feedback)
  - If the user selects "Generate", proceed to Step 4.

### Step 4: Create Files
Create files after the user selects "Generate" in `AskUserQuestion`.
- Automatically create directories if they do not exist (`mkdir -p`, etc.).
- If existing `TASK_REQUEST_*.md` / `VERIFY_CHECKLIST_*.md` files are found in the project root, suggest migrating them to `.qe/tasks/pending/` and `.qe/checklists/pending/`.
- **On initial project setup**, if `.claude/settings.json` and `.mcp.json` do not exist, suggest creating them with default settings.
  - `.claude/settings.json` → empty settings file (`{}`)
  - `.mcp.json` → create with basic structure if the user wants it
- **Automatic `.gitignore` management:** If `.gitignore` is missing or any of the entries below are absent, suggest adding them.
  - Skip entries that already exist; add only missing ones under a `# Claude Code` section.
  - If `.gitignore` does not exist at all, create it.

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

```
project-root/
├── CLAUDE.md
├── .mcp.json                   ← MCP server config (optional)
└── .qe/
    ├── tasks/
    │   └── pending/
    │       ├── TASK_REQUEST_{UUID1}.md
    │       └── TASK_REQUEST_{UUID2}.md   ← if multiple tasks
    └── checklists/
        └── pending/
            ├── VERIFY_CHECKLIST_{UUID1}.md
            └── VERIFY_CHECKLIST_{UUID2}.md
```

### Step 5: Suggest Immediate Execution
After file creation is complete, use the **`AskUserQuestion` tool** to ask whether to execute immediately:
- Question: Would you like to run `/Qrun-task {UUID}` now?
- Options: "Run" (immediately execute `/Qrun-task {UUID}`), "Later" (finish with spec generation only)
- For multiple tasks: guide with `/Qrun-task {UUID1} {UUID2}` format
- If the user selects "Run", follow the `/Qrun-task` skill procedure.

## Pre-execution Gate

When `--ultrawork`, `--ultraqa`, or Utopia mode triggers autonomous execution, the **Pre-execution Gate** checks whether the user's prompt is specific enough to proceed directly. Vague prompts are redirected to the normal Qgenerate-spec flow (Step 1~5) to ensure proper scoping before execution.

### Gate Logic

1. **Scan for anchor signals** in the user's prompt:

| Signal Type | Pattern | Example |
|---|---|---|
| File path | Path separators, extensions (`.ts`, `.py`, `src/`) | `src/auth/login.ts` |
| Function/class name | camelCase, PascalCase, snake_case identifiers | `processKeywordDetector`, `UserModel` |
| Issue/PR number | `#N`, `issue N`, `PR N` | `#42`, `issue 15` |
| Error reference | Error type names (`TypeError`, `Error:`) | `TypeError in auth` |
| Code block | Triple backticks | `` ```ts ... ``` `` |
| Numbered steps | `1. ... 2. ...` pattern | `1. Add validation 2. Write tests` |
| Escape prefix | `force:` or `!` at start | `force: ultrawork 성능 개선` |

2. **Decision rule:**
   - **Any anchor signal found** → Gate passes, proceed with autonomous execution
   - **No anchor signals AND effective word count ≤ 15** → Gate fires, redirect to Qgenerate-spec normal flow
   - **No anchor signals BUT effective word count > 15** → Gate passes (detailed enough)

3. **On Gate fire:**
   - Inform the user: "프롬프트가 모호하여 계획 수립 단계로 전환합니다. 우회하려면 `force:` 또는 `!` 접두어를 사용하세요."
   - Invoke Qgenerate-spec Step 1 (Collect Information) with the user's original prompt as context

### Gate Bypass

Users can bypass the gate with:
- `force:` prefix — e.g., `force: ultrawork 성능 개선`
- `!` prefix — e.g., `! ultrawork 앱 개선`

When bypass is detected, skip the gate entirely and proceed with autonomous execution.

### Good vs Bad Prompts

| Verdict | Prompt | Reason |
|---------|--------|--------|
| Pass | `ultrawork src/auth/login.ts의 null 체크 수정` | File path anchor |
| Pass | `ultrawork issue #42 구현` | Issue number anchor |
| Pass | `ultrawork processKeywordDetector 함수 리팩토링` | Function name anchor |
| Pass | `force: ultrawork 성능 개선` | Escape prefix |
| Gate | `ultrawork 성능 개선해줘` | No anchor, vague |
| Gate | `ultrawork 인증 추가` | No anchor, scope unclear |
| Gate | `ultrawork 앱 개선` | No anchor, extremely vague |

## Ultra Modes

When invoked with `--ultrawork` or `--ultraqa` flag, the skill enters an AI-driven autonomous execution mode.

### `--ultrawork`
Spec generation → single user confirmation → autonomous parallel task execution.

**Modified workflow:**
1. Steps 1–2.7: Same as normal (collect info, draft documents, plan review loop, executability verification)
2. Step 3: Show drafts → **single confirmation** via `AskUserQuestion` ("Approve & Execute" / "Needs revision")
3. Step 4: Create files (same as normal)
4. **Step 5 (auto-execute):** Skip the execution prompt. Instead:
   a. Write ultra state file via Bash: create `.qe/state/ultrawork-state.json` with:
      ```json
      {
        "active": true,
        "mode": "ultrawork",
        "started_at": "<ISO timestamp>",
        "session_id": "<session_id>",
        "reinforcement_count": 0,
        "max_reinforcements": 50,
        "original_prompt": "<user's original prompt>",
        "task_uuids": ["<UUID1>", "<UUID2>", ...]
      }
      ```
   b. For **multiple tasks**: spawn separate `Etask-executor` agents **in parallel** via the Agent tool (one per task). Pass each agent:
      - TASK_REQUEST content
      - VERIFY_CHECKLIST content
      - CLAUDE.md constraints
   c. For **single task**: invoke `/Qrun-task {UUID}` in autonomous mode (skip approval step)
   d. After all agents complete, perform final verification on each task
   e. Clear the ultra state file
   f. Output overall completion report

### `--ultraqa`
Same as `--ultrawork`, plus a full quality verification loop on every task.

**Additional behavior on top of `--ultrawork`:**
1. Write ultra state file with `"mode": "ultraqa"` and `"max_reinforcements": 80`
2. After each task's implementation, automatically run the `/Qcode-run-task` quality loop (test → review → fix → retest, max 3 cycles) — no user confirmation needed
3. After all tasks complete, perform a **cross-task audit**:
   - Check all VERIFY_CHECKLIST items across all tasks
   - Verify inter-task consistency (shared files, dependencies)
   - Run project-wide validation (build, lint, test suite)
4. Output comprehensive QA report including:
   - Per-task verification results
   - Cross-task consistency check results
   - Overall quality score

### Ultra Mode Common Rules
- **State management**: Always create the state file before starting execution, clear it after completion
- **Reinforcement**: The Stop hook checks the state file. While active, stop signals are blocked up to `max_reinforcements`
- **Parallel execution**: When multiple tasks exist, use the Agent tool to spawn multiple `Etask-executor` agents concurrently
- **Error handling**: If a task fails, log the failure, skip to the next task, and report all failures at the end
- **No intermediate user prompts**: After the single initial confirmation, the AI operates fully autonomously
- **Progress output**: Periodically report progress (e.g., "3/7 tasks complete") so the user can monitor

## Document Writing Rules

### CLAUDE.md
- Acts as the "Single Source of Truth" for the project
- Context file read by AI at every session
- Task list includes UUID, task name, and status
- Note that completed tasks (✅) do not need to be referenced

### TASK_REQUEST
- Clearly separate "what is wanted" from "how it will be built"
- Checklist items listed in order as `- [ ]`
- No vague expressions — only specific, verifiable items
- **Specify output files (optional)**: Append `→ output: {file-path}` after a checklist item to designate where the result goes. Without it, behavior is the same as before.
  - Example: `- [ ] Analyze TB_AS_B table field mapping → output: analysis/tb_as_b_mapping.md`
  - Used to verify file existence and content during validation
- **Checklist item granularity guidelines**:
  - **Single responsibility**: Each item performs exactly one task
  - **Verifiable**: Completion can be judged as yes/no
  - **Appropriate size**: Each item can be completed within 30 minutes
  - If an item exceeds these criteria, split it into sub-items
- **Execution instructions required**: Always include a `## How to Run` section at the end of the document with the `/Qrun-task {UUID}` command. If related tasks in the same batch exist, include a multi-UUID run example (e.g., `/Qrun-task UUID1 UUID2`)
- **Decision rationale (ADR) section (optional)**: Include the `## 의사결정 근거` section when a task involves design decisions with 2+ viable alternatives. Omit for simple tasks (bug fixes, config changes, single-line edits). The section records: chosen approach with rationale, alternatives considered with rejection reasons, and downstream consequences. This creates an audit trail for future reference without adding overhead to trivial tasks.

### VERIFY_CHECKLIST
- Each validation criterion must be answerable as yes/no
- Task is complete when all items are checked
- Include a note to update the CLAUDE.md task list to ✅ upon completion

## UUID Generation Rules
- 8-character hex (e.g., `a1b2c3d4`)
- TASK_REQUEST and VERIFY_CHECKLIST for the same task share the same UUID

## Self-Evolving
- After completing tasks, if recurring patterns are found (frequently missing checklist items, common constraints, etc.), suggest template improvements to the user.
- Example: "The 'write test code' verification item is added every time in this project. Would you like to include it in the default template?"
- Upon user approval, reflect that pattern in future document generation.

## Output Format
- Wrap document content in markdown code blocks when displaying.
- Do not use JSON. Use pure markdown only.
