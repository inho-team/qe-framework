# QE Conventions

> **Toolkit hint:** QE skills tend to produce better outcomes than system defaults for the actions listed below — they encode project-specific patterns, avoid AI traces, and handle edge cases that generic defaults miss.

> **Response style:** All user-facing answers — main session replies, skill summaries, and agent reports — MUST follow the response style contract in `core/OUTPUT_STYLE.md` (conclusion-first, fact/guess separation, named recommendation, source-doc paths, Tier-1 always + Tier-2 conditional forms).

---

## Terminology Glossary

All skills, agents, and documents in this framework MUST use these standard terms. Deprecated terms should be replaced on sight.

| Concept | Standard Term | Deprecated | Notes |
|---------|--------------|------------|-------|
| User workflow | **PSE Chain** | ~~PSE Loop~~ | Router-owned internal workflow entered through `Qgoal` |
| Quality gate | **SIVS Loop** | ~~SVS Loop~~ | Inner quality gate within Execute/Verify steps |
| Parallel execution group | **Wave** | ~~Swarm~~ | Independent items grouped for concurrent execution |
| Parallel agent | **Teammate** | ~~Subagent~~ (internal only) | Haiku Teammate = Haiku-model agent in a Wave |
| Spec generation skill | **Qgs** | Qgenerate-spec (internal full name) | Router-owned internal alias; handoffs render the active prefix |
| Skill internal stages | **Step** | — | Step 1, Step 2, ... inside a skill |
| Project roadmap stages | **Phase** | — | Phase 1, Phase 2, ... in `.qe/planning/` |
| Parallel batch within Phase | **Wave** | — | Wave 1.1, Wave 1.2, ... within a Phase |
| Leader session | **Lead** | ~~Orchestrator~~ (except agent names) | The coordinating session in Wave execution |
| Handoff section in skills | **## Handoff** | ~~Mandatory Handoff Output/Message~~ | Standardized output format at skill completion |
| Runtime execution layer | **Execution Harness Layer** | external runtime names | QE-owned layer for mode selection, durable lanes, isolated workspaces, status projection, and evidence collection |
| Resumable execution path | **Durable Lane** | ad hoc worker/session | Resumable harness lane with owner, status, artifacts, and evidence |
| Runtime status display | **Status Projection** | completion proof | Read-only display of PSE/SIVS/harness state; never a substitute for VERIFY_CHECKLIST or Supervise |

### PSE Chain (outer workflow)

```
User: $Qgoal {목표} / /Qgoal {목표} → router
Internal: Qplan → Qgs (Qgenerate-spec) → Qexecute → Qexecute -verify / Qrt
```

- **Plan**: Define roadmap, phases, requirements (`Qplan`)
- **Spec**: Generate TASK_REQUEST + VERIFY_CHECKLIST (`Qgs`)
- **Execute**: Implement checklist items via Wave execution (`Qexecute`)
- **Verify**: Test → review → fix quality loop (`Qexecute -verify`)

### SIVS Loop (inner quality gate)

```
Spec → Implement → Verify → Supervise → (FAIL) Remediate → Spec → ...
```

The SIVS Loop runs **inside** the Execute and Verify steps of the PSE Chain. It is the quality gate that ensures each task meets its spec before completion. See `core/PHILOSOPHY.md` for full specification.

### Relationship

```
PSE Chain (router-owned internal workflow)
├── Entry ────────── $Qgoal {목표} / /Qgoal {목표}
├── Plan ─────────── Qplan
├── Spec ─────────── Qgs (Qgenerate-spec)
├── Execute ──────── Qexecute / Qrt
│     └── SIVS Loop (quality gate)
│           ├── Spec: TASK_REQUEST defines the contract
│           ├── Implement: Actual coding and file changes
│           ├── Verify: VERIFY_CHECKLIST confirms completion
│           └── Supervise: Supervision agents confirm quality
└── Verify ───────── Qexecute -verify
      └── SIVS Loop (quality gate, final pass)
```

---

## PSE Chain: Skill Roles

