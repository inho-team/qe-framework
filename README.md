# QE Framework

**Query Execute Framework for Claude Code and Codex**

> <!--qe:skills-->46<!--/qe:skills--> skills | <!--qe:agents-->28<!--/qe:agents--> agents | Folder-aware context memory | SIVS quality gate

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

The shared adapter vocabulary is defined in
[`core/INTERACTION_ADAPTER.md`](core/INTERACTION_ADAPTER.md),
[`core/LIFECYCLE_ADAPTER.md`](core/LIFECYCLE_ADAPTER.md), and the Phase 1
[`ADAPTER_CONTRACT.md`](.qe/planning/plans/claude-codex-generalization/phases/1/ADAPTER_CONTRACT.md).
The Phase 4 public-doc parity pass is recorded in
[`PARITY_VERIFICATION_REPORT.md`](.qe/planning/plans/claude-codex-generalization/phases/4/PARITY_VERIFICATION_REPORT.md).

Install the Claude plugin with two commands:

```bash
# 1. Register the marketplace
claude plugin marketplace add inho-team/qe-framework

# 2. Install the plugin
claude plugin install qe-framework@inho-team-qe-framework
```

That installs Claude assets and, when `~/.codex` exists, synchronizes Codex
assets too: native skills, generated agent TOML files, copied scripts, and a
managed lifecycle hook fence pointing at the installed QE hook bundle. After a
Codex install, run the hooks review command inside Codex once to review and
trust the QE safety hook.

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

### Companion MCP setup

QE Framework is distributed separately from its MCP companions. Install the
plugin first, then connect `qe-mcp` for expert-library and cross-agent runner
tools:

```bash
npm install -g @inho-team/qe-mcp
qe-mcp init-registry
qe-mcp sync --client claude
qe-mcp sync --client codex
```

Use `qe-mcp sync --dry-run --client claude` or
`qe-mcp sync --dry-run --client codex` before applying if you want to inspect
the client config writes. Restart Claude Code or Codex after syncing.

The normal user-facing companion is `qe-mcp`. Maintainers may additionally
connect `qe-admin-mcp` for release, bump, skill-test, audit, and migration
workflows. See [`docs/MCP_GLOBAL_SETUP.md`](docs/MCP_GLOBAL_SETUP.md).

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

Every follow-up command should keep the active client prefix: Claude `/Q...`, Codex `$Q...`.

Shared QE skills render follow-up commands with the active client prefix:
Claude uses `/Q...`; Codex uses `$Q...`.

`Qinit` creates the active client's project instruction artifact. Claude uses
`CLAUDE.md`; Codex-capable projects may use `AGENTS.md`. Shared QE state and
task history live under `.qe/`, with `QE_CONVENTIONS.md` as the common rule
reference.

---

## Architecture

### PSE Chain (User Workflow)

The 4-step pipeline that drives all work:

| Step | Claude | Codex | What it does |
|------|--------|-------|-------------|
| **Plan** | `/Qplan` | `$Qplan` | Roadmap, phases, requirements |
| **Spec** | `/Qgs` | `$Qgs` | TASK_REQUEST + VERIFY_CHECKLIST generation |
| **Execute** | `/Qatomic-run` | `$Qatomic-run` | Parallel Wave execution with Haiku Teammates |
| **Verify** | `/Qcode-run-task` | `$Qcode-run-task` | Test → review → fix quality loop |

`/Qrun-task` (`$Qrun-task` on Codex) is the sequential fallback when tasks can't be parallelized.

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

Pick a setup with the active client prefix:

```
Claude: /Qsivs-config verify codex --background true # long verify job in Codex background
Codex:  $Qsivs-config verify codex --background true
Claude: /Qsivs-config set --all claude               # route every stage to Claude
Codex:  $Qsivs-config set --all claude
Claude: /Qsivs-config                                # see current setup
Codex:  $Qsivs-config
Claude: /Qsivs-config --help                         # full options
Codex:  $Qsivs-config --help
```

No Codex? No problem. No Claude delegation from Codex? Also fine. Each base runs
solo with zero config, and routing activates only when you opt into the bridge
for the other engine. The four base/engine combinations are documented in
`.qe/planning/plans/codex-native-parity/VERIFICATION_MATRIX.md`.

### Folder-Aware Context Memory

**The key differentiator.** Instead of loading one massive project instruction artifact, QE partitions context by folder:

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

| Claude | Codex | Description |
|--------|-------|-------------|
| `/Qcontext init` | `$Qcontext init` | Initialize context partitioning |
| `/Qcontext add backend "src/backend/**"` | `$Qcontext add backend "src/backend/**"` | Add a folder context |
| `/Qcontext show` | `$Qcontext show` | View all contexts + staleness status |
| `/Qcontext refresh` | `$Qcontext refresh` | Auto-update stale contexts |
| `/Qcontext status src/api/` | `$Qcontext status src/api/` | Preview which contexts would load |

Auto-refreshed via the active-client `Qrefresh` integration.

### Model Tiering

| Model | Use | Examples |
|-------|-----|---------|
| **Haiku** | Simple, parallel tasks | Wave Teammates, archiving, data refresh |
| **Sonnet** | Code implementation | Etask-executor, Ecode-reviewer |
| **Opus** | Strategy, architecture | Claude `/Qplan`, Codex `$Qplan`, Edeep-researcher |

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

