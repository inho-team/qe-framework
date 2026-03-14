**English** | [한국어](docs/README.ko.md) | [中文](docs/README.zh.md) | [日本語](docs/README.ja.md)

# QE Framework (Query Executor)

A personal skills and agents package for Claude Code.

QE (Query Executor) is a framework that transforms user queries into structured, executable tasks. It handles the full lifecycle — from spec generation to implementation, verification, and commit — through a coordinated system of skills and agents.

## Philosophy

QE Framework is built on proven engineering principles:

- **SOLID** -- Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY** -- No repeated logic; extract common logic into shared components
- **KISS** -- Prefer simple solutions; eliminate unnecessary complexity
- **YAGNI** -- Implement only what is needed now; no speculative design
- **Evidence-based** -- Do not guess. When uncertain, read the file and verify.
- **Minimal change** -- Modify only what was requested. Do not refactor adjacent code.
- **Internal English processing** -- All reasoning and analysis is done in English internally for higher accuracy, then translated to the user's language before responding. This produces better results while keeping the conversation natural in any language.

## Architecture

QE Framework uses a 3-tier architecture:

```
Skills (Q-prefix)          Agents (E-prefix)          Core
Methodology & process      Execution & delegation     Shared principles
/Qgenerate-spec            Etask-executor             PRINCIPLES.md
/Qsystematic-debugging     Ecode-debugger             INTENT_GATE.md
/Qcommit                   Ecommit-executor           AGENT_TIERS.md
```

- **Skills** define *how* to do something (process, methodology, workflow orchestration)
- **Agents** *execute* the work (code writing, debugging, reviewing, research)
- **Core** provides shared principles, intent routing, and model tier selection

## Installation

Run these commands in your **terminal** (not inside a Claude Code session):

### Step 1: Register marketplace (first time only)
```bash
claude plugin marketplace add inho-team/qe-framework
```

### Step 2: Install plugin
```bash
claude plugin install qe-framework@inho-team-qe-framework
```

### Update to latest version
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

### Verify installation
```bash
claude plugin list
```

### Troubleshooting

**SSH permission denied error during install**

If you see `git@github.com: Permission denied (publickey)`, run this to force HTTPS:
```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```
Then retry the install command.

> **Note**: Plugin commands must be run from the terminal, not inside a Claude Code session. After install or update, restart Claude Code to apply changes.

### Initialize a project

```
/Qinit
```

This creates `CLAUDE.md`, `.qe/` directory structure, and runs initial project analysis.

## Usage

### Task Workflow

Generate a spec, then execute it:

```
/Qgenerate-spec    -- Creates TASK_REQUEST.md + VERIFY_CHECKLIST.md
/Qrun-task         -- Executes the task with automatic quality verification
```

### Commit Changes

```
/Qcommit           -- Human-style commits with no AI traces
```

### Debugging

```
/Qsystematic-debugging   -- Root cause analysis before applying fixes
```

### Deep Research

Invoke the `Edeep-researcher` agent for technology comparison, architecture decisions, or investigative tasks.

### Other Examples

```
/Qgenerate-spec + /Qrun-task     -- Full task lifecycle
/Qfrontend-design                -- Create production-grade UI components
/Qtest-driven-development        -- Red-green-refactor TDD workflow
/Qgrad-paper-write               -- Academic paper drafting
/Qc4-architecture                -- C4 model architecture diagrams
/Qrefresh                        -- Update project analysis data
```

## Skills (52)

### Development

| Skill | Description |
|-------|-------------|
| Qcommit | Creates natural commits that look like they were written by a human. Removes AI traces. |
| Qsystematic-debugging | Find the root cause first through systematic debugging, test hypotheses, then fix. |
| Qtest-driven-development | TDD: write the test first, confirm it fails, pass with minimal code, refactor. |
| Qcode-run-task | Performs a test, review, fix, retest quality verification loop after code task completion. |
| Qfrontend-design | Creates original, production-grade frontend interfaces with high design quality. |
| Qspringboot-security | Spring Security best practices guide for Java Spring Boot services. |
| Qdatabase-schema-designer | Designs robust, scalable SQL/NoSQL database schemas with normalization and indexing strategies. |
| Qdoc-comment | Automatically adds documentation comments appropriate for the project's language. |
| Qmcp-builder | MCP (Model Context Protocol) server creation guide using Python (FastMCP) or TypeScript (MCP SDK). |
| Qagent-browser | Browser automation CLI for navigation, form filling, screenshots, and data extraction. |

