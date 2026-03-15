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

## Skills (63 + 72 Coding Experts)

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
| Qautoresearch | Autonomous experiment loop inspired by Karpathy's autoresearch. Supports multi-file targets, integrates Ecode-reviewer/debugger, and keeps or discards based on metrics. |
| Qmcp-setup | MCP server setup and configuration guide for connecting external services (Google Drive, Slack, GitHub, etc.). |

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
| Qdoc-converter | Document format converter between MD, DOCX, PDF, PPTX, HTML with multi-tool orchestration. |
| Qcontent-research-writer | Research-driven content writing with citations, iterative refinement, and section feedback. |

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
| Qtranslate | Multilingual support with programmatic language detection (CJK, Latin, Cyrillic, Arabic, etc.) and automatic language.md management. |

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
| Qskill-tester | Automated skill routing tester. Verifies intent classification accuracy and finds misrouted skills. |
| Qjira-cli | Lightweight Jira CLI wrapper for quick issue management without MCP server setup. |

### Analysis

| Skill | Description |
|-------|-------------|
| Qdata-analysis | Data exploration, statistical analysis, and visualization for CSV/JSON/Excel datasets. |
| Qfinance-analyst | Financial analysis, valuation modeling, DCF, Monte Carlo simulation, and portfolio optimization. |
| Qfact-checker | Extracts factual claims from documents and verifies them through evidence-based research. |
| Qsource-verifier | Verifies source credibility and digital content authenticity using the SIFT method. |

## Coding Expert Skills (72)

Domain-specific coding experts organized by category. Each skill provides deep expertise in its technology stack, including best practices, common patterns, and production-ready code generation.

### Languages (14)

| Skill | Description |
|-------|-------------|
| Qcpp-pro | Modern C++20/23 with concepts, ranges, coroutines, SIMD, and template metaprogramming. |
| Qcsharp-developer | C# with .NET 8+, ASP.NET Core, Blazor, Entity Framework, and CQRS patterns. |
| Qembedded-systems | Firmware for STM32, ESP32, FreeRTOS, bare-metal, and real-time systems. |
| Qgolang | Go development standards with strict test-driven development and quality gates. |
| Qgolang-pro | Concurrent Go patterns, gRPC/REST microservices, and performance optimization. |
| Qjava-architect | Spring Boot 3.x, WebFlux, JPA optimization, and OAuth2/JWT security. |
| Qjavascript-pro | Modern ES2023+, async/await, ESM modules, and Node.js APIs. |
| Qkotlin-specialist | Coroutines, Flow, KMP, Compose UI, Ktor, and type-safe DSLs. |
| Qphp-pro | PHP 8.3+ with Laravel, Symfony, Swoole async, and PSR standards. |
| Qpython-pro | Python 3.11+ with type safety, async programming, pytest, and mypy strict mode. |
| Qrust-engineer | Ownership, lifetimes, traits, async with tokio, and zero-cost abstractions. |
| Qsql-pro | Complex queries, window functions, CTEs, indexing, and cross-dialect migration. |
| Qswift-expert | iOS/macOS with SwiftUI, async/await, actors, and protocol-oriented design. |
| Qtypescript-pro | Advanced generics, conditional types, branded types, and tRPC integration. |

### Frontend (12)

| Skill | Description |
|-------|-------------|
| Qangular-architect | Angular 17+ standalone components, NgRx, RxJS patterns, and lazy loading. |
| Qflutter-expert | Flutter 3+ with Riverpod/Bloc, GoRouter, and platform-specific implementations. |
| Qgame-developer | Unity/Unreal Engine, ECS architecture, multiplayer networking, and shader programming. |
| Qnextjs-developer | Next.js 14+ App Router, Server Components, Server Actions, and streaming SSR. |
| Qreact-best-practices | React/Next.js performance optimization guidelines from Vercel Engineering. |
| Qreact-expert | React 18+ with hooks, Server Components, Suspense, and React 19 features. |
| Qreact-native-expert | Cross-platform mobile apps with React Native, Expo, and native module integration. |
| Qvite | Vite build tool configuration, plugin API, SSR, and Rolldown migration. |
| Qvue-best-practices | Vue 3 Composition API with TypeScript, SSR, and Volar. |
| Qvue-expert | Vue 3 Composition API, Nuxt 3, Pinia, Quasar/Capacitor, and PWA features. |
| Qvue-expert-js | Vue 3 with vanilla JavaScript and JSDoc-based typing (no TypeScript). |
| Qweb-design-guidelines-vercel | UI code review for Web Interface Guidelines compliance. |

