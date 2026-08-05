# QE Conventions

## Architecture dependency boundary

Harness-neutral code may not import Claude/Codex-specific adapters, and the two
host adapters may not import one another directly. Put shared behavior in the
neutral core and validate changes with `scripts/check-architecture-boundaries.mjs`
(automatically included by `scripts/check-all.mjs`). The enforced zones and
named pre-contract debt are defined in `core/ARCHITECTURE_BOUNDARIES.md`.

> **`.qe` state lives in the DB, not files (DB-backed store).** The `.qe/` tree is
> backed by the SQLite store `.qe/qe.db` (`qe_files` table + derived index tables);
> a given `.qe/` path may have **no file on disk**. So when a skill or the agent
> needs `.qe/` content, read it from the store, not the raw filesystem:
> - **read a file** → `node scripts/qe-cat.mjs <.qe/path>` (row-first, disk fallback)
> - **list a dir** → `node scripts/qe-cat.mjs --ls <.qe/dir>` · **exists** → `--exists`
> - **query structured state** → `node scripts/qe-query.mjs tasks|specs|verification|analysis|contracts|wiki|failures|…`
> Framework code reads `.qe/` through `hooks/scripts/lib/qe-fs.mjs` automatically;
> the tools above are the equivalent for skill/agent (prose) steps. Do **not**
> assume a `.qe/` file exists on disk — a missing file is normal, its content is a row.
> `.qe/planning/**` is DB-only by default: its directory structure is logical and
> Qplan must mutate it through QE state/store utilities, never raw filesystem writes.
> Other `.qe` namespaces may still mirror rows to disk during the transition.
> Migration/verification: `node scripts/qe-fs-to-db.mjs migrate|verify|reconstruct`.

> **Toolkit hint:** QE skills tend to produce better outcomes than system defaults for the actions listed below — they encode project-specific patterns, avoid AI traces, and handle edge cases that generic defaults miss.

> **Response style:** All user-facing answers — main session replies, skill summaries, and agent reports — MUST follow `core/OUTPUT_STYLE.md`: lead task turns with the next action, number multi-step work, restate current state, estimate remaining work in minutes, expose wins, report errors matter-of-factly, cap each list at five items, suppress tangents, omit preamble/recap/generic closers, and end with one concrete next step. Fact/guess separation, named recommendations, source paths, and conditional visual forms still apply.

---

## Terminology Glossary

All skills, agents, and documents in this framework MUST use these standard terms. Deprecated terms should be replaced on sight.