### Task Management

| Skill | Description |
|-------|-------------|
| Qgenerate-spec | Generates CLAUDE.md, TASK_REQUEST.md, and VERIFY_CHECKLIST.md project spec documents. |
| Qrun-task | Executes tasks based on TASK_REQUEST and VERIFY_CHECKLIST with automatic verification. |
| Qinit | QE framework initial setup: creates CLAUDE.md, settings, directory structure, and auto-analyzes the project. |
| Qrefresh | Manually refreshes project analysis data and shows change history. |
| Qresume | Restores saved context after compaction to resume previous work. |
| Qcompact | Context preservation and session handoff. Saves context or generates handoff documents. |
| Qarchive | Automatically archives completed task files. |
| Qmigrate-tasks | Migrates scattered task files into the .qe/tasks/ and .qe/checklists/ directory structure. |
| Qupdate | Updates the QE Framework plugin to the latest version. |
| Qutopia | Utopia mode — fully autonomous execution without any confirmations. |

### Documentation

| Skill | Description |
|-------|-------------|
| Qdocx | Create, read, edit, and manipulate Word documents (.docx). |
| Qpdf | All PDF-related tasks: reading, merging, splitting, watermarking, encryption, OCR, and more. |
| Qpptx | All PPTX tasks: creating slide decks, reading, editing, and working with templates. |
| Qxlsx | All spreadsheet tasks (.xlsx, .csv, .tsv): formulas, formatting, charts, and data cleanup. |
| Qwriting-clearly | Writes clearer, stronger prose based on Strunk's principles. |
| Qhumanizer | Removes traces of AI-generated writing from text. |
| Qprofessional-communication | Technical communication guide: email structure, team messages, meeting agendas. |
| Qmermaid-diagrams | Generates software diagrams using Mermaid syntax (class, sequence, flowchart, ERD, etc.). |
| Qc4-architecture | Generates architecture documentation using C4 model Mermaid diagrams. |
| Qimage-analyzer | Analyzes images: screenshots, diagrams, charts, wireframes, OCR text extraction. |

### Academic

| Skill | Description |
|-------|-------------|
| Qgrad-paper-write | Systematically drafts academic papers following standard section structure. |
| Qgrad-paper-review | Analyzes reviewer comments and writes Response Letters with point-by-point responses. |
| Qgrad-research-plan | Conducts literature reviews and experiment design with gap analysis. |
| Qgrad-seminar-prep | Prepares academic presentations with slide structure, scripts, and anticipated Q&A. |
| Qgrad-thesis-manage | Manages thesis progress: chapter structure, progress tracking, advisor meeting prep. |

### Planning

| Skill | Description |
|-------|-------------|
| Qpm-prd | Systematically writes PRDs with problem definition, personas, and success metrics. |
| Qpm-user-story | Writes user stories in Mike Cohn format with Gherkin acceptance criteria. |
| Qpm-roadmap | Plans strategic product roadmaps with prioritization and release sequencing. |
| Qrequirements-clarity | Clarifies ambiguous requirements through focused dialogue before implementation. |
| Qqa-test-planner | Generates test plans, manual test cases, regression suites, and bug reports. |

### Media

| Skill | Description |
|-------|-------------|
| Qaudio-transcriber | Converts audio recordings (MP3, WAV, M4A, etc.) into professional Markdown documents. |
| Qyoutube-transcript-api | Extracts, transcribes, and translates YouTube video subtitles/captions. |
| Qtranslate | Multilingual translation with grammar correction support. |

### Meta

| Skill | Description |
|-------|-------------|
| Qskill-creator | Create new skills, modify existing skills, and measure skill performance. |
| Qcommand-creator | Creates Claude Code slash commands from repetitive workflows. |
| Qfind-skills | Searches for skills on skills.sh and installs them as SKILL.md files. |
| Qalias | Defines aliases for folders, paths, and commands using short names. |
| Qprofile | Analyzes user command patterns, writing style, and frequently used expressions. |
| Qagent-md-refactor | Refactors bloated agent instruction files following progressive disclosure. |
| Qweb-design-guidelines | Reviews UI code against Web Interface Guidelines for accessibility and UX. |
| Qlesson-learned | Analyzes recent code changes via git history and extracts engineering lessons. |
| Qhelp | Shows QE Framework quick reference card in terminal. |

