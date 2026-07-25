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

## SIVS Engine Routing

> **Superseded:** SIVS is now single-AI. The active client owns every stage;
> cross-client bridges and per-stage engine routing are not execution paths.
> The authoritative contract is `core/SIVS_SINGLE_AI_MODEL.md`.

Each SIVS stage can be configured to use Claude or Codex. Routing is base-agnostic and bidirectional: with `.qe/sivs-config.json`, a Claude base session delegates Codex stages through `codex_bridge`, and a Codex base session delegates Claude stages through `claude_bridge` / `Qclaude-rescue` (DECISION_LOG D028/D029/D030).

Recommended default when Codex is available is **Claude Head / Codex Body**
(`claude-head`): Spec and Supervise stay Claude-led, while Implement and Verify
prefer Codex.

- **Spec**: Claude generates specs natively, or delegates to Codex via `/codex:rescue`
- **Implement**: Claude executes via agents, or delegates to Codex via `/codex:rescue --write`
- **Verify**: Claude validates results, or delegates to Codex via `/codex:rescue --verify`
- **Supervise**: Claude runs domain supervisors, or delegates to Codex via `/codex:review`

Configuration: `.qe/sivs-config.json` (optional — absent config means each base runs solo with zero external dependencies)

This architecture ensures:
- Claude-only and Codex-only baselines work without any external dependencies
- Cross-engine delegation is strictly optional via the Codex and Claude bridges
- No external provider APIs (Gemini, GPT) are directly invoked by the framework
- User retains full choice of which engine handles each SIVS stage

