---
name: Qrefresh
description: Manually refreshes project analysis data. Use when refreshing, updating, or syncing .qe/analysis/ files.
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
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

### Step 1.6: Wiki Freshness Hint (조건부 — `.qe/wiki/`가 있을 때만)
`existsSync('.qe/wiki')`가 참일 때만(아니면 skip — 비-wiki 프로젝트 무영향): analysis 갱신은 코드 변경을
뜻하므로 관련 wiki 페이지가 stale일 수 있다. `node <plugin>/scripts/lib/wiki-freshness.mjs`를 실행해
stale 후보를 **안내만** 한다(자동 수정 안 함) — "코드가 바뀌었습니다. `/Qwiki-lint`로 wiki 신선도를
점검하거나 `/Qwiki-compile`로 갱신을 고려하세요." analysis/wiki 없으면 graceful skip.

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

## Will Not
- Perform analysis directly → delegate to Erefresh-executor
- Modify source code
- Modify CLAUDE.md without user approval
