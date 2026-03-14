---
name: Qutopia
description: "Utopia mode — fully autonomous execution. Skips all confirmations (AskUserQuestion) and auto-allows tool permissions. Use for 'utopia', 'autonomous', 'no questions', '자동 실행'."
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep
---
> Shared principles: see core/PRINCIPLES.md

# Qutopia — Utopia Mode (Fully Autonomous Execution)

## Role
Toggles Utopia mode ON/OFF. When ON, the entire QE framework runs without asking the user any questions.

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

## Execution Procedure

### `/Qutopia` or `/Qutopia on` — Enable
1. Create `.qe/state/utopia-state.json` with `enabled: true`
2. Read `.claude/settings.json` (create if not exists)
3. Merge `permissions.allow` array (preserve existing settings)
4. Save `.claude/settings.json`
5. Report: "Utopia mode ON — all confirmations disabled"

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

## Will
- Toggle autonomous execution mode
- Manage .claude/settings.json permissions
- Manage .qe/state/utopia-state.json

## Will Not
- Enable --dangerously-skip-permissions (CLI flag, not controllable)
- Skip safety checks for destructive operations
- Run without explicit user invocation to enable