## Skill Library (<!--qe:skills-->46<!--/qe:skills--> skills)

> **Start here.** You only need **7 core skills** to use the framework end-to-end. The
> the rest is intentionally smaller after hard-pruning broad PM/document/academic
> helper families. New here? Learn these and ignore the rest until you need them:
>
> Claude: `/Qinit` · `/Qcontext` · `/Qplan` · `/Qgs` · `/Qatomic-run` · `/Qcode-run-task` · `/Qsivs-config`
>
> Codex: `$Qinit` · `$Qcontext` · `$Qplan` · `$Qgs` · `$Qatomic-run` · `$Qcode-run-task` · `$Qsivs-config`
>
> *(these carry `tier: core` in their frontmatter; everything else is treated as `extended` — no tag needed. The shipped catalog is intentionally kept small enough to stay discoverable.)*

Specialist guidance removed from the default catalog now lives outside this
framework package in `https://github.com/inho-team/qe-mcp`. Install or sync that
MCP package when you need `qe_search_experts`, `qe_read_expert`, or the
cross-agent runner tools without making every QE Framework install download the
optional expert corpus.

### Core Skills

| Category | Skills | Count |
|----------|--------|-------|
| **PSE Chain** *(workflow, ≠ `tier: core`)* | `Qplan` `Qgs` `Qatomic-run` `Qrun-task` `Qcode-run-task` `Qinit` | 6 |
| **Autonomy** ⚠️ | `Qutopia` *(auto-approves everything — read warning below before using)* | 1 |
| **Context & Config** | `Qcontext` `Qsivs-config` `Qrefresh` `Qmemory` `Qcompact` `Qdoctor` | 6 |
| **Project** | `Qcommit` `Qbranch` `Qarchive` `Qproject-sync` | 4 |
| **Quality** | `Qgc` `Qsource-verifier` | 2 |
| **Docs & Writing** | `Qwriting-clearly` | 1 |
| **Research** | `Qautoresearch` `Qfact-checker` `Qsource-verifier` | 3 |
| **More** | `/Qfind-skills` or `/Qhelp` on Claude; `$Qfind-skills` or `$Qhelp` on Codex | Extended catalog |

#### ⚠️ Autonomous Mode (`/Qutopia` / `$Qutopia`) — Use With Caution

`Qutopia` flips a session-level switch (`.qe/state/utopia-state.json`) that makes **every** subsequent skill:

- **Skip interaction prompts** and auto-pick the first (recommended) option
- **Auto-approve** `Qrun-task` execution and `Qgenerate-spec` outputs
- **Auto-commit** (and, with `--ralph`, loop until `VERIFY_CHECKLIST` is fully green)
- On Claude, merge broad tool permissions (`Bash(*)`, `Agent(*)`, `WebFetch`, …) into `.claude/settings.json`; on Codex, keep autonomy in QE state and rely on Codex session policy plus QE hook rails

**Why this is dangerous.** The "recommended" option is not always what *you* would pick. In an ambiguous spec or a mixed-scope commit, the default can silently commit wrong files, push to `main`, or chain into irreversible steps. Qutopia trades your oversight for wall-clock speed.

**Only enable Qutopia when ALL of the following hold:**

1. The task is well-defined and repetitive (e.g., applying a known fix across many files)
2. Every step is reversible (no `push --force`, no schema migrations on prod, no destructive deletes)
3. You accept that commits/pushes may happen without re-confirmation

**Do NOT enable Qutopia for:** exploratory work, new project kick-offs, ambiguous requirements, first-time tools, or anything on a shared/production branch.

**Recommended lifecycle:** Claude `/Qutopia status` -> `/Qutopia` (or `--work` / `--qa`) -> `/Qutopia off`; Codex `$Qutopia status` -> `$Qutopia` -> `$Qutopia off`. Leaving it on across sessions is how accidents happen.

## Agent Fleet (<!--qe:agents-->28<!--/qe:agents--> agents)

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

```text
Claude: /Qsivs-config                    # Show current routing
Codex:  $Qsivs-config
Claude: /Qsivs-config implement codex    # Route implement stage to Codex
Codex:  $Qsivs-config implement codex
Claude: /Qsivs-config --help             # Full usage guide
Codex:  $Qsivs-config --help
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

```text
Claude: /Qcontext init                              # Initialize
Codex:  $Qcontext init
Claude: /Qcontext add frontend "src/frontend/**"    # Add folder context
Codex:  $Qcontext add frontend "src/frontend/**"
Claude: /Qcontext show                              # View all + staleness
Codex:  $Qcontext show
Claude: /Qcontext refresh                           # Update stale contexts
Codex:  $Qcontext refresh
Claude: /Qcontext --help                            # Full usage guide
Codex:  $Qcontext --help
```

---

## Project Structure

```
qe-framework/
├── skills/                  # skill definitions
│   ├── Q*/                  # user-facing skills
│   └── M*/                  # maintenance skills
├── agents/                  # 28 agent definitions
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

`6.3.0` — Plugin-based installation, Qdebate, Qplan micro-task support, 167 skills.

## License

MIT. See [LICENSE](LICENSE).
