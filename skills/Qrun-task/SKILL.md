---
name: Qrun-task
description: "Use when a TASK_REQUEST/VERIFY_CHECKLIST must execute sequentially because items are ordered, long-form, or non-atomic. Use Qatomic-run for independent wave work; use Qcode-run-task only after code already changed."
invocation_trigger: When a TASK_REQUEST or checklist needs implementation or verification.
recommendedModel: haiku
---

# Task Execution Skill (PSE Chain Fallback)

## Role
Execute tasks based on spec documents. This is a **secondary execution engine** within the `Qplan` PSE Chain, used when tasks cannot be fully atomized for `Qatomic-run`.

> **MANDATORY:** All user confirmations MUST use the interaction adapter. Claude MUST use the `AskUserQuestion` tool. Codex interactive may use concise plain-text choices. Codex non-interactive selects the documented recommended default only when the action is reversible and reports the default.

## Client Adapter Compatibility

- **Claude**: approvals and next-task prompts use `AskUserQuestion`; implementation delegation uses the Agent tool where specified.
- **Codex interactive**: approvals and next-task prompts use concise plain-text choices.
- **Codex non-interactive**: chained tasks may continue; otherwise default to the safe recommended action and report it. Destructive ambiguity must stop.
- **Agent delegation**: Codex should prefer native subagents through the client adapter. QE-installed agent TOML carries `model` and `model_reasoning_effort` converted from `recommendedModel`. If the runtime lacks the required primitive, preserve the role contract with role-separated inline execution and mark the fallback explicitly.
- **Command rendering**: user-visible handoffs use `adapter.commandPrefix` (`/Q...` for Claude, `$Q...` for Codex).

## Relationship to the Primary Chain
- Canonical path: `{adapter.commandPrefix}Qplan -> {adapter.commandPrefix}Qgs -> {adapter.commandPrefix}Qatomic-run -> {adapter.commandPrefix}Qcode-run-task`.
- Prefer `{adapter.commandPrefix}Qatomic-run` whenever the checklist can be partitioned; use `{adapter.commandPrefix}Qrun-task` when tasks are non-atomic, long-form, or explicitly routed for remediation.
- Even in fallback mode, still hand off to `{adapter.commandPrefix}Qcode-run-task` to maintain the verification and supervision gate.

## Workflow
```
Qgenerate-spec -> Qrun-task -> Read -> Summarize -> Approve -> Execute -> Verify -> Done
```

## Directory Structure
```
.qe/tasks/{pending,in-progress,completed,on-hold}/TASK_REQUEST_*.md
.qe/checklists/{pending,in-progress,completed,on-hold}/VERIFY_CHECKLIST_*.md
.qe/tasks/remediation/REMEDIATION_REQUEST_*.md
```

## SIVS Engine Routing

Before executing task items, resolve SIVS engine routing:

1. Read `.qe/sivs-config.json` from the project root (via `scripts/lib/codex_bridge.mjs` → `loadSivsConfig()`).
2. Call `resolveEngine("implement", config)` for the **Implement** stage (actual coding). If Codex is installed and no explicit config overrides it, Implement resolves to Codex by default.
   - **Base client = Claude, stage engine = `claude`**: Proceed with the standard execution workflow.
   - **Base client = Claude, stage engine = `codex`**: Delegate implementation through `codex_bridge.mjs` / codex-plugin-cc, passing the TASK_REQUEST checklist items as the task description. If unavailable, warn and fall back to Claude execution.
   - **Base client = Codex, stage engine = `codex`**: Prefer native Codex execution/subagents using the installed TOML model routing. If unavailable, use role-separated inline execution and mark the route `degraded-inline`.
   - **Base client = Codex, stage engine = `claude`**: Delegate through `Qclaude-rescue` / `claude_bridge.mjs` when available. If unavailable, warn and keep execution on Codex with `crossmodel=false`.
