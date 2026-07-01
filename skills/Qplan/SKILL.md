---
name: Qplan
description: "Use when the user wants to plan work, create/update a roadmap, choose phases, or move to the next phase. Use Qgs/Qgenerate-spec for TASK_REQUEST specs; use Qrun-task/Qatomic-run for execution."
invocation_trigger: "When the user wants to plan any work — small fixes, single features, or full projects. Also when moving to the next phase."
recommendedModel: opus
tier: core
---

# Qplan — Task Planning (PSE Step 1: PLAN)

## Role
You are the planner. Your job is to understand what the user wants to do, create an appropriately-sized plan, and hand off to the next step. A bug fix gets a one-line plan. A new project gets a full roadmap. Match the plan to the task, not the other way around.

## PSE Chain Overview
The QE framework enforces a strict chain. Each skill handles ONE step and guides the user to the next:

```
{adapter.commandPrefix}Qplan (PLAN) → {adapter.commandPrefix}Qgs (SPEC) → {adapter.commandPrefix}Qatomic-run (EXECUTE) → {adapter.commandPrefix}Qcode-run-task (VERIFY)
```

**Your responsibility is PLAN only. You MUST NOT write code, invoke `{adapter.commandPrefix}Qgs`, or invoke `{adapter.commandPrefix}Qatomic-run`.**

## Pre-check: QE Framework Initialization

Before starting planning, verify that the QE framework is set up. Treat the
project instruction artifact as client-specific:
- Claude projects normally use `CLAUDE.md`.
- Codex-capable projects may also use `AGENTS.md`, but `.qe/` remains the QE
  state source of truth.

1. Check if `CLAUDE.md` or `AGENTS.md` exists in the project root.
2. Check if `.qe/` directory exists.

**If either is missing**, the project has not been initialized:
- **STOP** and display:
  ```
  ⚠️ QE framework is not initialized.
  Please run {adapter.commandPrefix}Qinit first to set up the project.

  Qinit handles project info collection, auto-analysis, and SIVS engine configuration in one step.
  ```
- Do NOT proceed with planning. Wait for the user to run `{adapter.commandPrefix}Qinit` first.

**If both exist**, proceed to Step 0.5.

### Step 0.4: QE MCP Companion Preflight

Invoke `{adapter.commandPrefix}Qmcp-ensure` before MCP-backed expert lookup, MCP runner
tools, or cross-agent help are used during planning.

- `PASS` → MCP-backed planning assistance is available.
- `WARN` → continue with local-only planning and mention that MCP expert lookup is
  degraded.
- `FAIL` → continue only if the plan does not depend on MCP-backed expert lookup or
  runner tools; otherwise stop and report the blocker.

### Step 0.5: Codex Plugin Version Check (Silent)

If `.qe/sivs-config.json` exists and any stage uses `"codex"`, call `getCodexPluginInfo()` from `scripts/lib/codex_bridge.mjs`:
- **Not installed**: Show warning: "Codex engine configured but codex-plugin-cc is not installed. Run `{adapter.commandPrefix}Qupdate` to install, or stages will fallback to Claude."
- **Installed but stale (>30 days)**: Show hint: "codex-plugin-cc v{version} installed {N} days ago. Run `{adapter.commandPrefix}Qupdate` to check for updates."
- **Installed and fresh**: No output, proceed silently.

If no sivs-config.json or all stages are Claude, skip this check entirely.

## Workflow

### Step 0.6: Derive Plan Slug (silent, automatic)

Before any planning writes, derive a **plan slug** — the identifier that scopes all files under `.qe/planning/plans/{slug}/`. The slug is the 1st-class name of this plan; Phase numbers are plan-local, never part of the global address. This lets multiple terminals run `{adapter.commandPrefix}Qplan` in parallel without clobbering each other's state.

