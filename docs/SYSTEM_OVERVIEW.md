# QE Framework System Overview

QE (**Query Execute**) Framework is a SIVS (Spec-Implement-Verify-Supervise) loop system for Claude Code. It provides a structured AI-driven workflow with **folder-aware context memory**, **<!--qe:skills-->182<!--/qe:skills--> skills**, and **<!--qe:agents-->25<!--/qe:agents--> agents**, using Claude as the default provider with optional Codex support via `codex-plugin-cc`.

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
│              │    Claude Code      │                     │
│              │  (+ optional Codex) │                     │
│              └─────────────────────┘                     │
└──────────────────────────────────────────────────────────┘
```

---

## User Workflow

```
/Qinit           →  /Qcontext init  →  /Qplan  →  /Qgs  →  /Qatomic-run  →  /Qcode-run-task
 Setup               Context            Plan       Spec     Execute          Verify
```

| Step | Skill | Purpose |
|------|-------|---------|
| Setup | `/Qinit` | Initialize project, directory structure, conventions |
| Context | `/Qcontext init` | Set up folder-aware context partitioning |
| Plan | `/Qplan` | Create roadmap, phases, requirements |
| Spec | `/Qgs` | Generate TASK_REQUEST + VERIFY_CHECKLIST |
| Execute | `/Qatomic-run` | Implement via parallel Haiku Wave |
| Verify | `/Qcode-run-task` | Test → review → fix quality loop |

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

**Engine Routing** — each stage independently routes to Claude (default) or Codex:

```json
{
  "spec":      { "engine": "claude" },
  "implement": { "engine": "codex", "model": "gpt-5.4", "effort": "high" },
  "verify":    { "engine": "claude" },
  "supervise": { "engine": "claude" }
}
```

Managed via `/Qsivs-config`. Falls back to Claude if codex-plugin-cc is not installed.

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
4. **Staleness detection** — warns if context is >7 days old, suggests `/Qcontext refresh`

### Token Savings

```
Traditional:  Load full CLAUDE.md (all domain rules)    → 100% tokens
QE Context:   Load root.md + matched folder context     → only the matched subset

Savings: fewer context tokens per session — the magnitude depends on project size and
how domain rules split across folders. Measure it for your repo: see docs/BENCHMARK.md.
```

### Management

| Command | Action |
|---------|--------|
| `/Qcontext init` | Initialize with root.md |
| `/Qcontext add <name> <pattern>` | Add folder context |
| `/Qcontext show` | List all contexts + staleness |
| `/Qcontext refresh` | Update stale contexts |
| `/Qcontext status <path>` | Preview matches for a path |

Auto-refreshed when `/Qrefresh` runs.

---

## Provider Routing

### Default (Claude-only)
- All SIVS stages use Claude
- No external dependencies
- Full functionality out of the box

### Optional Codex Bridge
- Install `codex-plugin-cc` for Codex integration
- Route individual SIVS stages via `/Qsivs-config`
- Bridge logic: `scripts/lib/codex_bridge.mjs`
- Falls back to Claude if plugin unavailable

---

## Model Tiering

| Tier | Model | Assigned To |
|------|-------|-------------|
| **Strategy** | Opus | `/Qplan`, Edeep-researcher, Esupervision-orchestrator |
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

## Skill Library (<!--qe:skills-->182<!--/qe:skills--> skills)

| Category | Count | Key Skills |
|----------|-------|------------|
| Core PSE | 6 | Qplan, Qgs, Qatomic-run, Qrun-task, Qcode-run-task, Qinit |
| Context & Config | 5 | Qcontext, Qsivs-config, Qrefresh, Qmemory, Qcompact |
| Project Management | 6 | Qpm-prd, Qpm-roadmap, Qpm-okr, Qpm-retro, Qpm-strategy, Qpm-gtm |
| Documents | 6 | Qdocx, Qpdf, Qpptx, Qxlsx, Qdoc-converter, Qdoc-comment |
| Academic | 4 | Qgrad-paper-write, Qgrad-research-plan, Qgrad-seminar-prep, Qgrad-thesis-manage |
| Coding Experts | 71 | Backend(14), Frontend(12), Languages(13), Infra(14), Quality(12), Data(6) |
| Other | 67 | `/Qfind-skills` or `/Qhelp` to discover |

---

## Agent Fleet (<!--qe:agents-->25<!--/qe:agents--> agents)

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

- **Folder-aware context memory** (`/Qcontext`) — partition and optimize context loading
- **SIVS config CLI** (`/Qsivs-config`) — quick engine routing changes
- **165 skills** (was 93 in v5.0) — 71 coding expert skills added
- **Auto-refresh integration** — `/Qrefresh` keeps context files up to date
- **Claude-first simplicity** — zero external dependencies required

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
- Agent Teams v2: Full `--agents` flag documentation (16 fields)
- `agent-teams.schema.json`: JSON Schema validation
- `managed-agents-adapter.mjs`: QE agent → Managed Agents API converter
- Cross-session memory patterns guide

### Observability & Measurement (Phase 5)
- 6 harness engineering metrics (METRICS_SPEC.md)
- `metrics-collector.mjs`: Session-scoped metric aggregation
- `telemetry.mjs`: JSONL telemetry export (.qe/telemetry/)
- `trace-logger.mjs`: Agent decision tracing (.qe/traces/)
- HUD metrics panel (`metrics-panel.mjs`)
- SessionEnd + TaskCompleted hooks wired to metrics/telemetry

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
| metrics-panel | hooks/scripts/lib/hud/elements/ | HUD metrics display |