| PSE Step | Skill | Role |
|----------|-------|------|
| Plan | `Qplan` | Roadmap, phases, requirements |
| Spec | `Qgs` | TASK_REQUEST + VERIFY_CHECKLIST generation |
| Execute | `Qexecute` | Wave execution with Haiku Teammates (default) |
| Execute | `Qexecute` | Sequential execution (fallback for non-atomic tasks) |
| Verify | `Qexecute -verify` | Test → review → fix quality loop |

PSE units (`Qplan`, `Qgs`, `Qgenerate-spec`, `Qexecute`, `Qrt`) are router-owned internal units, not normal user entry points. Start new work with `$Qgoal {목표}` in Codex or `/Qgoal {목표}` in Claude. In-chain calls carrying an existing task UUID remain valid through task-artifact continuity.

---

## Client Command Prefixes

QE skills are shared across Claude and Codex, but the user-visible command
prefix is client-specific.

| Active client | Skill command prefix | Example |
|---------------|----------------------|---------|
| Claude | `/` | `/Qgoal {목표}` |
| Codex | `$` | `$Qgoal {목표}` |

All handoffs must render through the active-client prefix. Do not show a
slash-only handoff in Codex-facing text, and do not rewrite Claude examples to
`$Q...`.

Skill templates should use `{adapter.commandPrefix}Qskill` for user-visible
handoffs. In a Codex session this means the final copyable command MUST start
with `$`, not `/`.

Codex compatibility is handled through the QE client adapter: Claude uses Agent
tool delegation, while Codex uses native subagents when available and preserves
the same role contract with role-separated inline execution only when the active
Codex runtime lacks the required subagent primitive.

---

## Handoff Format Rules

Every PSE Chain skill MUST end with a `## Handoff` section. The handoff follows these rules:

1. **Phase context + Roadmap progress** — Display current Phase and overall progress at a glance
2. **PSE Chain status, one line** — Show current completion/progress status
3. **Task description line** — One-line natural language summary of what the next command does, placed directly above the `Next:` line
4. **`Next command:` block** — For a new user entry, render active-prefix `Qgoal {목표}` alone in a code block. Router-owned in-chain handoffs may render their explicit UUID/phase command.
5. **No explanations** — Do not add alternatives, elaborations, or choices after the command. Do not present a direct PSE command as a new-work fallback.
6. **Task type branching** — In an active UUID chain, `type: code` may hand off to `Qexecute -verify`; otherwise guide to active-prefix `Qgoal {목표}`.
7. **Short alias only** — Use the short phase label (e.g., `Phase 2: Codex Bridge`), not a copy of the full phase description. Max ~6 words.
8. **Harness status is not completion** — If a handoff includes Execution Harness status, lane status, or status projection, it must still render the SIVS/PSE state separately. A finished lane does not replace VERIFY_CHECKLIST completion or Supervise.

### Phase Progress Display

When handing off, resolve the active plan's ROADMAP via the Named Plan resolution order (session binding → `ACTIVE_PLAN` → flat fallback) and read `.qe/planning/plans/{slug}/ROADMAP.md` (or flat `.qe/planning/ROADMAP.md` for legacy projects) to display the full Phase list and completion status.

**Format rules for terminal compatibility:**
- Use a **vertical table** for Roadmap — never rely on horizontal emoji alignment
- Status markers: `[x]` = complete, `[>]` = current/next, `[ ]` = not started
- Keep each line under 60 characters to prevent wrapping
- PSE Chain uses the same `[x]`/`[>]`/`[ ]` markers instead of emoji
- All output inside a **single code block** (no split blocks)

### Code Task Example
```
sivs-migration · Phase 2: Codex Bridge — Implementation complete

Roadmap
  [x] Phase 1: Strip & Purify
  [>] Phase 2: Codex Bridge
  [ ] Phase 3: Polish & Release

PSE: [x] Plan [x] Spec [x] Execute [>] Verify

구현 코드의 테스트 및 품질 검증
Next: {adapter.commandPrefix}Qexecute -verify a1b2c3d4
```

