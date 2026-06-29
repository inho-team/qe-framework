# QE Framework

**Query Execute Framework for Claude Code and Codex**

> <!--qe:skills-->105<!--/qe:skills--> skills | <!--qe:agents-->27<!--/qe:agents--> agents | Folder-aware context memory | SIVS quality gate

---

### 📖 Try it in your browser — 5-minute tour

**English** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.en.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.en.html)
**한국어** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.ko.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.ko.html)
**日本語** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.ja.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.ja.html)
**中文** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.zh.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.zh.html)

Rendered guides — view in any browser, no install needed.

---

```
Claude: /Qplan  →  /Qgs  →  /Qatomic-run  →  /Qcode-run-task
Codex:  $Qplan  →  $Qgs  →  $Qatomic-run  →  $Qcode-run-task
        Plan       Spec     Execute          Verify
```

---

## Why QE?

Everything you do with AI comes down to two things: **Query** and **Execute**.

"Why is this bug happening?" — that's a Query.
"Fix it." — that's an Execute.
"Run the tests", "commit this", "is this architecture right?" — all just Q and E, over and over.

The problem is, raw AI doesn't do either well on its own. Query without context gives shallow answers. Execute without verification gives unchecked results. And the precision of your question determines the quality of the output — but maintaining that precision every time is exhausting.

**QE Framework puts structure between Query and Execute.**

```
  You say             QE does                    You get
─────────────────────────────────────────────────────────
  "what to do"   →   Plan → Spec (refine Q)   →  precise query
  "do it"        →   Implement → Verify → S   →  verified result
```

You only say **what you want**. How to ask the right question, how to verify the result — the framework handles that.

```
┌─────────────────────────────────────────────────┐
│                  QE Framework                   │
│                                                 │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐ │
│  │  Context   │  │   SIVS    │  │   178+      │ │
│  │  Memory    │  │   Loop    │  │   Skills    │ │
│  │  Manager   │  │   Engine  │  │   Library   │ │
│  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘ │
│        │              │               │         │
│        └──────────────┼───────────────┘         │
│                       │                         │
│              ┌────────┴────────┐                │
│              │ Claude / Codex  │                │
│              └─────────────────┘                │
└─────────────────────────────────────────────────┘
```

| Problem | QE Solution |
|---------|-------------|
| Context window fills with irrelevant info | **Folder-aware context** — loads only what matches your working directory |
| No structured workflow for complex tasks | **PSE Chain** — Plan → Spec → Execute → Verify pipeline |
| Quality depends on prompt quality | **SIVS Loop** — automated Spec → Implement → Verify → Supervise gate |
| No model routing control | **SIVS Config** — route each stage to Claude or Codex independently |
| Token waste on repeated scans | **Context Memory** — pre-analyzed project knowledge, auto-refreshed |

---

## Install

QE Framework installs as a **dual-target Claude + Codex framework**. The Claude
plugin is the distribution anchor, and Codex-native assets are installed when
`~/.codex` exists; see
[`docs/INSTALL.md`](docs/INSTALL.md) and the measured
[`VERIFICATION_MATRIX.md`](.qe/planning/plans/codex-native-parity/VERIFICATION_MATRIX.md)
for the support boundary.

Install the Claude plugin with two commands:

```bash
# 1. Register the marketplace
claude plugin marketplace add inho-team/qe-framework

# 2. Install the plugin
claude plugin install qe-framework@inho-team-qe-framework
```

That installs Claude assets and, when `~/.codex` exists, synchronizes Codex
assets too: 105 native skills, 27 generated agent TOML files, copied scripts,
and a managed `PreToolUse` hook fence pointing at the installed QE hook bundle.
After a Codex install, run `/hooks` inside Codex once to review and trust the QE
safety hook.

**SSH error?** If installation fails with `Host key verification failed`, set git to use HTTPS:
```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```
Then retry the install command.

**Verify installation:**
```bash
claude plugin list
# Should show: qe-framework@inho-team-qe-framework ✔ enabled
```

**Update:**
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

**Uninstall:**
```bash
claude plugin uninstall qe-framework@inho-team-qe-framework
```

### Alternative: Local development mode

If you're developing or contributing to QE Framework itself:

```bash
git clone https://github.com/inho-team/qe-framework.git
cd your-project
claude --plugin-dir /path/to/qe-framework
```

---

## Quick Start

In Claude, you only need to remember two commands:

