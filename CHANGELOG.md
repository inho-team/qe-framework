# Changelog

All notable user-visible changes to the QE Framework are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

**Release policy**: see `QE_CONVENTIONS.md` → Release Process.

- **PATCH** — bundled bug fixes, tweaks. Batched release (weekly or every ~5 fixes).
- **MINOR** — new skills, agents, or feature additions. Monthly cadence.
- **MAJOR** — breaking changes. Rare.
- **Hotfix patch release** (between batches) — only for security / data loss / framework-unusable regressions.

All entries should land in `[Unreleased]` until `/Mrelease` cuts a version.

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

### Security

## [7.0.0] - 2026-06-06

### Added
- 18 new hook lifecycle events — full Claude Code 27-event coverage (Setup, SessionEnd, PostToolUseFailure, SubagentStart/Stop, FileChanged, TaskCreated, PostToolBatch, PostCompact, and 9 more)
- 5 functional hook handlers: PostToolUseFailure (error streak tracking), SubagentStart/Stop (lifecycle metrics), FileChanged (ContextMemo invalidation), SessionEnd (cleanup + metrics flush)
- `effort` parameter support in SIVS config — Claude `max` and Codex `xhigh` with automatic cross-engine mapping via `effort-compat.mjs`
- Compaction API settings in svs-config.schema.json (enabled, strategy: server/client/auto)
- Skill Budget auto-management — `skill-budget.mjs` monitors token usage across 183 skills with overflow warnings at session start
- 6 harness engineering metrics: Task Resolution Rate, Code Churn, Verification Tax, Harness Constraint Effect, Defect Escape Rate, Pass@1 — collected via `metrics-collector.mjs`
- Session telemetry JSONL export via `telemetry.mjs` — daily `.qe/telemetry/` files
- Agent decision trace logger via `trace-logger.mjs` — `.qe/traces/` JSONL files
- HUD metrics summary panel (`metrics-panel.mjs`)
- Agent Teams v2 config with JSON Schema (`agent-teams.schema.json`) — 16 fields including effort, isolation, color
- Dynamic Workflows documentation (`docs/DYNAMIC_WORKFLOWS.md`)
- Cross-session memory patterns guide (`docs/CROSS_SESSION_MEMORY.md`)
- Managed Agents API adapter (`managed-agents-adapter.mjs`)
- Import System documentation (`docs/IMPORT_SYSTEM.md`)
- Upgrade guide v7 (`docs/UPGRADE_GUIDE_v7.md`)
- `Edependency-auditor` agent — dependency security/license/outdated auditing
- `Eperformance-profiler` agent — build/runtime performance profiling
- `user-prompt-expansion.mjs` — macro shortcuts (rt/gs/ar)
- `stop-failure.mjs` — abnormal termination capture with telemetry
- `config-change.mjs` — settings change detection with utopia alerting
- `task-created.mjs` — harness metrics tasksTotal increment (fixes metrics system)

### Changed
- Plugin marketplace metadata aligned to v2 spec (category, tags, compatibility, features)
- PHILOSOPHY.md: added Acknowledged Exceptions section (Qutopia SIMPLE, Qautoresearch, Retry Loop)
- PHILOSOPHY.md: expanded "Where Every Component Fits" table with v7 components
- AGENT_BASE.md: added Effort Parameter Guide (tier vs effort orthogonality)
- AGENT_TIERS.md: added tier-vs-effort section, registered Etracer, Econtract-judge, Edependency-auditor, Eperformance-profiler
- PRINCIPLES.md: unified SIMPLE criteria as pointer to Qutopia SKILL.md
- SYSTEM_OVERVIEW.md, README.ko.md, README.ja.md: updated to v7 numbers
- `Qprompt-engineer` (ai/): merged data/ version content (structured outputs, function-calling schemas)

### Fixed
- task-completed hook now auto-appends TASK_LOG, moves pending→completed, and signals archive at ≥10 completed
- task-created.mjs was a stub causing harnessMetrics.tasksTotal to always be 0 — metrics system was non-functional
- Qagent-browser and Qautoresearch had copy-paste error in invocation_trigger ("framework initialization" instead of actual purpose)
- validate_svs_config.mjs error message now dynamically lists allowed effort values
- PRINCIPLES.md outdated terminology: ultrawork/ultraqa → --work/--qa