| Concept | Standard Term | Deprecated | Notes |
|---------|--------------|------------|-------|
| User workflow | **PSE Chain** | ~~PSE Loop~~ | Router-owned internal workflow entered through `Qgoal` |
| Quality gate | **SIVS Loop** | ~~SVS Loop~~ | Inner quality gate within Execute/Verify steps |
| Parallel execution group | **Wave** | ~~Swarm~~ | Independent items grouped for concurrent execution |
| Parallel agent | **Teammate** | ~~Subagent~~ (internal only) | Haiku Teammate = Haiku-model agent in a Wave |
| Spec generation skill | **Qgenerate-spec** | — | Router-owned internal PSE unit |
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
User: $Qplan {의도} / /Qplan {의도} (or $Qgoal / /Qgoal) → Plan intake
Internal: Plan-owned Goal loop → knowledge → Qgenerate-spec → Qexecute → Qexecute -verify
```

- **Plan**: Define roadmap, phases, requirements, and an ordered Goal queue (`Qplan`)
- **Spec**: Generate TASK_REQUEST + VERIFY_CHECKLIST (`Qgenerate-spec`)
- **Execute**: Implement checklist items via Wave execution (`Qexecute`)
- **Verify**: Test → review → fix quality loop (`Qexecute -verify`)

### Goal completion standard

A Goal may become `complete` only after its pre-execution acceptance contract is
matched by recorded evidence: every requirement criterion and user scenario
passes, the applicable regression command passes, an independent verifier passes,
that verifier confirms the evidence still proves the verbatim Goal objective, and
any required human acceptance is recorded. Goals with authentication, authorization,
payment, deployment, data-migration, destructive-data, external-integration, or
security risk require human acceptance. A bare implementation report,
test claim, or self-verification is not Goal completion. See
[`core/GOAL_ACCEPTANCE_CONTRACT.md`](core/GOAL_ACCEPTANCE_CONTRACT.md).

### SIVS Loop (inner quality gate)

```
Spec → Implement → Verify → Supervise → (FAIL) Remediate → Spec → ...
```

The SIVS Loop runs **inside** the Execute and Verify steps of the PSE Chain. It is the quality gate that ensures each task meets its spec before completion. See `core/PHILOSOPHY.md` for full specification.

### Relationship

```
PSE Chain (Plan-owned internal workflow)
├── Entry ────────── $Qplan {의도} / /Qplan {의도}
├── Plan ─────────── Qplan creates ordered Goals
├── Goal loop ────── retrieve knowledge → Spec → Execute → Verify
├── Spec ─────────── Qgenerate-spec
├── Execute ──────── Qexecute
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
| Plan | `Qplan` | Roadmap, phases, requirements, sequential Goal control |
| Spec | `Qgenerate-spec` | TASK_REQUEST + VERIFY_CHECKLIST generation |
| Execute | `Qexecute` | Wave execution with Haiku Teammates (default) |
| Execute | `Qexecute` | Sequential execution (fallback for non-atomic tasks) |
| Verify | `Qexecute -verify` | Test → review → fix quality loop |

`Qplan` is the public Plan controller. `Qgenerate-spec` and `Qexecute` are internal PSE units, not normal user entry points. Start new work with `$Qplan {의도}` in Codex or `/Qplan {의도}` in Claude; `$Qgoal`/`/Qgoal` remain accepted intake aliases. In-chain calls carrying an existing task UUID remain valid through task-artifact continuity.

### Deterministic tacit-knowledge intake

- Qplan is the sole intake owner. Qgoal delegates the original intent and
  client mode; internal PSE stages do not recreate questions or counters.
- Reconnaissance precedes intake. Repository evidence becomes typed
  `source-fact` knowledge; unresolved user choices become questions. A model
  synthesis is not a reviewed wiki fact.
- Broad, ambiguous, or materially incomplete work uses
  `scripts/qe-intake.mjs` before ROADMAP, REQUIREMENTS, Goal, or acceptance
  finalization. The safe omission path requires a recorded finding that no
  unresolved material decision exists.
- Intake state is the DB-only logical path
  `.qe/planning/plans/{slug}/INTAKE.json`. Every state-changing CLI call uses
  the current full session owner and expected revision. Owner or revision
  conflicts fail closed and preserve the prior stored bytes.
- The engine, not the client adapter, owns labels and limits: base 30,
  follow-up 3 per parent and 12 allocated total, 42 unique issued versions,
  and batches of 3. Base labels use `[17/30]`; follow-ups use `[17-1/3]`.
- Interactive clients render the same labeled open question. Non-interactive
  clients may assume only an explicitly reversible non-material default; any
  unresolved material question blocks finalization.
- Pause/resume preserves the earliest unresolved label. Answer correction is
  capped at 6, re-baseline at 1, synthesis correction at 2, and successful
  resume cycles at 10. Stop produces `blocked`; exhausted structural budgets
  produce `split-required`; only accepted synthesis produces `confirmed`.
- Confirmed intake knowledge remains Plan evidence. It reaches the reviewed
  project wiki only through the normal verified Goal completion path.

The authoritative transition and knowledge schema is
[`core/KNOWLEDGE_ELICITATION_CONTRACT.md`](core/KNOWLEDGE_ELICITATION_CONTRACT.md);
rendering behavior is in
[`core/INTERACTION_ADAPTER.md`](core/INTERACTION_ADAPTER.md).