**Gate subagent engine ownership (Phase 5 / D-f876457e-1):** SIVS `enforceRouting` hard-blocks direct Agent spawns (`Etask-executor` → implement, `Esupervision-orchestrator` → supervise, `Ecode-reviewer` → verify) that violate the configured engine. However, gate subagents spawned *inside* `Qcritical-review` (Devil's Advocate, Security Auditor, Merge Blocker, Merge Advocate, Impartial Judge) are **protocol-owned**: the gate protocol itself controls their engine assignment, including the automatic Codex cross-model upgrade for DA and Merge Blocker. SIVS enforcer does not reach inside protocol-owned spawns. This mixed ownership is profile-independent: stage routing may choose Claude or Codex for the top-level SIVS stage, while `Qcritical-review` still owns its adversarial role routing. Under `codex-head`, G3 Verify is mixed (DA → Codex via protocol auto-upgrade, Security Auditor + Performance Skeptic → Claude) and G5 Supervise includes a Codex orchestrator aggregation. Under the recommended `claude-head`, top-level Supervise is Claude-led, while DA/Merge Blocker can still auto-upgrade to Codex inside the gate protocol. G4 Risk Proof (`Erisk-proof-auditor`) is Claude-only (not in SIVS STAGE_MAP). The Supervise call budget is 4–5 (≤4 when Esecurity-officer is not warranted; floor = 5 when security audit fires); the reduction from baseline 6–7 comes from the findings pipeline (Phase 2 / R002) injecting Verify findings into Supervise so cross-stage `Ecode-reviewer`/`Ecode-test-engineer` re-audits on unchanged files are skipped — not from routing changes. See DECISION_LOG `D-f876457e-1` and `skills/Qcritical-review/reference/{verify-gate-protocol,supervise-gate-protocol}.md`.

**Per-scope config design:** `loadSivsConfig(cwd)` uses exact-path loading (no directory walk-up); hook cwd = session cwd. Each repo has its own `.qe/sivs-config.json` scope independent from a wrapper workspace's config — two configs in separate scopes do not conflict in a single session by design. See `QE_CONVENTIONS.md` Codex Runtime Policy and DECISION_LOG `D-f876457e-1` (config scope authority rules).

---

## Position in the PSE Chain

The SIVS Loop is the **quality gate** that runs inside the Execute and Verify steps of the PSE Chain (`/Qplan → /Qgs → /Qexecute → /Qexecute -verify` on Claude; `$Qplan → $Qgs → $Qexecute → $Qexecute -verify` on Codex). The PSE Chain is the user-facing workflow; the SIVS Loop is the internal quality mechanism that ensures each task meets its spec.

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

This loop — the **SIVS Loop** — is not optional. It is the quality gate that drives every task to completion.

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

## The Three Core Documents

| Document | Stage | Role | Generated by |
|----------|-------|------|--------------|
| `TASK_REQUEST_{UUID}.md` | Spec | Defines the work contract | `Qgenerate-spec` |
| `VERIFY_CHECKLIST_{UUID}.md` | Verify | Objective completion check | `Qgenerate-spec` |
| `REMEDIATION_REQUEST_{UUID}_{N}.md` | Remediate | Rework directive for failing items | Supervision agents |

These three documents are the backbone of the framework. Every other component exists to support them.

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
| `Qplan` | Phase planning and roadmap design (PSE Step 1) |
| `Qcommit` | Git commit without AI traces (utility layer) |
| `Qcompact` / `Qresume` | Context preservation and restoration across sessions |
| `skill-budget.mjs` | Skill token budget monitoring and overflow detection |
| `metrics.mjs` | Harness metrics aggregation + session telemetry JSONL |
| `trace-logger.mjs` | Agent decision tracing for observability |

---

## Hook Lifecycle Events (9)

The QE Framework hooks into 9 Claude Code plugin-supported lifecycle events.

| Event | Handler | Purpose |
|-------|---------|---------|
| SessionStart | session-start.mjs | Session init, legacy migration, memory load, skill budget check |
| PreToolUse | pre-tool-use.mjs | ContextMemo validation, SIVS routing, block emitter |
| PostToolUse | post-tool-use.mjs | ContextMemo update, lint, error detection |
| PreCompact | pre-compact.mjs | Pre-compaction snapshot, handoff save |
| Stop | stop-handler.mjs | Session end, sweep, failure capture, rating |
| UserPromptSubmit | prompt-check.mjs | Help flag parsing, intent routing |
| Notification | notification.mjs | Agent completion chaining, persistent mode |
| TeammateIdle | teammate-idle.mjs | Teammate task assignment on idle |
| TaskCompleted | task-completed.mjs | VERIFY_CHECKLIST check, TASK_LOG update, archival |

---

## Mandatory Obligations

Every skill, agent, and hook in this framework must uphold the following:

1. **Respect the spec.** Do not execute work that has no TASK_REQUEST. If asked to work without a spec, generate one first via `Qgenerate-spec`.

2. **Do not skip verification.** A task is not complete until its VERIFY_CHECKLIST items are checked. Marking a task complete without checking is a violation.

3. **Parallel first.** If two operations have no data dependency, run them in parallel. Never default to sequential when parallel is possible. This applies to: agent spawning, file reads/writes, analysis tasks, test+review, multi-UUID execution, and wave execution in Etask-executor. Sequential is the fallback, not the default.

4. **Remediation is a new spec, not a patch.** When verification fails, generate a proper REMEDIATION_REQUEST with a proper checklist. Do not apply ad-hoc fixes without a spec.

5. **The loop is the product.** Features, skills, and agents are means to an end. The end is always: spec defined → implemented → verified → shipped with confidence.

6. **Ground truth over self-assessment.** When verifying work, prefer external execution (Bash, actual tool invocation, real system test) over self-review. Code that compiles is not code that works. A checklist item that passes self-review may still fail in the real system. Always run the actual command, install the actual plugin, execute the actual test before declaring completion.

7. **Verify research before planning.** Web search results, blog posts, and documentation claims must be tested against the actual system before incorporating into plans. Run `--help`, `--version`, or a minimal test to confirm the feature exists. Unverified claims must be tagged `[UNVERIFIED]` in all downstream documents. Never build phases around unverified external capabilities.

8. **Independent verification at every stage.** A stage cannot certify its own output — that is the self-reference problem, and it is acute when the SIVS engine is homogeneous (all-Claude or all-Codex), because the verifier shares the author's blind spots. Every SIVS stage therefore runs a **mandatory independent verification gate** with **structural independence** (a fresh-context adversarial sub-agent in a distinct cognitive mode — Spec: Structural+Critical, Verify: Critical, Supervise: Meticulous), auto-upgraded to a cross-model engine (Codex) when reachable. A gate FAIL is **not a dead-end**: it routes **backward** to the stage that caused it (Spec→Spec, Verify→Implement/Spec, Supervise→Verify→Implement→Spec), re-entering the loop until it passes or the 3-round cap escalates to the user. Codex is never a required dependency — the same-engine baseline always runs. See `skills/Qcritical-review/reference/{thinking-modes,spec-gate-protocol,verify-gate-protocol,supervise-gate-protocol}.md`.

---

## Adaptive Harness Principle

PSE chain (Qplan → Qgs → Qexecute → Qexecute -verify) is the structured default path. However, when Claude Code provides native features that are more suitable, prefer native over PSE:

1. **Verification** → `/goal` sets a completion condition evaluated by a **separate model**, breaking self-preferential bias. Use when the pass criteria are mechanically verifiable (tests pass, build succeeds, lint clean).
2. **Large-scale orchestration** → `/workflows` writes a JS orchestration script for up to 1,000 subagents. Use when the task has 10+ independent items or requires adversarial multi-agent coordination.
3. **Code review** → `claude ultrareview` runs a cloud-hosted multi-agent review. Use as an external alternative to self-review via Eqa-orchestrator.
4. **Background agents** → `claude agents` manages parallel sessions with effort/model control. Use for background processing alongside interactive work.

**Rule**: Skills should wrap or complement native features, not compete with them. If a native feature does the job better, guide the user to it instead of reimplementing it.

The Execution Harness Layer (`core/EXECUTION_HARNESS.md`) defines QE-owned runtime
patterns for mode selection, durable lanes, isolated workspaces, status
projection, and evidence collection. It is subordinate to the SIVS Loop and the
Mandatory Obligations above: harness status can supply evidence, but it cannot
replace TASK_REQUEST fulfillment, VERIFY_CHECKLIST completion, or supervision
judgment.

See `docs/CLAUDE_CODE_FEATURES.md` for verified feature reference with minimum versions and official documentation links.

---

## Acknowledged Exceptions

The following are intentional design trade-offs, not violations of the Mandatory Obligations:

### 1. Qexecute -utopia SIMPLE Classification

Tasks classified as SIMPLE (≤3 files, single action, <3 checklist items) may execute without a formal TASK_REQUEST document. This is an intentional trade-off for micro-task velocity. The canonical SIMPLE criteria are defined in `skills/Qexecute/SKILL.md` (`-utopia` section, Single Source of Truth).

**Rationale**: Requiring a full spec for a one-line fix would add overhead that exceeds the risk of the change itself.

### 2. Qautoresearch Experimental Loop

Experimental optimization loops (Qautoresearch) use metric convergence as verification instead of VERIFY_CHECKLIST. The loop evaluates a single metric per iteration (keep/discard) rather than a document-based checklist.

**Rationale**: In the experimental domain, hypothesis-metric feedback is the natural verification mechanism. Forcing VERIFY_CHECKLIST onto iterative experiments would break the tight feedback loop that makes experimentation effective.

### 3. Qexecute -utopia Retry Loop

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