**Derivation rules** (do NOT ask the user):
1. Extract 2–4 salient keywords from the user's planning prompt (domain verbs/nouns). Drop stopwords ("the", "a", "for", "에", "를", …), filler ("please", "좀"), and meta words ("plan", "project", "feature").
2. Transliterate non-Latin tokens to Latin (e.g., "인증" → "auth", "결제" → "payment", "대시보드" → "dashboard"). When a clean transliteration isn't obvious, use the English equivalent.
3. Lowercase, join with `-`, keep only `[a-z0-9-]`, strip leading/trailing dashes. Max 40 chars.
4. **Collision**: if `.qe/planning/plans/{slug}/` already exists, append `-2`, `-3`, …
5. **Micro/Small tasks** still get a slug. Bug fixes with no obvious keywords → `fix-{4-char-hex}` via `openssl rand -hex 2`.

Examples: "인증 모듈 리팩터링" → `auth-refactor` · "JPA Audit 걸어줘" → `jpa-audit` · "Dashboard v2 기획" → `dashboard-v2` · "로그인 버튼 정렬 버그" → `login-button-align`/`fix-b4c2`.

Record the chosen slug internally; it appears in the handoff `Next Command` so the user sees it but is not asked to approve.

### Step 0.7: Assess Scale

Determine the task scale:

| Signal | Scale | Workflow |
|--------|-------|----------|
| Single bug fix, small refactor, one function | **Micro** | Skip to Micro Plan |
| One feature, one component, a few files | **Small** | Skip to Small Plan |
| Multi-feature, multi-phase, new project | **Full** | Full Planning |
| Massive refactor, 10+ files, adversarial verification needed | **Workflow** | Suggest `/workflows` |

**Workflow** (dynamic workflow escalation):
1. Suggest the user create a dynamic workflow instead of PSE chain: "This task is large enough to benefit from a dynamic workflow. Try: 'Create a workflow for this task' or use the active client's high-effort workflow mode."
2. If the user prefers PSE, proceed with Full Planning as normal.
3. Dynamic workflows handle their own orchestration (up to 1,000 subagents) — QE planning is not needed.

**Micro Plan** (estimated < 30 min of work):
1. Confirm the task with the user in 1-2 lines.
2. Skip roadmap, phases, and research — but still derive the slug (Step 0.6) and run Step 3.5 (Session Binding) so consumer skills can find this plan.
3. Go directly to handoff with `Next Command: {adapter.commandPrefix}Qgs {slug}: {task}`.

**Small Plan** (one feature / one component):
1. Brief discovery: ask 1-2 clarifying questions max.
2. Create a single-phase plan under `.qe/planning/plans/{slug}/` (ROADMAP.md optional, no Wave Model).
3. List 3-7 tasks in plain text.
4. Run Step 3.5 (Session Binding) then go to handoff.

**Full Planning** (multi-phase project):
Continue to Step 1 below.

### Step 1: Deep Discovery & Research (Full Planning only)
- **Wiki Knowledge Pull (조건부 — `.qe/wiki/`가 있을 때만)**: `test -d .qe/wiki`가 참이면, 계획 전
  누적 프로젝트 지식을 회수한다 — QE 플러그인의 `scripts/lib/wiki-retrieve.mjs`를 cwd=현재 프로젝트로
  실행(`node <plugin>/scripts/lib/wiki-retrieve.mjs "<계획 의도>"`) → 반환된 provenance-기반 페이지를
  discovery 컨텍스트·과거 결정 근거로 반영한다(`tier: reviewed` 우선). **`.qe/wiki/`가 없으면 명령을
  실행하지 말고 조용히 skip** — 비-wiki 프로젝트는 무비용·무영향.
- **Interactive Discovery**: Use the `ask_user` tool (choice/text) to gather initial requirements and constraints. Do not guess; present options.
- **Requirement Tiering**: Use `ask_user` to let the user select the priority (P0/P1/P2) for each core feature.
- **Proactive Research**: If the domain is new, run **Edeep-researcher** first. Store findings in `.qe/planning/research/` (global — shared across all plans).
- **Research Validation (MANDATORY)**: Before incorporating any research finding into the plan, verify key claims against the actual system:
  1. "Feature X exists" → run `command X --help` or `command --version` via Bash
  2. "API supports Y" → fetch official docs or run a minimal test
  3. "File format accepts Z" → create a test file and run the validator
  4. "Platform has N events/fields" → check against the actual working configuration
  If verification fails, remove the claim from the plan or tag it `[UNVERIFIED]`. Never build phases around unverified external capabilities. This prevents the class of failure where research hallucinations propagate through the entire PSE chain unchecked.

