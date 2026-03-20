<div align="center">

<br/>

# QE Framework

### Spec-Driven Task Execution for Claude Code

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=22&pause=1000&color=60A5FA&center=true&vCenter=true&width=500&lines=Work+without+a+spec+is+guesswork.;A+spec+without+verification+is+hope.;Verification+without+supervision+is+bias.)](https://github.com/inho-team/qe-framework)

<br/>

![Stars](https://img.shields.io/github/stars/inho-team/qe-framework?style=social)
![Forks](https://img.shields.io/github/forks/inho-team/qe-framework?style=social)
![Watchers](https://img.shields.io/github/watchers/inho-team/qe-framework?style=social)

![Release](https://img.shields.io/github/v/release/inho-team/qe-framework?style=flat&logo=github&color=8B5CF6)
![Last Commit](https://img.shields.io/github/last-commit/inho-team/qe-framework?style=flat&logo=git&color=22C55E)
![Repo Size](https://img.shields.io/github/repo-size/inho-team/qe-framework?style=flat&logo=database&color=D97706)
![License](https://img.shields.io/github/license/inho-team/qe-framework?style=flat&color=60A5FA)

[![Built with Claude](https://img.shields.io/badge/Built_with-Claude-D4A574?style=flat&logo=anthropic&logoColor=white)](https://claude.ai)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-Plugin-22C55E?style=flat)](https://code.claude.com)
[![65 Skills](https://img.shields.io/badge/Skills-65-8B5CF6?style=flat)](#skills-65--72-coding-experts)
[![72 Coding Experts](https://img.shields.io/badge/Coding_Experts-72-EC4899?style=flat)](#coding-expert-skills-72)
[![22 Agents](https://img.shields.io/badge/Agents-22-F97316?style=flat)](#agents-22)

<br/>

**Overview:** [Philosophy](#philosophy) · [SVS Loop](#philosophy) · [Architecture](#architecture) · [How It Works](#background-processing)

**Get Started:** [Installation](#installation) · [Initialize](#initialize-a-project) · [Usage](#usage)

**Reference:** [Skills](#skills-65--72-coding-experts) · [Coding Experts](#coding-expert-skills-72) · [Agents](#agents-22) · [Hooks](#lifecycle-hooks) · [Agent Teams](#agent-teams-experimental)

**[English](README.md)** | [한국어](docs/README.ko.md) | [中文](docs/README.zh.md) | [日本語](docs/README.ja.md)

</div>

---

> [!IMPORTANT]
> **QE Framework v2.2.0** — Agent Teams detection infrastructure, team mode rewrite for all agents, task history extracted from CLAUDE.md to `.qe/TASK_LOG.md`.
>
> **[Changelog](CHANGELOG.md)** | **[Update instructions](#update-to-latest-version)**

> [!CAUTION]
> This project is under active development. Breaking changes may occur between minor versions.

---

<div align="center">

## Every query deserves a spec. Every spec deserves verification.

</div>

## Philosophy

QE Framework turns vague requests into spec-driven, verified, and supervised task execution through the **SVS Loop** (Spec → Verify → Supervise):

```
/Qgenerate-spec  →  /Qrun-task  →  Supervision  →  Done
                                        ↑                |
                           auto-remediate (max 3x)  ← FAIL
```

| Step | What Happens |
|------|-------------|
| **`/Qgenerate-spec`** | Creates TASK_REQUEST + VERIFY_CHECKLIST. A Plan agent auto-reviews the spec for executability. |
| **`/Qrun-task`** | Executes checklist items with progress tracking. Shows task type banner (CODE / DOCS / ANALYSIS). |
| **Supervision** | Domain-specific supervisors (code quality, security, docs, analysis) do independent review. Failures auto-remediate up to 3x. |
| **Result** | You're only asked at 5 points. Everything else is automatic. |

Engineering principles: SOLID, DRY, KISS, YAGNI, evidence-based decisions, minimal change, multilingual (auto language detection).

---

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

---

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

---

## Usage

### Task Workflow

Generate a spec, then execute it:

```
/Qgenerate-spec    → Creates TASK_REQUEST.md + VERIFY_CHECKLIST.md
/Qrun-task         → Executes the task with automatic quality verification
```

### Commit Changes

```
/Qcommit           → Human-style commits with no AI traces
```

### Debugging

```
/Qsystematic-debugging   → Root cause analysis before applying fixes
```

### Deep Research

Invoke the `Edeep-researcher` agent for technology comparison, architecture decisions, or investigative tasks.

### More Examples

```
/Qgenerate-spec + /Qrun-task     → Full task lifecycle
/Qfrontend-design                → Create production-grade UI components
/Qtest-driven-development        → Red-green-refactor TDD workflow
/Qgrad-paper-write               → Academic paper drafting
/Qc4-architecture                → C4 model architecture diagrams
/Qrefresh                        → Update project analysis data
```

---

## Skills (65 + 72 Coding Experts)

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
| Qstitch-cli | Google Stitch MCP setup and CLI guide for AI-powered UI design. |
| Qcc-setup | Claude Code shell alias setup (cc, ccc, ccd) for quick terminal launch. |

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

### Analysis

| Skill | Description |
|-------|-------------|
| Qdata-analysis | Data exploration, statistical analysis, and visualization for CSV/JSON/Excel datasets. |
| Qfinance-analyst | Financial analysis, valuation modeling, DCF, Monte Carlo simulation, and portfolio optimization. |
| Qfact-checker | Extracts factual claims from documents and verifies them through evidence-based research. |
| Qsource-verifier | Verifies source credibility and digital content authenticity using the SIFT method. |

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

---

## Coding Expert Skills (72)

Domain-specific coding experts organized by category. Each skill provides deep expertise in its technology stack, including best practices, common patterns, and production-ready code generation.

<details>
<summary><strong>Languages (14)</strong></summary>

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

</details>

<details>
<summary><strong>Frontend (12)</strong></summary>

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

</details>

<details>
<summary><strong>Backend (14)</strong></summary>

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

</details>

<details>
<summary><strong>Data & AI (6)</strong></summary>

| Skill | Description |
|-------|-------------|
| Qfine-tuning-expert | LoRA/QLoRA, PEFT, instruction tuning, RLHF, DPO, and model quantization. |
| Qml-pipeline | MLflow, Kubeflow, Airflow, feature stores, and experiment tracking. |
| Qpandas-pro | DataFrame operations, aggregation, merging, time series, and performance optimization. |
| Qprompt-engineer | Prompt design, chain-of-thought, few-shot learning, and evaluation frameworks. |
| Qrag-architect | RAG systems, vector databases, hybrid search, reranking, and embedding pipelines. |
| Qspark-engineer | Spark DataFrame transformations, SQL optimization, and structured streaming. |

</details>

<details>
<summary><strong>Infra & DevOps (14)</strong></summary>

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

</details>

<details>
<summary><strong>Quality & Security (12)</strong></summary>

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

</details>

---

## Background Processing

QE Framework runs several agents silently in the background at key lifecycle moments. These agents require no manual invocation — they are triggered automatically by hooks.

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
│                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Lifecycle Hooks

The framework uses 9 lifecycle hooks that fire at specific events:

| Hook | Trigger | What Happens |
|------|---------|--------------|
| `SessionStart` | Conversation begins | Injects framework rules, triggers `Erefresh-executor` if analysis is stale |
| `UserPromptSubmit` | User sends a message | **i18n intent classification** via Haiku translation + **language detection** |
| `PreToolUse` | Before every tool call | Intent Gate routing, secret scanning, context pressure warnings, **Agent Teams file ownership guard** |
| `PostToolUse` | After every tool call | Error tracking/escalation, tool call counting, `Eprofile-collector` trigger |
| `PreCompact` | Before context compaction | Triggers `Ecompact-executor` to save context before it is lost |
| `Stop` | Conversation ends | Session log recording, mode blocking for active work |
| `Notification` | Background agent completes | Chains follow-up actions when background agents finish |
| `TaskCompleted` | Task finishes | Validates verify checklist completion before allowing task close |
| `TeammateIdle` | Agent team member idles | Reads pending tasks/checklists, suggests next work, keeps teammate active via exit code 2 |

---

## Agents (22)

Agents are automatically assigned a model tier based on task complexity. See [AGENT_TIERS.md](core/AGENT_TIERS.md) for details.

<details>
<summary><strong>HIGH Tier (opus) — 3 agents</strong></summary>

| Agent | Description |
|-------|-------------|
| Edeep-researcher | Systematic multi-step research agent for technology comparison and decision support. |
| Eqa-orchestrator | Executes the full test, review, fix quality loop. Protects the main context. |
| Esupervision-orchestrator | Supervision orchestrator. Routes to domain supervisors, aggregates PASS/PARTIAL/FAIL grades. |

</details>

<details>
<summary><strong>MEDIUM Tier (sonnet) — 15 agents</strong></summary>

| Agent | Description |
|-------|-------------|
| Etask-executor | Implements checklist items in order. Supports wave-based parallel execution. |
| Ecode-debugger | Debugging specialist. Analyzes bug root causes, traces errors, and troubleshoots. |
| Ecode-reviewer | Code review specialist. Reviews quality, security, performance, and pattern compliance. |
| Ecode-test-engineer | Test engineer. Handles test writing, coverage analysis, and test strategy. |
| Ecode-doc-writer | Technical documentation specialist. Writes code explanations, API docs, and READMEs. |
| Ecode-quality-supervisor | Code quality audit supervisor. Returns PASS/PARTIAL/FAIL. |
| Edocs-supervisor | Documentation audit supervisor. Returns PASS/PARTIAL/FAIL. |
| Eanalysis-supervisor | Analysis audit supervisor. Returns PASS/PARTIAL/FAIL. |
| Esecurity-officer | Security audit specialist. Scans git diff changes for vulnerabilities. |
| Edoc-generator | Background sub-agent for batch document generation (docx/pdf/pptx/xlsx). |
| Egrad-writer | Writes academic paper chapters with academic writing style and citation rules. |
| Epm-planner | Planning specialist. Handles PRD, user stories, roadmap, and document generation. |
| Erefresh-executor | Detects project changes, updates .qe/ analysis data, and records change history. |
| Ecompact-executor | Detects context window pressure, saves context, and supports restoration. |
| Ehandoff-executor | Generates and validates session handoff documents. |

</details>

<details>
<summary><strong>LOW Tier (haiku) — 3 agents</strong></summary>

| Agent | Description |
|-------|-------------|
| Earchive-executor | Archives completed task files into .qe/.archive/ by version. |
| Ecommit-executor | Analyzes diffs, generates commit messages, and stages files with no AI traces. |
| Eprofile-collector | Collects user command patterns, writing style, and correction history. |

</details>

---

## Agent Teams (Experimental)

QE Framework supports [Claude Agent Teams](https://code.claude.com/docs/en/agent-teams) for complex tasks that benefit from parallel collaboration. Agent Teams spawns **separate Claude Code instances** as teammates — fundamentally different from Agent tool subagents.

| Agent | Team Trigger | Team Structure | Lead Model |
|-------|-------------|----------------|------------|
| Eqa-orchestrator | 3+ distinct test/source groups | test-engineer + reviewer | opus |
| Etask-executor | 5+ independent checklist items | 1 teammate per file group | sonnet |
| Edeep-researcher | 3+ research sources/perspectives | researchers + devils-advocate | opus |

Teams are created via **natural language request**, not Agent tool calls. Each teammate gets its own context window, file ownership partition, and model assignment.

| Mechanism | Purpose |
|-----------|---------|
| Messages | Direct peer-to-peer communication |
| Shared task list | Work coordination and dependencies |
| File ownership | Each teammate edits only assigned files |
| TeammateIdle hook | Keeps idle teammates working on pending tasks |

To enable, add to `.claude/settings.json`:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

All agents fall back to Subagent behavior when Agent Teams is not enabled. See [AGENT_TEAMS.md](core/AGENT_TEAMS.md) for details.

---

## Project Structure

```
qe-framework/
├── .claude-plugin/    # Plugin configuration
├── agents/            # 22 agents (E-prefix)
├── skills/            # 65 core + 72 coding expert skills (Q-prefix)
├── core/              # Shared principles & configuration
├── hooks/             # 9 lifecycle hooks + i18n translation layer
├── install.js         # Installation script
└── package.json
```

---

## License

UNLICENSED