### Non-code Task Complete Example
```
sivs-migration · Phase 1: Strip & Purify — Complete

Roadmap
  [x] Phase 1: Strip & Purify
  [>] Phase 2: Codex Bridge
  [ ] Phase 3: Polish & Release

PSE: [x] Plan [x] Spec [x] Execute [x] Complete

Codex CLI 브릿지 연동 및 fallback 로직 구현
다음: {adapter.commandPrefix}Qgs sivs-migration: Codex Bridge
```
(Note 1: the `{slug} · ` prefix identifies which plan this belongs to, enabling multi-terminal parallelism. Legacy flat-file projects omit the prefix and use `Phase N: …` as the address.)
(Note 2: `Next:` label above is shown in Korean as `다음:` because the task description is in Korean. Always localize the label to match user input language.)

### When entire Roadmap is complete
```
sivs-migration · Phase 3: Polish & Release — Complete

Roadmap
  [x] Phase 1: Strip & Purify
  [x] Phase 2: Codex Bridge
  [x] Phase 3: Polish & Release

PSE: [x] Plan [x] Spec [x] Execute [x] Complete

All phases done. Finalize with {adapter.commandPrefix}Qcommit
```

Codex finalization example:

```
codex-native-parity · Phase 5: Verification Docs — Complete

Roadmap
  [x] Phase 1: Runtime Contract
  [x] Phase 2: Skill Compatibility
  [x] Phase 3: Native Agents
  [x] Phase 4: Hook Parity
  [x] Phase 5: Verification Docs

PSE: [x] Plan [x] Spec [x] Execute [x] Complete

All phases done. Finalize with $Qcommit
```

---

## Named Plan Layout

Planning state is scoped per plan under `.qe/planning/plans/{slug}/` so multiple routed pipelines can coexist without clobbering each other's STATE/ROADMAP.

**Per-plan files** (under `.qe/planning/plans/{slug}/`):
- `ROADMAP.md`, `STATE.md`, `REQUIREMENTS.md`, `phases/{X}/SUMMARY_*.md`, `phases/{X}/RETROSPECTIVE.md`.

**Global files** (under `.qe/planning/`, shared across all plans):
- `PROJECT.md` — project-wide vision and pillars.
- `DECISION_LOG.md` — architectural decisions that cut across plans.
- `research/` — reusable research reports.
- `ACTIVE_PLAN` — single-line pointer to the most-recently-activated slug.
- `.sessions/{session_id}.json` — per-session `{ activePlanSlug, updatedAt }` binding.

**Plan resolution order** (used by consumer skills):
1. Router-owned explicit slug handoff (e.g., `/Qgs auth-refactor: 인증 모듈`).
2. `.qe/state/current-session.json` → `session_id` → `.qe/planning/.sessions/{session_id}.json` → `activePlanSlug`.
3. `.qe/planning/ACTIVE_PLAN`.
4. Legacy flat `.qe/planning/ROADMAP.md` / `STATE.md` (pre-Named-Plan projects).

**Slug shape**: `[a-z0-9][a-z0-9-]{0,63}`. Qplan derives slugs automatically from the task prompt (no user prompt). See `skills/Qplan/SKILL.md` Step 0.6.

**Session bridge**: `hooks/scripts/session-start.mjs` writes `.qe/state/current-session.json` with the current session_id on every session start. Skills read this file to discover their own session_id (which Claude Code does not otherwise expose to the model).

## Global Output Rules

### Response Language
All skills MUST respond in the same language the user used in their most recent message. If the user writes in Korean, all output — section titles, descriptions, summaries, handoff messages, **and handoff labels (e.g., `Next:` → `다음:`)** — must be in Korean. Only the following are exempt and stay in English:
- File names and paths (e.g., `TASK_REQUEST_abc123.md`)
- Code and code blocks
- Skill/command names (e.g., `/Qgs`, `/Qexecute`)
- Status markers (`[x]`, `[>]`, `PSE:`)

---

## QE Rules