### Backend (14)

| Skill | Description |
|-------|-------------|
| Qapi-designer | REST/GraphQL API design, OpenAPI specs, versioning, and pagination patterns. |
| Qarchitecture-designer | System architecture, ADRs, technology trade-offs, and scalability planning. |
| Qdjango-expert | Django REST Framework, ORM optimization, and JWT authentication. |
| Qdotnet-core-expert | .NET 8 minimal APIs, clean architecture, and cloud-native microservices. |
| Qfastapi-expert | High-performance async Python APIs with Pydantic V2 and SQLAlchemy. |
| Qgraphql-architect | GraphQL schemas, Apollo Federation, DataLoader, and real-time subscriptions. |
| Qlaravel-specialist | Laravel 10+ with Eloquent, Sanctum, Horizon, Livewire, and Pest testing. |
| Qlegacy-modernizer | Strangler fig pattern, branch by abstraction, and incremental migration. |
| Qmcp-developer | MCP server/client development with TypeScript or Python SDKs. |
| Qmicroservices-architect | DDD, saga patterns, event sourcing, CQRS, service mesh, and distributed tracing. |
| Qnestjs-expert | NestJS modules, dependency injection, guards, interceptors, and Swagger docs. |
| Qrails-expert | Rails 7+ with Hotwire, Turbo Frames/Streams, Action Cable, and Sidekiq. |
| Qspring-boot-engineer | Spring Boot 3.x REST, Spring Security 6, Spring Data JPA, and WebFlux. |
| Qwebsocket-engineer | Real-time WebSocket/Socket.IO systems with Redis scaling and presence tracking. |

### Data & AI (6)

| Skill | Description |
|-------|-------------|
| Qfine-tuning-expert | LoRA/QLoRA, PEFT, instruction tuning, RLHF, DPO, and model quantization. |
| Qml-pipeline | MLflow, Kubeflow, Airflow, feature stores, and experiment tracking. |
| Qpandas-pro | DataFrame operations, aggregation, merging, time series, and performance optimization. |
| Qprompt-engineer | Prompt design, chain-of-thought, few-shot learning, and evaluation frameworks. |
| Qrag-architect | RAG systems, vector databases, hybrid search, reranking, and embedding pipelines. |
| Qspark-engineer | Spark DataFrame transformations, SQL optimization, and structured streaming. |

### Infra & DevOps (14)

| Skill | Description |
|-------|-------------|
| Qatlassian-mcp | Jira/Confluence integration via MCP for issue tracking and documentation. |
| Qchaos-engineer | Chaos experiments, failure injection, game days, and resilience testing. |
| Qcli-developer | CLI tools with argument parsing, completions, and interactive prompts. |
| Qcloud-architect | Multi-cloud architecture, Well-Architected Framework, and cost optimization. |
| Qdatabase-optimizer | Query optimization, EXPLAIN analysis, index design, and partitioning strategies. |
| Qdevops-engineer | Docker, CI/CD, Kubernetes, Terraform, GitHub Actions, and GitOps. |
| Qkubernetes-specialist | K8s manifests, Helm charts, RBAC, NetworkPolicies, and multi-cluster management. |
| Qmonitoring-expert | Prometheus/Grafana, structured logging, alerting, distributed tracing, and load testing. |
| Qpostgres-pro | PostgreSQL EXPLAIN, JSONB, extensions, VACUUM tuning, and replication. |
| Qsalesforce-developer | Apex, Lightning Web Components, SOQL, triggers, and platform events. |
| Qshopify-expert | Liquid themes, Hydrogen storefronts, Shopify apps, and checkout extensions. |
| Qsre-engineer | SLI/SLO, error budgets, incident response, chaos engineering, and capacity planning. |
| Qterraform-engineer | Terraform modules, state management, multi-environment workflows, and testing. |
| Qwordpress-pro | WordPress themes, Gutenberg blocks, WooCommerce, REST API, and security hardening. |