```
/Qinit    # Set up project, choose engine routing (Claude, Codex, or hybrid)
/Qplan    # Start working — the framework guides you through every next step
```

`/Qinit` asks how you want to assign engines to each stage (Spec, Implement, Verify, Supervise). Pick a single engine or mix Claude and Codex — your choice. After that, `/Qplan` takes over and tells you exactly what to run next.

In Codex, use the same skill names with the Codex skill prefix:

```text
$Qinit
$Qplan
```

Shared QE skills render follow-up commands with the active client prefix:
Claude uses `/Q...`; Codex uses `$Q...`.

---

## Architecture

### PSE Chain (User Workflow)

The 4-step pipeline that drives all work:

| Step | Skill | What it does |
|------|-------|-------------|
| **Plan** | `/Qplan` | Roadmap, phases, requirements |
| **Spec** | `/Qgs` | TASK_REQUEST + VERIFY_CHECKLIST generation |
| **Execute** | `/Qatomic-run` | Parallel Wave execution with Haiku Teammates |
| **Verify** | `/Qcode-run-task` | Test → review → fix quality loop |

`/Qrun-task` is the sequential fallback when tasks can't be parallelized.

Codex uses the same PSE skills with `$Q...`. The QE client adapter maps Claude
Agent-tool workflows onto Codex native subagents and falls back to role-separated
inline execution only when the active Codex runtime does not expose a required
native subagent primitive.

### SIVS Loop (Quality Gate)

Runs inside Execute and Verify steps:

```
     ┌──────────────────────────────────────┐
     │            SIVS Loop                 │
     │                                      │
     │  Spec ──► Implement ──► Verify ──►  │
     │   (S)       (I)          (V)        │
     │                                      │
     │              ┌─── PASS ──► Done     │
     │   Supervise ─┤                       │
     │     (S)      └─── FAIL ──► Remediate │
     │                     │                │
     │                     └──► Spec (retry)│
     └──────────────────────────────────────┘
```

### Multi-Engine Routing

The problem with single-model workflows: the same model that writes the spec also implements it, reviews it, and approves it. That's self-grading.