3. Call `resolveEngine("verify", config)` for the **Verify** stage (validation only). If Codex is installed and no explicit config overrides it, Verify resolves to Codex by default.
   - **Base client = Claude, stage engine = `claude`**: Claude validates implementation results against VERIFY_CHECKLIST.
   - **Base client = Claude, stage engine = `codex`**: Codex validates through the bridge command when available; otherwise Claude validates and reports `crossmodel=false`.
   - **Base client = Codex, stage engine = `codex`**: Codex validates natively.
   - **Base client = Codex, stage engine = `claude`**: Claude validates through `Qclaude-rescue` / `claude_bridge.mjs` when available; otherwise Codex validates and reports `crossmodel=false`.
4. Check for legacy config: call `detectLegacyConfig()`. If non-null, display migration warning.

**Codex Implement Delegation:**
- Claude base session: use the Claude agent adapter / codex-plugin-cc bridge for autonomous Codex execution
- Codex base session: prefer the native Codex execution/subagent path; if native subagent delegation is unavailable, use role-separated inline execution and mark the fallback explicitly
- Pass TASK_REQUEST content as the task prompt
- Codex operates in `--write` mode (can modify files)
- After Codex returns Done, run **Materialization Check** before proceeding

**Codex Materialization Check (Mandatory after Codex Done):**
Codex may return `Done` before files are actually written (async companion pattern). The notification hook (`notification.mjs`) handles initial detection and writes state to `unified-state.json` under the `codex_materialization` key.

**After every Codex `Done`, execute this sequence:**

1. **Read unified state** — check `.qe/state/unified-state.json` → `codex_materialization` field:
   - `status: "completed"` → notification hook already confirmed files written. Run `git diff --stat` and proceed to **Verify**.
   - `status: "failed"` → report error to user, offer retry or Claude fallback.
   - `status: "crashed"` → companion PID was confirmed dead before materialization. Enter the abnormal-termination retry path immediately: retry Codex once through the existing SIVS route, then fallback to Claude if the same task/worker/item has already retried.
   - `status: "running"` → poll watcher is active, proceed to step 2.
   - Field missing → notification hook did not fire, proceed to step 2.

2. **Read signal file** — `cat .qe/agent-results/codex-ready.signal 2>/dev/null`:
   - `"detected": true` → files written. Run `git diff --stat`, proceed to **Verify**.
   - `"crashed": true` or `"status": "crashed"` → companion process died before materialization. Enter the one-retry/fallback path immediately; do not wait for the 1h timeout.
   - File not found → watcher still polling. Wait 30s, re-read. Repeat up to 120 times (1h).
   - `"timeout": true` → no changes after 1h. Go to step 3.

3. **Fallback** — use the interaction adapter:
   - "Codex companion did not produce file changes after 1 hour."
   - (a) Keep waiting +1h  (b) Retry with Codex  (c) Implement with Claude  (d) Check Codex process
   - If user chooses (a), repeat the 1-hour polling loop.

Results are logged to `.qe/agent-results/codex-materialization.md` automatically.

**Fallback guarantee**: Missing `.qe/sivs-config.json` → all stages default to Claude. Zero impact on existing workflows.

**Build Admission Gate:** Before invoking any build-capable verification command (`gradle`, `mvn`, `npm test`, `npm run build`, or wrappers), let the normal PreToolUse Bash hook enforce machine-global build admission. Heavy commands may be hard-blocked until memory is available and no competing build lock is active; do not bypass this with worker-side verification.

## Delegation Rule
When checklist has **5+ items**, delegate to `Etask-executor` agent. Main agent tracks progress, state transitions, and verification. After delegation, update timestamps: `- [x] item ✅ (HH:MM)`.

**Model selection when spawning Etask-executor:**

Read the TASK_REQUEST checklist for `<!-- complexity: ... -->` tags, then pick the model:

| Condition | Model |
|-----------|-------|
| Any item tagged `complexity: high` | `sonnet` |
| All items tagged `complexity: low` | `haiku` |
| No tags, ≤ 3 items, single-file scope | `haiku` |
| No tags, 4–7 items | `sonnet` |
| No tags, 8+ items OR cross-cutting architecture | `sonnet` |

