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
The single entry point for executing spec documents. Qexecute consolidates the three former
execution engines — sequential run, parallel-wave atomic, and the code quality loop — into one
skill. It reads the actual `TASK_REQUEST` — not the user's phrasing — to decide **how** to execute.

> **MANDATORY:** All user confirmations MUST use the interaction adapter. Claude MUST use
> `AskUserQuestion`. Codex interactive may use concise plain-text choices. Codex
> non-interactive selects the documented recommended default only when the action is
> reversible and reports it; destructive ambiguity must stop.

## Flag Grammar

| Invocation | Mode | Behavior |
|------------|------|----------|
| `Qexecute {UUID}` | **default** | Read the spec → classify → **sequential** or **parallel wave** |
| `Qexecute -verify {UUID}` | **verify** | test → review → fix → retest quality loop on already-changed code |
| `Qexecute -utopia …` | **modifier** | Fully autonomous: no-confirmation / auto-approve, combines with default or `-verify`. Sub-flags `-ralph`, `off`, `status`. See “-utopia — Fully Autonomous Execution”. |
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

### TDD Applicability Gate (R004 — scale-aware)

<!-- Attribution: RED-GREEN-REFACTOR methodology adapted from obra/superpowers
     skills/test-driven-development/ (MIT © Jesse Vincent / Prime Radiant).
     Rewritten in QE terms; original text not copied. Scale-aware constraint
     (D017) preserved: blanket-mandating TDD on every task is prohibited. -->

Before delegating implementation for `type: code` items, call
`hooks/scripts/lib/qexecute-tdd-policy.mjs` → `judgeTddPolicy()` with the
following deterministic inputs from the TASK_REQUEST context:

| Input | How to derive |
|---|---|
| `taskType` | TASK_REQUEST `<!-- type: ... -->` annotation |
| `hasTestRunner` | at least one allowlist command available in the repo (`npm run qe:validate`, `node scripts/check-all.mjs`, `node --test <path>`) |
| `hasTestableLogic` | `→ output:` paths include `.mjs`/`.js`/`.ts` logic files with observable function/class outputs |
| `isConfigOrDocOnly` | every `→ output:` path is `.json`/`.md`/`.yaml`/`.yml` — no logic file |
| `hasTestInfrastructure` | repo contains `__tests__/` or `*.test.mjs` files and a runnable node:test harness |

**If `apply = true`** — the RED-GREEN-REFACTOR gate is mandatory (see below).

**If `apply = false`** — record the `result.reason` (exclusion or missing-signal
text from the module) in the task handoff note using `formatExclusionHandoff()`.
Do not leave a blank exclusion record. The three exclusion classes are:
1. `docs`/`analysis` task type — not a code-change task.
2. Config/document-only change — no logic file in scope.
3. Test infrastructure absent — no test runner or test files in the target repo.

Contradictory inputs: exclusions win over inclusions. If a caller supplies both an
inclusion signal and a conflicting exclusion signal (e.g. `taskType='code'` alongside
`isConfigOrDocOnly=true`), `judgeTddPolicy()` resolves to `apply=false`. Never
assume TDD applies when any exclusion fires, regardless of other signals.

**RED-GREEN-REFACTOR gate (apply = true only):**

> **PSE Iron Law (QE R004): No implementation code before a failing test.**

When the gate is active, enforce this sequence for each checklist item that
introduces or changes logic. Violation of step order is a hard stop — do not
proceed to the next step until the current gate passes:

1. **RED — write the failing test first.**
   Write the minimum test(s) that specify the expected behaviour of the new or
   changed logic. Run the test suite and confirm the test **fails for the right
   reason** (not an import error, not a pre-existing pass). If the test passes
   immediately, the test is not specifying new behaviour — revise it.

2. **GREEN — write the minimum implementation to pass.**
   Write only enough production code to make the failing test pass. Run the
   suite again and confirm the test now **passes** with clean output (no
   warnings, no unrelated failures introduced).

3. **REFACTOR — clean up, then re-verify.**
   Improve clarity, remove duplication, adjust structure. After any refactor
   change, re-run the full test suite to confirm the GREEN state is preserved.
   A refactor that re-introduces a failure is a regression — fix before moving
   on.

Scale-aware note: apply this gate only when `judgeTddPolicy()` returns
`apply=true`. Do not apply it to docs, analysis, or config-only items (D017).
If `judgeTddPolicy` itself throws, treat the result as `apply=false` with reason
"policy module error — fail-open" and log the error to handoff notes.

### Delegation & model routing
Delegate to `Etask-executor`. Pick the worker model dynamically:

| Classification | Worker model | Origin |
|----------------|--------------|--------|
| **wave** (parallel) | `sonnet` Etask-executor, one per active item | wave engine |
| **sequential** | `haiku` Etask-executor | sequential engine |

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
   `crossmodel=false`. `qe-mcp` runner tools are compatibility-only and are not the default
   PSE/SIVS execution path.
