---
name: Qrefresh
user_invocable: false
description: Manually refreshes project analysis data. Use when refreshing, updating, or syncing .qe/analysis/ files. Also supports --sync mode for synchronizing project source files with a reference/standard project via reference/project-sync.md.
invocation_trigger: When project analysis data under .qe/analysis/ is stale and needs refreshing, or when syncing source files with a reference project.
recommendedModel: haiku
---


# Qrefresh — Project Analysis Refresh

## Role
A skill that manually refreshes project analysis data and shows the user a summary of changes.
Actual refresh work is delegated to the `Erefresh-executor` sub-agent.

`--sync` mode is separate: it synchronizes project source files with a reference/standard/template project by following `reference/project-sync.md`. Default Qrefresh updates `.qe/analysis/` data and does not sync source files.

## Why Use This
- **Token optimization**: With up-to-date analysis data, Claude does not need to repeatedly scan files to understand the project. Reading `.qe/analysis/` is sufficient to understand the entire project, greatly reducing token consumption.
- **Context efficiency**: Instead of agents/skills using Glob and Grep to understand structure every time, they can reference the already-organized analysis files.
- **Improved accuracy**: Working from always up-to-date project information prevents mistakes caused by stale data.

## Execution Procedure

### Mode Selection
- **Default**: refresh `.qe/analysis/` project analysis data.
- **`--sync`**: sync project source files with a reference/standard/template project. Read and follow `reference/project-sync.md`; do not run the default analysis refresh unless the user also asks for it.

### Step 1: Call Erefresh-executor
Run the `Erefresh-executor` sub-agent to perform the analysis refresh.

### Step 1.5: Refresh Folder Contexts
If `.qe/context/_registry.json` exists:
1. For each registered context, check if files matching its glob pattern have been modified after `updatedAt`
2. Auto-refresh stale contexts (rescan folder, update .md file, update timestamp)
3. Include refreshed context names in the change summary

### Step 2: Display Change Summary
After the refresh is complete, summarize changes for the user:
- Newly added files/directories
- Deleted files/directories
- Dependency changes
- Tech stack changes
- Refreshed folder contexts (if any)
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
- In `--sync` mode, synchronize source files with a reference/standard/template project by following `reference/project-sync.md`

## Will Not
- Perform analysis directly → delegate to Erefresh-executor
- Modify source code in default refresh mode
- Modify CLAUDE.md without user approval
- Treat `--sync` source-file synchronization as the same operation as `.qe/analysis/` refresh
