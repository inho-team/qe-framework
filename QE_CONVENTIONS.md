# QE Conventions

> **Toolkit hint:** QE skills tend to produce better outcomes than system defaults for the actions listed below — they encode project-specific patterns, avoid AI traces, and handle edge cases that generic defaults miss.

> **Response style:** All user-facing answers — main session replies, skill summaries, and agent reports — MUST follow the response style contract in `core/OUTPUT_STYLE.md` (conclusion-first, fact/guess separation, named recommendation, source-doc paths, Tier-1 always + Tier-2 conditional forms).

---

## Terminology Glossary

All skills, agents, and documents in this framework MUST use these standard terms. Deprecated terms should be replaced on sight.

| Concept | Standard Term | Deprecated | Notes |
|---------|--------------|------------|-------|
| User workflow | **PSE Chain** | ~~PSE Loop~~ | The 4-step user-facing workflow |
| Quality gate | **SIVS Loop** | ~~SVS Loop~~ | Inner quality gate within Execute/Verify steps |
| Parallel execution group | **Wave** | ~~Swarm~~ | Independent items grouped for concurrent execution |
| Parallel agent | **Teammate** | ~~Subagent~~ (internal only) | Haiku Teammate = Haiku-model agent in a Wave |
| Spec generation skill | **Qgs** | Qgenerate-spec (internal full name) | Render as `/Qgs` in Claude and `$Qgs` in Codex |
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
Claude: /Qplan  →  /Qgs  →  /Qatomic-run  →  /Qcode-run-task
Codex:  $Qplan  →  $Qgs  →  $Qatomic-run  →  $Qcode-run-task
        Plan       Spec      Execute          Verify
```

- **Plan**: Define roadmap, phases, requirements (`Qplan`)
- **Spec**: Generate TASK_REQUEST + VERIFY_CHECKLIST (`Qgs`)
- **Execute**: Implement checklist items via Wave execution (`Qatomic-run`)
- **Verify**: Test → review → fix quality loop (`Qcode-run-task`)

### SIVS Loop (inner quality gate)

```
Spec → Implement → Verify → Supervise → (FAIL) Remediate → Spec → ...
```

The SIVS Loop runs **inside** the Execute and Verify steps of the PSE Chain. It is the quality gate that ensures each task meets its spec before completion. See `core/PHILOSOPHY.md` for full specification.

### Relationship

```
PSE Chain (user workflow)
├── Plan ─────────── /Qplan
├── Spec ─────────── /Qgs (Qgenerate-spec)
├── Execute ──────── /Qatomic-run or /Qrun-task
│     └── SIVS Loop (quality gate)
│           ├── Spec: TASK_REQUEST defines the contract
│           ├── Implement: Actual coding and file changes
│           ├── Verify: VERIFY_CHECKLIST confirms completion
│           └── Supervise: Supervision agents confirm quality
└── Verify ───────── /Qcode-run-task
      └── SIVS Loop (quality gate, final pass)
```

---

## PSE Chain: Skill Roles

| PSE Step | Skill | Role |
|----------|-------|------|
| Plan | `Qplan` | Roadmap, phases, requirements |
| Spec | `Qgs` | TASK_REQUEST + VERIFY_CHECKLIST generation |
| Execute | `Qatomic-run` | Wave execution with Haiku Teammates (default) |
| Execute | `Qrun-task` | Sequential execution (fallback for non-atomic tasks) |
| Verify | `Qcode-run-task` | Test → review → fix quality loop |

---

## Client Command Prefixes

QE skills are shared across Claude and Codex, but the user-visible command
prefix is client-specific.

| Active client | Skill command prefix | Example |
|---------------|----------------------|---------|
| Claude | `/` | `/Qatomic-run 24740a27` |
| Codex | `$` | `$Qatomic-run 24740a27` |

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
4. **`Next command:` block** — Place alone in a code block for easy copying, **must include UUID or Phase argument**
5. **No explanations** — Do not add alternatives, elaborations, or choices after the command. **Never include a fallback line** (`or: /Qgenerate-spec ...`, `If that doesn't work: ...`). `/Qgs` is the registered alias for `/Qgenerate-spec` — a duplicate line is noise.
6. **Task type branching** — Guide only `type: code` to `/Qcode-run-task`. For docs/analysis/deletion tasks, guide to the next Phase
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
Next: {adapter.commandPrefix}Qcode-run-task a1b2c3d4
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