### File Naming
- Task request: `TASK_REQUEST_{UUID}.md`
- Verification checklist: `VERIFY_CHECKLIST_{UUID}.md`
- One task shares the same UUID across both documents.
- UUID: 8-character random hex (`openssl rand -hex 4`). Must check for collision before use.

### Document Convention
Newly generated execution documents (spec/verify/audit/execution/handoff/report) carry a
title-following `<!-- qe-doc-frontmatter ... -->` block and are indexed in the derived
`.qe/index.md` MOC. The full contract — frontmatter fields, `[[link]]` rules, the derived
index, and the grandfather boundary — lives in `core/DOC_CONVENTIONS.md`. The `check-doc-conventions`
guard enforces it; `scripts/lib/doc-index.mjs` rebuilds the index after any doc create/move.

### Task Status
| Status | Meaning |
|--------|---------|
| 🔲 Pending | Not yet started |
| 🔶 In progress | Currently being worked on |
| ✅ Complete | All VERIFY_CHECKLIST items checked. **No further reference needed.** |

### Completion Criteria
- All VERIFY_CHECKLIST checkboxes checked → ✅ Complete
- Completed task files do not need to be referenced.

### Memory Boundaries
- **auto-memory** (`~/.claude/.../memory/`): AI 행동 교정, 사용자 선호, cross-project reference를 저장한다.
- **Qlearn** (`.qe/learnings.md`): 프로젝트 특정 기술 교훈(mistake/gotcha/decision/convention)을 우선 기록한다. 같은 교훈을 auto-memory와 이중 저장하지 않는다.

