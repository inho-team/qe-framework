---
name: Qrefresh
description: Manually refreshes project analysis data. Use when refreshing, updating, or syncing .qe/analysis/ files and reviewing change history.
---


# Qrefresh — Project Analysis Refresh

## Role
A skill that manually refreshes project analysis data and shows the user a summary of changes.
Actual refresh work is delegated to the `Erefresh-executor` sub-agent.

## Why Use This
- **Token optimization**: With up-to-date analysis data, Claude does not need to repeatedly scan files to understand the project. Reading `.qe/analysis/` is sufficient to understand the entire project, greatly reducing token consumption.
- **Context efficiency**: Instead of agents/skills using Glob and Grep to understand structure every time, they can reference the already-organized analysis files.
- **Improved accuracy**: Working from always up-to-date project information prevents mistakes caused by stale data.

## Execution Procedure

### Step 1: Call Erefresh-executor
Run the `Erefresh-executor` sub-agent to perform the analysis refresh.

### Step 2: Display Change Summary
After the refresh is complete, summarize changes for the user:
- Newly added files/directories
- Deleted files/directories
- Dependency changes
- Tech stack changes
- Recent history recorded in `.qe/changelog.md`

### Step 3: Suggest CLAUDE.md Update
If the analysis results show that CLAUDE.md content differs from the current project state, suggest an update.
- When the tech stack has changed
- When the project structure has changed significantly
- Apply after user approval

## Will
- Call Erefresh-executor
- Display change summary
- Suggest CLAUDE.md update

## Will Not
- Perform analysis directly → delegate to Erefresh-executor
- Modify source code
- Modify CLAUDE.md without user approval