Planning state is scoped per plan under `.qe/planning/plans/{slug}/` so multiple terminals can run `/Qplan` in parallel without clobbering each other's STATE/ROADMAP.

**Per-plan files** (under `.qe/planning/plans/{slug}/`):
- `ROADMAP.md`, `STATE.md`, `REQUIREMENTS.md`, `phases/{X}/SUMMARY_*.md`, `phases/{X}/RETROSPECTIVE.md`.

**Global files** (under `.qe/planning/`, shared across all plans):
- `PROJECT.md` — project-wide vision and pillars.
- `DECISION_LOG.md` — architectural decisions that cut across plans.
- `research/` — reusable research reports.
- `ACTIVE_PLAN` — single-line pointer to the most-recently-activated slug.
- `.sessions/{session_id}.json` — per-session `{ activePlanSlug, updatedAt }` binding.

**Plan resolution order** (used by consumer skills):
1. Explicit slug argument (e.g., `/Qgs auth-refactor: 인증 모듈`).
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
- Skill/command names (e.g., `/Qgs`, `/Qatomic-run`)
- Status markers (`[x]`, `[>]`, `PSE:`)

---

## QE Rules

### File Naming
- Task request: `TASK_REQUEST_{UUID}.md`
- Verification checklist: `VERIFY_CHECKLIST_{UUID}.md`
- One task shares the same UUID across both documents.
- UUID: 8-character random hex (`openssl rand -hex 4`). Must check for collision before use.

### Task Status
| Status | Meaning |
|--------|---------|
| 🔲 Pending | Not yet started |
| 🔶 In progress | Currently being worked on |
| ✅ Complete | All VERIFY_CHECKLIST items checked. **No further reference needed.** |

### Completion Criteria
- All VERIFY_CHECKLIST checkboxes checked → ✅ Complete
- Completed task files do not need to be referenced.

### Codex Runtime Policy
When invoking Codex (`codex:codex-rescue`, SIVS codex routing):
- **Stage defaults** — without Codex, all SIVS stages use Claude. When Codex is available, Spec and Supervise stay Claude-led while Implement and Verify prefer Codex; explicit `.qe/sivs-config.json` entries can override this.
- **Role profiles** — the Head/Body split is a named preset over the four stages: **Head = Spec + Supervise**, **Body = Implement + Verify**. `/Qsivs-config profile <name>` sets all four at once — `claude-head` (default: Claude Head / Codex Body), `codex-head` (Codex Head / Claude Body), `all-claude`, `all-codex`. The stored `profile` field is metadata; the per-stage engine entries remain the routing source of truth.
- **Fallback is bidirectional** — engine assignment is a preference. A `codex` stage degrades to Claude when codex-plugin-cc is absent; a `claude` stage degrades to Codex in a Codex-native session where Claude is unreachable. See `resolveEngine()` in `scripts/lib/codex_bridge.mjs`.
- **Cross-engine calls go through MCP** — when one engine must invoke the other (Head calling Body or vice versa), use the qe-mcp tools `qe_run_codex_agent` / `qe_run_claude_agent` / `qe_delegate_agent` (recursion-guarded, `max_concurrent_runs: 1`). Do **not** shell out to `codex-companion.mjs` or any `node .../scripts/*.mjs` runner directly for cross-engine work — direct library invocation bypasses the recursion guard and audit trail.
- **Spec/Supervise assistance** — Claude owns requirements and final judgment, but should actively use Codex for bounded repo search, context gathering, test diagnosis, and second-opinion review when that reduces Claude token load.
- **Runtime mode is selectable** — foreground is preferred for short Codex tasks so stdout lands in the conversation. Background is allowed for long Implement/Verify jobs only when the session retrieves results with `/codex:status` and `/codex:result <job-id>` before final reporting.
- **Session result hint** — SessionStart may emit `[Session State] ... codex:<status>...:retrieve /codex:result` when a background Codex job is still relevant. Treat it as a retrieval reminder, not as completion evidence.
- **Concise Codex output** — ask Codex for relevant files, line numbers, summaries, and next actions; do not paste raw bulk search output back into Claude unless necessary.