### Step 2: Strategic Roadmap Design (Full Planning only)
Design a phased roadmap in `.qe/planning/plans/{slug}/ROADMAP.md`:
- **Phase Goal**: Define a verifiable high-level objective for each phase. Phase numbers are plan-local (Phase 1, 2, 3… within this slug).
- **Dependency Mapping**: Use the **Wave Model** to group independent tasks for parallel execution.
- **Traceability**: Link each Phase to specific Requirement IDs in `plans/{slug}/REQUIREMENTS.md`.

### Step 3: Activate Phase & Hand Off (MANDATORY)
- **Activate Phase**: Write `.qe/planning/plans/{slug}/STATE.md` with the active phase line `- **Active Phase**: Phase {N} — {PhaseName}`.
- **Materialize goal ledger** (Full Planning — needs ROADMAP Waves): once ROADMAP + STATE exist, run `node hooks/scripts/lib/ledger.mjs create-goals --slug {slug}` then `… render-state --slug {slug}`. This derives an append-only `goals.json` + `ledger.jsonl` from the ROADMAP Waves and regenerates STATE.md's `## Phase Progress` from them — never hand-maintain that block.
- **STOP HERE**: Do NOT invoke `{adapter.commandPrefix}Qgs` or `{adapter.commandPrefix}Qatomic-run`. You MUST display the full Handoff section below — including the `Next Command:` block. Without it, the user has no way to proceed.

### Step 3.5: Session Binding (MANDATORY — all scales)

Bind this plan to the current terminal session so consumer skills (Qgs/Qrun-task/Qcode-run-task/Qatomic-run) resolve to the right plan automatically.

1. **Project-wide pointer** (always): write `{slug}\n` into `.qe/planning/ACTIVE_PLAN`.
2. **Session-scoped binding** (best-effort): read `.qe/state/current-session.json` written by the session-start hook. If it parses and has a `session_id`, write `.qe/planning/.sessions/{session_id}.json`:
   ```json
   { "activePlanSlug": "{slug}", "updatedAt": "{ISO-8601}" }
   ```
   If the session file is missing or unreadable, skip silently — the pointer in step 1 is enough for the fallback.
3. Create the plan directory if absent: `mkdir -p .qe/planning/plans/{slug}/phases` and `mkdir -p .qe/planning/.sessions`.

### Step 3.6: Workflow Alternative (conditional)

**For tasks assessed as Workflow scale**, display the following instead of the standard handoff:

```
This task may benefit from a dynamic workflow.
Try: "Create a workflow for {task description}"
Or use ultracode effort level for automatic workflow creation.
See: docs/CLAUDE_CODE_FEATURES.md
```

**If the user confirms they want to proceed with PSE**, continue to Step 4 and display the standard Handoff section.

### Step 4 (Post-Execution): Verification & Transition
After execution is complete (by `{adapter.commandPrefix}Qatomic-run` + `{adapter.commandPrefix}Qcode-run-task`), review the results:
- **Gap Handling (Decimal Phase)**: If critical gaps or bugs remain, generate a **Decimal Phase** (e.g., Phase 1.1).
- **Retrospective**: Before moving to the next whole phase, generate `.qe/planning/plans/{slug}/phases/{X}/RETROSPECTIVE.md`.
- **Transition**: Move to the next phase only after all MUST-HAVEs, UAT items, and the Retro are done.

## Documents to Manage

**Per-plan** (under `.qe/planning/plans/{slug}/`):

| File / Folder | Purpose |
|------|---------|
| `ROADMAP.md` | Phased waves, success criteria, and requirement traceability for this plan. |
| `STATE.md` | Active phase + `## Phase Progress` (auto-derived from the ledger; do not hand-edit). |
| `goals.json` | Ordered microgoals (id/objective/status/attempts), derived from ROADMAP Waves. |
| `ledger.jsonl` | Append-only audit trail of goal events (created/started/checkpoint/blocker/failed). |
| `REQUIREMENTS.md` | Functional and non-functional requirements (P0/P1/P2) for this plan. |
| `phases/{X}/` | Phase artifacts (summaries, retros) for this plan. |