### Removed
- `skills/coding-experts/data/Qprompt-engineer/` — duplicate of ai/ version (file name identical)

### Security

## [6.6.4] - 2026-04-24

### Fixed
- `package.json` description — corrected skill/agent counts from `167 skills and 21 agents` to actual `107 skills and 23 agents`.
- `.qe/planning/PROJECT.md` — updated from stale v4.0 SVS language to v6.6 SIVS 4-stage per D005. Added v5.x/v6.5/v6.6 milestone rows.
- `.qe/planning/ROADMAP.md` — replaced completed Qgc Phase 1 content with a thin index stub pointing to `features/<name>/ROADMAP.md`. Establishes convention that new phase work lives in feature subdirectories, not the root.
- `.qe/MISTAKE.md` — seeded empty file with placeholder header so session-start hook no longer reads a zero-content file.
- `.qe/docs/README.md` — added placeholder so session-start `Check .qe/docs/` hint points at valid content.

### Performance
- Hook hot-path latency reduction. Measured via `scripts/perf_hooks.mjs` (N=50, p50/p95, Apple M4). Changes:
  - `prompt-check.mjs` — early-exit for empty prompts before config/state I/O.
  - `pre-tool-use.mjs` — lazy `await import()` for `context-monitor`, `context-loader`, `delegation-enforcer`, `team-detect`. Read memo fast-path now skips 4 module loads.
- Representative deltas (p50): prompt-check/empty 0ms, prompt-check/plain +1ms, pre-tool-use/read-cached -1ms, pre-tool-use/bash -1ms. Full report: `.qe/perf/after.md` (gitignored).

