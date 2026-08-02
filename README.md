# QE Framework

**Query Execute Framework for Claude Code and Codex**

> <!--qe:skills-->10<!--/qe:skills--> skills | <!--qe:agents-->12<!--/qe:agents--> agents | Folder-aware context memory | SIVS quality gate

**A transparent, auditable, single-AI quality gate for coding agents.** Three things set QE apart:

1. **Role-separated QA by construction** — one active AI client owns a session, while isolated critical subagents verify and supervise the work.
2. **Auditable** — every routing decision and gate verdict is logged (`.qe/state/sivs-audit.log`, gate audits); nothing is a black box you take on faith.
3. **Transparent** — the whole loop is plain files and skills you can read: `Plan → Spec → Execute → Verify`, no hidden orchestration.

**See it work:** run `/Qplan` on a real task. QE creates a Plan with ordered Goals, then internally performs knowledge preflight, spec, execution, and verification for each Goal. Role contract: [`core/SIVS_SINGLE_AI_MODEL.md`](core/SIVS_SINGLE_AI_MODEL.md).

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
│  │  Context   │  │   SIVS    │  │   10        │ │
│  │  Memory    │  │   Loop    │  │   Skills    │ │
│  │  Manager   │  │   Engine  │  │   Focused   │ │
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

Skill manifests remain deterministic via `npm run eval:skills`;
behavioral review can be delegated manually to `/Qcritical-review` when needed.

Audit and migration work follows a documented manual procedure: define scope and
preconditions, identify exact files and a rollback point, record ordered steps,
review the diff, run existing targeted validators, and preserve the evidence and
rollback instructions in the relevant task artifact.

**Update:**
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

**Uninstall:**
```bash
claude plugin uninstall qe-framework@inho-team-qe-framework
```

### Supported package command surface

The supported npm package entrypoints are the `qe-framework-install` and
`qe-framework-uninstall` binaries, the commands declared in `package.json`
(for example `npm run check:all` and `npm run qe:query -- analysis`), and the
documented QE skills. Although the package ships `scripts/`, `hooks/`, and
`core/` so the installer can copy runtime assets, direct imports or execution
of undeclared deep paths are internal and unsupported; those paths may be
removed between releases.

For retired maintenance paths, use the supported command surface:

- old audit runners (`audit_io`, `audit_skills`, `run_audit`, `verify-memo`) →
  `npm run check:all` for repository guards and
  `npm run qe:query -- analysis` for stored analysis;
- the former `scripts/preuninstall.mjs` path → normal `npm uninstall` lifecycle
  cleanup or `qe-framework-uninstall` for an explicit removal;
- retired internal library modules have no public import replacement.

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

`/Qplan` initializes QE when needed, owns the Plan, and advances verified Goals internally. A Goal completes only when its pre-defined acceptance criteria, user-journey scenarios, regression evidence, independent Goal-alignment verification, and required human acceptance are recorded. High-impact risk Goals require human acceptance. You review material decisions rather than run stage commands.

In Codex, use the same skill names with the Codex skill prefix:

```text
$Qplan "what you want to achieve"
```

Use `/Qplan` or `$Qplan` to start or re-plan work. Internal QE stages do not require user commands.

`Qplan` performs the minimal `.qe/` bootstrap when needed. On an explicit QE entry,
it also creates the client-neutral `QE.md` when absent and adds a small managed pointer
to `CLAUDE.md` (Claude) or `AGENTS.md` (Codex) without overwriting project instructions.
Shared QE state and task history live under `.qe/`, with `QE_CONVENTIONS.md` as the
common rule reference.

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

### Store schema and upgrades

The QE document store has a versioned ERD and append-only SQLite migrations.
Check or apply local compatibility work with:

```bash
npm run qe:schema -- status
npm run qe:schema -- verify
npm run qe:schema -- plan
npm run qe:schema -- migrate
```

See [Store Schema and Migration Guide](docs/STORE_SCHEMA.md) for the ERD,
framework-to-schema compatibility contract, and release procedure.

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

Choose Claude or Codex for a session; SIVS does not invoke the other client.

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

## Skill Library (<!--qe:skills-->10<!--/qe:skills--> skills)

> **Start here.** Claude uses `/Qplan {intent}` and Codex uses `$Qplan {intent}`.
> Spec and execution remain internal components of the Plan-owned Goal loop.

Specialist guidance removed from the default catalog is no longer installed as
part of the framework. Keep project-specific guidance in local docs, custom
skills, or explicitly connected MCP servers without making every QE Framework
install download optional guidance.

### Core Skills

| Category | Skills | Count |
|----------|--------|-------|
| **Workflow intake** | `Qplan` `Qgoal` | 2 |
| **Internal PSE stages** | `Qgenerate-spec` `Qexecute` *(not user-invocable)* | 2 |
| **Quality** | `Qcritical-review` | 1 |
| **Project** | `Qcommit` `Qupdate` `Qversion` | 3 |
| **Session** | `Qcompact` `Qresume` | 2 |

## Agent Fleet (<!--qe:agents-->12<!--/qe:agents--> agents)

| Agent | Role |
|-------|------|
| **Etask-executor** | Complex checklist implementation (5+ items) |
| **Eqa-orchestrator** | Test → review → fix quality loop |
| **Esupervision-orchestrator** | Routes to domain supervisors, aggregates grades |
| **Ecode-reviewer** | Code review after changes |
| **Ecode-test-engineer** | Test writing and coverage |
| **Ecommit-executor** | AI-trace-free git commits |
| **Edeep-researcher** | Multi-source research |
| **Esecurity-officer** | Security audit on diffs |
| **Ecompact-executor** | Context window pressure management |
| **Erisk-proof-auditor** | Fresh-context risk proof audit |
| **Edoc-writer** | Technical and generated documentation |
| +2 more | Debugging and bounded task execution |

---

## Project Structure

```
qe-framework/
├── skills/                  # 10 skill definitions (8 public, 2 internal)
├── agents/                  # 20 agent definitions
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
| Contract Layer | [docs/contract-layer.md](docs/contract-layer.md) |

| Language | Path |
|----------|------|
| Korean | [docs/README.ko.md](docs/README.ko.md) |
| Japanese | [docs/README.ja.md](docs/README.ja.md) |
| Chinese | [docs/README.zh.md](docs/README.zh.md) |

---

## Version

`6.3.0` — Historical plugin installation and planning improvements (legacy catalog era).

## License

MIT. See [LICENSE](LICENSE).
