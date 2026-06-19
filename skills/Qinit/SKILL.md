---
name: Qinit
description: QE framework (Query Executor) initial setup. Creates CLAUDE.md, settings.json, directory structure, and .gitignore in a new project, then auto-analyzes the project. Use when the user wants to initialize a project or set up the framework.
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
tier: core
---

# Qinit — QE Framework Initialization

## Role
A skill that sets up the QE framework base structure in a new project and auto-analyzes it.
Run once only; do not run on a project that is already set up.

## Pre-check
Before running, verify whether `CLAUDE.md` exists in the project root.
- **If it does not exist**: Proceed with initialization (Step 0).
- **If it exists**: Run migration check (Step M) instead of exiting.

### Step M: CLAUDE.md Migration
When `CLAUDE.md` already exists, check if it contains the `## QE Toolkit` section.
- **If the section exists**: Display "QE framework is already up to date." then exit.
- **If the section is missing**: Migrate the existing CLAUDE.md.
  1. Read the existing CLAUDE.md content.
  2. Read the `base.md` template and extract the `## QE Toolkit` section (from that heading to `## Task Log`).
  3. If the existing CLAUDE.md has a `## Task Log` section, insert the QE Toolkit section **before** it.
  4. If not, append the QE Toolkit section at the end.
  5. Also ensure `## Task Log` with `.qe/TASK_LOG.md` reference exists; add if missing.
  6. Show diff preview to user via `AskUserQuestion` before applying.
  7. Report: "CLAUDE.md migrated — QE Toolkit section added."

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

### Step 1.5: SIVS Engine Configuration (Optional)

**Codex Plugin Detection (MANDATORY):** Before presenting engine options, you MUST run the following bash command. Do NOT skip this step. Do NOT guess the result. The output determines what status to display.

```bash
node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const base=process.env.CLAUDE_PLUGIN_ROOT||join(process.env.HOME||process.env.USERPROFILE||'','.claude');const m=await import(pathToFileURL(join(base,'scripts','lib','codex_bridge.mjs')).href);const r=await m.getCodexPluginInfo();console.log(JSON.stringify(r))})()"
```

- If `installed: true`: Display "Codex 플러그인 v{version} 감지됨" before the options.
- If `installed: false`: Display "Codex 플러그인 미설치 (Hybrid 선택 시 설치 안내)" before the options.
- If the command fails or the script is missing: Treat as `installed: false`.
- If installed > 30 days ago (compare `installedAt`): Append "Run `/QCodexUpdate` to check for updates."

After running the detection command and displaying the result, ask the user to configure SIVS engine routing.

> **CRITICAL — ALL THREE OPTIONS ARE MANDATORY**: You MUST call `AskUserQuestion` with exactly the three options listed below. NEVER remove, merge, reword, or conditionally hide any option. The "Claude + Codex Hybrid" option MUST always appear regardless of the detection result above. Codex availability is checked AFTER the user selects that option, not before.

Call `AskUserQuestion` with these **exact** parameters (copy verbatim):
```json
{
  "questions": [{
    "question": "SIVS 엔진 라우팅을 설정하시겠습니까? (Spec/Implement/Verify/Supervise 각 단계별 엔진 선택)",
    "header": "SIVS 설정",
    "multiSelect": false,
    "options": [
      {
        "label": "Claude Only (Recommended)",
        "description": "모든 단계를 Claude가 처리합니다. 추가 설정 없음."
      },
      {
        "label": "Claude + Codex Hybrid",
        "description": "단계별 엔진을 선택합니다. codex-plugin-cc 필요."
      },
      {
        "label": "나중에 설정",
        "description": "초기화만 진행. .qe/sivs-config.json은 나중에 수동 생성 가능."
      }
    ]
  }]
}
```
> **Hook enforced**: PreToolUse hook will hard-block this call if the "Claude + Codex Hybrid" option is missing. Do not attempt to remove it.

**On option 1 "Claude Only"**: Skip — Do not create `.qe/sivs-config.json`. All stages automatically use Claude.

**On option 2 "Claude + Codex Hybrid"**:
1. **After** the user selects this option, you MUST run this bash command to verify (reuse the result from the detection step above if it was `installed: true`):
   ```bash
   node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const base=process.env.CLAUDE_PLUGIN_ROOT||join(process.env.HOME||process.env.USERPROFILE||'','.claude');const m=await import(pathToFileURL(join(base,'scripts','lib','codex_bridge.mjs')).href);console.log(m.isCodexPluginAvailable())})()"
   ```
   - If `false`: Show warning ("codex-plugin-cc가 설치되어 있지 않습니다. `/plugin install codex@openai-codex`로 설치 후 `/Qsivs-config`로 다시 설정해주세요.") → Fallback to Claude Only.
   - If `true`: Continue.
2. For each SIVS stage, use `AskUserQuestion` to select engine:

   **Spec Stage**: "Select engine for Spec stage"
   - Claude (Recommended) — Claude generates spec document
   - Codex — Codex generates spec via `/codex:rescue`

   **Implement Stage**: "Select engine for Implement stage"
   - Claude (Recommended) — Claude agent implements changes
   - Codex — Codex implements via `/codex:rescue --write`

   **Verify Stage**: "Select engine for Verify stage"
   - Claude (Recommended) — Claude validates implementation results
   - Codex — Codex verifies via `/codex:rescue --verify`

   **Supervise Stage**: "Select engine for Supervise stage"
   - Claude (Recommended) — Claude domain supervisor reviews
   - Codex — Codex reviews via `/codex:review`

3. Create `.qe/sivs-config.json` based on selections:
   ```json
   {
     "spec": { "engine": "claude" },
     "implement": { "engine": "codex" },
     "verify": { "engine": "claude" },
     "supervise": { "engine": "claude" }
   }
   ```
4. If Codex is selected for any stage, ask additional questions:
   - **Model** (Optional): Specify Codex model (default: not set → use codex-plugin-cc default)
   - **Effort** (Optional): Reasoning effort level (`low` / `medium` / `high` / `xhigh`, default: not set)
5. Validate generated configuration with `npm run qe:validate`.

**On option 3 "나중에 설정"**: Skip — Show guidance message: "`.qe/sivs-config.json`은 나중에 수동 생성하거나 `/Qsivs-config`로 설정할 수 있습니다."

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
  "env": {
    "SLASH_COMMAND_TOOL_CHAR_BUDGET": "100000"
  }
}
```
Sets the character budget for slash command tool descriptions so all skills fit within the system prompt.

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
├── config.json
├── context/
├── docs/
├── handoffs/
├── learning/
│   ├── failures/
│   └── signals/
├── MISTAKE.md
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
```

### Step 4: Completion Notice
Show the list of created files and guide the next steps.
- Show a brief summary of analysis results (tech stack, file count, main entry points).
- Follow the **Response Language** rule from `QE_CONVENTIONS.md`: all output must match the user's language. If the user asked in Korean, write section titles, descriptions, and guidance in Korean.

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