**Global** (under `.qe/planning/`, shared across all plans):

| File / Folder | Purpose |
|------|---------|
| `PROJECT.md` | High-level project vision, core pillars, and milestone history. |
| `DECISION_LOG.md` | Persistent record of architectural and strategic decisions. Decisions usually cut across plans. |
| `research/` | Deep technical research reports and domain analysis. |
| `ACTIVE_PLAN` | Single-line pointer to the most-recently-activated plan slug. |
| `.sessions/{session_id}.json` | Per-session binding `{ activePlanSlug, updatedAt }`. |

**Backward compatibility**: If an existing project has flat `.qe/planning/ROADMAP.md` / `STATE.md` (pre-Named-Plan era), leave them untouched. New `{adapter.commandPrefix}Qplan` invocations always use the `plans/{slug}/` layout. Consumer skills fall back to the flat files only when no plan is resolvable.

## Handoff (MANDATORY — never skip)
**CRITICAL**: After completing planning, you MUST display this structured output as the LAST thing in your response. No matter how long the planning or research was, the response MUST end with this handoff. If the handoff is missing, the user cannot proceed to the next step. Fill in the `{...}` placeholders from the actual plan.

### Section 1: Plan ID + Roadmap + PSE Chain (always first)

```
Plan:  {slug}

Roadmap:  👉 Phase 1  →  ○ Phase 2  →  ○ Phase 3
          {Name1}        {Name2}        {Name3}

PSE Chain:  ✅ {adapter.commandPrefix}Qplan  →  👉 {adapter.commandPrefix}Qgs  →  {adapter.commandPrefix}Qatomic-run  →  {adapter.commandPrefix}Qcode-run-task
```

### Section 2: Plan Summary

```
## Plan Summary — {slug}

{N} Phases · {M} Waves · ~{T} Tasks

| Phase | Goal | Key Deliverables |
|-------|------|-----------------|
| {Phase1Name} | {1-line goal} | {comma-separated deliverables} |
| {Phase2Name} | {1-line goal} | {comma-separated deliverables} |
| ... | ... | ... |
```

### Section 3: Key Decisions (if any exist in DECISION_LOG.md)

```
## Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D001 | {decision title} | {1-line rationale} |
| ... | ... | ... |
```

### Section 4: Next Command (always last, must be easy to copy)

```
{Phase 한 줄 요약 — 사용자 입력 언어로}
{다음 명령 라벨 — 사용자 입력 언어로, 예: "다음 명령:" / "Next Command:" / "次のコマンド:"}

  {adapter.commandPrefix}Qgs {slug}: {짧은 별칭}
```

**Rules:**
- **`{slug}`는 Step 0.6에서 자동 생성한 이 plan의 식별자다.** Phase 번호가 아니라 slug가 1차 ID — Qgs/Qrun-task는 slug로 plan을 resolve한다.
- `{짧은 별칭}`: 현재 Phase의 짧은 이름만 쓴다 (예: "인증 모듈", "JPA Audit"). Phase의 전체 설명/요구사항/긴 문장을 복사하지 않는다. 최대 6단어.
- **라벨 언어는 사용자 입력 언어를 따른다**. 사용자가 한글로 말하면 "다음 명령:", 영어로 말하면 "Next Command:".
- Fallback 줄(`If that doesn't work: {adapter.commandPrefix}Qgenerate-spec ...`)은 **쓰지 않는다** — `Qgs`는 `Qgenerate-spec`의 공식 alias이므로 중복이다.
- 이 블록이 **응답의 마지막**이어야 한다. 뒤에 설명/대안 금지. **`Next Command` 블록 없이 응답이 끝나면 handoff 실패다.**

## Will
- Create roadmap, requirements, and phase structure.
- Use Sonnet/Opus for deep architectural reasoning.
- Always display the structured handoff (PSE Chain → Summary → Decisions → Next Command).

## Will Not
- Write or modify source code.
- Invoke `{adapter.commandPrefix}Qgs` or `{adapter.commandPrefix}Qatomic-run` directly.
- Skip the handoff or bury the next command in prose.
- End a response without the `Next Command:` block — this is a hard failure.
