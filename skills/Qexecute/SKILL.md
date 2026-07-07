---
name: Qexecute
description: "Use when executing a TASK_REQUEST/VERIFY_CHECKLIST or when already-changed code needs the test-review-fix quality loop. With no flag it auto-selects sequential or parallel-wave execution; `-verify` runs verification. Use Qautoresearch for iterative code-optimization loops and Qscenario-test for scenario/E2E."
invocation_trigger: "When a TASK_REQUEST/VERIFY_CHECKLIST must be executed, or already-changed code needs the test-review-fix quality loop."
recommendedModel: haiku
tier: core
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Qexecute — Unified Execution Engine

## Role
The single entry point for executing spec documents. Qexecute consolidates the former
`Qrun-task` (sequential), `Qatomic-run` (parallel wave), and `Qcode-run-task` (quality loop).
It reads the actual `TASK_REQUEST` — not the user's phrasing — to decide **how** to execute.

> **MANDATORY:** All user confirmations MUST use the interaction adapter. Claude MUST use
> `AskUserQuestion`. Codex interactive may use concise plain-text choices. Codex
> non-interactive selects the documented recommended default only when the action is
> reversible and reports it; destructive ambiguity must stop.

## Flag Grammar

| Invocation | Mode | Behavior |
|------------|------|----------|
| `Qexecute {UUID}` | **default** | Read the spec → classify → **sequential** or **parallel wave** |
| `Qexecute -verify {UUID}` | **verify** | test → review → fix → retest quality loop on already-changed code |
| `Qexecute -utopia …` | **modifier** | No-confirmation / auto-approve. Combines with default or `-verify`. *(implemented in Task B; currently a reserved stub — see “-utopia (reserved)”.)* |
| `-loop` | *not owned* | Redirect to `{adapter.commandPrefix}Qautoresearch` (code-modify-evaluate loop) |
| `-scenario` | *not owned* | Redirect to `{adapter.commandPrefix}Qscenario-test` (scenario/E2E) |

- Flags use a **single dash**. `-utopia` is a modifier (combinable); `-verify` and default
  are mutually exclusive execution axes.
- `Qexecute -loop` / `Qexecute -scenario` are **not** handled here — Qexecute emits a one-line
  redirect to the owning skill (not an error).

## Client Adapter Compatibility
- **Claude**: approvals/next-task prompts use `AskUserQuestion`; delegation uses the Agent tool.
- **Codex native**: prefer native subagents via installed agent TOML (`model` /
  `model_reasoning_effort` derived from `recommendedModel`).
- **Codex client adapter**: role-separated inline execution only when native subagent dispatch
  is unavailable; mark the fallback explicitly.
- **Command rendering**: user-visible handoffs use `adapter.commandPrefix` (`/Q…` Claude, `$Q…` Codex).

---

# Default Mode — Execute a Spec

## Step 1: Document Discovery

**Wiki Knowledge Pull (조건부 — `.qe/wiki/`가 있을 때만):** `test -d .qe/wiki`가 참이면
`node <QE plugin>/scripts/lib/wiki-retrieve.mjs "<task 의도>"`(cwd=현재 프로젝트)로 누적 지식을
회수해 실행 컨텍스트에 반영(`tier: reviewed` 우선). 없으면 조용히 skip.

1. **State utility**: call `parseClaudeTaskTable(cwd)` from `hooks/scripts/lib/state.mjs`
   (prefers `.qe/TASK_LOG.md`, falls back to the legacy Claude task table).
2. Glob `.qe/tasks/{pending,in-progress,on-hold}/*.md` for TASK_REQUEST files.
3. Backward compat: check project root if `.qe/tasks/` is missing.
4. UUID argument → select directly. No argument + multiple tasks → ask which to run.
5. Multiple space-separated UUIDs → see **Multiple UUID Execution**.

## Step 2: Summary and Approval

Read TASK_REQUEST + VERIFY_CHECKLIST and show a summary.

**Chained skip:** if TASK_REQUEST contains `<!-- chained-from: Qgenerate-spec -->`, skip the
approval prompt (already approved in Qgenerate-spec) and remove the comment after reading.

Otherwise get approval via the interaction adapter. On approve:
- Move files to `in-progress/`.
- **Status**: call `updateClaudeStatus(cwd, uuid, "🔶")`.

## Step 2.5: Classification — Sequential vs Wave

Parse the TASK_REQUEST checklist and decide the execution shape:

```
WAVE  when ALL hold:
  1. checklist items ≥ 5
  2. topological sort by `depends`/`depends_on` tags yields a max wave width ≥ 2
     (i.e. ≥ 2 items can run at once)
  3. file ownership is non-overlapping — no two items write the same `→ output:` path
SEQUENTIAL  otherwise
```
- No tags → let `Etask-executor` infer dependencies from file paths (existing behavior).
- `--worktree` (opt-in) requests isolated per-item execution when two+ items must touch the
  same file in one wave; default is in-place.

### Code Risk Gate (`type: code` — hard block)
Before any implementation worker starts, enforce:
- TASK_REQUEST has a `## Risk Register` with all six fields filled: worst-case failure,
  data loss/corruption risk, security/permission risk, concurrency/race risk, rollback
  strategy, and unverified assumptions.