---

## Client Command Prefixes

QE skills are shared across Claude and Codex, but the user-visible command
prefix is client-specific.

| Active client | Skill command prefix | Example |
|---------------|----------------------|---------|
| Claude | `/` | `/Qplan {의도}` |
| Codex | `$` | `$Qplan {의도}` |

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

Dependency direction is enforced by `scripts/check-architecture-boundaries.mjs`.
Harness-neutral core must not import a host adapter, and Claude/Codex adapters
must not couple directly. See [`core/ARCHITECTURE_BOUNDARIES.md`](core/ARCHITECTURE_BOUNDARIES.md)
for the exact rules and the single documented legacy baseline edge.

---

## Handoff Format Rules

Internal PSE units MUST report their state back to Qplan. Qplan reports Plan and Goal status to the user; it does not hand users a chain of internal commands.

1. **Phase context + Roadmap progress** — Display current Phase and overall progress at a glance
2. **PSE Chain status, one line** — Show current completion/progress status
3. **Current Goal** — State the active Goal, its completion criterion, and whether it is progressing, blocked, or verified.
4. **No command choreography** — Do not ask users to invoke internal PSE, derived-wiki, or ledger commands. A new Plan may be started with active-prefix `Qplan {의도}`.
5. **No explanations after a required decision** — If a material decision is needed, present only the decision and its consequences.
6. **Task type branching** — Internal code tasks may enter `Qexecute -verify`; Qplan remains responsible for the user-facing status.
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
Qplan continues with internal verification for Goal a1b2c3d4.
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
Qplan advances the active Goal internally to Codex Bridge.
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

All phases done. The user may finalize with the active-client `Qcommit` command.
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

All phases done. The user may finalize with `$Qcommit`.
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
1. Qplan controller context carrying an explicit plan slug.
2. `.qe/state/current-session.json` → `session_id` → `.qe/planning/.sessions/{session_id}.json` → `activePlanSlug`.
3. `.qe/planning/ACTIVE_PLAN`.
4. Legacy flat `.qe/planning/ROADMAP.md` / `STATE.md` (pre-Named-Plan projects).

**Slug shape**: `[a-z0-9][a-z0-9-]{0,63}`. Qplan derives slugs automatically from the task prompt (no user prompt). See `skills/Qplan/SKILL.md` Step 0.6.

**Session bridge**: `hooks/scripts/session-start.mjs` writes `.qe/state/current-session.json` with the current session_id on every session start. Skills read this file to discover their own session_id (which Claude Code does not otherwise expose to the model).

## Global Output Rules

### Response Language
<!-- qe:response-language=latest-user-message -->
Reply in the language of the user's most recent message. Use a stored language profile only when that message has no detectable natural language.

This applies to all skills and user-facing output. If the user writes in Korean, section titles, descriptions, summaries, handoff messages, **and handoff labels (e.g., `Next:` → `다음:`)** must be in Korean. Only the following are exempt and stay in English:
- File names and paths (e.g., `TASK_REQUEST_abc123.md`)
- Code and code blocks
- Skill names and internal stage identifiers (e.g., `Qplan`, `Qexecute`)
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
- Project-specific decisions and lessons belong in reviewed Plan evidence or project documentation; do not duplicate them in auto-memory.

### Single-AI SIVS Runtime Policy

- The active client owns Spec, Implement, Verify, and Supervise; no SIVS path
  invokes a second AI client or bridge.
- Spec is main-thread work. Implement is main-thread-led and uses bounded
  same-client subagents. Verify and Supervise are high-reasoning critical QA
  leads that create evidence and call isolated same-client subagents.
- `.qe/sivs-config.json` configures only active-client `model`, `effort`, and
  compaction. Verify and Supervise default to `effort: high`.
