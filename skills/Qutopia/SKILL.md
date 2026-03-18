---
name: Qutopia
description: "Utopia mode — fully autonomous execution. Skips all confirmations (AskUserQuestion) and auto-allows tool permissions. Complex tasks automatically go through spec→task→verify pipeline. Use for 'utopia', 'autonomous', 'no questions', '자동 실행'."
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep
---
> Shared principles: see core/PRINCIPLES.md

# Qutopia — Utopia Mode (Fully Autonomous Execution)

## Role
Toggles Utopia mode ON/OFF. When ON, the entire QE framework runs autonomously — no user confirmations, and complex tasks automatically follow the spec→task→verify pipeline.

## What It Does

### 1. QE Internal — Skip AskUserQuestion
Creates/updates `.qe/state/utopia-state.json`:
```json
{
  "enabled": true,
  "activatedAt": "2026-03-14T19:00:00Z"
}
```

When `enabled: true`, ALL skills and agents MUST:
- Skip `AskUserQuestion` calls — auto-select the first (recommended) option
- Auto-approve task execution in Qrun-task (always "Proceed")
- Auto-select "Generate" in Qgenerate-spec
- Auto-commit and push after task completion via Qcommit

### 2. Claude Code — Auto-allow tool permissions
Creates/updates `.claude/settings.json` with `allowedTools` to suppress permission prompts:
```json
{
  "permissions": {
    "allow": [
      "Read", "Write", "Edit", "Glob", "Grep",
      "Bash(*)", "Agent(*)",
      "WebFetch", "WebSearch",
      "NotebookEdit"
    ]
  }
}
```

### 3. Autonomous Pipeline — Complexity-based routing

When Utopia mode is ON and the user gives a request, **automatically classify complexity** and route accordingly.

#### Complexity Classification

**SIMPLE (직접 실행)** — ALL of the following must be true:
- Single file change OR single well-defined action
- No architectural decisions needed
- Estimated steps: 1-2
- No new files to create (only modify existing)

Examples of SIMPLE:
- "이 오타 고쳐줘"
- "이 함수 이름 바꿔줘"
- "이 import 추가해"
- "이 파일 삭제해"
- "git status 보여줘"

**COMPLEX (spec→task pipeline)** — ANY of the following is true:
- Multiple files to modify (3+)
- New feature or component to create
- Architectural or design decisions involved
- Estimated steps: 3+
- Unclear scope requiring analysis first
- Refactoring across multiple modules

Examples of COMPLEX:
- "로그인 기능 추가해"
- "이 모듈 리팩토링해줘"
- "테스트 코드 작성해"
- "API 엔드포인트 만들어줘"
- "성능 최적화해줘"

#### Pre-execution Gate Integration

Before routing, COMPLEX requests pass through the **Pre-execution Gate** (defined in Qgenerate-spec SKILL.md). The gate checks if the prompt has concrete anchor signals (file paths, function names, issue numbers, code blocks, numbered steps, etc.).

- **Anchor found** → proceed with COMPLEX pipeline directly
- **No anchor + ≤15 effective words** → redirect to Qgenerate-spec normal flow (Step 1) for proper scoping
- **Bypass**: `force:` or `!` prefix skips the gate entirely

See the "Pre-execution Gate" section in Qgenerate-spec SKILL.md for the full anchor signal table and bypass rules.

#### Routing Behavior

```
Utopia ON + User Request
    ↓
Complexity Classification (automatic, no user prompt)
    ↓
├── SIMPLE → Execute directly (no spec, no task file)
│   └── Done → Report result
│
└── COMPLEX → Pre-execution Gate check
    ├── Gate fires → Qgenerate-spec normal flow (Step 1~5)
    └── Gate passes → Autonomous Pipeline:
        1. Qgenerate-spec (auto-generate, skip all confirmations)
           - Create TASK_REQUEST + VERIFY_CHECKLIST
           - Auto-select "Generate" (no user review)
        2. Qrun-task (auto-execute)
           - Read task files, implement all checklist items
           - Skip approval step
        3. Verify
           - Check all VERIFY_CHECKLIST items
           - Auto-commit via Qcommit
        4. Report completion summary
```

#### Classification Output Format
When classifying, briefly state the decision:
```
[Utopia] SIMPLE — direct execution (single file edit)
```
or
```
[Utopia] COMPLEX — entering spec→task pipeline (multi-file feature)
```

## Execution Procedure

### `/Qutopia` or `/Qutopia on` — Enable
1. Create `.qe/state/utopia-state.json` with `enabled: true`
2. Read `.claude/settings.json` (create if not exists)
3. Merge `permissions.allow` array (preserve existing settings)
4. Save `.claude/settings.json`
5. Report: "Utopia mode ON — autonomous pipeline active"

### `/Qutopia off` — Disable
1. Update `.qe/state/utopia-state.json` with `enabled: false`
2. Remove the `permissions.allow` array from `.claude/settings.json`
3. Report: "Utopia mode OFF — confirmations restored"

### `/Qutopia status` — Check status
1. Read `.qe/state/utopia-state.json`
2. Report current state

## How Other Skills Check Utopia Mode
Before calling `AskUserQuestion`, skills should check:
```
Read .qe/state/utopia-state.json
If enabled: true → skip AskUserQuestion, auto-select first option
If enabled: false or file missing → normal behavior
```

## Safety
- Utopia mode does NOT skip destructive git operations (force push, reset --hard)
- Utopia mode does NOT skip file deletion confirmations for files outside .qe/
- User can always turn it off with `/Qutopia off`
- The spec→task pipeline creates an audit trail even in autonomous mode

## Will
- Toggle autonomous execution mode
- Classify request complexity and route accordingly
- Run spec→task→verify pipeline for complex tasks
- Execute simple tasks directly
- Manage .claude/settings.json permissions
- Manage .qe/state/utopia-state.json

## Will Not
- Enable --dangerously-skip-permissions (CLI flag, not controllable)
- Skip safety checks for destructive operations
- Run without explicit user invocation to enable
- Force spec→task pipeline for trivially simple tasks (1-2 step edits)