- The paired VERIFY_CHECKLIST has checks for worst-case failure, data/security/concurrency
  risk evaluation, unverified-assumption/residual-risk reporting, and high-risk
  mitigation/defer rationale.
- Empty fields, placeholder text, or missing paired checks → route back to
  `{adapter.commandPrefix}Qgs` or amend the spec. Do not start execution.

## Step 3: Execute

### Delegation & model routing
Delegate to `Etask-executor`. Pick the worker model dynamically:

| Classification | Worker model | Origin |
|----------------|--------------|--------|
| **wave** (parallel) | `sonnet` Etask-executor, one per active item | former Qatomic-run |
| **sequential** | `haiku` Etask-executor | former Qrun-task |

Per-item `<!-- complexity: high -->` tags override upward to `sonnet`. On Codex the installed
TOML maps `haiku → gpt-5.3-codex-spark` (low), `sonnet → gpt-5.4-mini` (medium),
`opus → gpt-5.4` (high). For `type: code`, first inject changed target files, adjacent
conventions, and `.qe/analysis/` findings into the worker prompt.

### Sequential path
Execute checklist items in order. Report `✅ [i/N] desc - done`; record `- [x] item ✅ (HH:MM)`.
Intermediate verification every 3 items (or per `<!-- verify-interval: N -->`).

### Wave path
- Cap active workers at `min(cpuCount - 2, 3)` (clamp ≥ 1); queue extra items FIFO.
- No two workers write the same file within a wave (Lead partitions first).
- Workers MUST NOT run raw `git commit` (route commits through `{adapter.commandPrefix}Qcommit`)
  and MUST NOT run project build/test verification themselves (Lead runs exactly one after synthesis).
- Each worker writes `SUMMARY_{Item#}.md` under the active plan phase dir.
- **Synthesis**: Lead reads all `SUMMARY_*.md`, aggregates, then `wait_agent`/`close_agent`
  each handle. Record each worker `completed|failed|timed-out|stale`. Confirm `open handles: 0`
  before the final report, or list each stale warning (handle id, role, item, timeout reason).

### Lifecycle Cleanup
Before returning, close all delegated handles and include their terminal status in the final report.

### SIVS Engine Routing
1. Load `.qe/sivs-config.json` (`scripts/lib/codex_bridge.mjs` → `loadSivsConfig()`).
2. `resolveEngine("implement", config)` — Claude/`claude` = standard; Claude/`codex` = delegate
   via `codex_bridge.mjs`/codex-plugin-cc (fallback Claude + warn); Codex/`codex` = native
   subagents or `degraded-inline`; Codex/`claude` = `Qclaude-rescue`/`claude_bridge.mjs` or
   `crossmodel=false`.
3. `detectLegacyConfig()` → show migration warning if non-null.
4. **Codex Materialization Check (mandatory after Codex `Done`)**: read
   `.qe/state/unified-state.json` → `codex_materialization` (completed/failed/crashed/running),
   then `.qe/agent-results/codex-ready.signal` (detected/crashed/timeout, 30s poll ≤ 1h),
   then fallback prompt. Missing `.qe/sivs-config.json` → all stages default to Claude.

**Build Admission Gate:** let the PreToolUse Bash hook enforce machine-global build admission
before any build/test command; wait and retry if blocked, do not bypass.

## Step 4: Final Verification
Verify **each** VERIFY_CHECKLIST item with a concrete action ("build passed" alone is NOT enough):
file existence → Glob; code behavior → Grep/run test; build → project build; regression → test
suite; security → `Esecurity-officer`; visual → screenshot. Report `✅ PASS` / `❌ FAIL (reason)`;
fix & re-verify (max 2 retries, then escalate).

**Cross-Phase Regression:** for `type: code`, run the Cross-Phase Regression Gate
(`hooks/scripts/lib/regression-gate.mjs`) before completion.

**Security Verification (mandatory for `type: code` + auth/crypto/payment/JWT/password/secret/
token/credential/bcrypt):** invoke `Esecurity-officer` with `git diff HEAD`; a FAIL grade
blocks Step 5.

## Step 4.5: Supervision Gate
Skip only if ALL: `type: docs`/`analysis` with < 5 items, single-item, MD-only.
**Never skip for `type: code`.** Track `supervision_iteration` in
`.qe/state/session-stats.json`.
1. Invoke `Esupervision-orchestrator` with task context + verification results.
2. PASS → Step 5; PARTIAL → apply improvements, re-verify; FAIL → save REMEDIATION_REQUEST,
   re-execute failed items via `Etask-executor`.
3. **Agent Trigger Check**: glob `.qe/agent-triggers/*.trigger.md`, spawn targets, delete
   processed files; append findings.

**For `type: code`, hand off to `-verify` mode** (test-review-fix quality loop) before final completion.

