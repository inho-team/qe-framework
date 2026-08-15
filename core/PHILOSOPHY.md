# QE Framework Philosophy

> This document defines the foundational philosophy of the QE Framework.
> Every skill, agent, and hook in this framework exists to serve this philosophy.
> When in doubt about a design decision, return to this document.
> All changes to this file are supervised via Esupervision-orchestrator.
>
> **Not runtime-injected, by design.** No hook loads this file into context. It guides
> design decisions for maintainers, not per-turn model behavior — the enforceable rules
> live in `core/PRINCIPLES.md` (injected via `loadPrinciples()`) and `core/contexts/*.md`
> (injected via CONTEXT_ROUTES). Read this on demand; do not wire it into a hook.

---

## SIVS Single-AI Role Model

Each session uses one active AI client. SIVS never delegates a stage to another
client. The authoritative contract is `core/SIVS_SINGLE_AI_MODEL.md`:

- Spec is authored in the main thread and adversarially challenged.
- Implement is main-thread-led with bounded same-client subagents.
- Verify is a high-reasoning evidence gate.
- Supervise is a high-reasoning release gate for security, business rules,
  change impact, operations, and residual-risk ownership.

Fresh context, role separation, and isolated subagents provide the required
independence. If delegation is unavailable, the run is `degraded-inline` and
cannot claim a stronger-than-WARN QA result without later delegated evidence.

---

## Position in the PSE Chain

The SIVS Loop is the **quality gate** inside the Plan-owned PSE Chain (`Qplan` controller → knowledge → spec → execute → verify). Only `Qplan` is user-facing workflow control; the remaining stages are internal quality mechanisms.

---

## The Core Principle

> Work without a spec is guesswork.
> A spec without implementation is intent.
> Implementation without verification is hope.
> Verification without supervision is confirmation bias.

The QE Framework is built around one repeating loop:

```
Spec → Implement → Verify → Supervise → (if failed) Remediate → Spec → ...
```

This loop — the **SIVS Loop** — is mandatory after the user explicitly enters
Full SIVS through `Qplan` or its single-Goal alias `Qgoal`. Ordinary requests
remain on the native client path, where the Safety Kernel, completion-evidence
checks, and QE response style still apply.