3. `detectLegacyConfig()` → show migration warning if non-null.
4. **Codex Materialization Check (mandatory after Codex `Done`)**: read
   `.qe/state/unified-state.json` → `codex_materialization` (completed/failed/crashed/running),
   then `.qe/agent-results/codex-ready.signal` (detected/crashed/timeout, 30s poll ≤ 1h),
   then fallback prompt. Missing `.qe/sivs-config.json` → all stages default to Claude.

**Build Admission Gate:** let the PreToolUse Bash hook enforce machine-global build admission
before any build/test command; wait and retry if blocked, do not bypass.

## Step 4: Final Verification

### TDD Completion Re-Verification (R004)

If the TDD gate was active during Step 3 (i.e. `judgeTddPolicy()` returned
`apply=true` for any item), confirm the following before accepting the
implementation as done:

- Every item that required a RED step has a corresponding test file on disk.
  Glob `__tests__/` or `*.test.mjs` for the affected module and confirm the
  test file was created or updated in this turn.
- The full test suite passes GREEN. Run the allowlist verification command
  (`npm run qe:validate` or `node --test <path>`) and record the output as
  evidence. A bare "tests passed" claim without a fresh command execution is
  not sufficient — use `node --test <path>` directly when in doubt.
- The REFACTOR phase did not reintroduce a failure. If the suite was run after
  refactoring, include that run's output in the verification evidence. If no
  refactor was performed, note "REFACTOR: no structural change" explicitly.
- If a VERIFY_CHECKLIST item covers a TDD-applicable module and its test file
  is absent, the item FAILS — do not mark `[x]` until the test file exists and
  passes.

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

**Supervise call budget (Phase 2 / R002).** Adversarial merge-readiness has a
single owner — `Qcritical-review --stage supervise` (3 agents); the orchestrator
does domain audit + aggregation, not a second adversarial pass. Unit = one
sub-agent spawn or the orchestrator's aggregation inference.
- Baseline: `Ecode-reviewer` + `Ecode-test-engineer` (2) + `Esecurity-officer`
  (0–1) + Qcritical supervise (3) + aggregation (1) = **6–7**.
- With the findings pipeline (Verify findings injected, unchanged files skipped —
  see `skills/Qcritical-review/reference/supervise-gate-protocol.md`), the two
  domain re-audits are skipped: **4–5** (≤4 when security-audit is not warranted;
  else floor = 5). The reduction is cross-stage de-duplication, not dropped
  coverage. If no removable duplication applies to a task, record "no reduction
  achieved" rather than an implicit pass.
- **Degraded independence (NF1):** when codex is unreachable, Qcritical's Merge
  Blocker re-runs on Claude and the gate is marked `degraded` → at least WARN,
  `crossmodel=false` — independence is preserved via separate-context adversarial
  roles, never collapsed to a silent same-engine PASS. A config that merely lists
  cross-model routing is not sufficient; the runtime path must degrade visibly.

**For `type: code`, hand off to `-verify` mode** (test-review-fix quality loop) before final completion.

## Step 5: Completion
1. Mark all items `[x]` in both files. 2. Move to `completed/`.
3. `updateClaudeStatus(cwd, uuid, "✅")`. 4. `type: code` → `Ecode-doc-writer`;
`type: docs` → `Edoc-generator`. 5. Auto-run `{adapter.commandPrefix}Qarchive` in background.
6. Clean up stale `.qe/agent-results/`. Report UUID, items, verification, changed files, then
the **Next Task Prompt** (remaining pending tasks).
7. **Clear the SIVS loop counters** for this UUID — call `resetLoop(cwd, uuid)` from
`hooks/scripts/lib/loop-guard.mjs` (Phase 3 / R005-R006). A cleanly completed task
must not leave a stale reentry/remediation counter that could false-block a future
run of the same UUID (abandoned runs are handled by the session-start staleness sweep).

---

# Verify Mode (`-verify`) — Quality Loop

Runs the **test → review → fix → retest** cycle on code already on disk. Equivalent to the
former `Qexecute -verify`. Entered directly (`Qexecute -verify {UUID}`) or automatically after
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

# `-utopia` — Fully Autonomous Execution (modifier)

`-utopia` runs execution with **no confirmations and auto-allowed tool permissions**. It is a
modifier: it layers onto default (execute) or `-verify` (quality loop). Absorbed from the former
`Qexecute -utopia` skill — the state contract, safety rails, and Stop-hook loop are preserved unchanged.

