---
name: Qinit
description: QE framework (Query Executor) initial setup. Creates the QE state directory, client-specific instruction/config artifacts, and .gitignore entries in a new project, then auto-analyzes the project. Use when the user wants to initialize a project or set up the framework.
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
tier: core
---

# Qinit — QE Framework Initialization

## Role
A skill that sets up the QE framework base structure in a new project and auto-analyzes it.
Run once only; do not run on a project that is already set up.

## Client Adapter Compatibility

Use the interaction adapter for all user choices and confirmations:
- **Claude**: use `AskUserQuestion` exactly where this skill requires structured choices.
- **Codex interactive**: if `AskUserQuestion` is unavailable, ask a concise plain-text question with the same explicit choices.
- **Codex non-interactive**: use the documented recommended/default path and report the selected default. Do not make destructive or irreversible choices without explicit user input.

Claude setup files such as `.claude/settings.json` remain part of the Claude
install target. Codex-native setup should be handled by the Codex install target
(`~/.codex` assets and `AGENTS.md`) rather than treating `.claude/settings.json`
as a universal client file.

## Pre-check
Before running, verify whether a project instruction artifact exists in the project root:
- Claude adapter: `CLAUDE.md`
- Codex-capable project: `AGENTS.md` or an existing QE-managed equivalent

- **If no instruction artifact exists**: Proceed with initialization (Step 0).
- **If `CLAUDE.md` exists**: Run migration check (Step M) instead of exiting.

### Step M: CLAUDE.md Migration
When `CLAUDE.md` already exists, check if it contains the `## QE Toolkit` section.
- **If the section exists**: Display "QE framework is already up to date." then exit.
- **If the section is missing**: Migrate the existing CLAUDE.md.
  1. Read the existing CLAUDE.md content.
  2. Read the `base.md` template and extract the `## QE Toolkit` section (from that heading to `## Task Log`).
  3. If the existing CLAUDE.md has a `## Task Log` section, insert the QE Toolkit section **before** it.
  4. If not, append the QE Toolkit section at the end.
  5. Also ensure `## Task Log` with `.qe/TASK_LOG.md` reference exists; add if missing.
  6. Show diff preview to user via the interaction adapter before applying.
     - Claude: `AskUserQuestion`.
     - Codex interactive: plain-text "Apply migration? Yes / No / Show more".
     - Codex non-interactive: do not migrate existing non-QE instructions unless the task explicitly requested migration.
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
node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const fs=await import('fs');const home=process.env.HOME||process.env.USERPROFILE||'';const _cr=join(home,'.claude','plugins','cache','inho-team-qe-framework','qe-framework');const _cand=[process.env.CLAUDE_PLUGIN_ROOT,join(home,'.claude','plugins','marketplaces','inho-team-qe-framework')];if(fs.existsSync(_cr))for(const v of fs.readdirSync(_cr).sort().reverse())_cand.push(join(_cr,v));_cand.push(join(home,'.claude'));const base=_cand.find(b=>b&&fs.existsSync(join(b,'hooks','scripts','lib','session-resolver.mjs')))||join(home,'.claude');const m=await import(pathToFileURL(join(base,'scripts','lib','codex_bridge.mjs')).href);const r=await m.getCodexPluginInfo();console.log(JSON.stringify(r))})()"
```

- If `installed: true`: Display "Codex 플러그인 v{version} 감지됨" before the options.
- If `installed: false`: Display "Codex 플러그인 미설치 (Hybrid 선택 시 설치 안내)" before the options.
- If the command fails or the script is missing: Treat as `installed: false`.
- If installed > 30 days ago (compare `installedAt`): Append "Run `{adapter.commandPrefix}Qupdate` to check for updates."

After running the detection command and displaying the result, ask the user to configure SIVS engine routing.

> **CRITICAL — ALL THREE OPTIONS ARE MANDATORY**: Ask through the interaction adapter with exactly the three options listed below. In Claude, you MUST call `AskUserQuestion`. In Codex interactive mode, present the same three choices as concise plain text. NEVER remove, merge, reword, or conditionally hide any option. The "Claude + Codex Hybrid" option MUST always appear regardless of the detection result above. Codex availability is checked AFTER the user selects that option, not before.

Claude adapter: call `AskUserQuestion` with these **exact** parameters (copy verbatim):
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
        "description": "Spec/Supervise는 Claude 주도, Implement/Verify는 Codex 선호. codex-plugin-cc 필요."
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
   node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const fs=await import('fs');const home=process.env.HOME||process.env.USERPROFILE||'';const _cr=join(home,'.claude','plugins','cache','inho-team-qe-framework','qe-framework');const _cand=[process.env.CLAUDE_PLUGIN_ROOT,join(home,'.claude','plugins','marketplaces','inho-team-qe-framework')];if(fs.existsSync(_cr))for(const v of fs.readdirSync(_cr).sort().reverse())_cand.push(join(_cr,v));_cand.push(join(home,'.claude'));const base=_cand.find(b=>b&&fs.existsSync(join(b,'hooks','scripts','lib','session-resolver.mjs')))||join(home,'.claude');const m=await import(pathToFileURL(join(base,'scripts','lib','codex_bridge.mjs')).href);console.log(m.isCodexPluginAvailable())})()"
   ```
   - If `false`: Show warning ("Codex bridge is not available for this base client. Claude-base sessions can install it with `/plugin install codex@openai-codex`; Codex-native sessions should verify native Codex readiness. Then rerun `{adapter.commandPrefix}Qsivs-config`.") → Fallback to Claude Only.
   - If `true`: Continue.