## Background Processing

QE Framework runs several agents silently in the background at key lifecycle moments. These agents require no manual invocation — they are triggered automatically by hooks and other agents.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        QE Framework Lifecycle                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Session Start                                                        │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ SessionStart │───▶│ Erefresh-executor   │  Update .qe/analysis/    │
│  │    Hook      │    │ (if analysis stale) │  before any work begins  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  User Interaction                                                     │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreToolUse   │───▶│   Intent Gate       │  Route user intent to    │
│  │    Hook      │    │   Classification    │  the correct skill/agent │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PostToolUse  │───▶│ Eprofile-collector  │  Learn user patterns     │
│  │    Hook      │    │ (command, style)    │  and correction history  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Context Pressure (75%+)                                              │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreCompact   │───▶│ Ecompact-executor   │  Save snapshot before    │
│  │    Hook      │    │ (auto-save context) │  context is lost         │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Task Completion                                                      │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │  Qrun-task   │───▶│ Earchive-executor   │  Archive completed tasks │
│  │  completes   │    │ Ecommit-executor    │  Auto-commit changes     │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ Notification │───▶│  Chain follow-up    │  Trigger next actions    │
│  │    Hook      │    │  actions            │  when agents complete    │
│  └──────────────┘    └─────────────────────┘                          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Lifecycle Hooks

The framework uses 6 lifecycle hooks that fire at specific events:

| Hook | Trigger | What Happens |
|------|---------|--------------|
| `SessionStart` | Conversation begins | Injects framework rules, triggers `Erefresh-executor` if analysis is stale |
| `PreToolUse` | Before every tool call | **Intent Gate** — classifies user intent and routes to the correct skill/agent |
| `PostToolUse` | After every tool call | Triggers `Eprofile-collector` to record user patterns |
| `PreCompact` | Before context compaction | Triggers `Ecompact-executor` to save context before it is lost |
| `Stop` | Conversation ends | Cleanup and finalization |
| `Notification` | Background agent completes | Chains follow-up actions when background agents finish |

### Background Agents

These agents run automatically without user interaction. They write results to `.qe/` files and never respond directly to the user.

#### Erefresh-executor — Project Analysis Sync

> Keeps `.qe/analysis/` up to date so other agents skip expensive project scanning.

| | Details |
|---|---|
| **When** | Session start (if stale), before Qrun-task, or manually via `/Qrefresh` |
| **Writes to** | `.qe/analysis/*.md`, `.qe/changelog.md` |
| **Token saving** | ~50% reduction — agents read 4 analysis files instead of scanning dozens |

**Steps:**
1. Detect changes via `git diff` and file system scan
2. Update 4 analysis files: `project-structure`, `tech-stack`, `entry-points`, `architecture`
3. Record change history in `.qe/changelog.md` tagged as `[External Change]` or `[QE]`

#### Ecompact-executor — Context Preservation

> Saves a lightweight snapshot before context compaction so sessions can be resumed.

| | Details |
|---|---|
| **When** | Context window reaches 75%+ capacity (Yellow zone), or manually via `/Qcompact` |
| **Writes to** | `.qe/context/snapshot.md`, `.qe/context/decisions.md` |
| **Token saving** | ~70% reduction — restores context from a few files instead of re-exploring the project |

**Steps:**
1. Collect in-progress tasks, checklist state, recent file changes, and key decisions
2. Save snapshot to `.qe/context/snapshot.md` (paths and summaries only, no code)
3. Accumulate decisions in `.qe/context/decisions.md` in reverse chronological order

#### Earchive-executor — Task Archival

> Moves completed tasks to a versioned archive, keeping the workspace clean.

| | Details |
|---|---|
| **When** | Qrun-task marks a task as completed, or manually via `/Qarchive` |
| **Writes to** | `.qe/.archive/vX.Y.Z/tasks/`, `.qe/.archive/vX.Y.Z/checklists/` |

**Steps:**
1. Scan `.qe/tasks/pending/` for fully completed tasks
2. Move completed TASK_REQUEST and VERIFY_CHECKLIST to `.qe/.archive/vX.Y.Z/`
3. Save a CLAUDE.md snapshot alongside archived files