---

## Performance & Optimization Standard

To maintain high reasoning quality and low latency, all agents and skills must adhere to these standards:

### 1. Minimal I/O Rule (Enforced)
- **Never read or write the same file twice** in a single execution turn.
- **ContextMemo (enforced)**: The `pre-tool-use` hook **hard-blocks** redundant `Read` calls for files already cached in the session. If a file was read before and not modified since, the Read is rejected with `exit(2)` and a `MEMO HIT` message. After a `Write`/`Edit` to that file, the next Read is allowed.
- **Unified State**: Use `unified-state.json` via `hooks/scripts/lib/state.mjs` for all persistent session data.

### 2. Token-Aware Context Management
- **Thresholds**: Monitor context pressure at **140k tokens** (Warning/Snapshot) and **170k tokens** (Critical/Hard Stop).
- **Semantic Compression**: When context is high, prioritize `SNAPSHOT_SUMMARY.md` over raw history preservation.
- **Strategic Planning**: Use `.qe/planning/` for project roadmaps and phase-based state management via `/Qplan`.
- **Token Fallback**: If real-time metrics are missing, use `Characters / 4` for estimation.

### 3. Persistent Mode Protection
- **Active pipelines are shielded from premature stopping.** When a multi-step pipeline (SIVS loop, Wave execution, Qatomic-run) is running, persistent mode blocks the Stop hook and injects reinforcement via the Notification hook. Skills enter persistent mode at execution start and exit at their Handoff step. See `hooks/scripts/lib/persistent-mode.mjs` and `core/CONTEXT_BUDGET.md` for details.

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
| version/release admin | `qe-admin-mcp` | Maintainer-only release/bump workflows with explicit admin MCP routing |
| show version | `Qversion` | Single source of truth across plugin.json / package.json |
| health check / repair | `Qdoctor` | Verifies framework, MCP companion, and `.qe/` consistency before repair |
| context save / handoff | `Qcompact` | Structured snapshot, recoverable in future sessions |
| context restore | `Qresume` | Reconstructs working state from snapshot |
| archive tasks | `Qarchive` | Moves files into versioned archive with index |
| project refresh | `Qrefresh` | Re-analyzes all four analysis files in one pass |

---

## Skills (Q-prefix)

### Framework Core
| Skill | Purpose |
|-------|---------|
| `Qhelp` | Show QE Framework usage overview |
| `Qversion` | Show current plugin version |
| `Qupdate` | Update everything QE — framework body, qe-mcp companion, and codex-plugin-cc bridge |
| `Qdoctor` | Diagnose and repair QE dependency and `.qe/` project-state health |
| `Qinit` | Initial setup and directory structure |
| `Qplan` | Strategic roadmap and phase management (.qe/planning/) |
| `Qrefresh` | Refresh project analysis data |
| `Qmap-codebase` | Automated brownfield codebase analysis (4 parallel agents) |
| `Qproject-sync` | Sync project source files with a reference/standard project |
| `Qcompact` | Save context / session handoff |
| `Qresume` | Restore saved context |
| `Qarchive` | Archive completed tasks |
| `Qcommit` | Human-style git commit (no AI traces) |
| `Qalias` | Define path/command shortcuts |
| `Qcc-setup` | Shell alias setup for Claude & Codex (cc, ccc, ccd, cx, cxd) |
| `Qcommand-creator` | Create slash commands |
| `Qfind-skills` | Find/install skills from skills.sh |
| `Qmcp-setup` | MCP server setup, configuration, and custom server building guide |
| `Qmcp-sync` | Sync external QE MCP registry from `inho-team/qe-mcp` |
| `Qmemory` | Manage project memory (conventions, gotchas, decisions with TTL) |
| `Qutopia` | Fully autonomous execution mode |
| `Qmistake` | Record mistakes to prevent repetition (.qe/MISTAKE.md) |
| `Qgc` | Code garbage collection (drift, violations, dead code) |