### Added
- **Mtest-skill batch mode + verdict cache** — new `--batch <glob>` path in `skills/Mtest-skill/SKILL.md` backed by `scripts/run_mtest_skill.mjs`. The runner expands a repo-relative glob (e.g. `skills/Q*`), replays the routing workflow per SKILL.md, and prints a markdown results table to stdout (optionally mirrored via `--out`). Verdicts are memoised through `hooks/scripts/lib/mtest-cache.mjs` keyed by sha256 of the canonicalised SKILL.md content; entries live under `.qe/mtest-cache/{hash}.json` (gitignored). Content-addressed invalidation: editing a SKILL.md automatically orphans its previous entry so the next batch run re-evaluates. Single-skill invocations still bypass the cache for interactive audits. Cuts the cost of 107-skill sweeps from "always re-run everything" to "only re-run what changed".
- **Named Plan layout** — planning state moves from flat `.qe/planning/{ROADMAP,STATE,REQUIREMENTS}.md` into per-plan directories `.qe/planning/plans/{slug}/`. Multiple terminals can now run `/Qplan` in parallel without clobbering each other's state. Qplan auto-derives the slug from the task prompt (no user prompt); consumer skills resolve the active plan via session binding → `ACTIVE_PLAN` pointer → flat fallback. Legacy flat-file projects keep working unchanged.
- **Session → Plan bridge** — `hooks/scripts/session-start.mjs` writes `.qe/state/current-session.json` so model-side skills can discover their own `session_id` and bind plans to terminals. HUD `phase` element reads `session_id` from the statusline payload to resolve `{slug} · Phase N`.
- `hooks/scripts/lib/plan-resolver.mjs` — shared resolver for `resolveActivePlanSlug` / `resolveStatePath` / `resolveRoadmapPath` with strict slug validation against path traversal.
- Qcritical-review: integrate OMC 9-step protocol (Pre-commitment / Multi-perspective / Pre-Mortem / Ambiguity Scan / Devil's Advocate / Self-audit / Realist / Adversarial / Gap Analysis) — adapted from oh-my-claudecode (MIT)
- Etracer agent: evidence-based causal trace lane (Observation/Inference separation, 6-tier evidence, ≥2 hypotheses, disconfirmation, next probe) — adapted from oh-my-claudecode (MIT)
- Safety hooks: post-tool-failure-guard (5-retry alternative-approach prompt), persistence-safety (max iterations + stale guard), context-guard (75/95% threshold + MAX_BLOCKS=2) — adapted from oh-my-claudecode (MIT)
- **HUD element architecture** — `hud-renderer.mjs` split into `hud/elements/*.mjs` (context, rate-limits, model, tokens, sivs, phase, task, model-ratio) + a preset-driven composer. Adding a new HUD element is now a single file + one preset edit.
- **Qhud `--preset <name>` flag** — pick element ordering at install time. Presets: `session` (default, v6.6.3 shape), `focused` (ctx/phase/task/sivs), `qe` (planning-layer only), `mix` (includes model-ratio), `full` (everything).
- **New HUD element: `phase`** — reads `.qe/planning/STATE.md` and surfaces the current Active Phase (e.g., `P: Phase 1`). Renders nothing when idle.
- **New HUD element: `task`** — reads the most-recent pending `TASK_REQUEST_*.md` and surfaces its UUID + title (e.g., `T: abc12345 Build landing page`). Renders nothing when no pending tasks.
- **New HUD element: `model-ratio`** — session-wide token distribution across Opus / Sonnet / Haiku / Codex that sums to exactly 100 (e.g., `O:42·S:31·H:12·X:15`). Reads the JSONL transcript at `data.transcript_path`, buckets by `message.model`; Claude turns invoking codex tool_use (`mcp__codex*` / `codex:rescue`) go into the `X` bucket as a delegation-cost proxy.

### Changed
- `hooks/scripts/lib/hud-renderer.mjs` is now a compatibility shim that re-exports the old public surface (`safe`, `formatTokens`, `pickContextUsed`, `pickRateLimits`, `pickModelName`, `pickSessionTokens`, `renderSivsLetters`, `renderHud`). New code should import from `hud/renderer.mjs` + individual elements.
- `formatTokens` now uses capital `M` for millions (`1.5M`) and promotes `999_500+` to `M` to avoid rendering `1000k`.
- **11 skill descriptions tuned with branch-point clarifications** (Phase 3 audit HIGH items) — design cluster (Qdesign, Qdesign-audit, Qdesign-studio, Qfrontend-design, Qvisual-qa, Qvisual-redesign, Qweb-design-guidelines) and task-exec cluster (Qrun-task, Qcode-run-task, Qatomic-run, Qrt). Each description now names sibling skills and states "use THIS when X / use Y when Z" so LLM-driven routing can disambiguate the overlapping "design" / "task" / "review" keyword clusters. Local replay (`run_mtest_skill.mjs`) score unchanged (it reads `triggers`/`keywords`, not `description`); LLM-driven re-measurement tracked separately. Before/after per-skill detail: `.qe/audit/high-priority-applied.md` (gitignored).

### Removed

### Security

### Audit
- **Skill Surface Audit (Framework Optimization P3, task `adbbd672`)** — static routing simulation run against all 106 skills via the `Mtest-skill` algorithm; baseline accuracy **29%** (105/359 prompts), **40 skills unregistered** in `intent-routes.json`, **95 skills below 80%** accuracy. Top confusion clusters: Design (7 skills), Task-exec (4 skills), Perspective (3 skills). Details + recommendations in `.qe/audit/RECOMMENDATIONS.md` (gitignored). Follow-up implementation tracked as a separate decimal phase.

## [6.6.3] - 2026-04-24

### Added
- `CHANGELOG.md` + `/Mrelease` skill establishing batched release workflow. Commits now accumulate entries under `[Unreleased]`; release is a deliberate action, not a per-commit side effect.
- **Qhelp Mode B** — `/Qhelp {skillName}` reads the target skill's SKILL.md and generates a 4-section summary (Summary / When to use / What it does / Usage) in the user's language. Uses `.qe/profile/language.md` for locale detection.
- **Universal `--help` flag** — typing `/Qxxx --help` or `/Qxxx -h` for any Q- or M-prefix skill is detected in the prompt-check hook and routed to `/Qhelp {skillName}`. Backed by `hooks/scripts/lib/help-flag-parser.mjs`.
- **Qhud Phase 2** — HUD now displays Anthropic rate-limit usage (`5h` / `7d`) and model label (`Opus`/`Sonnet`/`Haiku`), plus an ANSI-sanitizing `safe()` helper that strips escape sequences from untrusted payload fields before emission.

### Changed
- Mbump is now a sub-step of `/Mrelease`; direct `/Mbump` invocation still works for explicit overrides but is no longer the recommended release path.
- **Qhud** — context percentage now displays *used* (e.g. `ctx 16%`) instead of *remaining*. Color thresholds: green `<50`, yellow `50–80`, red `≥80`. Inverse of prior behavior; matches common "capacity used" UX.
- **Qhud** — SIVS routing always renders as 4-letter `C/C/C/C` (spec/implement/verify/supervise, `C=claude X=codex`). The previous "claude" compact label for all-Claude configs is removed in favor of stable positional display.
- **Internal API rename** in `hooks/scripts/lib/hud-renderer.mjs`: `pickContextRemaining()` → `pickContextUsed()` (return semantics inverted). Hook-internal lib; no external callers known.

## [6.6.2] - 2026-04-24

### Added
- QE HUD statusline primitive (`Qhud`, `hud-renderer.mjs`, `statusline.mjs`).

### Fixed
- `comment-checker` JSDoc walk — dynamic lookback replaces fixed 5-line window so long JSDoc blocks (8+ lines) no longer trigger false "undocumented" warnings.

## [6.6.1] - 2026-04-24

### Fixed
- `slider-parser.applyValues` — digit-boundary lookaround replaces `\b` word boundary so `padding: 32px` → `padding: 48px` now rewrites correctly inside unit suffixes.
- `design-scanner` — tailwind `fontFamily: ['Inter', 'sans-serif']` arrays no longer truncate at the first comma.
- `artifact-dispatcher` — added implicit UI keywords (`landing page`, `page`, `component`, `dashboard`, `페이지`, etc.) so multi-artifact briefs like "pitch deck and the landing page" return `['code', 'deck']`. Leading word-boundary match prevents substring false positives (`ui` no longer matches inside `build`).

## [6.6.0] - 2026-04-24

### Added — Design Skills Upgrade (Claude Design parity+)
- **Phase 1 — Foundation**: `design-scanner.mjs` (`/Qdesign --scan` auto-bootstraps DESIGN.md from tailwind config + component className scan), `canvas-preview.mjs` (`/Qfrontend-design --canvas` live browser render via playwright MCP, claude-in-chrome fallback).
- **Phase 2 — Iteration Primitives**: `slider-parser.mjs` (markdown slider syntax for tunable tokens), `inline-comment-parser.mjs` (`<!-- claude: ... -->` directive pickup on skill re-invocation), `/Qvisual-redesign --tune` mode for interactive UI token editing.
- **Phase 3 — Unified Studio**: `/Qdesign-studio` orchestrator (one brief → code + deck + doc + mockup + prototype), `artifact-dispatcher.mjs` keyword-based artifact routing, `/Qfrontend-design --prototype` 1-file HTML sketch mode.
- 77 new unit tests, 249/249 total green.

## [6.5.0] - 2026-04-23

### Added — Contract Layer v1
- `/Qcontract`, `/Qverify-contract`, `Econtract-judge` agent, `.qe/contracts/` structure.
- 14 initial contracts approved and locked.

### Changed
- Naming 7-principle framework expanded in `core/rules/naming.md`.

## [5.x] - 2026-04-05

### Added — SIVS 4-stage migration
- Split SVS (3-stage) into SIVS (Spec-Implement-Verify-Supervise 4-stage).
- codex-plugin-cc bridge for optional Codex engine routing per stage.
- Decision log entries D001–D005 documenting the rationale.

### Removed
- Direct Gemini / GPT provider integrations (D001).
- All `~/.codex/` installation logic (D004).

## [4.0] - 2026-04-04

### Added — Claude-first baseline
- Strip/Bridge/Polish initiative establishing Claude-only core with optional plugin bridge.

---

**Older history** prior to v4.0 lived in previous planning artifacts and is not reconstructed here; see `.qe/planning/DECISION_LOG.md` and git history for context.