#### Ecommit-executor — Auto-Commit

> Creates human-style commits with zero AI traces.

| | Details |
|---|---|
| **When** | Delegated by `/Qcommit`, or auto-commit after Qrun-task completion |
| **Prohibited** | `Co-Authored-By` lines, AI-related wording, emojis |

**Steps:**
1. Analyze `git diff` and match the project's existing commit message style
2. Selectively stage relevant files (excludes `.env`, credentials)
3. Create a commit indistinguishable from a human-written one

#### Eprofile-collector — User Pattern Learning

> Learns user preferences over time to improve intent recognition accuracy.

| | Details |
|---|---|
| **When** | After any skill or agent completes |
| **Writes to** | `.qe/profile/command-patterns.md`, `writing-style.md`, `corrections.md`, `preferences.md` |

**What it collects:**

| File | Content |
|------|---------|
| `command-patterns.md` | Skill/agent invocation frequency and recency |
| `writing-style.md` | Formal/informal patterns, abbreviation dictionary |
| `corrections.md` | History of user corrections to prevent repeated misunderstandings |
| `preferences.md` | Response length, code style, language preferences |

#### Ehandoff-executor — Session Handoff

> Generates a validated handoff document for seamless cross-session continuation.

| | Details |
|---|---|
| **When** | Manually via `/Qcompact` (handoff mode) |
| **Writes to** | `.qe/handoffs/HANDOFF_{date}_{time}.md` |

**Steps:**
1. Collect task state, checklist progress, recent git changes, and decisions
2. Generate a structured handoff document with concrete next steps
3. Validate that all referenced files and task UUIDs actually exist

#### Edoc-generator — Batch Document Generation

> Offloads heavy document generation from the main context window.

| | Details |
|---|---|
| **When** | Delegated by Epm-planner, Qrun-task (`type: docs`), or multi-document requests |
| **Formats** | `.docx`, `.pdf`, `.pptx`, `.xlsx` |

Processes multiple documents in parallel, using templates when available.

---

## Agents (16)

Agents are automatically assigned a model tier based on task complexity. See [AGENT_TIERS.md](core/AGENT_TIERS.md) for details.

### HIGH Tier (opus)

| Agent | Description |
|-------|-------------|
| Edeep-researcher | Systematic multi-step research agent for technology comparison and decision support. |
| Eqa-orchestrator | Executes the full test, review, fix quality loop. Protects the main context. |

### MEDIUM Tier (sonnet)

| Agent | Description |
|-------|-------------|
| Etask-executor | Implements checklist items in order. Learns task patterns for repetitive work. |
| Ecode-debugger | Debugging specialist. Analyzes bug root causes, traces errors, and troubleshoots. |
| Ecode-reviewer | Code review specialist. Reviews quality, security, performance, and pattern compliance. |
| Ecode-test-engineer | Test engineer. Handles test writing, coverage analysis, and test strategy. |
| Ecode-doc-writer | Technical documentation specialist. Writes code explanations, API docs, and READMEs. |
| Edoc-generator | Background sub-agent for batch document generation (docx/pdf/pptx/xlsx). |
| Egrad-writer | Writes academic paper chapters with academic writing style and citation rules. |
| Epm-planner | Planning specialist. Handles PRD, user stories, roadmap, and document generation. |
| Erefresh-executor | Detects project changes, updates .qe/ analysis data, and records change history. |
| Ecompact-executor | Detects context window pressure, saves context, and supports restoration after compaction. |
| Ehandoff-executor | Generates and validates session handoff documents. |

### LOW Tier (haiku)

| Agent | Description |
|-------|-------------|
| Earchive-executor | Archives completed task files into .qe/.archive/ by version. |
| Ecommit-executor | Analyzes diffs, generates commit messages, and stages files with no AI traces. |
| Eprofile-collector | Collects user command patterns, writing style, and correction history. |

## Project Structure

```
qe-framework/
├── .claude-plugin/    # Plugin configuration
├── agents/            # 16 agents (E-prefix)
├── skills/            # 49 skills (Q-prefix)
├── core/              # Shared principles & configuration
├── hooks/             # Lifecycle hooks
├── install.js         # Installation script
└── package.json
```

## License

UNLICENSED
