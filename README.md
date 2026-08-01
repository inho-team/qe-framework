# QE Framework

**Query Execute Framework for Claude Code and Codex**

> <!--qe:skills-->32<!--/qe:skills--> skills | <!--qe:agents-->20<!--/qe:agents--> agents | Folder-aware context memory | SIVS quality gate

**A transparent, auditable, single-AI quality gate for coding agents.** Three things set QE apart:

1. **Role-separated QA by construction** — one active AI client owns a session, while isolated critical subagents verify and supervise the work.
2. **Auditable** — every routing decision and gate verdict is logged (`.qe/state/sivs-audit.log`, gate audits); nothing is a black box you take on faith.
3. **Transparent** — the whole loop is plain files and skills you can read: `Plan → Spec → Execute → Verify`, no hidden orchestration.

**See it work:** run `/Qplan` on a real task. QE creates a Plan with ordered Goals, then internally performs knowledge preflight, spec, execution, and verification for each Goal. Role contract: [`core/SIVS_SINGLE_AI_MODEL.md`](core/SIVS_SINGLE_AI_MODEL.md).

---

### 📖 Try it in your browser — 5-minute tour

**English** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.en.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.en.html)
**한국어** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.ko.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.ko.html)
**日本語** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.ja.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.ja.html)
**中文** · [**Intro →**](https://inho-team.github.io/qe-framework/qe_framework_intro.zh.html) · [**Reference →**](https://inho-team.github.io/qe-framework/qe_framework_diagram.zh.html)

Rendered guides — view in any browser, no install needed.

---

```
Claude: /Qplan → [Goal loop: knowledge → spec → execute → verify]
Codex:  $Qplan → [Goal loop: knowledge → spec → execute → verify]
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

### Optional MCP setup

QE Framework works standalone. Connect MCP servers only when a workflow needs
external tools, and use `Qmcp setup`, `Qmcp ensure`, or `Qmcp sync` to inspect
and manage client configuration. Restart Claude Code or Codex after changing
MCP config.

Maintainers use `/Qrelease` for version bump, changelog update, release commit,
tag, optional push, and optional GitHub Release. `/Qversion` is the read-only
version lookup path. Skill manifests remain deterministic via `npm run eval:skills`;
behavioral review can be delegated manually to `/Qcritical-review` when needed.

Audit and migration work follows a documented manual procedure: define scope and
preconditions, identify exact files and a rollback point, record ordered steps,
review the diff, run existing targeted validators, and preserve the evidence and
rollback instructions. See [`docs/MCP_GLOBAL_SETUP.md`](docs/MCP_GLOBAL_SETUP.md).

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

In Claude, you only need to remember the Plan entry point:

```
/Qplan "what you want to achieve"    # Initializes when needed, then runs the Plan-owned Goal loop
```

`/Qplan` initializes QE when needed, owns the Plan, and advances verified Goals internally. A Goal completes only when its pre-defined acceptance criteria, user scenarios, regression evidence, independent verification, and required human acceptance are recorded. You review material decisions rather than run stage commands.

In Codex, use the same skill names with the Codex skill prefix:

```text
$Qplan "what you want to achieve"
```

Use `/Qplan` or `$Qplan` to start or re-plan work. Internal QE stages do not require user commands.

`Qinit` creates the active client's project instruction artifact. Claude uses
`CLAUDE.md`; Codex-capable projects may use `AGENTS.md`. Shared QE state and
task history live under `.qe/`, with `QE_CONVENTIONS.md` as the common rule
reference.

---

## Architecture

### Plan-owned Goal Loop

The Plan is the user workflow; Spec, Execute, and Verify are internal per-Goal stages:

| Step | Claude | Codex | What it does |
|------|--------|-------|-------------|
| **Plan** | `/Qplan` | `$Qplan` | Roadmap, phases, requirements, ordered Goals |
| **Knowledge** | internal | internal | Retrieve relevant QE evidence and project wiki pointers |
| **Spec / Execute / Verify** | internal | internal | Generate evidence, implement, test, review, and gate the active Goal |

Only verified Goal outcomes are added to the derived project wiki; QE documents remain the source of truth and qe.db remains the lookup index.

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

### Single-AI Role Separation

The problem with single-model workflows: the same model that writes the spec also implements it, reviews it, and approves it. That's self-grading.

QE uses one active client. Spec stays in the main thread; Implement is led by
the main thread with bounded subagents; Verify and Supervise are high-reasoning
critical QA roles that produce evidence and use isolated subagents.

Pick a setup with the active client prefix:

```
Claude: /Qsivs-config set verify --effort high
Codex:  $Qsivs-config set verify --effort high
Claude: /Qsivs-config                                # see current setup
Codex:  $Qsivs-config
Claude: /Qsivs-config --help                         # full options
Codex:  $Qsivs-config --help
```

Choose Claude or Codex for a session; SIVS does not invoke the other client.

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

## Skill Library (<!--qe:skills-->32<!--/qe:skills--> skills)

> **Start here.** You only need **7 core skills** to use the framework end-to-end. The
> the rest is intentionally smaller after hard-pruning broad PM/document/academic
> helper families. New here? Learn these and ignore the rest until you need them:
>
> Claude: `/Qinit` · `/Qcontext` · `/Qplan` · `/Qgs` · `/Qexecute` · `/Qexecute -verify` · `/Qsivs-config`
>
> Codex: `$Qinit` · `$Qcontext` · `$Qplan` · `$Qgs` · `$Qexecute` · `$Qexecute -verify` · `$Qsivs-config`
>
> *(these carry `tier: core` in their frontmatter; everything else is treated as `extended` — no tag needed. The shipped catalog is intentionally kept small enough to stay discoverable.)*
>
> **v9 (Breaking):** goal is the single entry point. Calling `Qgs` / `Qgenerate-spec` / `Qexecute` directly is blocked — use `/Qgoal {목표}` (or just state a clear goal). `Qplan` now owns the goal-driven workflow. See [`docs/MIGRATION_v8_to_v9.md`](docs/MIGRATION_v8_to_v9.md).

Specialist guidance removed from the default catalog is no longer installed as
part of the framework. Keep project-specific guidance in local docs, custom
skills, or explicitly connected MCP servers without making every QE Framework
install download optional guidance.

### Core Skills

| Category | Skills | Count |
|----------|--------|-------|
| **PSE Chain** *(workflow, ≠ `tier: core`)* | `Qplan` `Qgs` `Qexecute` `Qexecute -verify` `Qinit` | 5 |
| **Autonomy** ⚠️ | `Qexecute -utopia` *(auto-approves everything — read warning below before using)* | 1 |
| **Context & Config** | `Qcontext` `Qsivs-config` `Qrefresh` `Qmemory` `Qcompact` `Qdoctor` | 6 |
| **Project** | `Qcommit` `Qrefresh --sync` | 2 |
| **Quality** | `Qgc` `Qcritical-review` `Qverify-contract` `Qqa` | 4 |
| **Research** | `Qautoresearch` | 1 |
| **More** | `/Qhelp find` on Claude; `$Qhelp find` on Codex | Extended catalog |

#### ⚠️ Autonomous Mode (`/Qexecute -utopia` / `$Qexecute -utopia`) — Use With Caution

`Qexecute -utopia` flips a session-level switch (`.qe/state/utopia-state.json`) that makes **every** subsequent skill:

- **Skip interaction prompts** and auto-pick the first (recommended) option
- **Auto-approve** `Qexecute` execution and `Qgenerate-spec` outputs
- **Auto-commit** (and, with `-ralph`, loop until `VERIFY_CHECKLIST` is fully green)
- On Claude, merge broad tool permissions (`Bash(*)`, `Agent(*)`, `WebFetch`, …) into `.claude/settings.json`; on Codex, keep autonomy in QE state and rely on Codex session policy plus QE hook rails

**Why this is dangerous.** The "recommended" option is not always what *you* would pick. In an ambiguous spec or a mixed-scope commit, the default can silently commit wrong files, push to `main`, or chain into irreversible steps. Qexecute -utopia trades your oversight for wall-clock speed.

**Only enable Qexecute -utopia when ALL of the following hold:**

1. The task is well-defined and repetitive (e.g., applying a known fix across many files)
2. Every step is reversible (no `push --force`, no schema migrations on prod, no destructive deletes)
3. You accept that commits/pushes may happen without re-confirmation

**Do NOT enable Qexecute -utopia for:** exploratory work, new project kick-offs, ambiguous requirements, first-time tools, or anything on a shared/production branch.

**Recommended lifecycle:** Claude `/Qexecute -utopia status` -> `/Qexecute -utopia` (or `-utopia -verify`) -> `/Qexecute -utopia off`; Codex `$Qexecute -utopia status` -> `$Qexecute -utopia` -> `$Qexecute -utopia off`. Leaving it on across sessions is how accidents happen.

## Agent Fleet (<!--qe:agents-->20<!--/qe:agents--> agents)

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

### SIVS Single-AI Role Settings

```text
Claude: /Qsivs-config                    # Show current routing
Codex:  $Qsivs-config
Claude: /Qsivs-config set verify --effort high
Codex:  $Qsivs-config set verify --effort high
Claude: /Qsivs-config --help             # Full usage guide
Codex:  $Qsivs-config --help
```

Config file: `.qe/sivs-config.json`

```json
{
  "schemaVersion": 2,
  "verify": { "effort": "high" },
  "supervise": { "effort": "high" }
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
├── agents/                  # 27 agent definitions
├── core/                    # Principles, schemas, rules
├── scripts/                 # Runtime utilities + shared libs
├── hooks/                   # Git/session hooks
├── docs/                    # Guides and references
└── .qe/                    # Project state (per-project)
    ├── context/             # Folder-aware context memory
    ├── sivs-config.json     # Single-AI role settings
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