## Flag mapping
| Invocation | Former | Behavior |
|------------|--------|----------|
| `Qexecute -utopia` | `Qexecute -utopia` / `--work` | Autonomous spec pipeline, **no** quality loop. Bare form auto-classifies SIMPLE/COMPLEX. |
| `Qexecute -utopia -verify` | `--qa` | Autonomous + mandatory quality loop (`-verify`) + item-by-item VERIFY check. |
| `Qexecute -utopia -ralph` | `--ralph` | Session-level Stop-hook loop: auto-repeat the PSE chain until VERIFY_CHECKLIST is fully `[x]`. Auto-picks work/qa internally; mutually exclusive with a manual `-verify` selection. |
| `Qexecute -utopia off` | `Qexecute -utopia off` | Disable autonomous mode, restore confirmations, remove Qexecute-added permissions. |
| `Qexecute -utopia status` | `Qexecute -utopia status` | Show current autonomous state. |
| `Qexecute -utopia -ralph off` | `--ralph off` | Clear ralph-state, exit persistent mode immediately. |

## State contract (unchanged — hooks depend on it)
- `.qe/state/utopia-state.json`: `{ enabled, mode: "auto|work|qa", allowUnsafe: false, activatedAt }`.
  Hooks also read `unified-state.json.utopia_state` for backward compat.
- `.qe/state/ralph-state.json`: persists the Stop-hook loop across stop events.
- Skills check autonomy by reading `utopia-state.json` → `enabled:true` = skip prompts, auto-select
  first (recommended) option (except destructive/irreversible choices).

## Pre-flight safety (MANDATORY before any change)
1. **Clean tree**: `git status --porcelain` must be empty, else STOP ("commit or stash first").
2. **Branch**: refuse `main`/`master`; auto-create + switch to `utopia/<timestamp>`, record pre-run SHA.
3. **Scope summary**: print expected touched files/dirs before changing anything.
4. Create `utopia-state.json` (`allowUnsafe:false`).
5. Permissions — **Claude**: merge `permissions.allow` into `.claude/settings.json` (preserve existing:
   Read/Write/Edit/Glob/Grep/Bash(*)/Agent(*)/WebFetch/WebSearch/NotebookEdit). **Codex**: do NOT
   write `.claude/settings.json`; rely on Codex session policy + QE hook rails.

## Enforced safety rails (not guidance)
While autonomous, the PreToolUse hook `hooks/scripts/lib/utopia-guard.mjs` **hard-blocks** regardless
of what the loop attempts: remote push (`git push`/`--force`), destructive git (`reset --hard`,
`clean -f`, `checkout/restore .`, `branch -D`, `stash drop/clear`), destructive shell (`rm -r`,
redirect-clobber, `find -delete`, `truncate`, `dd of=`), sensitive-file writes (`.env`, migrations,
`*.tf`, `Dockerfile`, `secrets/`, keys/certs, k8s), and non-`.qe/` writes on `main`/`master`. Rails are
inert in normal sessions. Escape hatch `allowUnsafe:true` disables all rails — **never in a shared repo.**

## Request routing
- **Bare `-utopia`**: classify SIMPLE (≤3 files, single action, no arch, <3 items → execute directly,
  no formal TASK_REQUEST) vs COMPLEX (any of: >3 files / new feature / arch / ≥3 items → spec pipeline).
  Auto-select work vs `-verify`: `type:code`+tests or +auth/crypto/payment → `-verify`; else → work.
- **Pre-execution gate**: no anchor (file path / symbol / issue# / error / code block / numbered steps)
  AND ≤20 words → redirect to `{adapter.commandPrefix}Qgs` for scoping. `force:`/`!` prefix bypasses.

## Retry loop (work + `-verify`)
On verification failure: diagnose (implementation gap / error / spec conflict / environment) → strategy
→ re-execute failed items only → re-verify. Approach escalation: 1st retry same method, 2nd via
`Ecode-debugger`, then escalate. Max retries: work 3, `-verify` 5. Record `retry` block in utopia-state.
`-verify` mode: after all tasks, run **Cross-task Audit** (file conflicts, i18n gaps, style drift).

## `-ralph` loop
Stop hook detects remaining `[ ]` VERIFY items and re-injects the next until all `[x]`. Safety limits:
`maxLoops` 50, `maxPerHour` 100, `maxConsecutiveFailures` 3 (circuit breaker → skip+log), 30-min stale
guard. On `tool_calls > 200`/iteration → auto `{adapter.commandPrefix}Qcompact` then resume. Progress
`[Ralph] N/M done — Loop #k`; final report `.qe/state/ralph-report.json`.

## Dynamic workflow escalation
When a task has ≥10 checklist items or touches ≥10 files, PSE may not be the best shape: suggest a
dynamic workflow ("Create a workflow for this task" / ultracode effort), optionally paired with a
session goal (`/goal all tests pass, or stop after N turns`) for unattended runs. Fallback: proceed
with `-utopia` / `-utopia -verify` as normal.

## Common rules
Skill priority holds (autonomous still routes git commit through `{adapter.commandPrefix}Qcommit`;
release/admin via `qe-admin-mcp`; QE_CONVENTIONS override map always applies). No intermediate user
prompts after activation. After a run: print `git diff --stat <pre-run-sha>..HEAD` and the rollback
command `git reset --hard <pre-run-sha>` (+ `git branch -D utopia/<ts>`). `-utopia off` restores
confirmations and removes only Qexecute-added permissions.

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