## Step 5: Completion
1. Mark all items `[x]` in both files. 2. Move to `completed/`.
3. `updateClaudeStatus(cwd, uuid, "✅")`. 4. `type: code` → `Ecode-doc-writer`;
`type: docs` → `Edoc-generator`. 5. Auto-run `{adapter.commandPrefix}Qarchive` in background.
6. Clean up stale `.qe/agent-results/`. Report UUID, items, verification, changed files, then
the **Next Task Prompt** (remaining pending tasks).

---

# Verify Mode (`-verify`) — Quality Loop

Runs the **test → review → fix → retest** cycle on code already on disk. Equivalent to the
former `Qcode-run-task`. Entered directly (`Qexecute -verify {UUID}`) or automatically after
default-mode Step 4.5 for `type: code`.

**Default execution:** delegate the whole loop to `Eqa-orchestrator` (saves main context; it
coordinates `Ecode-test-engineer` + `Ecode-reviewer` + `Ecode-debugger`, escalates MEDIUM→HIGH).
Pass changed files (`git diff --name-only`), TASK_REQUEST, VERIFY_CHECKLIST, test patterns. Lead
owns the handle lifecycle (`wait_agent`/`close_agent`, report `open handles: 0`).

**Loop limit: 3 iterations** (confirm continuation via the interaction adapter each round).

Mandatory gates before completion (full protocols unchanged):
- **4.6/4.8 Regression + Cross-Phase Regression** (`regression-gate.mjs`) — skip for docs/analysis/Phase 1.
- **4.85 Smoke Test Gate** — `node -c`, sample-input execution for changed `.mjs`/JSON/hooks.
- **4.7 Nyquist Audit** — coverage-gap / ghost-requirement discovery.
- **4.8 Comment Coverage Gate** (`comment-checker.mjs`) — 80% min, < 50% FAIL.
- **4.9 Adversarial Verify Gate** — `{adapter.commandPrefix}Qcritical-review --stage verify`
  (Devil's Advocate cross-model + Security Auditor + Performance Skeptic). FAIL routes backward
  per `root_cause_stage`. Always mandatory for `type:code`/`type:other`.
- **4.10 Risk Proof Gate** — `{adapter.commandPrefix}Qcritical-review --risk {UUID}`; persisted
  report at `.qe/agent-results/risk-proof-{UUID}.md`. HIGH/CRITICAL unknown/no-evidence hard-blocks.
- **4.11 Contract Conformance Gate** — `{adapter.commandPrefix}Qverify-contract --all` when
  `.qe/contracts/active/*.md` exist.

**Review Readiness dashboard** (before review): `reviewReadiness(getChangedFiles(cwd))` from
`hooks/scripts/lib/changed-files.mjs` — routes each domain (security/test/analysis/docs/config/
code) to its reviewers; always route `security` → `Esecurity-officer`.

**Report (Step 5):** include `Facts`, `Verification`, `Residual Risks`, `Assumptions` (user's
language; state `none` explicitly if empty). Do not end on a purely positive summary.

---

# `-utopia` (reserved)

`-utopia` is the no-confirmation / auto-approve modifier and is **implemented in Task B**
(`44837422`, Qutopia absorption). Until then this flag is a reserved stub: if passed, report
that `-utopia` is not yet active and proceed in normal (confirmed) mode. Do not silently skip
confirmations.

---

## Multiple UUID Execution
Parallel by default. Read all TASK_REQUESTs → detect inter-dependencies (`depends: {UUID}`, or
task A's output path referenced in task B). No deps → spawn one `Etask-executor` per UUID
concurrently (single tool-call block). Deps → topological waves. File ownership: no two agents
write the same file; shared files (i18n/config/barrels/manifests) are Lead-merged after workers
complete. On failure: skip that task, continue others, report all at end.

## Handoff
Resolve the active plan (session binding → `.qe/planning/ACTIVE_PLAN` → flat fallback), read the
resolved ROADMAP, and render the standard handoff (`QE_CONVENTIONS.md`: vertical table,
`[x]`/`[>]`/`[ ]`, single code block, lines < 60 chars).

- **`type: code`** → `Next: {adapter.commandPrefix}Qexecute -verify {UUID}`
- **`type: docs`/`analysis`/deletion-heavy** → SIVS verify inline, then
  `{adapter.commandPrefix}Qgs {slug}: {alias}` for the next phase.
- All phases done → `All phases done. Finalize with {adapter.commandPrefix}Qcommit`.

## Special Situations
| Situation | Action |
|-----------|--------|
| No documents | Suggest `{adapter.commandPrefix}Qgs` |
| Interrupted | Save progress with timestamps, leave in `in-progress/` |
| On hold | Move to `on-hold/`, set ⏸️ |
| Resume | Move to `in-progress/`, continue from last unchecked item |
| Etask-executor crash | Offer Resume / Retry / Abort |
| `-loop` / `-scenario` passed | Redirect to `Qautoresearch` / `Qscenario-test` |

## Role Constraints
- Only executes existing spec documents; use `{adapter.commandPrefix}Qgs` to create specs.
- Do not modify spec content except checking off items.
- Do not let implementer-stage execution mutate planner-owned artifacts except approved revisions.
- Verify mode adds no features; fix scope is limited to discovered issues.