### Codex Runtime Policy
When invoking Codex (`codex:codex-rescue`, SIVS codex routing):
- **Stage defaults** — without Codex, all SIVS stages use Claude. When Codex is available, Spec and Supervise stay Claude-led while Implement and Verify prefer Codex; explicit `.qe/sivs-config.json` entries can override this.
- **Role profiles** — the Head/Body split is a named preset over the four stages: **Head = Spec + Supervise**, **Body = Implement + Verify**. `/Qsivs-config profile <name>` sets all four at once — `claude-head` (default: Claude Head / Codex Body), `codex-head` (Codex Head / Claude Body), `all-claude`, `all-codex`. The stored `profile` field is metadata; the per-stage engine entries remain the routing source of truth.
- **Fallback is bidirectional** — engine assignment is a preference. A `codex` stage degrades to Claude when codex-plugin-cc is absent; a `claude` stage degrades to Codex in a Codex-native session where Claude is unreachable. See `resolveEngine()` in `scripts/lib/codex_bridge.mjs`.
- **Cross-engine execution is bridge-owned** — when Claude must hand a stage to Codex, route through `scripts/lib/codex_bridge.mjs` and the `codex-plugin-cc` bridge. When Codex must hand a stage to Claude, route through `scripts/lib/claude_bridge.mjs` and `Qclaude-rescue`. MCP server tools are not the canonical PSE/SIVS execution path.
- **Spec/Supervise assistance** — Claude owns requirements and final judgment, but should actively use Codex for bounded repo search, context gathering, test diagnosis, and second-opinion review when that reduces Claude token load.
- **Runtime mode is selectable** — foreground is preferred for short Codex tasks so stdout lands in the conversation. Background is allowed for long Implement/Verify jobs only when the session retrieves results with `/codex:status` and `/codex:result <job-id>` before final reporting.
- **Session result hint** — SessionStart may emit `[Session State] ... codex:<status>...:retrieve /codex:result` when a background Codex job is still relevant. Treat it as a retrieval reminder, not as completion evidence.
- **Concise Codex output** — ask Codex for relevant files, line numbers, summaries, and next actions; do not paste raw bulk search output back into Claude unless necessary.
- **Per-scope config design** — `loadSivsConfig(cwd)` uses exact-path loading (no walk-up); hook cwd = session cwd. Each repo (e.g. `qe-framework/`) has its own `.qe/sivs-config.json` scope independent from a wrapper workspace's config. The two configs do not conflict in a single session — they apply to different session cwds by design. See the config-scope authority section of `D-f876457e-1` in the plan `DECISION_LOG.md` for the authority rule.
- **Gate subagent engine ownership** — SIVS `enforceRouting` hard-blocks direct Agent spawns (`Etask-executor` → implement, `Esupervision-orchestrator` → supervise, `Ecode-reviewer` → verify) that violate the configured engine. However, **gate subagents inside `Qcritical-review`** (Devil's Advocate, Security Auditor, Merge Blocker, etc.) are **protocol-owned**: the gate protocol itself controls their engine assignment (including the automatic Codex cross-model upgrade for DA/Merge Blocker). SIVS enforcer does not reach inside protocol-owned spawns. This means gate execution is **mixed** under `codex-head`: DA/Merge Blocker → Codex (protocol auto-upgrade), other agents → Claude (protocol-owned). G4 Risk Proof (`Erisk-proof-auditor`) is Claude-only (not in SIVS STAGE_MAP). See DECISION_LOG `D-f876457e-1`.

---

## Performance & Optimization Standard

To maintain high reasoning quality and low latency, all agents and skills must adhere to these standards:

### 1. Minimal I/O Rule (Enforced)
- **Never read or write the same file twice** in a single execution turn.
- **ContextMemo (enforced)**: The `pre-tool-use` hook **hard-blocks** redundant `Read` calls for files already cached in the session. If a file was read before and not modified since, the Read is rejected with `exit(2)` and a `MEMO HIT` message. After a `Write`/`Edit` to that file, the next Read is allowed.
- **Query, do not read whole files**: `.qe/TASK_LOG.md` alone is ~20k tokens. Use `npm run qe:query` for task status, specs, checklists, contracts, analysis docs, and verification failure history — a 20-row answer costs ~2k tokens and a `GROUP BY` aggregate ~30. Read the file only when you need one specific record in full.
  ```bash
  npm run qe:query -- --list                     # catalog of named queries
  npm run qe:query -- tasks --status pending     # what is still open
  npm run qe:query -- specs --status pending     # TASK_REQUEST files awaiting work
  npm run qe:query -- verification --status in-progress
  npm run qe:query -- failures --uuid <task>     # why verification failed before
  npm run qe:query -- wiki --type concept        # LLM wiki pages by frontmatter
  npm run qe:query -- wiki --tier draft          # what still needs review
  npm run qe:query -- wiki-links --broken        # dangling [[links]]
  npm run qe:query -- --sql "SELECT status, COUNT(*) c FROM task_log GROUP BY status"
  ```
  Read-only by construction: `--sql` accepts a single `SELECT` on a read-only connection. Markdown stays the source of truth; the index is derived and refreshes itself at read time, so writing a spec, a task-log row or a wiki page is all it takes to make it queryable — no manual reindex.
- **Unified State**: Use `unified-state.json` via `hooks/scripts/lib/state.mjs` for all persistent session data. High-frequency and contended state (ContextMemo, session registry, SIVS loop counters) lives in `.qe/qe.db` behind `hooks/scripts/lib/store.mjs` — see `.qe/planning/ADR-027-local-store-and-query-layer.md`.

### 2. Token-Aware Context Management
- **Thresholds**: Monitor context pressure at **140k tokens** (Warning/Snapshot) and **170k tokens** (Critical/Hard Stop).
- **Semantic Compression**: When context is high, prioritize `SNAPSHOT_SUMMARY.md` over raw history preservation.
- **Strategic Planning**: Start with active-prefix `Qgoal {목표}`; the router owns PSE planning and `.qe/planning/` state.
- **Token Fallback**: If real-time metrics are missing, use `Characters / 4` for estimation.

### 3. Persistent Mode Protection
- **Active pipelines are shielded from premature stopping.** When a multi-step pipeline (SIVS loop, Wave execution, Qexecute) is running, persistent mode blocks the Stop hook and injects reinforcement via the Notification hook. Skills enter persistent mode at execution start and exit at their Handoff step. See `hooks/scripts/lib/persistent-mode.mjs` and `core/CONTEXT_BUDGET.md` for details.

### 4. Optimized Model Tiering
- **Haiku (LOW)**: Default for pattern matching, structural verification (S1-S5), file I/O, and simple text transforms.
- **Sonnet (MEDIUM)**: Default for code implementation, test writing, and complex reasoning.
- **Opus (HIGH)**: Default for high-risk architecture, deep research, security, and adversarial review.
- **Codex mapping**: Codex-installed agents convert QE tiers to native model routing: `haiku -> gpt-5.3-codex-spark` with `low`, `sonnet -> gpt-5.4-mini` with `medium`, `opus -> gpt-5.4` with `high`.
- **Skill-First**: Always check `skills/CATALOG.md` before manual labor. Skills are pre-optimized workflows.

### 5. Delegation Enforcer (Enforced)
- The `pre-tool-use` hook intercepts all Agent tool calls and checks the target agent's `recommendedModel` frontmatter field.
- **No model specified**: The recommended model is auto-injected into the hook output hint.
- **Lower model specified** (e.g., haiku for a sonnet task): Allowed silently -- cost saving is intentional.
- **Higher model specified** (e.g., opus for a haiku task): Allowed with a cost-awareness warning.
- **Codex native agents**: QE installer writes `model` and `model_reasoning_effort` into `~/.codex/agents/*.toml` for known QE tiers. Shared skills should prefer explicit native Codex subagents for delegated work; use role-separated inline execution only when the active Codex runtime lacks the needed subagent primitive, and report that fallback.
- Delegation stats (`autoInjections`, `warnings`, `overrides`) are tracked in `unified-state.json` under `delegationStats`.

---

## Preferred Skill Map

These skills are optimized for common workflows and consistently outperform generic approaches.

| Action | Preferred Skill | Why it's better |
|--------|----------------|-----------------|
| git commit | `Qcommit` | Human-style messages, no Co-Authored-By traces, reads staged diff intelligently |
| version/release mutation | `Qrelease` | Bumps versions, rewrites changelog, commits, tags, and optionally publishes the push and GitHub Release |
| read-only version lookup | `Qversion` | Reports the single source of truth across plugin.json / package.json without mutation |
| health check / repair | `Qdoctor` | Verifies framework, MCP companion, and `.qe/` consistency before repair |
| context save / handoff | `Qcompact` | Structured snapshot, recoverable in future sessions |
| context restore | `Qresume` | Reconstructs working state from snapshot |
| archive tasks | `Qgc archive` | Moves files into versioned archive with index |
| project refresh | `Qrefresh` | Re-analyzes all four analysis files in one pass |
| "what is still open / what failed before" | `npm run qe:query` | Answers from a derived index instead of pulling ~20k tokens of `TASK_LOG.md` into context; read-only, works the same from Claude and Codex |

---

## When to use X vs Y

Complements the `Preferred Skill Map` above. That map names the canonical skill per
action; this matrix disambiguates the cases where two similar skills (or tools) both
apply and the choice depends on the situation. Only skills confirmed present in
`skills/` are listed; browser entries are tool routes, not skills.

| 상황 | 1순위 | 대안 | 판단 기준 |
|------|-------|------|-----------|
| 작업 실행 방식 | `Qexecute` (무플래그) | `Qexecute -verify` · `Qexecute -utopia` | 단순·저위험이면 무플래그 자기분류(순차/wave); 코드 품질 루프 게이트가 필요하면 `-verify`; 무인 자율 반복이면 `-utopia` |
| 세션 연속성 | `Qcompact` → `Qresume` | `Qmemory` · `Qcontext` · `Qlearn` | 진행 상태를 통째로 다음 세션에 넘길 땐 compact/resume; 재사용할 규칙·결정은 `Qmemory`; 폴더 국소 컨텍스트는 `Qcontext`; 실패에서 얻은 교훈은 `Qlearn` |
| 정리 vs 스냅샷 | `Qgc` | `Qshadow` | 드리프트·데드코드·규칙 위반 스캔/정리는 `Qgc`; 작업트리 체크포인트·되돌리기(실제 git 무영향)는 `Qshadow` |
| 계획 vs 스펙 | `Qplan` | `Qgs` | 로드맵·페이즈 관리는 `Qplan`; 특정 작업의 TASK_REQUEST+VERIFY_CHECKLIST 생성은 `Qgs`(= `Qgenerate-spec`) |
| 품질 검증 | `Qcritical-review` | `Qqa` | SIVS 스테이지 적대적 검증(spec/impl/merge)은 `Qcritical-review`; 실행 중인 웹앱 대상 탐색·회귀 QA는 `Qqa` |
| 브라우저 자동화 (도구) | Playwright MCP | claude-in-chrome · 스크린샷 CLI | 접근성 트리 기반 안정 조작은 Playwright MCP(우선); 확장 연동 시나리오는 claude-in-chrome; 단순 캡처만이면 `npx playwright screenshot` CLI |

---

## Skills (Q-prefix)

### Framework Core
| Skill | Purpose |
|-------|---------|
| `Qhelp` | Show QE Framework usage overview |
| `Qversion` | Show current plugin version |
| `Qupdate` | Update QE framework body, Codex assets, and codex-plugin-cc bridge |
| `Qdoctor` | Diagnose and repair QE dependency and `.qe/` project-state health |
| `Qinit` | Initial setup and directory structure |
| `Qplan` | Strategic roadmap and phase management (.qe/planning/) |
| `Qrefresh` | Refresh project analysis data; use `Qrefresh --sync` to sync source files with a reference/standard project |
| `Qcompact` | Save context / session handoff |
| `Qresume` | Restore saved context |
| `Qgc archive` | Archive completed tasks |
| `Qcommit` | Human-style git commit (no AI traces) |
| `Qcontext` | Folder-aware context memory manager (.qe/context/) |
| `Qlearn` | Cross-session learning memory (.qe/learnings.md) |
| `Qshadow` | Shadow-git snapshot store (checkpoint/diff/restore, no real git impact) |
| `Qsecret` | OS-backed secret storage with secure env injection |
| `Qsivs-config` | View/change SIVS engine routing (.qe/sivs-config.json) |
| `Qcollect-skill` | Collect project-local stack guidance into `.claude/skills/` |
| `Qissue` | File GitHub issues against the qe-framework repo |
| `Qhelp find` | Find/install skills from skills.sh |
| `Qmcp setup` | MCP server setup, configuration, and custom server building guide |
| `Qmcp sync` | Preview and guide MCP client config synchronization |
| `Qmemory` | Manage project memory (conventions, gotchas, decisions with TTL) |
| `Qexecute -utopia` | Fully autonomous execution mode |
| `Qmistake` | Record mistakes to prevent repetition (.qe/MISTAKE.md) |
| `Qgc` | Code garbage collection (drift, violations, dead code) |

### Task Execution
| Skill | Purpose |
|-------|---------|
| `Qgenerate-spec` | Generate CLAUDE.md + TASK_REQUEST + VERIFY_CHECKLIST |
| `Qexecute` | Execute spec-based tasks |
| `Qexecute -verify` | Test > review > fix quality loop |
| `Qqa` | Unified QA: `plan` (test docs) · `run` (single-pass scenarios) · `council` (multi-agent QA loop) |
| `Qautoresearch` | Autonomous experiment loop (modify > run > evaluate) |
| `Qcritical-review` | SIVS stage-aware adversarial verification; hosts `--debate` and `--risk` modes |
| `Qverify-contract` | Verify implementation/tests against business-logic contracts (.qe/contracts/) |
| `Qclaude-rescue` | Hand SIVS claude-stages from a Codex session to the local Claude CLI |

### Expert & Domain Skills (external)

Domain expert skills (language/framework experts, PM & product docs, design/frontend,
infrastructure & DevOps, data analysis, academic writing, etc.) are no longer part of
the framework payload. They live in the external `@inho-team/qe-mcp` companion package
so framework installs stay small and client-neutral. Use `Qmcp setup` to connect the
companion, `Qcollect-skill` for project-local stack guidance, or `Qhelp find` to
discover installable skills.

---

## Agents (E-prefix: background/sub-agents)

| Agent | Purpose |
|-------|---------|
| `Earchive-executor` | Archive tasks to .qe/.archive/ |
| `Ecode-debugger` | Bug root cause analysis |
| `Ecode-reviewer` | Code review (quality/security/perf) |
| `Ecode-test-engineer` | Test writing and coverage |
| `Ecommit-executor` | Git commit operations (used by Qcommit) |
| `Ecompact-executor` | Context save/restore |
| `Econtract-judge` | Business-logic contract PASS/FAIL verdict (used by Qverify-contract) |
| `Edeep-researcher` | Multi-source research |
| `Edoc-writer` | Technical documentation writing and batch document generation |
| `Egrad-writer` | Academic paper chapter writing |
| `Ehandoff-executor` | Session handoff documents |
| `Eperformance-profiler` | Build/bundle/runtime performance profiling |
| `Epm-planner` | PRD/roadmap/story planning |
| `Eqa-orchestrator` | Test > review > fix loop |
| `Eqa-explorer` | Black-box exploratory UI tester (browser-only, no source access) |
| `Erefresh-executor` | Project change detection |
| `Erisk-proof-auditor` | Adversarial risk-proof audit (used by Qcritical-review --risk) |
| `Esecurity-officer` | Security vulnerability scanning |
| `Esupervision-orchestrator` | Expert-level quality assessment |
| `Etask-executor` | Complex task implementation (5+ items) |

---

## Release Process

The framework uses a **release train** pattern. Every commit that changes user-visible behavior must add an entry to `CHANGELOG.md` under `[Unreleased]`; versions are cut deliberately, not per commit.

### Cadence

| Level | Cadence | Trigger |
|-------|---------|---------|
| **patch** | weekly OR ~5 fixes accumulated | bundled bug fixes, tweaks |
| **minor** | monthly | new skills/agents, feature additions |
| **major** | rare | breaking changes |
| **hotfix patch** | immediate | security, data loss, framework-unusable regression only |

### Flow

1. **Every commit** that ships user-visible behavior → add entry to `CHANGELOG.md [Unreleased]` under `Added` / `Changed` / `Fixed` / `Removed` / `Security`.
2. **Do NOT bump version** on the fix/feature commit. `plugin.json` / `package.json` stay at the last released version.
3. **When a batch is ready** → run `/Qrelease` with an optional `major|minor|patch` override. `Qrelease` reads `[Unreleased]`, bumps, rewrites changelog, commits, tags, and—after explicit confirmation—optionally pushes and creates the GitHub Release. Use `/Qversion` only to look up the current version.
4. **Between releases**, `main` may be "ahead" of the latest tag — that's expected. Users who want bleeding edge can track the tip; most pin a tag.

### Manual audit and migration procedure

Audit and migration work has no replacement admin service. Document the scope and
preconditions in the task spec, identify the exact files and backup or rollback point,
write the ordered manual steps, review the resulting diff, run the repository's existing
targeted validators, and record evidence plus rollback instructions before completion.
Do not infer an automated tool or modify unrelated files.

### Anti-patterns

- Bumping version in the same commit as a fix → **use `/Qrelease` later instead**
- Using `Qversion` to mutate release state → `Qversion` is read-only; use `/Qrelease`
- Releasing with empty `[Unreleased]` → `Qrelease` aborts
- Per-edge-case patch release → batch it; only security / data loss / framework-unusable bugs get immediate hotfix

### Rationale

The plugin cache uses a version-pinned path (`~/.claude/plugins/cache/inho-team-qe-framework/qe-framework/<version>/`). Each release forces a re-cache on users' machines. Batched releases keep release notes meaningful and caches stable.

---

## Skill File Size Rules

| Tier | Lines | When |
|------|-------|------|
| Minimal | <100 | Simple wrapper, single action |
| Standard | 100-200 | Most skills |
| Comprehensive | 200-250 | Complex multi-step workflows |

**Hard limit: 250 lines per SKILL.md.** If a skill exceeds 250 lines, extract verbose content (examples, reference docs) into a `references/` subdirectory.