Pass the selected model as the `model` parameter when spawning `Etask-executor`.
On Codex, installed agent TOML maps these QE tiers to native model routing:
`haiku -> gpt-5.3-codex-spark` with low effort, `sonnet -> gpt-5.4-mini` with medium effort, and `opus -> gpt-5.4` with high effort.

### Repository Context Resolution (`type: code` only)

Before spawning `Etask-executor`, collect the task's target files from the `TASK_REQUEST`
checklist paths and the current diff when available. Inject the relevant repository
instructions, adjacent code conventions, and `.qe/analysis/` findings into the agent
prompt. Keep the context focused on files that directly affect the task.

---
## Step 1: Document Discovery

**Wiki Knowledge Pull (조건부 — `.qe/wiki/`가 있을 때만):** `test -d .qe/wiki`가 참이면, 실행할 task의
변경 대상/주제 관련 누적 지식(conventions·gotcha·과거 결정)을 회수한다 — `node <QE plugin>/scripts/lib/wiki-retrieve.mjs "<task 의도>"`
(cwd=현재 프로젝트) → 중복 구현·결정 위반을 피하도록 실행 컨텍스트에 반영(`tier: reviewed` 우선).
**`.qe/wiki/`가 없으면 명령 실행 없이 조용히 skip**(비-wiki 무영향).

1. **Use State Utility**: Call `parseClaudeTaskTable(cwd)` from `hooks/scripts/lib/state.mjs`. It now prefers `.qe/TASK_LOG.md` and falls back to the legacy Claude `CLAUDE.md` task table.
2. Glob `.qe/tasks/{pending,in-progress,on-hold}/*.md` for TASK_REQUEST files
3. Backward compat: check project root if `.qe/tasks/` missing
4. Multiple tasks → ask which to run. UUID argument → select directly
5. Multiple UUIDs (space-separated) → parallel execution (see **Multiple UUID Execution** section below)

## Step 2: Summary and Approval

Read TASK_REQUEST + VERIFY_CHECKLIST, show summary:
... (omitted summary table) ...

**Chained execution skip:** If TASK_REQUEST contains `<!-- chained-from: Qgenerate-spec -->`, skip the approval prompt (user already approved in Qgenerate-spec). Remove the comment after reading.

Otherwise, use the interaction adapter for approval. On approve:
- Move files to `in-progress/`
- **Update Status**: Call `updateClaudeStatus(cwd, uuid, "🔶")`. This updates the active task registry, preferring `.qe/TASK_LOG.md`.

## Step 3: Execute

Execute checklist items in order. Report: `✅ [1/N] desc - done`. Record `- [x] item ✅ (HH:MM)`.

**Code task**: After Step 3, ask whether to run `{adapter.commandPrefix}Qcode-run-task` quality loop.

**Intermediate verification**: Every 3 items (or per `<!-- verify-interval: N -->`), check relevant VERIFY_CHECKLIST items. Fix failures before continuing.

## Step 4: Final Verification

Verify **each** VERIFY_CHECKLIST item with a concrete action — "build passed" alone is NOT sufficient.

| Item type | Verification action |
|-----------|-------------------|
| File exists | `Glob` for the path |
| Code behavior | `Grep` for expected pattern or run test |
| Build/compile | `tsc --noEmit` or project build command |
| No regression | Run existing test suite |
| Security | Invoke `Esecurity-officer` (see below) |
| Visual/UI | Screenshot via chrome tools if available |

Report per item: `✅ PASS` or `❌ FAIL (reason)`. All pass → Step 5. Failures → fix and re-verify (max 2 retries, then escalate).

**Cross-Phase Regression:** For `type: code` tasks, also run the Cross-Phase Regression Gate (see Qcode-run-task Step 4.8) to ensure prior phases have not regressed before marking completion.

### Security Verification (Mandatory for code + security keywords)

