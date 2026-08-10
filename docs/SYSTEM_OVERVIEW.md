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
Claude: /Qplan → [initialize if needed] → [Plan-owned Goal loop]
Codex:  $Qplan → [initialize if needed] → [Plan-owned Goal loop]
        Plan       setup              knowledge → spec → execute → verify
```

| Step | Claude | Codex | Purpose |
|------|--------|-------|---------|
| Plan | `/Qplan` | `$Qplan` | Create roadmap, phases, requirements, and ordered Goals |
| Goal loop | internal | internal | Retrieve QE knowledge, generate spec, implement, verify, and advance only on evidence |

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

**Single-AI role separation** — one active client owns every SIVS stage. Spec and
Implement remain main-thread-led; Verify and Supervise use high-reasoning critical
leads with isolated same-client subagents. No stage invokes a second AI client.

---

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
| Team completion | `TaskCompleted` (Claude only) | unsupported; caller-owned handoff |
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

## Skill Library (<!--qe:skills-->12<!--/qe:skills--> skills)

| Category | Count | Key Skills |
|----------|-------|------------|
| Plan and PSE | 4 | Qplan, Qgoal, Qgenerate-spec, Qexecute |
| Quality | 1 | Qcritical-review |
| Project | 3 | Qcommit, Qupdate, Qversion |
| Session | 2 | Qcompact, Qresume |
| Inspection | 1 | Qdashboard |
| Environment | 1 | Qcc-setup |

---

## Agent Fleet (<!--qe:agents-->12<!--/qe:agents--> agents)

| Agent | Responsibility |
|-------|---------------|
| Etask-executor | Complex checklist implementation |
| Eqa-orchestrator | Test → review → fix loop |
| Esupervision-orchestrator | Domain supervisor routing + grade aggregation |
| Ecode-reviewer | Post-change code review |
| Ecode-test-engineer | Test writing + coverage |
| Ecommit-executor | AI-trace-free git commits |
| Edeep-researcher | Multi-source research |
| Esecurity-officer | Security audit on diffs |
| Ecompact-executor | Context window management |
| Erisk-proof-auditor | Fresh-context risk proof audit |
| Edoc-writer | Technical documentation generation |

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

## Historical v6.x Changes

- **Folder-aware context memory** — partitioned context loading (the former public wrapper has since been retired)
- **SIVS config CLI** — engine routing configuration (the former public wrapper has since been retired)
- **165 skills** (was 93 in v5.0) — 71 coding expert skills added
- **Auto-refresh integration** — background context refresh support
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
- `metrics.mjs`: Harness metric aggregation + JSONL telemetry export (.qe/telemetry/)
- `trace-logger.mjs`: Agent decision tracing (.qe/traces/)
- Claude SessionEnd + TaskCompleted hooks wired to metrics/telemetry

### Runtime Controller verification

- `node scripts/check-runtime-controller.mjs` runs the closed-loop public SIVS
  E2E proof plus its locked stage, completion, remediation, persistent-lease,
  and process-metrics regressions.
- The causal path covers Verify failure, bounded remediation, restart, fresh
  independent proofs, completion, replay/bypass boundaries, and lease release.
- The checker is local and deterministic; rollout and deployment qualification
  are documented as a separate follow-up scope. See
  [Runtime Controller rollout readiness](RUNTIME_CONTROLLER_ROLLOUT.md) for the
  local shadow, canary, scale-qualification, abort, and rollback contract.

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