2. For each SIVS stage, ask through the interaction adapter to select engine:

   **Spec Stage**: "Select engine for Spec stage"
   - Claude (Recommended) — Claude generates spec document and may delegate bounded repo search/context gathering to Codex
   - Codex — Codex generates spec via `/codex:rescue`

   **Implement Stage**: "Select engine for Implement stage"
   - Codex (Recommended) — Codex implements via `/codex:rescue --write`
   - Claude — Claude agent implements changes

   **Verify Stage**: "Select engine for Verify stage"
   - Codex (Recommended) — Codex verifies via `/codex:rescue --verify`
   - Claude — Claude validates implementation results

   **Supervise Stage**: "Select engine for Supervise stage"
   - Claude (Recommended) — Claude domain supervisor reviews and may ask Codex for a bounded second opinion
   - Codex — Codex reviews via `/codex:review`

3. Create `.qe/sivs-config.json` based on selections:
   ```json
   {
     "spec": { "engine": "claude" },
     "implement": { "engine": "codex" },
     "verify": { "engine": "codex" },
     "supervise": { "engine": "claude" }
   }
   ```
4. If Codex is selected for any stage, ask additional questions:
   - **Model** (Optional): Specify Codex model (default: not set → use codex-plugin-cc default)
   - **Effort** (Optional): Reasoning effort level (`low` / `medium` / `high` / `xhigh`, default: not set)
   - **Background** (Optional): `true` for long Implement/Verify jobs. If enabled, the session must retrieve results with `/codex:status` and `/codex:result <job-id>` before final reporting.