Each stage in this loop runs a **mandatory independent verification gate** (Mandatory Obligation #8): a fresh-context adversarial sub-agent that breaks the self-reference problem of a homogeneous engine certifying its own output. A gate FAIL routes the loop **backward** to the causing stage rather than dead-ending.

---

## The Efficiency Philosophy

> **Efficiency is Accuracy.**

In a context-constrained environment, every unnecessary token is a potential source of drift. Every redundant I/O operation is a source of latency that degrades the "speed of thought."

We treat efficiency not as a cost-saving measure, but as a **reliability requirement**:
1. **Minimal Context Drift**: By preserving only the most relevant "semantic context" (via Phase 2 Semantic Compression), we ensure the agent remains focused on the core task.
2. **Deterministic State**: By using a Unified State (Phase 1), we ensure all hooks and agents operate on a single version of the truth, preventing race conditions and stale data.
3. **Low Latency Interaction**: By optimizing CJK translation and model tiering, we keep the feedback loop tight, allowing for more iterations within the same human time-budget.

---

## The SIVS Loop

```
┌──────────────────────────────────────────────────────────────────────┐
│                          SIVS Loop                                   │
│                                                                      │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  SPEC    │─▶│ IMPLEMENT  │─▶│  VERIFY  │─▶│   SUPERVISE      │  │
│  │          │  │            │  │          │  │                  │  │
│  │ Define   │  │ Execute    │  │ Confirm  │  │ Expert evaluation│  │
│  │ what &   │  │ the actual │  │ it was   │  │ security, test,  │  │
│  │ how      │  │ coding     │  │ done     │  │ design, facts    │  │
│  └──────────┘  └────────────┘  └──────────┘  └────────┬─────────┘  │
│       ▲                                               │            │
│       │              PASS                             │            │
│       │         ┌────────────┐                        │            │
│       │         │  ✅ Done   │◀───────────────────────┤            │
│       │         └────────────┘                        │            │
│       │                                          FAIL │            │
│       │         ┌────────────────────┐                │            │
│       └─────────│ REMEDIATION        │◀───────────────┘            │
│                 │ REQUEST            │                             │
│                 │ (new spec for      │                             │
│                 │  failing items)    │                             │
│                 └────────────────────┘                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Cross-Phase Regression

Before a Phase is marked complete, prior phases' key verification items are re-checked to prevent regression. This ensures that work in Phase N does not silently break guarantees established by Phases 1 through N-1. The regression gate is implemented in `hooks/scripts/lib/regression-gate.mjs` and integrated into the verification flow at Qexecute -verify Step 4.8.

### Stage 1 — Spec

**Document:** `TASK_REQUEST_{UUID}.md`
**Generated by:** `Qgenerate-spec`
**Purpose:** Define the work before executing it.

A spec must answer:
- What exactly needs to be done?
- How will it be done (approach, steps)?
- What does "done" look like (output files, observable results)?
- In what order (dependency-aware checklist)?

Without a spec, the executor has no contract. Without a contract, verification is impossible.

### Stage 2 — Implement

**Executed by:** `Qexecute` / `Qexecute` (via `Etask-executor` or Haiku Teammates)
**Purpose:** Execute the actual coding work defined in the spec.

Implementation is the stage where files are created, modified, or deleted according to the TASK_REQUEST checklist. This stage is strictly separated from verification to ensure clean responsibility boundaries:
- Implementation produces code changes
- Verification (next stage) confirms those changes are correct

### Stage 3 — Verify

**Document:** `VERIFY_CHECKLIST_{UUID}.md`
**Generated by:** `Qgenerate-spec` (alongside the spec)
**Executed by:** `Qexecute` after implementation

A verification checklist must:
- Answer every item with yes or no — no subjective judgment
- Map 1:1 to the spec's checklist items
- Be answerable by reading output files or running commands

A checklist that says "code looks good" is not a checklist. It is an opinion.

### Stage 4 — Supervise

**Document:** `REMEDIATION_REQUEST_{UUID}_{N}.md` (generated only on FAIL)
**Executed by:** Supervision agents (security, test, design, fact-checking)
**Purpose:** Independent expert evaluation that the spec was fulfilled at quality.

Supervision is not the same as verification:
- Verification confirms *completion* (was it done?)
- Supervision confirms *quality* (was it done *well*?)

Supervision domains in this framework:
| Domain | Agent | Evaluates |
|--------|-------|-----------|
| Security | Esecurity-officer | Vulnerabilities, data exposure, auth flaws |
| Code quality | Esupervision-orchestrator | Correctness, maintainability, test coverage |
| Documentation | Esupervision-orchestrator | Accuracy, completeness, clarity |
| Analysis | Esupervision-orchestrator | Validity of findings, source reliability |

### Stage 5 — Remediate (on FAIL)

**Document:** `REMEDIATION_REQUEST_{UUID}_{N}.md`
**Triggers:** When any supervision domain returns FAIL
**Maximum rounds:** 3

A REMEDIATION_REQUEST is a new spec — scoped to only the failing items.
It feeds back into `Qgenerate-spec`, creating a new TASK_REQUEST and VERIFY_CHECKLIST
for the remediation work. The loop restarts from Stage 1.

If FAIL persists after 3 rounds, the supervision orchestrator escalates to the user.

---

## The Plan Control Plane and SIVS Documents

The DB-authoritative Plan/Goal ledger owns ordered outcomes, immutable
acceptance, execution ownership, and completion authority. Formal Goals then
materialize the three SIVS documents below; bounded-micro Goals use the
ledger-issued acceptance and completion evidence defined by Qplan.

| Document | Stage | Role | Generated by |
|----------|-------|------|--------------|
| `TASK_REQUEST_{UUID}.md` | Spec | Defines the work contract | `Qgenerate-spec` |
| `VERIFY_CHECKLIST_{UUID}.md` | Verify | Objective completion check | `Qgenerate-spec` |
| `REMEDIATION_REQUEST_{UUID}_{N}.md` | Remediate | Rework directive for failing items | Supervision agents |

These documents are the formal-lane execution contract. They are subordinate to
the Plan/Goal control plane that decides which Goal may execute and whether its
evidence is sufficient to complete.

---

## Where Every Component Fits

| Component | Role in the SIVS Loop |
|-----------|---------------------|
| `Qgenerate-spec` | Creates TASK_REQUEST + VERIFY_CHECKLIST (Stage 1) |
| `Qexecute` | Executes the spec (Stage 2), runs the verify checklist (Stage 3) |
| `Qexecute` | Parallel implementation via Haiku Waves (Stage 2) |
| `Etask-executor` | Implements checklist items one by one (Stage 2) |
| `Esupervision-orchestrator` | Coordinates all supervision agents (Stage 4) |
| `Esecurity-officer` | Security supervision domain |
| `Qexecute -verify` | Test → review → fix loop within Stage 3 |
| All hooks | Support the loop: context management, intent routing, state tracking |
| `Ttune` | Repairs framework components that deviate from this philosophy |
| `Qplan` | Owns Plan intake, atomic initialization, Goal ordering, assurance selection, and evidence-gated completion |
| `Qcommit` | Git commit without AI traces (utility layer) |
| `Qcompact` / `Qresume` | Context preservation and restoration across sessions |
| `skill-budget.mjs` | Skill token budget monitoring and overflow detection |
| `metrics.mjs` | Harness metrics aggregation + session telemetry JSONL |
| `trace-logger.mjs` | Agent decision tracing for observability |

---

## Hook Lifecycle Events (7)

The QE Framework registers seven lifecycle events with concrete QE outcomes.

| Event | Handler | Purpose |
|-------|---------|---------|
| SessionStart | session-start.mjs | Session identity, migration, memory and resume context |
| PreToolUse | pre-tool-use.mjs | ContextMemo validation, SIVS routing, block emitter |
| PostToolUse | post-tool-use.mjs | ContextMemo update, lint, error detection |
| Stop | stop-handler.mjs | Session end, sweep, failure capture, rating |
| UserPromptSubmit | prompt-check.mjs | Help flag parsing, intent routing |
| TeammateIdle | teammate-idle.mjs | Teammate task assignment on idle |
| TaskCompleted | task-completed.mjs | VERIFY_CHECKLIST check, TASK_LOG update, archival |

---

## Mandatory Obligations

These obligations have explicit scope. Obligations 1–5 and 8 govern work after
the user enters a Full SIVS Plan through `Qplan` or `Qgoal`; they do not create
an entry from ordinary prose. Obligations 6–7 are evidence-quality rules for
both native and Full SIVS work. The Safety Kernel and QE response style also
remain universal.

1. **Respect the selected Full SIVS assurance contract.** Within an explicit
   Full SIVS Plan, execute only against either a formal TASK_REQUEST or a Qplan-
   admitted immutable bounded micro-Goal acceptance contract. Specification is
   Plan-owned; implementation may not invent its own exception.

2. **Do not skip Full SIVS verification.** A formal Goal is not complete until
   its VERIFY_CHECKLIST items are checked. An admitted bounded micro Goal is not
   complete until every immutable acceptance requirement and scenario has
   implementation and distinct-session verification evidence plus an independent
   Goal-alignment verdict. Marking either lane complete without its required
   evidence is a violation.

3. **Parallel first.** If two operations have no data dependency, run them in parallel. Never default to sequential when parallel is possible. This applies to: agent spawning, file reads/writes, analysis tasks, test+review, multi-UUID execution, and wave execution in Etask-executor. Sequential is the fallback, not the default.

4. **Full SIVS remediation is a new spec, not a patch.** When formal-lane
   verification fails, generate a proper REMEDIATION_REQUEST with a proper
   checklist. A bounded micro verification failure blocks the immutable micro
   Goal and creates a linked formal successor Plan/Goal before remediation; its
   lane is never mutated in place. Do not apply ad-hoc fixes without a spec.

5. **The Full SIVS loop is the structured product.** Inside an explicit Plan, features, skills, and agents are means to the Plan-owned end: spec defined → implemented → verified → shipped with confidence.

6. **Ground truth over self-assessment.** When verifying work, prefer external execution (Bash, actual tool invocation, real system test) over self-review. Code that compiles is not code that works. A checklist item that passes self-review may still fail in the real system. Always run the actual command, install the actual plugin, execute the actual test before declaring completion.

7. **Verify research before planning.** Web search results, blog posts, and documentation claims must be tested against the actual system before incorporating into plans. Run `--help`, `--version`, or a minimal test to confirm the feature exists. Unverified claims must be tagged `[UNVERIFIED]` in all downstream documents. Never build phases around unverified external capabilities.

8. **Independent verification at every executed Full SIVS stage.** A stage
   cannot certify its own output. The formal Goal lane uses fresh-context
   adversarial roles at Spec, Verify, and Supervise. The bounded micro-Goal lane
   intentionally omits formal Spec and routine Supervise stages, but its Verify
   stage still requires distinct-session machine re-execution and an independent
   Goal-alignment verdict. A gate FAIL routes backward to its cause until it
   passes or the round cap escalates. Degraded inline work cannot claim PASS
   without later independent evidence. See `skills/Qcritical-review/reference/
   {thinking-modes,spec-gate-protocol,verify-gate-protocol,supervise-gate-protocol}.md`.

---

## Adaptive Harness Principle

The native client path is the default. The user may explicitly enter the PSE
chain through `Qplan` or `Qgoal` when durable planning and Full SIVS assurance
are desired. Execution mechanisms remain independent of that assurance choice;
when a client-native feature is more suitable, use it within the selected path:

1. **Verification** → `/goal` sets a completion condition evaluated by a **separate model**, breaking self-preferential bias. Use when the pass criteria are mechanically verifiable (tests pass, build succeeds, lint clean).
2. **Large-scale orchestration** → `/workflows` writes a JS orchestration script for up to 1,000 subagents. Use when the task has 10+ independent items or requires adversarial multi-agent coordination.
3. **Code review** → `claude ultrareview` runs a cloud-hosted multi-agent review. Use as an external alternative to self-review via Eqa-orchestrator.
4. **Background agents** → `claude agents` manages parallel sessions with effort/model control. Use for background processing alongside interactive work.

**Rule**: Skills should wrap or complement native features, not compete with them. If a native feature does the job better, guide the user to it instead of reimplementing it.

The Execution Harness Layer (`core/EXECUTION_HARNESS.md`) defines QE-owned runtime
patterns for mode selection, durable lanes, isolated workspaces, status
projection, and evidence collection. Within an explicit Full SIVS Plan it is
subordinate to the SIVS Loop and the Mandatory Obligations above: harness status
can supply evidence, but it cannot replace TASK_REQUEST fulfillment,
VERIFY_CHECKLIST completion, or supervision judgment.

See `docs/CLAUDE_CODE_FEATURES.md` for verified feature reference with minimum versions and official documentation links.

---

## Acknowledged Exceptions

The following are intentional design trade-offs, not violations of the Mandatory Obligations:

### 1. Bounded micro-Goal exception

Qplan may admit a low-risk Goal with one implementation outcome, at most three
allowed paths, fewer than three work items, and no material ambiguity to the
bounded micro-Goal lane. Its immutable Goal acceptance contract is the executable
spec, so it may execute without a formal TASK_REQUEST and without Spec/Supervise
review fan-out. The canonical criteria and escalation rule live in
`skills/Qplan/SKILL.md`; Qexecute only consumes the Plan-owned handoff.

Independent final verification, locked regression evidence, TDD when applicable,
and Goal alignment remain mandatory. New acceptance schema 2 contracts bind
every criterion, journey, regression, and final alignment to one immutable
outcome ID; existing schema 1 contracts are resume-only. Any scope growth, high-impact risk, or
verification failure blocks the immutable micro Goal and creates a linked formal
successor Plan/Goal with a fresh acceptance contract.

**Rationale**: Requiring three independent Spec reviewers and a separate routine
Supervise fan-out for a bounded one-file fix adds latency disproportionate to its
risk, while an immutable acceptance contract plus independent re-execution still
guards the completion claim.

### 2. Qexecute -utopia Retry Loop

Retry loops in Qexecute -utopia modes (`-utopia` / `-utopia -verify`) may re-execute failed items up to 3 (work) or 5 (qa) times without generating a REMEDIATION_REQUEST. Full remediation spec generation is required only when retry limits are exceeded and the system escalates to the user.

**Rationale**: For simple failures (test flakiness, minor syntax errors), generating a full remediation spec is disproportionate. The retry limit ensures that persistent failures do escalate properly.

---

## Why This Matters

Most AI-assisted work fails at one of four points:
- **No spec**: The AI guesses what to do. The user gets something unexpected.
- **No implementation discipline**: Code changes are mixed with validation, making it unclear what was done vs. what was checked.
- **No verification**: The AI says it's done. Nobody checks. Bugs ship.
- **No supervision**: The work passes local checks but fails in the real world.

The SIVS Loop closes all four gaps. It is the reason this framework exists.

---

## SIVS Loop Test Log

| Date | Run | Supervisor | Verdict |
|------|-----|-----------|---------|
| 2026-03-19 | First supervised run | Edocs-supervisor | PASS |
