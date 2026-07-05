# QE Framework System Overview

QE (**Query Execute**) Framework is a SIVS (Spec-Implement-Verify-Supervise)
loop system for Claude Code and Codex. Claude remains the fully supported
baseline. Codex is supported as a native client for installed skills, generated
agents, and hard safety hooks, with documented degradation where Codex and
Claude expose different primitives. See
`../.qe/planning/plans/codex-native-parity/VERIFICATION_MATRIX.md` for measured
parity status.
The public documentation parity pass is summarized in
`../.qe/planning/plans/claude-codex-generalization/phases/4/PARITY_VERIFICATION_REPORT.md`.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     QE Framework v7.x                    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Context     │  │    SIVS      │  │    Skill      │  │
│  │   Memory      │  │    Engine    │  │    Library    │  │
│  │   Manager     │  │    Router    │  │    (178)      │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│  ┌──────┴─────────────────┴───────────────────┴───────┐  │
│  │              PSE Chain Orchestrator                 │  │
│  │         Plan → Spec → Execute → Verify             │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────┴─────────────────────────────┐  │
│  │                 Agent Fleet (25)                    │  │
│  │    Etask-executor  Eqa-orchestrator  Edeep-researcher │
│  │    Ecode-reviewer  Esecurity-officer  Ecommit-executor│
│  └────────────────────────────────────────────────────┘  │
│                         │                                │
│              ┌──────────┴──────────┐                     │
│              │   Claude / Codex    │                     │
│              │ measured parity     │                     │
│              └─────────────────────┘                     │
└──────────────────────────────────────────────────────────┘
```

---

## User Workflow

```
Claude: /Qinit → /Qcontext init → /Qplan → /Qgs → /Qatomic-run → /Qcode-run-task
Codex:  $Qinit → $Qcontext init → $Qplan → $Qgs → $Qatomic-run → $Qcode-run-task
        Setup     Context          Plan     Spec    Execute       Verify
```

| Step | Claude | Codex | Purpose |
|------|--------|-------|---------|
| Setup | `/Qinit` | `$Qinit` | Initialize project, directory structure, conventions |
| Context | `/Qcontext init` | `$Qcontext init` | Set up folder-aware context partitioning |
| Plan | `/Qplan` | `$Qplan` | Create roadmap, phases, requirements |
| Spec | `/Qgs` | `$Qgs` | Generate TASK_REQUEST + VERIFY_CHECKLIST |
| Execute | `/Qatomic-run` | `$Qatomic-run` | Implement via parallel Haiku Wave |
| Verify | `/Qcode-run-task` | `$Qcode-run-task` | Test → review → fix quality loop |

---

## SIVS Loop

The execution engine that runs inside Execute and Verify steps:

```
  ┌─────┐    ┌───────────┐    ┌────────┐    ┌───────────┐
  │Spec │───►│Implement  │───►│Verify  │───►│Supervise  │
  │ (S) │    │   (I)     │    │  (V)   │    │   (S)     │
  └─────┘    └───────────┘    └────────┘    └─────┬─────┘
                                                   │
                                          ┌────────┴────────┐
                                          │                 │
                                        PASS              FAIL
                                          │                 │
                                        Done          Remediate
                                                          │
                                                    ┌─────┴─────┐
                                                    │   Spec    │
                                                    │  (retry)  │
                                                    └───────────┘
```

**Stage Responsibilities:**

| Stage | Owner | Artifacts |
|-------|-------|-----------|
| **Spec** | TASK_REQUEST generation | `TASK_REQUEST.md` |
| **Implement** | Code changes | `IMPLEMENTATION_REPORT.md` |
| **Verify** | Validation (no coding) | `VERIFY_CHECKLIST.md` |
| **Supervise** | Quality gate + approval | `SUPERVISION_REPORT.md` |

**Engine Routing** — each stage independently routes to Claude or Codex. Without
Codex, all stages use Claude. When Codex is available, Implement and Verify
prefer Codex by default while Spec and Supervise stay Claude-led:

```json
{
  "spec":      { "engine": "claude" },
  "implement": { "engine": "codex", "model": "gpt-5.4", "effort": "high" },
  "verify":    { "engine": "codex", "background": true },
  "supervise": { "engine": "claude" }
}
```

Managed via `/Qsivs-config` on Claude or `$Qsivs-config` on Codex. Falls back to Claude if codex-plugin-cc is not installed.

---

## Folder-Aware Context Memory

The context memory system optimizes Claude's context window by loading only relevant knowledge for the current working directory.

### How It Works

```
.qe/context/
├── _registry.json     # glob pattern → context file mapping
├── root.md            # always loaded
├── frontend.md        # loaded in src/frontend/**
├── backend.md         # loaded in src/backend/**
└── scripts.md         # loaded in scripts/**
```

### Loading Rules

1. **Always load** `root.md` — project-wide conventions
2. **Glob match** — load contexts whose pattern matches the working directory
3. **Multiple matches OK** — `src/frontend/api/` can match both `frontend.md` and `api.md`
4. **Staleness detection** — warns if context is >7 days old, suggests the active-client `Qcontext refresh` command

### Token Savings

```
Traditional:  Load one monolithic project instruction artifact → 100% tokens
QE Context:   Load root.md + matched folder context            → only the matched subset

