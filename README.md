# QE Framework

A personal skills and agents package for Claude Code.

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

```bash
claude plugin add github:inho-team/qe-framework
```

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

## Skills (49)

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
