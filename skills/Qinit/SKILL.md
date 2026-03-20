---
name: Qinit
description: QE framework (Query Executor) initial setup. Creates CLAUDE.md, settings.json, directory structure, and .gitignore in a new project, then auto-analyzes the project. Use when the user wants to initialize a project, set up the framework, or start a new project setup. Korean: '초기화', '프로젝트 설정', '프로젝트 시작'. Chinese: '初始化', '项目设置'. Japanese: '初期化', 'プロジェクト設定'. Arabic: 'تهيئة'. Hindi: 'आरंभ करें'. Spanish: 'inicializar proyecto'. Portuguese: 'inicializar projeto'. French: 'initialiser projet'. German: 'Projekt initialisieren'. Russian: 'инициализация проекта'. Indonesian: 'inisialisasi proyek'.
---

# Qinit — QE Framework Initialization

## Role
A skill that sets up the QE framework base structure in a new project and auto-analyzes it.
Run once only; do not run on a project that is already set up.

## Pre-check
Before running, verify whether `CLAUDE.md` exists in the project root.
- **If it exists**: Display "QE framework is already set up. Use `/Qgenerate-spec` to create tasks." then exit.
- **If it does not exist**: Proceed with initialization.

## Step 0: Acquire .qe/ Permissions

Before starting initialization, obtain read/write/delete permissions for all files under `.qe/`.
- All file creation, modification, and deletion under `.qe/` is **performed automatically without user confirmation**.
- This is the QE framework data area and requires no separate approval.
- Files outside `.qe/` (CLAUDE.md, .gitignore, etc.) still require user confirmation as usual.

## Initialization Procedure

### Step 1: Collect Project Information
Ask the user for the minimum required information:
- **Project name**: Required
- **Project description**: One-line summary
- **Tech stack**: Primary languages/frameworks (optional)

### Step 2: Auto-analyze Project
Delegate the analysis to the `Erefresh-executor` sub-agent. Since Erefresh-executor uses the same analysis logic as Qrefresh, consistency of analysis is guaranteed.

Scan project sources and save analysis results to `.qe/analysis/`.

#### Analysis Targets and Output Files

| Output File | Analysis Content | Scan Method |
|-------------|-----------------|-------------|
| `project-structure.md` | Directory tree, key file list, file count/language ratio | Use `ls`, `Glob` to understand structure |
| `tech-stack.md` | Languages, frameworks, dependencies, version info | Parse `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc. |
| `entry-points.md` | Main entry points, API endpoints, routes, CLI commands | Search `main`, `app`, `index`, `server` files + pattern search for `@Controller`, `@Route`, `router`, etc. |
| `architecture.md` | Layer structure, inter-module relationships, design patterns | Analyze directory naming conventions (`controller/`, `service/`, `repository/`, etc.) + track import/require relationships |

#### Analysis Rules
- Analysis is **read-only** — do not modify source code.
- If there are too many files, summarize focusing on top-level structure (1000+ files).
- If the project is empty (no source files), skip the analysis step and create empty analysis files.
- Record the creation timestamp at the top of each analysis file.

### Step 3: Create Files
Create the following files and directories:

#### CLAUDE.md Template Selection

Use `templates/claude-md/base.md` as the primary template. It contains conditional sections marked with `<!-- if: type -->` / `<!-- end: type -->` comments. Detect the project type, then include only the matching conditional sections.

| Project Type | Sections to Include | When to Use |
|-------------|-------------------|-------------|
| `minimal` | Core only (Overview, Tech Stack, Constraints, Task List) | Single-purpose project, few files, no build system |
| `standard` | Core + Build & Run, Project Structure, Goals | Single app with build/test pipeline (default) |
| `fullstack` | Core + standard sections + Frontend/Backend/Database subsections, API Endpoints, Environment Variables | Separate frontend + backend + database |
| `monorepo` | Core + standard sections + Packages table, Build Order, Shared Dependencies | Multiple packages/apps in one repository |

Conditional markers: `<!-- if: standard+ -->` applies to standard, fullstack, and monorepo. Type-specific markers (e.g., `<!-- if: fullstack -->`) apply only to that type.

Detection heuristics:
- **monorepo**: `workspaces` in package.json, `pnpm-workspace.yaml`, `lerna.json`, or `nx.json` exists
- **fullstack**: Separate `frontend/` + `backend/` directories, or both a UI framework and a server framework detected
- **minimal**: Fewer than 10 source files, no package manager config
- **standard**: Everything else (default)

> Legacy templates (`minimal.md`, `standard.md`, `fullstack.md`, `monorepo.md`) are retained for backward compatibility but `base.md` is the preferred template going forward.

#### CLAUDE.md
Generate using the selected template from `templates/claude-md/`.
Also reference `QE_CONVENTIONS.md` (project root) for QE rules (file naming, task status, completion criteria) and add a reference line in the generated CLAUDE.md pointing to it.
- Fill in project name and description
- Reflect tech stack from Step 2 analysis results
- Leave goals, constraints, and decisions empty
- Create an empty table for the task list

#### .claude/settings.json
```json
{
}
```
Empty settings file. Users can add hooks etc. as needed.

#### Directory Structure
```
.qe/
├── analysis/
│   ├── project-structure.md
│   ├── tech-stack.md
│   ├── entry-points.md
│   └── architecture.md
├── agent-results/
├── agent-triggers/
├── .archive/
├── context/
├── profile/
├── tasks/
│   └── pending/
└── checklists/
    └── pending/
```
Created with `mkdir -p`.

#### Agent Teams (Optional)
If the user wants to enable Agent Teams for parallel work:
```json
// .claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```
Note: Agent Teams is experimental. It enables parallel teammate spawning for complex tasks in Eqa-orchestrator, Etask-executor, and Edeep-researcher.

#### .gitignore Entries
If `.gitignore` does not exist, create it; if it does, add only missing entries from below:
```gitignore
# Claude Code
.claude/settings-local.json
.qe/tasks/
.qe/checklists/
.qe/analysis/
TASK_REQUEST_*.md
VERIFY_CHECKLIST_*.md
ANALYSIS_*.md

# Oh My ClaudeCode
.omc/
```

### Step 4: Completion Notice
Show the list of created files and guide the next steps:
- "Initialization complete. Use `/Qgenerate-spec` to create your first task."
- Show a brief summary of analysis results (tech stack, file count, main entry points).

## Creation Rules
- Do not overwrite files that already exist.
- Keep existing `.gitignore` content intact; add only missing entries.
- Do not create files without user confirmation. **MUST use the `AskUserQuestion` tool to confirm — do NOT output confirmation prompts as plain text.**

## Will
- Create CLAUDE.md from template
- Create .qe/ directory structure (including analysis/, TASK_LOG.md)
- Auto-analyze project and save results
- Configure .gitignore
- Create .claude/settings.json

## Will Not
- Create task specs → use `/Qgenerate-spec`
- Write or modify code
- Overwrite existing files
- Modify source code (analysis is read-only)