### Knowledge Wiki (Qwiki — `.qe/wiki/` layer)
| Skill | Purpose |
|-------|---------|
| `Qwiki-ingest` | Save a source (URL/file/text) into `.qe/wiki/inbox` — save only, no synthesis |
| `Qwiki-compile` | Synthesize inbox → wiki pages (canonicalize, router/index/overview, raw move, Qcommit) |
| `Qwiki-query` | 2-phase routed retrieval (Phase A route / Phase B search) with provenance + fileback |
| `Qwiki-lint` | 7-check wiki health audit (contradictions, orphans, dead links, index/router, shard cap, tier, conventions↔router) |

> Distinct from `Qmemory` (volatile fact cards), `Qcontext` (per-folder loading), `.qe/analysis`
> (code snapshot). wiki = canonical project knowledge; others are pointers (DECISION_LOG D-WIKI-02).
> Full guide: `docs/QWIKI.md`. compile/query/lint are utility skills outside SIVS stage routing; commits via Qcommit only.

### Task Execution
| Skill | Purpose |
|-------|---------|
| `Qgenerate-spec` | Generate CLAUDE.md + TASK_REQUEST + VERIFY_CHECKLIST |
| `Qrun-task` | Execute spec-based tasks |
| `Qcode-run-task` | Test > review > fix quality loop |
| `Qscenario-test` | Generate, execute, and verify E2E user scenarios (browser/API/CLI) |
| `Qqa-council` | Multi-agent QA loop: explore (black-box) → codify → heal → report; optional PR-trigger scaffold |
| `Qautoresearch` | Autonomous experiment loop (modify > run > evaluate) |
| `Qtest-driven-development` | TDD: failing test first, then implement |
| `Qsystematic-debugging` | Hypothesis-driven root cause analysis |
| `Qrequirements-clarity` | Clarify ambiguous requirements before coding |