When `type: code` AND TASK_REQUEST contains any of: auth, crypto, payment, JWT, password, secret, token, credential, bcrypt:
1. Invoke `Esecurity-officer` agent with `git diff HEAD` context
2. Integrate findings into VERIFY_CHECKLIST security items
3. FAIL grade from Esecurity-officer blocks Step 5 until resolved

This is **mandatory**, not a recommendation.

## Step 4.5: Supervision Gate

After verification, run the Supervision Gate to get expert-level quality assessment.

**skip-supervision conditions** (skip if ALL true):
- Task is `type: docs` or `type: analysis` with fewer than 5 items
- Single-item tasks
- MD-only changes

**never skip-supervision for `type: code` tasks** — code always goes through the gate.

Track `supervision_iteration` counter in `.qe/state/session-stats.json` to persist across session compactions. Increment on each supervision round.

1. Invoke `Esupervision-orchestrator` with task context and verification results
2. If grade is PASS → proceed to Step 5
3. If grade is PARTIAL → apply suggested improvements, re-verify
4. If grade is FAIL → save REMEDIATION_REQUEST, re-execute failed items via Etask-executor

When role-separated orchestration is active:
- include `review-report.md` and `implementation-report.md` in the supervision packet
- require the supervisor to explicitly check whether role boundaries were respected
- write the final verdict to `.qe/ai-team/artifacts/verification-report.md`

**Agent Trigger Check:** After supervision, check `.qe/agent-triggers/` for trigger files written by agents during execution:
1. Glob `.qe/agent-triggers/*.trigger.md`
2. For each trigger: spawn the target agent with the provided context (in parallel if multiple)
3. Delete processed trigger files
4. If triggered agents produce new findings, append to verification results

Skip agent triggers if no trigger files exist.

## Step 5: Completion

1. Mark all items `[x]` in TASK_REQUEST and VERIFY_CHECKLIST
2. Move files to `completed/`
3. **Update Status**: Call `updateClaudeStatus(cwd, uuid, "✅")`. This updates the active task registry, preferring `.qe/TASK_LOG.md`.
4. `type: code` → call `Ecode-doc-writer`; `type: docs` → call `Edoc-generator`
5. Auto-run `{adapter.commandPrefix}Qgc archive` in background
6. Clean up `.qe/agent-results/` (delete result files older than current task)

Report: UUID, items completed, verification passed, changed files.

### Next Task Prompt

After completion, check for remaining tasks:
1. Read the project task registry first (`.qe/TASK_LOG.md` or equivalent active task tracker); use the legacy Claude `CLAUDE.md` task table only as backward compatibility fallback
2. Also check `.qe/tasks/pending/` for queued TASK_REQUEST files
3. If next tasks exist, use the interaction adapter to prompt:
   - List upcoming tasks (UUID + name)
   - Ask: "To execute the next task, run `{adapter.commandPrefix}Qrun-task {UUID}`."
4. If no remaining tasks, skip this step

---

## Handoff
After task completion (Step 5), resolve the active plan's ROADMAP before rendering handoff:
1. Read `.qe/state/current-session.json` → `session_id` → `.qe/planning/.sessions/{session_id}.json` → `activePlanSlug`.
2. Else read `.qe/planning/ACTIVE_PLAN`.
3. Use the resolved `.qe/planning/plans/{slug}/ROADMAP.md`, falling back to flat `.qe/planning/ROADMAP.md` for legacy projects.

Use the standard handoff format from `QE_CONVENTIONS.md` (vertical table, `[x]`/`[>]`/`[ ]` markers, single code block, lines under 60 chars).

### When `type: code`
```
{slug} · Phase {X}: {PhaseName} — Implementation complete

Roadmap
  [x] Phase 1: {Name1}
  [>] Phase {X}: {PhaseName}
  [ ] Phase {X+1}: {NextName}

PSE: [x] Plan [x] Spec [x] Execute [>] Verify

{TaskDescription — 다음 작업 내용 한 줄 요약}
Next: {adapter.commandPrefix}Qcode-run-task {UUID}
```