- Native subagent loss degrades to isolated inline work (`mode=degraded-inline`)
  and cannot yield a stronger-than-WARN QA verdict without later delegated proof.
- See `core/SIVS_SINGLE_AI_MODEL.md` for the authoritative contract.

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
- **Active pipelines are shielded from premature stopping.** When a multi-step pipeline (SIVS loop, Wave execution, Qexecute) is running, persistent mode blocks the Stop hook with a bounded reinforcement counter stored in `unified-state.json`. Skills enter persistent mode at execution start and exit at their Handoff step. See `hooks/scripts/lib/persistent-mode.mjs` and `core/CONTEXT_BUDGET.md` for details.

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

| Action | Preferred Skill |
|--------|-----------------|
| start or re-plan work | `Qplan` |
| add an explicit Goal | `Qgoal` |
| generate task specifications | `Qgenerate-spec` (internal) |
| execute or verify a task | `Qexecute` (internal) |
| adversarial stage review | `Qcritical-review` |
| git commit or push | `Qcommit` |
| save or restore session context | `Qcompact` / `Qresume` |
| update installed framework assets | `Qupdate` |
| read the installed version | `Qversion` |

## Skills (Q-prefix)

| Skill | Purpose |
|-------|---------|
| `Qplan` | Plan-owned Goal controller and minimal project bootstrap |
| `Qgoal` | Goal intake router |
| `Qgenerate-spec` | TASK_REQUEST and VERIFY_CHECKLIST generation |
| `Qexecute` | Spec execution and `-verify` quality loop |
| `Qcritical-review` | SIVS adversarial verification, debate, and risk modes |
| `Qcommit` | Human-style Git commit and optional push |
| `Qcompact` | Context snapshot and handoff |
| `Qresume` | Saved-context restoration |
| `Qupdate` | Framework and client-asset update |
| `Qversion` | Read-only framework version |

## Agents (E-prefix: background/sub-agents)

| Agent | Purpose |
|-------|---------|
| `Ecode-debugger` | Bug root cause analysis |
| `Ecode-reviewer` | Read-only correctness and maintainability review |
| `Ecode-test-engineer` | Test writing and coverage |
| `Ecommit-executor` | Git commit operations (used by Qcommit) |
| `Ecompact-executor` | Context snapshots, handoffs, and restore support |
| `Edeep-researcher` | Multi-source research |
| `Edoc-writer` | Technical documentation writing and batch document generation |
| `Eqa-orchestrator` | Test > review > fix loop |
| `Erisk-proof-auditor` | Adversarial risk-proof audit (used by Qcritical-review --risk) |
| `Esecurity-officer` | Security vulnerability scanning |
| `Esupervision-orchestrator` | Expert-level quality assessment |
| `Etask-executor` | Complex task implementation (5+ items) |

The authoritative fleet, callers, models, budgets, and tool grants live in
`core/agent-registry.json`. All calls use `core/AGENT_DELEGATION_CONTRACT.md`.

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
3. **When a batch is ready** → a maintainer performs the reviewed release/admin workflow: read `[Unreleased]`, choose the SemVer bump, keep `package.json` and `.claude-plugin/plugin.json` aligned, commit, tag, and optionally publish. Use `/Qversion` only to look up the current version.
4. **Between releases**, `main` may be "ahead" of the latest tag — that's expected. Users who want bleeding edge can track the tip; most pin a tag.

### Manual audit and migration procedure

Audit and migration work has no replacement admin service. Document the scope and
preconditions in the task spec, identify the exact files and backup or rollback point,
write the ordered manual steps, review the resulting diff, run the repository's existing
targeted validators, and record evidence plus rollback instructions before completion.
Do not infer an automated tool or modify unrelated files.

### Anti-patterns

- Bumping version in the same commit as a fix → defer it to the reviewed release/admin workflow
- Using `Qversion` to mutate release state → `Qversion` is read-only
- Releasing with empty `[Unreleased]` → do not cut a release
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
