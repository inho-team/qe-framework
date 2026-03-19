---
name: Qresume
description: "Restores saved context after compaction or session break. Use for resume, restore context, 이어하기, continue from where I left off, or load previous session."
---

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qresume — Context Restoration

## Role
A skill that restores context saved in `.qe/context/` after compaction.
Loads the previous session's task state, decisions, and pending items to resume work seamlessly.

## How It Works

### Auto Load
Integrated with the pre-check in PRINCIPLES.md:
- When the skill is called immediately after compaction, Ecompact-executor checks whether `.qe/context/snapshot.md` exists
- If it exists, automatically loads the context and reflects it in the current session
- Notifies the user with a single line: "Previous context has been restored"

### Manual Execution
- Invoke directly with `/Qresume`
- Displays the entire saved context and proposes what to do next

## Restoration Procedure

### Step 1: Read Context Files
Load files from the `.qe/context/` directory:
- `snapshot.md` — last task state
- `decisions.md` — accumulated decisions

### Step 2: Restore State
- Check in-progress tasks (cross-reference with .qe/tasks/pending/)
- Check checklist progress
- Present list of pending items

### Step 3: Suggest Next Actions
Propose next actions based on restored context:
- If there are incomplete tasks → guide with `/Qrun-task {UUID}`
- If new work is needed → guide with `/Qgenerate-spec`
- If decisions need review → display decision list

## .qe/analysis/ Integration
When restoring context, also read `.qe/analysis/` files to understand the latest project state.
This allows starting work immediately without re-scanning the project with Glob/Grep, saving tokens.

## Will
- Load .qe/context/ context files
- Restore previous task state
- Suggest next actions
- Integrate with .qe/analysis/ to understand project state

## Will Not
- Error when context files are missing (silently ignore if not found)
- Blindly follow restored context (user can change direction)
- Force-apply stale context (notify "Context is stale" when 24+ hours have passed)