### Quality & Security (12)

| Skill | Description |
|-------|-------------|
| Qcode-documenter | Docstrings, OpenAPI/Swagger specs, JSDoc, and documentation portals. |
| Qcode-reviewer | Code quality audits: bugs, security, performance, naming, and architecture. |
| Qdebugging-wizard | Error parsing, stack trace analysis, and hypothesis-driven root cause isolation. |
| Qfeature-forge | Requirements workshops, user stories, EARS-format specs, and acceptance criteria. |
| Qfullstack-guardian | Security-focused full-stack development with layered auth and validation. |
| Qplaywright-expert | E2E testing with Playwright, page objects, fixtures, and visual regression. |
| Qsecure-code-guardian | Authentication, input validation, OWASP Top 10 prevention, and encryption. |
| Qsecurity-reviewer | Security audits, SAST, penetration testing, and compliance checks. |
| Qspec-miner | Reverse-engineering specs from legacy/undocumented codebases. |
| Qtest-master | Test strategies, coverage analysis, performance testing, and test architecture. |
| Qthe-fool | Devil's advocate, pre-mortem, red teaming, and assumption auditing. |
| Qvitest | Vitest unit testing with Jest-compatible API, mocking, and coverage. |

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

The framework uses 9 lifecycle hooks that fire at specific events:

| Hook | Trigger | What Happens |
|------|---------|--------------|
| `SessionStart` | Conversation begins | Injects framework rules, triggers `Erefresh-executor` if analysis is stale |
| `UserPromptSubmit` | User sends a message | **Intent auto-classification** with CJK/bigram matching + **language detection** for Qtranslate |
| `PreToolUse` | Before every tool call | Intent Gate routing display, secret scanning, context pressure warnings |
| `PostToolUse` | After every tool call | Error tracking/escalation, tool call counting, `Eprofile-collector` trigger |
| `PreCompact` | Before context compaction | Triggers `Ecompact-executor` to save context before it is lost |
| `Stop` | Conversation ends | Session log recording, mode blocking for active work |
| `Notification` | Background agent completes | Chains follow-up actions when background agents finish |
| `TaskCompleted` | Task finishes | Validates verify checklist completion before allowing task close |
| `TeammateIdle` | Agent team member idles | Prompts idle teammates to claim pending tasks |

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

## Agent Teams (Experimental)

QE Framework supports [Claude Agent Teams](https://code.claude.com/docs/en/agent-teams) for complex tasks that benefit from parallel collaboration. Agent Teams spawn multiple Claude instances that communicate directly and share a task list.

### When Teams Are Used

Teams are activated automatically when the feature is enabled and the task meets complexity thresholds:

| Agent | Team Trigger | Team Structure |
|-------|-------------|----------------|
| Eqa-orchestrator | 3+ distinct test/source groups | Test Engineer + Code Reviewer in parallel |
| Etask-executor | 5+ independent checklist items | One teammate per file group |
| Edeep-researcher | 3+ research sources/perspectives | Researchers + Devil's Advocate |

### Enable Agent Teams

Add to `.claude/settings.json`:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

All agents fall back to their existing Subagent behavior when Agent Teams is not enabled.

See [AGENT_TEAMS.md](core/AGENT_TEAMS.md) for detailed configuration and team patterns.

## Project Structure

```
qe-framework/
├── .claude-plugin/    # Plugin configuration
├── agents/            # 16 agents (E-prefix)
├── skills/            # 63 core + 72 coding expert skills (Q-prefix)
├── core/              # Shared principles & configuration
├── hooks/             # Lifecycle hooks
├── install.js         # Installation script
└── package.json
```

## License

UNLICENSED