### Writing & Documentation
| Skill | Purpose |
|-------|---------|
| `Qwriting-clearly` | Improve prose clarity and remove AI writing patterns (Strunk's principles + AI pattern removal) |
| `Qdoc-comment` | Add inline code documentation |
| `Qdoc-converter` | Convert between MD/DOCX/PDF/PPTX/HTML |
| `Qcontent-research-writer` | Research-driven article writing |
| `Qprofessional-communication` | Business email/message writing |
| `Qmermaid-diagrams` | Generate Mermaid diagrams |
| `Qc4-architecture` | C4 architecture diagrams |

### Data & Analysis
| Skill | Purpose |
|-------|---------|
| `Qdata-analysis` | Statistical analysis and visualization |
| `Qfinance-analyst` | Financial analysis and valuation |
| `Qxlsx` | Spreadsheet operations |
| `Qpdf` | PDF processing |
| `Qpptx` | Presentation creation/editing |
| `Qdocx` | Word document creation/editing |
| `Qimage-analyzer` | Analyze screenshots/diagrams/charts |
| `Qaudio-transcriber` | Audio to text conversion |
| `Qyoutube-transcript-api` | YouTube subtitle extraction |

### Product & Project Management
| Skill | Purpose |
|-------|---------|
| `Qpm-prd` | Write PRDs (P0/P1/P2 prioritization) |
| `Qpm-user-story` | User stories with INVEST + Gherkin criteria |
| `Qpm-roadmap` | Outcome-focused strategic roadmap planning |
| `Qpm-discovery` | Product discovery: OST, experiments, assumptions, interviews |
| `Qpm-strategy` | Strategic analysis: Lean Canvas, SWOT, PESTLE, Porter's |
| `Qpm-gtm` | Go-to-market: ICP, growth loops, battlecards, positioning |
| `Qpm-okr` | OKR brainstorming with SMART validation |
| `Qpm-retro` | Retrospectives, pre-mortem, release notes |
| `Qqa-test-planner` | Test plans and regression suites |
| `Qfeature-forge` | Requirements workshop > feature specs |
| `Qjira-cli` | Jira CLI for issue management |
| `Qstitch-cli` | Google Stitch MCP setup |
| `Qstitch-apply` | Convert Stitch HTML designs to React TSX components |
| `Qagentation` | Visual UI feedback tool setup |

### Academic
| Skill | Purpose |
|-------|---------|
| `Qgrad-paper-write` | Draft academic papers |
| `Qgrad-paper-review` | Respond to reviewer comments |
| `Qgrad-research-plan` | Literature review and experiment design |
| `Qgrad-seminar-prep` | Prepare presentations |
| `Qgrad-thesis-manage` | Thesis progress management |

### Code Quality & Security
| Skill | Purpose |
|-------|---------|
| `Qcode-reviewer` | Code diff review |
| `Qcode-documenter` | Generate API docs and guides |
| `Qdebugging-wizard` | Parse errors and trace execution |
| `Qsecurity-reviewer` | Security vulnerability scanning |
| `Qsecure-code-guardian` | Auth/OWASP implementation |
| `Qspringboot-security` | Spring Security best practices |
| `Qplaywright-expert` | E2E tests with Playwright |
| `Qtest-master` | Test file generation |
| `Qvitest` | Vitest unit testing |
| `Qspec-miner` | Reverse-engineer specs from legacy code |
| `Qthe-fool` | Critical reasoning / devil's advocate |
| `Qcritical-review` | SIVS stage-aware adversarial verification (PASS/WARN/FAIL) |
| `Qdebate` | Structured multi-round debate (agent-vs-agent, codex-vs-claude) |
| `Qperspective` | Multi-perspective analysis (dev/user/pm/security/ops) |
| `Qfact-checker` | Verify factual claims |
| `Qsource-verifier` | Source credibility verification (SIFT) |
| `Qlesson-learned` | Extract engineering lessons from git history |
| `Qi18n-audit` | Scan for hardcoded strings, generate translation keys, report i18n coverage |

### Design & Frontend
| Skill | Purpose |
|-------|---------|
| `Qdesign` | Create DESIGN.md — the design system spec that all frontend skills reference |
| `Qfrontend-design` | Create new UI from scratch (reads DESIGN.md as source of truth) |
| `Qdesign-audit` | Audit design consistency within the project's own design system |
| `Qweb-design-guidelines` | Audit existing UI code |
| `Qweb-design-guidelines-vercel` | Vercel Web Interface Guidelines review |
| `Qdatabase-schema-designer` | Database schema design |
| `Qapi-designer` | REST/GraphQL API design |
| `Qarchitecture-designer` | System architecture design |
| `Qmicroservices-architect` | Distributed system architecture |
| `Qlegacy-modernizer` | Legacy system migration strategy |
| `Qagent-browser` | Browser automation CLI |
| `Qvisual-qa` | Chrome browser visual QA — screenshot compare against reference images |
| `Qvisual-redesign` | Visual audit + auto-fix — captures rendered pages, diagnoses DESIGN.md violations, fixes code |

### Language & Framework Experts
| Skill | Purpose |
|-------|---------|
| `Qpython-pro` | Python 3.11+ |
| `Qtypescript-pro` | TypeScript advanced |
| `Qjavascript-pro` | JavaScript ES2023+ |
| `Qgolang-pro` / `Qgolang` | Go |
| `Qrust-engineer` | Rust |
| `Qjava-architect` | Java / Spring Boot |
| `Qcsharp-developer` | C# / .NET 8 |
| `Qcpp-pro` | C++20/23 |
| `Qkotlin-specialist` | Kotlin |
| `Qphp-pro` | PHP 8.3+ |
| `Qswift-expert` | Swift / SwiftUI |
| `Qsql-pro` | SQL optimization |
| `Qreact-expert` | React 18+ |
| `Qvue-expert` / `Qvue-expert-js` | Vue 3 |
| `Qangular-architect` | Angular 17+ |
| `Qnextjs-developer` | Next.js 14+ |
| `Qreact-native-expert` | React Native / Expo |
| `Qflutter-expert` | Flutter 3+ |
| `Qfastapi-expert` | FastAPI |
| `Qdjango-expert` | Django |
| `Qnestjs-expert` | NestJS |
| `Qlaravel-specialist` | Laravel 10+ |
| `Qrails-expert` | Rails 7+ |
| `Qspring-boot-engineer` | Spring Boot 3.x |
| `Qdotnet-core-expert` | .NET 8 |
| `Qvite` | Vite |
| `Qreact-best-practices` | React/Next.js optimization |
| `Qvue-best-practices` | Vue.js best practices |

### Infrastructure & DevOps
| Skill | Purpose |
|-------|---------|
| `Qdevops-engineer` | Docker, CI/CD, K8s |
| `Qkubernetes-specialist` | Kubernetes workloads |
| `Qterraform-engineer` | Terraform IaC |
| `Qcloud-architect` | AWS/Azure/GCP |
| `Qpostgres-pro` | PostgreSQL optimization |
| `Qdatabase-optimizer` | DB query optimization |
| `Qmonitoring-expert` | Prometheus/Grafana |
| `Qsre-engineer` | SLOs, error budgets, incident response |
| `Qchaos-engineer` | Chaos experiments |
| `Qcli-developer` | CLI tool development |
| `Qwebsocket-engineer` | WebSocket systems |
| `Qsalesforce-developer` | Salesforce/Apex |
| `Qshopify-expert` | Shopify |
| `Qwordpress-pro` | WordPress |
| `Qatlassian-mcp` | Atlassian integration |
| `Qspark-engineer` | Spark jobs |
| `Qgraphql-architect` | GraphQL / Apollo |
| `Qprompt-engineer` | LLM prompt writing |
| `Qrag-architect` | RAG systems |
| `Qfine-tuning-expert` | LLM fine-tuning |
| `Qml-pipeline` | ML pipeline infrastructure |
| `Qpandas-pro` | Pandas DataFrame operations |
| `Qgame-developer` | Unity/Unreal game systems |
| `Qembedded-systems` | Firmware / RTOS |
| `Qmcp-developer` | Build/debug MCP servers |
| `Qfullstack-guardian` | Security-focused full-stack apps |

---

## Agents (E-prefix: background/sub-agents)

| Agent | Purpose |
|-------|---------|
| `Earchive-executor` | Archive tasks to .qe/.archive/ |
| `Ecode-debugger` | Bug root cause analysis |
| `Ecode-doc-writer` | Technical documentation writing |
| `Ecode-quality-supervisor` | Code quality audit (PASS/PARTIAL/FAIL) |
| `Ecode-reviewer` | Code review (quality/security/perf) |
| `Ecode-test-engineer` | Test writing and coverage |
| `Ecommit-executor` | Git commit operations (used by Qcommit) |
| `Ecompact-executor` | Context save/restore |
| `Edeep-researcher` | Multi-source research |
| `Edoc-generator` | Batch document generation |
| `Edocs-supervisor` | Documentation audit (PASS/PARTIAL/FAIL) |
| `Eanalysis-supervisor` | Analysis audit (PASS/PARTIAL/FAIL) |
| `Egrad-writer` | Academic paper chapter writing |
| `Ehandoff-executor` | Session handoff documents |
| `Epm-planner` | PRD/roadmap/story planning |
| `Eqa-orchestrator` | Test > review > fix loop |
| `Eqa-explorer` | Black-box exploratory UI tester (browser-only, no source access) |
| `Eqa-reporter` | QA findings aggregator → PR comment (comment-only, never merges) |
| `Erefresh-executor` | Project change detection |
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
3. **When a batch is ready** → use `qe-admin-mcp` to load the release admin workflow with an optional `major|minor|patch` override. The admin workflow reads `[Unreleased]`, bumps, rewrites changelog, commits, tags, optionally pushes + creates GitHub Release.
4. **Between releases**, `main` may be "ahead" of the latest tag — that's expected. Users who want bleeding edge can track the tip; most pin a tag.

### Anti-patterns

- Bumping version in the same commit as a fix → **use the `qe-admin-mcp` release workflow later instead**
- Invoking a local `M*` skill directly → admin workflows live in `inho-team/qe-admin-mcp`, not the default user skill tree
- Releasing with empty `[Unreleased]` → the release admin workflow aborts
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