Savings: fewer context tokens per session — the magnitude depends on project size and
how domain rules split across folders. Measure it for your repo: see docs/BENCHMARK.md.
```

### Management

| Claude | Codex | Action |
|--------|-------|--------|
| `/Qcontext init` | `$Qcontext init` | Initialize with root.md |
| `/Qcontext add <name> <pattern>` | `$Qcontext add <name> <pattern>` | Add folder context |
| `/Qcontext show` | `$Qcontext show` | List all contexts + staleness |
| `/Qcontext refresh` | `$Qcontext refresh` | Update stale contexts |
| `/Qcontext status <path>` | `$Qcontext status <path>` | Preview matches for a path |

Auto-refreshed when the active-client `Qrefresh` command runs.

---

## Provider Routing

### Defaults
- Without Codex: all SIVS stages use Claude.
- With Codex: Spec/Supervise stay Claude-led; Implement/Verify prefer Codex.
- Explicit `.qe/sivs-config.json` entries override the environment-aware defaults.

### Codex Paths
- Claude base -> Codex engine uses the `codex-plugin-cc` bridge.
- Codex base -> Codex engine uses native Codex skills, generated native agents,
  and the Codex `PreToolUse` hook fence.
- Codex base -> Claude engine uses the reverse bridge surface
  (`Qclaude-rescue` / `claude_bridge.mjs`) when available.
- Agent delegation is normalized through the QE client adapter: Claude uses the
  Agent tool, while Codex uses generated native subagents and role-separated
  inline execution only when a runtime lacks the required primitive.

## Lifecycle Adapter

Lifecycle behavior is defined as generic QE events and then rendered through the
active client adapter. See `core/LIFECYCLE_ADAPTER.md` and
`core/INTERACTION_ADAPTER.md`.

| Generic event | Claude adapter | Codex adapter |
|---------------|----------------|---------------|
| SessionStart | Claude plugin hook | Codex lifecycle wrapper when the event is emitted |
| PreToolUse | Claude plugin hard-block hook | Codex hook fence + lifecycle wrapper |
| PostToolUse | Claude plugin hook | Codex wrapper/shim when available |
| Stop | Claude plugin hook | Codex wrapper/shim when available |
| Notification | Claude plugin hook | Codex wrapper/shim when available |
| Status guidance | Session context and hook messages | Session context and hook messages |

Safety-critical behavior, especially raw commit/version guards and autonomous
mode rails, must be equivalent. Non-safety events can degrade, but they must be
labeled as wrapper, proxy, shim, unsupported, or degraded.

## Execution Harness State And Lifecycle

Execution Harness is the runtime layer beneath PSE and SIVS. Its source contract
is [../core/EXECUTION_HARNESS.md](../core/EXECUTION_HARNESS.md). Harness state
ownership and lane records are defined in
[../core/STATE_SPEC.md](../core/STATE_SPEC.md), while harness lifecycle labels
and status projection behavior are rendered through
[../core/LIFECYCLE_ADAPTER.md](../core/LIFECYCLE_ADAPTER.md).

| Contract | Responsibility |
| --- | --- |
| Execution Harness | Selects and observes the runtime shape without owning completion. |
| State Spec | Defines lane storage, status axes, session binding, and evidence boundaries. |
| Lifecycle Adapter | Renders harness labels and status projection through client capabilities. |

---

## Model Tiering

| Tier | Model | Assigned To |
|------|-------|-------------|
| **Strategy** | Opus | `Qplan`, Edeep-researcher, Esupervision-orchestrator |
| **Implementation** | Sonnet | Etask-executor, Ecode-reviewer, Ecode-test-engineer |
| **Parallel Tasks** | Haiku | Wave Teammates, archiving, data refresh, formatting |

Delegation Enforcer hook auto-assigns the correct model tier.

---

## Token Efficiency

| Layer | Mechanism | Effect |
|-------|-----------|--------|
| **Context** | Folder-aware context loading | Load only relevant domain knowledge |
| **Dedup** | ContextMemo hook | Block duplicate file reads (`exit 2`) |
| **Compaction** | Ecompact-executor | Auto-trigger at 140k tokens, mandatory at 170k |
| **Persistence** | Persistent Mode | Prevent pipeline interruption |
| **Size Limits** | 250-line SKILL.md cap | Excess content → `references/` |

---

## Skill Library (<!--qe:skills-->33<!--/qe:skills--> skills)

| Category | Count | Key Skills |
|----------|-------|------------|
| Core PSE | 6 | Qplan, Qgs, Qatomic-run, Qrun-task, Qcode-run-task, Qinit |
| Context & Config | 5 | Qcontext, Qsivs-config, Qrefresh, Qmemory, Qcompact |
| Research | 3 | Qautoresearch, Qfact-checker, Qsource-verifier |
| Other | 41 | `Qhelp find` or `Qhelp` to discover |

---

## Agent Fleet (<!--qe:agents-->27<!--/qe:agents--> agents)

| Agent | Responsibility |
|-------|---------------|
| Etask-executor | Complex checklist implementation |
| Eqa-orchestrator | Test → review → fix loop |
| Esupervision-orchestrator | Domain supervisor routing + grade aggregation |
| Ecode-reviewer | Post-change code review |
| Ecode-test-engineer | Test writing + coverage |
| Ecommit-executor | AI-trace-free git commits |
| Erefresh-executor | Project analysis + context refresh |
| Edeep-researcher | Multi-source research |
| Esecurity-officer | Security audit on diffs |
| Ecompact-executor | Context window management |
| Epm-planner | PRD, roadmap, document generation |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `.qe/sivs-config.json` | SIVS engine routing (claude/codex per stage) |
| `.qe/context/_registry.json` | Folder-to-context mapping |
| `.qe/context/*.md` | Folder-specific context files |
| `core/schemas/svs-config.schema.json` | SIVS config JSON schema |
| `QE_CONVENTIONS.md` | Framework coding conventions |

---

## v6.x Changes

- **Folder-aware context memory** (`Qcontext`) — partition and optimize context loading
- **SIVS config CLI** (`Qsivs-config`) — quick engine routing changes
- **165 skills** (was 93 in v5.0) — 71 coding expert skills added
- **Auto-refresh integration** — `Qrefresh` keeps context files up to date
- **Dual-client simplicity** — Claude and Codex assets install from the same package

---

## v7.0 Changes (Harness Engineering Upgrade)

### Hook System (Phase 1)
- Maintains **9 lifecycle events** covering the full plugin-supported hook surface
- 5 functional handlers: PostToolUseFailure, SubagentStart/Stop, FileChanged, SessionEnd
- 13 stub handlers for remaining events (ready for future extension)

### SIVS & API (Phase 2)
- `effort` parameter: Claude `max` + Codex `xhigh` with cross-engine mapping
- `compaction` settings: server/client/auto strategy in sivs-config
- `effort-compat.mjs`: budget_tokens → effort backward compatibility
- `managed-agents.mjs`: Managed Agents API compatibility types

### Plugin & Skill Governance (Phase 3)
- Plugin marketplace v2 metadata alignment
- **Skill Budget**: Auto-monitoring of skill token usage (1% context window threshold)
- Skill deduplication audit: 20 merge candidate clusters identified

### Multi-Agent Orchestration (Phase 4)
- Claude adapter: Agent Teams v2 `--agents` flag documentation (16 fields)
- `agent-teams.schema.json`: JSON Schema validation
- `managed-agents-adapter.mjs`: QE agent → Managed Agents API converter
- Cross-session memory patterns guide

### Observability & Measurement (Phase 5)
- 6 harness engineering metrics (METRICS_SPEC.md)
- `metrics-collector.mjs`: Session-scoped metric aggregation
- `telemetry.mjs`: JSONL telemetry export (.qe/telemetry/)
- `trace-logger.mjs`: Agent decision tracing (.qe/traces/)
- Claude SessionEnd + TaskCompleted hooks wired to metrics/telemetry

### New lib Modules
| Module | Path | Purpose |
|--------|------|---------|
| effort-compat | scripts/lib/ | budget_tokens↔effort mapping |
| managed-agents | scripts/lib/ | Managed Agents API types |
| managed-agents-adapter | scripts/lib/ | QE agent → API format converter |
| skill-budget | hooks/scripts/lib/ | Skill token budget calculator |
| metrics-collector | hooks/scripts/lib/ | Harness metrics aggregation |
| telemetry | hooks/scripts/lib/ | JSONL telemetry writer |
| trace-logger | hooks/scripts/lib/ | Agent decision trace logger |