5. Validate the generated configuration by running the framework validator from the plugin root (the `qe:validate` npm script only exists inside the framework repo, **not** in the target project — invoking it via the plugin path validates the project's `.qe/sivs-config.json` from any cwd):
   ```bash
   node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const fs=await import('fs');const home=process.env.HOME||process.env.USERPROFILE||'';const _cr=join(home,'.claude','plugins','cache','inho-team-qe-framework','qe-framework');const _cand=[process.env.CLAUDE_PLUGIN_ROOT,join(home,'.claude','plugins','marketplaces','inho-team-qe-framework')];if(fs.existsSync(_cr))for(const v of fs.readdirSync(_cr).sort().reverse())_cand.push(join(_cr,v));_cand.push(join(home,'.claude'));const base=_cand.find(b=>b&&fs.existsSync(join(b,'hooks','scripts','lib','session-resolver.mjs')))||join(home,'.claude');await import(pathToFileURL(join(base,'scripts','validate_svs_config.mjs')).href)})()"
   ```

**On option 3 "나중에 설정"**: Skip — Show guidance message: "`.qe/sivs-config.json`은 나중에 수동 생성하거나 `{adapter.commandPrefix}Qsivs-config`로 설정할 수 있습니다."

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

#### Project Instruction Artifact
Generate the active client's instruction artifact using the selected template.
Claude adapter writes `CLAUDE.md` from `templates/claude-md/`. Codex-capable
projects may additionally maintain `AGENTS.md` or another QE-managed instruction
artifact, but `.qe/TASK_LOG.md` remains the task ledger.
Also reference `QE_CONVENTIONS.md` (project root) for QE rules (file naming, task status, completion criteria) and add a reference line in the generated instruction artifact pointing to it.
- Fill in project name and description
- Reflect tech stack from Step 2 analysis results
- Leave goals, constraints, and decisions empty
- Create an empty table for the task list

#### Claude Adapter: `.claude/settings.json`
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

#### Claude Adapter: Agent Teams (Optional)
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
# QE Framework / client-local state
.claude/settings-local.json
.qe/tasks/
.qe/checklists/
.qe/analysis/
TASK_REQUEST_*.md
VERIFY_CHECKLIST_*.md
ANALYSIS_*.md
```

### Step 3.5: Wiki Bootstrap (Opt-in — `.qe/` 구조 생성 후)
디렉터리 구조가 만들어진 뒤에만 실행하는 **선택 단계**. interaction adapter로 "프로젝트 지식 wiki를
부트스트랩할까요? (기존 DECISION_LOG·MISTAKE·RETROSPECTIVE를 `.qe/wiki/`로 시드 → Qwiki 생태계 시작)"를
묻는다.
- **예**: `.qe/wiki/{inbox,raw,pages,templates,queries,archive}` 스켈레톤 생성 →
  `node <QE plugin>/scripts/lib/wiki-seed.mjs --seed-self` 실행 → "N개 inbox 적재됨. **다음: {adapter.commandPrefix}Qwiki-compile**
  로 위키 페이지로 합성하세요(self-seed는 게이트 필수, `--batch` 금지)" 안내.
- **아니요/생략**: 아무것도 만들지 않는다. **기존 Qinit 동작과 완전히 동일**(wiki는 순수 opt-in).
- `.qe/analysis`는 시드 대상이 아니다(D-WIKI-02). wiki가 비면 이후 모든 소비 경로는 무영향(Phase 5).

### Step 4: Completion Notice
Show the list of created files and guide the next steps.
- Show a brief summary of analysis results (tech stack, file count, main entry points).
- Follow the **Response Language** rule from `QE_CONVENTIONS.md`: all output must match the user's language. If the user asked in Korean, write section titles, descriptions, and guidance in Korean.

## Creation Rules
- Do not overwrite files that already exist.
- Keep existing `.gitignore` content intact; add only missing entries.
- Do not create files without user confirmation. **Use the interaction adapter to confirm. Claude MUST use `AskUserQuestion`; Codex interactive may use plain-text choices; Codex non-interactive must only proceed when the user explicitly requested initialization and the change is reversible.**

## Will
- Create the active client instruction artifact from template
- Create .qe/ directory structure (including analysis/, TASK_LOG.md)
- Auto-analyze project and save results
- Configure .gitignore
- Create `.claude/settings.json` only for the Claude adapter

## Will Not
- Create task specs → use `{adapter.commandPrefix}Qgenerate-spec`
- Write or modify code
- Overwrite existing files
- Modify source code (analysis is read-only)