### When `type: docs` / `type: analysis` / deletion-heavy
After performing SIVS verification inline:
```
{slug} · Phase {X}: {PhaseName} — Complete

Roadmap
  [x] Phase 1: {Name1}
  [>] Phase {X+1}: {NextName}
  [ ] Phase {X+2}: {FutureName}

PSE: [x] Plan [x] Spec [x] Execute [x] Complete

{NextPhaseDescription — 다음 Phase 작업 내용 한 줄 요약}
{Next label — 사용자 입력 언어로, 예: "다음:" / "Next:"}: {adapter.commandPrefix}Qgs {slug}: {짧은 별칭, 최대 6단어}
```
(Fallback line 금지 — `Qgs`는 `Qgenerate-spec`의 alias이므로 중복이다. Legacy flat-file projects drop the `{slug} · ` prefix and use `{adapter.commandPrefix}Qgs Phase {X+1}: {짧은 별칭}`.)
When all Phases are complete:
```
All phases done. Finalize with {adapter.commandPrefix}Qcommit
```

---

## Special Situations

| Situation | Action |
|-----------|--------|
| No documents | Suggest `{adapter.commandPrefix}Qgenerate-spec` or alias `{adapter.commandPrefix}Qgs` |
| Task interrupted | Save progress with timestamps, leave in `in-progress/` |
| On hold | Move to `on-hold/`, set ⏸️ |
| Resume | Move to `in-progress/`, continue from last unchecked item |
| Etask-executor crash | Offer Resume/Retry/Abort |
| No project instruction file or legacy task table | Proceed without context, notify user |

## Multiple UUID Execution

**Parallel by default.** When multiple UUIDs are passed (space-separated), spawn one `Etask-executor` Agent per UUID concurrently.

### Execution Flow
```
{adapter.commandPrefix}Qrun-task {UUID1} {UUID2} {UUID3}
  │
  ├─ Read all TASK_REQUESTs → check for inter-dependencies
  │
  ├─ No dependencies found (default):
  │    ├─ Agent spawn: Etask-executor(UUID1)  ─┐
  │    ├─ Agent spawn: Etask-executor(UUID2)  ─┼─ parallel
  │    └─ Agent spawn: Etask-executor(UUID3)  ─┘
  │         Each runs Steps 2-5 independently
  │
  └─ Dependencies found (fallback):
       └─ Sequential: UUID1 → UUID2 → UUID3
          (only when task B's input is task A's output)
```

### Parallel Execution Rules
1. **Spawn all agents in a single tool-call block** — do not await one before spawning the next
2. **File ownership**: no two agents may write the same file. If overlap detected, serialize those tasks
3. **Shared files** (i18n, config, barrel exports, package manifests): Qrun-task edits these after all agents complete, merging their requirements
4. **Independent state**: each agent moves its own TASK_REQUEST/VERIFY_CHECKLIST through `pending → in-progress → completed`
5. **On failure**: skip failed task, continue others, report all results at end

### Dependency Detection
Before spawning, scan each TASK_REQUEST for:
- Explicit `depends: {UUID}` in notes
- Output path of task A appearing as input reference in task B's checklist

If dependencies exist, topologically sort and execute in waves (parallel within each wave, sequential across waves).

## Autonomous Mode (Ultra)

When `.qe/state/ultra{work,qa}-state.json` is active:
- Skip Step 2 approval
- Auto-proceed on judgments
- `--ultraqa`: auto-run code quality loop
- Multiple UUIDs: parallel Etask-executor agents

## Role Constraints
- Only executes existing spec documents
- Use `{adapter.commandPrefix}Qgenerate-spec` or `{adapter.commandPrefix}Qgs` to create specs
- Do not modify spec content (except checking off items)
- In role-separated or tiered orchestration, do not allow implementer-stage execution to mutate planner-owned artifacts except for explicitly approved planner revisions