QE solves this by letting you **assign a different engine to each SIVS stage**. Without Codex, Claude handles all stages. When Codex is available, Implement and Verify prefer Codex by default to reduce Claude session token pressure, while Spec and Supervise remain Claude-led unless you explicitly reroute them. Routing is bidirectional: a Claude base session can route Codex stages through `codex-plugin-cc`, and a Codex base session can route Claude stages back through `Qclaude-rescue` plus `claude_bridge.mjs` (the reverse of `codex-plugin-cc`'s `/codex:rescue`).

You decide what fits your project. Some examples:

```
Solo developer, simple project:
  Spec → Claude    Implement → Claude    Verify → Claude    Supervise → Claude
  (no Codex installed — just use Claude for everything, zero config needed)

Claude session token saver:
  Spec → Claude    Implement → Codex     Verify → Codex     Supervise → Claude
  (default when Codex is available — Claude thinks, Codex does heavy execution)

Maximum independence:
  Spec → Claude    Implement → Codex     Verify → Claude    Supervise → Codex
  (no stage shares the same engine with its neighbor)
```

Pick a setup with one command:

```
/Qsivs-config verify codex --background true # long verify job in Codex background
/Qsivs-config set --all claude               # route every stage to Claude
/Qsivs-config                                # see current setup
/Qsivs-config --help                         # full options
```

No Codex? No problem. No Claude delegation from Codex? Also fine. Each base runs
solo with zero config, and routing activates only when you opt into the bridge
for the other engine. The four base/engine combinations are documented in
`.qe/planning/plans/codex-native-parity/VERIFICATION_MATRIX.md`.

### Folder-Aware Context Memory

**The key differentiator.** Instead of loading one massive CLAUDE.md, QE partitions context by folder:

```
.qe/context/
├── _registry.json       # folder ↔ context mapping
├── root.md              # always loaded (project-wide rules)
├── frontend.md          # loaded only in src/frontend/**
├── backend.md           # loaded only in src/backend/**
└── scripts.md           # loaded only in scripts/**
```

```
Working in src/frontend/components/Button.tsx
  → Loads: root.md + frontend.md
  → Skips: backend.md, scripts.md, infra.md
  → Result: loads only matched context — fewer tokens per turn
            (savings vary by project; measure with docs/BENCHMARK.md)
```

| Command | Description |
|---------|-------------|
| `/Qcontext init` | Initialize context partitioning |
| `/Qcontext add backend "src/backend/**"` | Add a folder context |
| `/Qcontext show` | View all contexts + staleness status |
| `/Qcontext refresh` | Auto-update stale contexts |
| `/Qcontext status src/api/` | Preview which contexts would load |

Auto-refreshed via `/Qrefresh` integration.

### Model Tiering

| Model | Use | Examples |
|-------|-----|---------|
| **Haiku** | Simple, parallel tasks | Wave Teammates, archiving, data refresh |
| **Sonnet** | Code implementation | Etask-executor, Ecode-reviewer |
| **Opus** | Strategy, architecture | /Qplan, Edeep-researcher |

Delegation Enforcer auto-injects the correct model via pre-tool-use hook.

### Token Efficiency (Enforced)

| Mechanism | Behavior |
|-----------|----------|
| **Folder Context** | Loads only relevant context per working directory |
| **ContextMemo** | Blocks duplicate file reads at hook level (`exit 2`) |
| **Auto-compaction** | Triggers Ecompact-executor at 140k tokens, mandatory at 170k |
| **Persistent Mode** | Prevents Claude from stopping mid-pipeline |
| **Skill size limit** | 250 lines max per SKILL.md, excess → `references/` |

---

## Skill Library (<!--qe:skills-->105<!--/qe:skills--> skills)

> **Start here.** You only need **7 core skills** to use the framework end-to-end. The
> other 170+ are an opt-in library that ships in the *same package* — no extra installs,
> no separate plugins. New here? Learn these and ignore the rest until you need them:
>
> `/Qinit` · `/Qcontext` · `/Qplan` · `/Qgs` · `/Qatomic-run` · `/Qcode-run-task` · `/Qsivs-config`
>
> *(these carry `tier: core` in their frontmatter; everything else is treated as `extended` — no tag needed. The breadth is a curated library, not a packaging burden — one install, progressive disclosure.)*

### Core Skills

| Category | Skills | Count |
|----------|--------|-------|
| **PSE Chain** *(workflow, ≠ `tier: core`)* | `Qplan` `Qgs` `Qatomic-run` `Qrun-task` `Qcode-run-task` `Qinit` | 6 |
| **Autonomy** ⚠️ | `Qutopia` *(auto-approves everything — read warning below before using)* | 1 |
| **Context & Config** | `Qcontext` `Qsivs-config` `Qrefresh` `Qmemory` `Qcompact` | 5 |
| **Project** | `Qmap-codebase` `Qcommit` `Qbranch` `Qarchive` `Qproject-sync` | 5 |
| **PM** | `Qpm-prd` `Qpm-roadmap` `Qpm-okr` `Qpm-retro` `Qpm-strategy` `Qpm-gtm` | 6 |
| **Quality** | `Qsystematic-debugging` `Qtest-driven-development` `Qgc` `Qsource-verifier` | 4 |
| **Docs & Output** | `Qdocx` `Qpdf` `Qpptx` `Qxlsx` `Qdoc-converter` `Qdoc-comment` | 6 |
| **Academic** | `Qgrad-paper-write` `Qgrad-research-plan` `Qgrad-seminar-prep` `Qgrad-thesis-manage` | 4 |
| **Research** | `Qautoresearch` `Qfact-checker` `Qsource-verifier` `Qdata-analysis` | 4 |
| **More** | `/Qfind-skills` or `/Qhelp` to discover all | 54+ |

#### ⚠️ Autonomous Mode (`/Qutopia`) — Use With Caution

`/Qutopia` flips a session-level switch (`.qe/state/utopia-state.json`) that makes **every** subsequent skill:

- **Skip `AskUserQuestion`** and auto-pick the first (recommended) option
- **Auto-approve** `Qrun-task` execution and `Qgenerate-spec` outputs
- **Auto-commit** (and, with `--ralph`, loop until `VERIFY_CHECKLIST` is fully green)
- Merge broad tool permissions (`Bash(*)`, `Agent(*)`, `WebFetch`, …) into `.claude/settings.json`

**Why this is dangerous.** The "recommended" option is not always what *you* would pick. In an ambiguous spec or a mixed-scope commit, the default can silently commit wrong files, push to `main`, or chain into irreversible steps. Qutopia trades your oversight for wall-clock speed.

**Only enable Qutopia when ALL of the following hold:**

1. The task is well-defined and repetitive (e.g., applying a known fix across many files)
2. Every step is reversible (no `push --force`, no schema migrations on prod, no destructive deletes)
3. You accept that commits/pushes may happen without re-confirmation

**Do NOT enable Qutopia for:** exploratory work, new project kick-offs, ambiguous requirements, first-time tools, or anything on a shared/production branch.

**Recommended lifecycle:** `/Qutopia status` → `/Qutopia` (or `--work` / `--qa`) → do one bounded task → `/Qutopia off`. Leaving it on across sessions is how accidents happen.

### Coding Expert Skills (71 experts)

Domain-specific best practices organized by category:

```
coding-experts/
├── backend/      14 experts    ├── frontend/    12 experts
├── languages/    13 experts    ├── infra/       14 experts
├── quality/      12 experts    └── data/         6 experts
```

<details>
<summary><b>Backend (14)</b></summary>

| Expert | Domain |
|--------|--------|
| `Qapi-designer` | REST API design, OpenAPI |
| `Qarchitecture-designer` | System design, ADR |
| `Qdjango-expert` | Django, DRF |
| `Qdotnet-core-expert` | .NET Core, EF |
| `Qfastapi-expert` | FastAPI, async SQLAlchemy |
| `Qgraphql-architect` | GraphQL, Federation |
| `Qlaravel-specialist` | Laravel, Eloquent |
| `Qlegacy-modernizer` | Legacy migration |
| `Qmcp-developer` | MCP protocol, SDK |
| `Qmicroservices-architect` | Microservices patterns |
| `Qnestjs-expert` | NestJS, DI |
| `Qrails-expert` | Rails, Hotwire |
| `Qspring-boot-engineer` | Spring Boot |
| `Qwebsocket-engineer` | WebSocket, scaling |

</details>

<details>
<summary><b>Frontend (12)</b></summary>

| Expert | Domain |
|--------|--------|
| `Qangular-architect` | Angular, NgRx, RxJS |
| `Qflutter-expert` | Flutter, Bloc, Riverpod |
| `Qgame-developer` | Unity, Unreal, ECS |
| `Qnextjs-developer` | Next.js App Router, RSC |
| `Qreact-best-practices` | React performance rules |
| `Qreact-expert` | React 19, hooks, state |
| `Qreact-native-expert` | React Native, Expo |
| `Qvite` | Vite, Rolldown |
| `Qvue-best-practices` | Vue 3 performance rules |
| `Qvue-expert` | Vue 3 + TypeScript |
| `Qvue-expert-js` | Vue 3 + JavaScript |
| `Qweb-design-guidelines-vercel` | Vercel design system |

</details>

<details>
<summary><b>Languages (13)</b></summary>

| Expert | Domain |
|--------|--------|
| `Qcpp-pro` | Modern C++, concurrency |
| `Qcsharp-developer` | C#, ASP.NET, Blazor |
| `Qembedded-systems` | MCU, RTOS, protocols |
| `Qgolang` / `Qgolang-pro` | Go patterns, concurrency |
| `Qjava-architect` | Spring, JPA, WebFlux |
| `Qjs-ts-expert` | JavaScript/TypeScript |
| `Qkotlin-specialist` | Kotlin, KMP, Compose |
| `Qphp-pro` | PHP, Laravel, Symfony |
| `Qpython-pro` | Python, async, typing |
| `Qrust-engineer` | Rust, ownership, async |
| `Qsql-pro` | SQL optimization |
| `Qswift-expert` | Swift, SwiftUI |

</details>

<details>
<summary><b>Infra (14)</b></summary>

| Expert | Domain |
|--------|--------|
| `Qatlassian-mcp` | Jira, Confluence MCP |
| `Qchaos-engineer` | Chaos testing |
| `Qcli-developer` | CLI tools (Go/Node/Python) |
| `Qcloud-architect` | AWS, GCP, Azure |
| `Qdatabase-optimizer` | DB performance tuning |
| `Qdevops-engineer` | CI/CD, Docker, K8s |
| `Qkubernetes-specialist` | K8s, Helm, GitOps |
| `Qmonitoring-expert` | Observability, alerting |
| `Qpostgres-pro` | PostgreSQL advanced |
| `Qsalesforce-developer` | Apex, LWC |
| `Qshopify-expert` | Shopify, Liquid |
| `Qsre-engineer` | SRE, SLO/SLI |
| `Qterraform-engineer` | Terraform, IaC |
| `Qwordpress-pro` | WordPress, Gutenberg |

</details>

<details>
<summary><b>Quality (12) & Data (6)</b></summary>

**Quality:**

| Expert | Domain |
|--------|--------|
| `Qcode-documenter` | Code documentation |
| `Qcode-reviewer` | Code review |
| `Qdebugging-wizard` | Systematic debugging |
| `Qfeature-forge` | Feature spec mining |
| `Qfullstack-guardian` | Full-stack patterns |
| `Qplaywright-expert` | E2E testing |
| `Qsecure-code-guardian` | OWASP, security |
| `Qsecurity-reviewer` | Security audit |
| `Qspec-miner` | Spec analysis |
| `Qtest-master` | Test strategy |
| `Qthe-fool` | Devil's advocate |
| `Qvitest` | Vitest testing |

**Data:**

| Expert | Domain |
|--------|--------|
| `Qfine-tuning-expert` | Model fine-tuning |
| `Qml-pipeline` | ML pipelines |
| `Qpandas-pro` | Pandas, DataFrames |
| `Qprompt-engineer` | Prompt engineering |
| `Qrag-architect` | RAG systems |
| `Qspark-engineer` | Apache Spark |

</details>

---

## Agent Fleet (<!--qe:agents-->27<!--/qe:agents--> agents)

| Agent | Role |
|-------|------|
| **Etask-executor** | Complex checklist implementation (5+ items) |
| **Eqa-orchestrator** | Test → review → fix quality loop |
| **Esupervision-orchestrator** | Routes to domain supervisors, aggregates grades |
| **Ecode-reviewer** | Code review after changes |
| **Ecode-test-engineer** | Test writing and coverage |
| **Ecommit-executor** | AI-trace-free git commits |
| **Erefresh-executor** | Project analysis + context refresh |
| **Edeep-researcher** | Multi-source research |
| **Esecurity-officer** | Security audit on diffs |
| **Ecompact-executor** | Context window pressure management |
| **Epm-planner** | PRD, roadmap, document generation |
| +10 more | Archiving, profiling, handoff, doc generation... |

---

## Configuration

### SIVS Engine Routing

```bash
/Qsivs-config                    # Show current routing
/Qsivs-config implement codex    # Route implement stage to Codex
/Qsivs-config --help             # Full usage guide
```

Config file: `.qe/sivs-config.json`

```json
{
  "spec":      { "engine": "claude" },
  "implement": { "engine": "codex", "model": "gpt-5.4", "effort": "high" },
  "verify":    { "engine": "codex", "background": true },
  "supervise": { "engine": "claude" }
}
```

### Folder Context Memory

```bash
/Qcontext init                              # Initialize
/Qcontext add frontend "src/frontend/**"    # Add folder context
/Qcontext show                              # View all + staleness
/Qcontext refresh                           # Update stale contexts
/Qcontext --help                            # Full usage guide
```

---

## Project Structure

```
qe-framework/
├── skills/                  # 178 skill definitions
│   ├── Q*/                  # 87 user-facing skills
│   ├── M*/                  # 7 maintenance skills
│   └── coding-experts/      # 71 domain expert skills
├── agents/                  # 21 agent definitions
├── core/                    # Principles, schemas, rules
├── scripts/                 # Runtime utilities + shared libs
├── hooks/                   # Git/session hooks
├── docs/                    # Guides and references
└── .qe/                    # Project state (per-project)
    ├── context/             # Folder-aware context memory
    ├── sivs-config.json     # Engine routing config
    └── tasks/               # Task tracking
```

---

## Documentation

| Doc | Path |
|-----|------|
| System Overview | [docs/SYSTEM_OVERVIEW.md](docs/SYSTEM_OVERVIEW.md) |
| Philosophy | [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) |
| Usage Guide | [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md) |
| Conventions | [QE_CONVENTIONS.md](QE_CONVENTIONS.md) |
| Secret Management | [docs/SECRETS.md](docs/SECRETS.md) |
| Multi-Model Setup | [docs/MULTI_MODEL_SETUP.md](docs/MULTI_MODEL_SETUP.md) |
| Contract Layer | [docs/contract-layer.md](docs/contract-layer.md) |

| Language | Path |
|----------|------|
| Korean | [docs/README.ko.md](docs/README.ko.md) |
| Japanese | [docs/README.ja.md](docs/README.ja.md) |
| Chinese | [docs/README.zh.md](docs/README.zh.md) |

---

## Version

`6.3.0` — Plugin-based installation, Qdebate, Qperspective, Qplan micro-task support, 167 skills.

## License

MIT. See [LICENSE](LICENSE).
