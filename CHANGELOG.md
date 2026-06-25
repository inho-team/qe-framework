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

- `Qqa-council` keyword routing — the new skill was absent from
  `hooks/scripts/lib/intent-routes.json`, so QA-council intent prompts ("run an AI QA
  council", "set up a PR QA bot", "exploratory + regression QA") produced HIGH-confidence
  hints pointing at the wrong skills (Qcode-run-task / Qqa-test-planner / Qissue). Added a
  dedicated route `qa-council/exploratory-qa/pr-qa-bot → Qqa-council` with keywords chosen
  not to collide with Qqa-test-planner's `QA-plan/regression-test`. Mtest-skill routing
  sim: 5/5 council prompts now route correctly, Qqa-test-planner regression-test prompts
  unchanged (score 139–151 ≫ council).

### Removed

### Security

## [7.2.7] - 2026-06-25

### Added

- `Qqa-council` — multi-agent QA orchestrator skill. Runs a role-separated, bounded-agent
  QA loop over a live web app: Planner designs scenarios, Explorer black-box explores for
  bugs (browser-only, no source access), Generator codifies stable flows into Playwright
  regression tests, Healer reproduces and patches failures, Reporter aggregates findings
  into a single PR comment. Reuses existing skills (`Qqa-test-planner`, `Qplaywright-expert`,
  `Eqa-orchestrator`) for non-novel roles. Includes a PR-trigger GitHub Actions scaffold
  (`reference/github-actions.md`) where Explorer's black-box boundary is hard-enforced via
  `--allowedTools`, and parametrized multitenancy/RBAC/audit-log guardrail scenario templates
  (`reference/guardrails.md`). Safety gates block production/real-PII runs and auto-merge.
- `Eqa-explorer` — black-box exploratory UI tester agent (tools: Bash, Write only; no source
  read). Probes bad input, boundary values, auth/permission edges, responsive breakpoints, and
  guardrail scenarios against a live URL; returns a structured findings list.
- `Eqa-reporter` — QA findings reporter agent (tools: Read, Bash). Aggregates explore/regress/
  heal results into one report and posts a single PR comment via `gh`; comment-only, never
  merges or pushes.

### Changed

### Fixed

- `Mrelease` Step 6 (plugin cache sync) now mandates a destination guard before the
  `rsync --delete`. The cache `installPath` lives nested under `.plugins[...]` in
  `installed_plugins.json`, not at the root; a wrong extraction yielded an empty
  variable, so `rsync -a --delete ./ "$CACHE/"` expanded to `rsync ... ./ /` and
  tried to mirror the repo onto the filesystem root (blocked here only by macOS
  read-only-system-volume + non-root permissions). Step 6 now spells out the full
  lookup path and requires three checks — non-empty, expected `~/.claude/plugins/
  cache/...` prefix, and directory-exists — aborting the release if any fail.

- `Qmermaid-diagrams` and `Qc4-architecture` no longer link to a `references/`
  directory that was never shipped. Both SKILL.md files pointed to deep-dive docs
  (`references/class-diagrams.md`, `references/c4-syntax.md`, … 10 links total) that
  did not exist, so the "Detailed References" / "References" sections were entirely
  dead links. The mermaid section is now an inline link-free topic quick-reference
  (its descriptions stand on their own); the C4 section, whose entries were too thin
  to keep without the linked files, was removed. A full skill/agent audit (182 skills
  + 25 agents) found these were the only broken local references.

### Removed

### Security

## [7.2.6] - 2026-06-24

### Fixed

- Context pressure false alarm on 1M-context models: the durable detected-limit
  store now matches model-id keys marker-insensitively. Claude Code strips the
  `[1m]` window marker from both the hooks payload and the transcript model
  field, but a human (or the env-visible id) keeps it — so a `context_window_limits`
  key set as `claude-opus-4-8[1m]` silently failed the stripped `claude-opus-4-8`
  lookup, leaving a 1M run scored against the 200k default and over-warning at
  ~90%+. `readDetectedLimit`/`writeDetectedLimit` now normalize keys (and collapse
  marker variants into the canonical stripped key), and `resolveLimit` takes the
  larger of the hook-hint and transcript model ids so a stripped id can no longer
  shadow a marked sibling source. New `normalizeModelId()` helper + tests.

- Skill bootstrap snippets no longer crash when `CLAUDE_PLUGIN_ROOT` is unset.
  v7.2.5 switched the inline `node -e` resolvers in `Qresume`, `Qmigrate-legacy`,
  `Qinit`, `QCodexUpdate`, and `Qcritical-review` to
  `CLAUDE_PLUGIN_ROOT || ~/.claude`, but in any session where the env var is
  absent the fallback resolved `~/.claude/hooks/scripts/lib/...` — a stale partial
  copy from an old global install that lacks `session-resolver.mjs` and 40+ other
  lib files — so every one of those skills died with `ERR_MODULE_NOT_FOUND` in
  installed user projects. The fallback now probes real plugin install locations
  in order (`CLAUDE_PLUGIN_ROOT` → marketplace checkout → newest version cache →
  legacy `~/.claude`) and picks the first that actually contains
  `session-resolver.mjs`, so the stale copy is skipped.

## [7.2.5] - 2026-06-23

### Fixed

- Skills now resolve framework-only scripts from the plugin root (`CLAUDE_PLUGIN_ROOT`) instead of the project cwd. `Qinit` and `QCodexUpdate` no longer call `npm run qe:validate` (which only exists in the framework repo and fails in every target project); `Qresume` and `Qmigrate-legacy` no longer import `./hooks/...` via project-relative paths. These ran correctly only inside the framework repo and broke in installed user projects.

## [7.2.4] - 2026-06-23

### Fixed

- **`npm run qe:mcp` and `npm run qe:secret` no longer crash on load.** `qe_mcp_registry.mjs` and `qe_secrets.mjs` still imported `readJsonFile`/`writeJsonFile` from `ai_team_config.mjs`, which was removed in the v4.0.0 Claude-only refactor — so both CLIs (and the `Qmcp-sync` / `Qsecret` skills behind them) died with `ERR_MODULE_NOT_FOUND` before doing anything. Restored the two helpers in a new `scripts/lib/json-io.mjs` (byte-identical to the originals) and repointed both imports. Added a `check-entrypoints` guard (run by `check:all`) that loads every CLI entrypoint and lib so a dangling import can never ship green again — the gap that let this regress unnoticed.
- **Qcron daemon now actually runs.** `qcron-daemon.sh` invoked `claude "$MISSION"` with no `-p`, so in a TTY-less detached tmux pane it opened an interactive REPL and hung forever — the mission never ran and the loop never slept. The daemon now runs `claude -p --dangerously-skip-permissions`, resolves the `claude` binary to an absolute path (detached tmux PATH differs from the shell's), generates a dedicated per-job script under `scripts/qcron-jobs/` (correct per-cycle timestamps + no nested-quote breakage), reads the mission from a file (quote-safe, written owner-only `chmod 600`), captures output to the job log, and writes a heartbeat each cycle. Generated job/mission artifacts are gitignored.

## [7.2.3] - 2026-06-22

### Fixed

- **Qcompact ↔ Qresume resume path unified**: a manual `/Qcompact` handoff saves under `.qe/handoffs/sessions/{sid}/`, but `/Qresume` only scanned `.qe/context/sessions/{sid}/`, so a later session could not find the handoff it had just written. Resume now resolves through a single shared `resolveResumeContext()` (`hooks/scripts/lib/session-resolver.mjs`) that both skills cite; `listSessionBuckets()` unions the context and handoff domains so handoff-only buckets surface in `--list`; and a lone `compact-trigger.json` no longer suppresses fallback to a real handoff stored under a prior sid.
- **Qwiki library hardened** against path-traversal and routing edge cases in `scripts/lib/wiki-router.mjs` and related wiki paths.
- Stale HUD tests repaired after the `wiki` element landed: the renderer `ELEMENTS` registry is now exported and the preset guard derives its known-element set from it (so a new element can no longer silently break the guard), and the session-render assertion checks element order and content rather than exact progress-bar glyphs.

## [7.2.2] - 2026-06-22

### Added

- `Qmcp-setup`: added Playwright (`@playwright/mcp`) and Chrome DevTools (`chrome-devtools-mcp`) browser servers to the recommended-MCP catalog, fixing the previously dangling `/Qmcp-setup playwright` reference in `Qvisual-redesign`.
- **Qwiki — project knowledge wiki** (Karpathy LLM-Wiki pattern over `.qe/wiki/`): new skills `Qwiki-ingest` / `Qwiki-compile` / `Qwiki-query` / `Qwiki-lint`, a zero-dep canonicalization+sharding authority (`scripts/lib/wiki-router.mjs`), page templates + conventions seed (`core/wiki-conventions.template.md`, `core/wiki-templates/`), an opt-in HUD `wiki` preset, a SessionStart inbox-queue notice, and a usage guide (`docs/QWIKI.md`). Synthesize-once/accumulate knowledge with provenance + intent-routing; commits go through Qcommit only; compile/query/lint are Claude-only. Boundary vs Qmemory/Qcontext/`.qe/analysis` recorded in DECISION_LOG D-WIKI-02.
- **Qwiki knowledge flywheel** (DECISION_LOG D-WIKI-03): the wiki now feeds AI judgment and compounds. **Consume** — `scripts/lib/wiki-retrieve.mjs` routes minimal relevant pages into the core PSE skills (Qplan/Qgs/Qrun-task/Qcode-run-task/Qutopia) and an opt-in UserPromptSubmit hint; tier-aware (reviewed > auto) with `flag:contradiction` exclusion. **Populate** — `scripts/lib/wiki-seed.mjs` + Qinit opt-in bootstrap seed DECISION_LOG/MISTAKE/RETROSPECTIVE as `provenance: inferred` (Socratic-gated, never `--batch`); analysis & query-filebacks excluded to prevent self-ingestion. **Govern** — `scripts/lib/wiki-freshness.mjs` + Qwiki-lint CHECK 8 detect code↔wiki drift via `.qe/analysis` mtime. All paths are **zero-impact when `.qe/wiki/` is absent** (existing behavior byte-identical).

### Changed

### Fixed

### Removed

### Security

## [7.2.1] - 2026-06-20

### Added

- `Qatomic-run`: opt-in `--worktree` flag runs each parallel Haiku teammate in an isolated git worktree, plus a scale-aware brainstorming gate at `Qgs` Step 1.5 and a skill eval harness (structure-deterministic checks with opt-in behavioral LLM-judge).
- Metadata drift gate with hardened lifecycle hooks: a single source of truth for skill/agent metadata, validated by `sync:metadata` and enforced in CI.
- Enforced safety rails for autonomous (`Qutopia`) mode at the hook level — push and sensitive-write actions stay gated even with confirmations skipped; inactive mode has no effect.
- Previewable, reversible plugin install: `--dry-run`, automatic backups, `restore`, and a `doctor` self-check.
- Skill tiering — 7 core skills tagged with tier metadata for progressive disclosure.

### Changed

- `sweep-analyzer`: two-tier age policy for incomplete pending tasks — warn (stale report) after 30 days, auto-archive the task/checklist pair (recoverable) after 60 days, so stale pending no longer accumulates indefinitely.
- Commit bypass flag hardened: TTL widened 60s → 120s and the flag must be written in its own Bash call immediately before the gated `git commit` (the PreToolUse hook reads it from disk before the command runs, so a same-call flag is blocked). `Ecommit-executor` docs updated to match.
- `core/OUTPUT_STYLE.md`: answer skeleton corrected and rendered consistently; prefer plain words over uncommon English transliterations.
- Dropped an unverified token-savings claim from the skill-tiering docs.

### Fixed

- Hooks now read stdin from fd 0 for CI portability.
- Stopped false context-pressure alarms on 1M-window models.
- Hardened the cross-reference regex against sub-path and URL false positives.

### Removed

### Security

## [7.2.0] - 2026-06-15

### Added

- `coverage-check.mjs`: a TASK_REQUEST→VERIFY_CHECKLIST output-coverage validator. Each TASK_REQUEST checklist item declares its artifacts via a `→ output:` trailer; the validator flags "orphan" outputs that are declared but never referenced in the paired VERIFY_CHECKLIST. Matching is tiered for prose checklists (full path = verified, basename/stem = weak, none = orphan) with generic filenames excluded. Exposes pure functions plus a CLI (`<uuid>` / `--all` / `--task --verify`); `--all` exits non-zero on orphans for CI use.

### Changed

- `core/OUTPUT_STYLE.md`: added a summary "delta test" — every line of a closing summary must carry a step not already in the body (what to do, what's at risk, what was decided), with `❌`/`✅` examples and a new self-check item. Body-restating summary lines are now explicitly banned.

## [7.1.6] - 2026-06-15

### Added

- HUD context element now renders a `[███░░░░] N%` gauge bar alongside the percentage, tinted by usage threshold.

### Changed

- `core/OUTPUT_STYLE.md` reworked for clarity: added a top-priority **Tier 0 (clarity over rule-compliance)** principle, density-control rules (one idea per line, single ★ per answer), a stream-of-consciousness ban, and good/bad (`❌`/`✅`) examples for every rule.

### Fixed

- False context-pressure warnings after `/clear` or `/compact`. The statusline now reconciles a stale Claude Code payload percentage against the transcript ground truth (deflate-only via `reconcileDisplayPercentage`), and session start invalidates the stale project-global ratio cache (`invalidateCachedRatio`) while preserving the model-constant window limit.

## [7.1.5] - 2026-06-14

### Fixed
- **False context-pressure warnings on 1M-context runs without the HUD statusline** — the 1M-tier detection added in 7.1.1/7.1.2 (`deriveContextLimit` back-solve) only runs inside `statusline.mjs`, so when the HUD statusline is **not** configured, `.qe/state/context-cache.json` is never written. With no cache, `context-guard` (Stop) and `context-monitor` (PreToolUse) fall back to transcript estimation, where the model id arrives stripped of its `[1m]` marker (e.g. `claude-opus-4-8`) → `modelIdToLimit` → 200k. A 1M session was therefore scored against a 200k denominator and falsely flagged WARNING from ~140k tokens (≈14% of its real window). Fixed by adding a statusline-independent override, `readConfiguredLimit()`, read by both hooks: `QE_CONTEXT_LIMIT` env var, then `.qe/config.json → hooks.context_window_limit`. Set `{ "hooks": { "context_window_limit": 1000000 } }` to score correctly with no HUD.
- **`writeCachedRatio` clobbered the TTL-exempt window limit** — the function overwrites the whole cache file, so any statusline redraw frame where `deriveContextLimit` returned null (e.g. `total_input_tokens` momentarily absent) dropped a previously persisted `limit`, reopening the sub-200k 1M blind spot. It now reads and preserves the existing limit when a fresh one isn't supplied.
- **`addMemory({priority:"permanent"})` no longer silently expires after 7 days** (#6) — `TTL_MAP.permanent` is `null` (the no-expiry sentinel), but `const ttl = TTL_MAP[priority] ?? TTL_MAP.normal` treated that `null` as "missing" and fell back to the 7-day `normal` TTL, so memories deliberately marked permanent were pruned by `getActiveMemories()`/`pruneExpired()` after a week. Switched to key-presence (`priority in TTL_MAP ? TTL_MAP[priority] : TTL_MAP.normal`) so the sentinel survives. Added `hooks/scripts/lib/__tests__/project-memory.test.mjs` covering permanent/high/normal/low/default/unknown TTL assignment.

## [7.1.4] - 2026-06-14

### Fixed
- **Codex auto-detection no longer fails on plugin installs (Windows especially)** (#8) — the `Qinit` and `Qcritical-review` skills resolved `codex_bridge.mjs` from a hardcoded `$HOME/.claude/scripts/lib/` base and passed the raw path straight to `import()`. On plugin installs the bridge lives under `$CLAUDE_PLUGIN_ROOT/scripts/lib/`, so the `$HOME` fallback was missing (and on Windows `$HOME` is unset / the ESM loader rejects non-`file://` paths), surfacing as `ERR_MODULE_NOT_FOUND` and Codex being reported unavailable even when the `openai-codex` plugin and `codex` CLI were installed. All three detection one-liners now resolve `CLAUDE_PLUGIN_ROOT` first (falling back to `$HOME`/`USERPROFILE`/.claude) and load the module via `pathToFileURL(...).href`.

## [7.1.3] - 2026-06-14

### Fixed
- **`Qupdate` tarball path no longer fails on a hardcoded version** — the preferred update flow installed `./inho-team-qe-framework-3.0.27.tgz`, a stale literal that never matches the real `npm pack` output (e.g. `…-7.1.2.tgz`), so the global install aborted with `ENOENT`. The filename is now derived from `package.json` at runtime (`VER=$(node -p "require('./package.json').version")`). Added a Step 0 pre-flight that compares local vs `origin` versions and falls back to `node install.js` when a freshly cut release hasn't been pushed (the `Mrelease` skip-push case), plus the `git fetch/show/pull` allowed-tools needed to run it.

## [7.1.2] - 2026-06-13

### Added
- **Response style contract (`core/OUTPUT_STYLE.md`)** — a single source of truth for how every user-facing answer is shaped: conclusion-first (결론→근거), fact/guess separation (사실/추정), a named recommended option with its trade-off, and source-doc paths under "참고 문서". Tier 1 rules always apply; Tier 2 rules (comparison tables, cause trees, ★ evidence-level, worked examples) fire only on explicit triggers. The contract is injected at session start and re-asserted post-compact, and the user-facing report agents (`Ecode-reviewer`, `Edeep-researcher`, `Esupervision-orchestrator`) now reference it.
- **Override Map injected at session start** — `session-start.mjs` now reads the `## Preferred Skill Map` section out of `QE_CONVENTIONS.md` and injects it in full (framed as a hard requirement) instead of a soft one-line hint. Claude now knows the git-commit→`Qcommit` / version-bump→`Mbump` routing up front, rather than discovering it only when the `PreToolUse` hook hard-blocks a direct attempt.
- **Routing/safety check scripts** — `scripts/check-all.mjs` and `scripts/check-skill-routing.mjs`, plus new `safety-hooks` regression tests under `hooks/scripts/lib/__tests__/`.

### Changed
- **`Mbump` / `Mrelease` now update `marketplace.json` too** — the nested `version` field inside the `qe-framework` entry under `plugins[]` is the source the marketplace clone reads. It was previously left out of version bumps, so the marketplace version drifted behind `plugin.json` / `package.json` (it was still on `7.0.0`). Both skills now treat it as the third manifest, and this release re-syncs it.
- **Model-aware context metering** — `context-monitor` / `context-guard` now read and cache the true context-window limit (`readCachedLimit` / `writeCachedLimit` in `context-meter.mjs`) and pass it through `estimateUsage`, so 1M-context runs keep the correct denominator across hook invocations.

## [7.1.1] - 2026-06-11

### Fixed
- **Context pressure false alarms on 1M-context models** — the HUD (sourced from Claude Code's authoritative reading) correctly showed ~20% while `context-monitor`/`context-guard` warned at ~84% for the same session. When the cached ratio went stale and Claude Code had stripped the `[1m]` marker from the model id, the transcript fallback divided live tokens by the 200k default (e.g. 168k/200k = 84%) instead of the true 1M window. The statusline now back-solves the real window limit (`total_input_tokens / used_percentage`) and persists it alongside the ratio, so the fallback in both hooks keeps the correct denominator (168k/1M ≈ 17%) even after the cache expires. New `deriveContextLimit()` / `readCachedLimit()` helpers in `context-meter.mjs`, plus regression coverage.

## [7.1.0] - 2026-06-11

### Added
- **Qplan goal ledger** — ports the durable half of oh-my-claudecode's `ultragoal` into Qplan. Each plan now carries an append-only `ledger.jsonl` (created/started/checkpoint/blocker/failed events) plus an ordered `goals.json` (microgoals with attempt counts) under `.qe/planning/plans/{slug}/`, derived from the ROADMAP Waves. `STATE.md`'s progress block is now auto-rendered from the ledger instead of hand-maintained. New helper `hooks/scripts/lib/ledger.mjs` (`create-goals`/`append`/`render-state`/`status`) reuses existing atomic-write and jsonl-append infra — zero new dependencies.

## [7.0.2] - 2026-06-06

### Added
- PHILOSOPHY.md Obligation 6: Ground truth over self-assessment — prefer external execution over self-review
- PHILOSOPHY.md Obligation 7: Verify research before planning — test claims against real system
- Qcode-run-task Step 4.85: Smoke Test Gate — run actual code before declaring PASS
- Qcode-run-task Step 4.86: Native Verification Alternatives — /goal and ultrareview guidance
- Qgenerate-spec Step 2.4: Premise Verification — verify external features exist before speccing
- Qplan Research Validation — test research claims via Bash before incorporating into plans
- Qplan Workflow scale level — suggest dynamic workflows for massive tasks (10+ files)
- Adaptive Harness Principle in PHILOSOPHY.md — native features over PSE when appropriate
- `docs/CLAUDE_CODE_FEATURES.md` — verified feature reference for /goal, /workflows, ultrareview, agents
- Dynamic Workflow Escalation in Qutopia — auto-suggest workflows for large tasks
- `Edependency-auditor` agent — dependency security/license/outdated auditing
- `Eperformance-profiler` agent — build/runtime performance profiling
- Skill Budget monitoring via `skill-budget.mjs` with SessionStart overflow warning
- Harness metrics (6 metrics) via `metrics-collector.mjs`, telemetry JSONL, trace logger, HUD panel
- `effort-compat.mjs` — budget_tokens to effort mapping with Claude/Codex cross-engine translation
- SIVS config schema: effort `max` value, compaction settings
- Plugin marketplace metadata v2 alignment (category, tags, compatibility, features)

### Changed
- PHILOSOPHY.md: added Acknowledged Exceptions (Qutopia SIMPLE, Qautoresearch, Retry Loop)
- PHILOSOPHY.md: expanded "Where Every Component Fits" table with v7 components
- AGENT_BASE.md: added Effort Parameter Guide (tier vs effort orthogonality)
- AGENT_TIERS.md: added tier-vs-effort section, registered 4 new agents
- PRINCIPLES.md: unified SIMPLE criteria as pointer to Qutopia SKILL.md
- Qprompt-engineer (ai/): merged data/ version content (structured outputs, function-calling)
- Qrag-architect (data/): merged ai/Qrag-pipeline content (pipeline, chunking strategies)
- Qcsharp-developer: merged backend/Qdotnet-core-expert content (AOT, clean architecture)
- Qweb-design-guidelines: merged frontend/Qweb-design-guidelines-vercel content

### Fixed
- Qagent-browser and Qautoresearch invocation_trigger copy-paste error
- validate_svs_config.mjs error message now dynamically lists allowed effort values
- PRINCIPLES.md outdated terminology: ultrawork/ultraqa → --work/--qa

### Removed
- `skills/Qrt/` — deprecated pass-through alias for Qrun-task
- `skills/coding-experts/data/Qprompt-engineer/` — duplicate of ai/ version
- `skills/coding-experts/ai/Qrag-pipeline/` — merged into data/Qrag-architect
- `skills/coding-experts/backend/Qdotnet-core-expert/` — merged into languages/Qcsharp-developer
- `skills/coding-experts/frontend/Qweb-design-guidelines-vercel/` — merged into top-level Qweb-design-guidelines
- 18 unsupported hook handler files and 6 test files (v7.0.0 → v7.0.1 hotfix)
- Speculative modules: managed-agents, agent-teams schema, Dynamic Workflows doc (v7.0.1 hotfix)

### Security

## [7.0.1] - 2026-06-06

### Fixed
- Removed 18 unsupported hook events that caused plugin installation failure
- Removed speculative modules (managed-agents, agent-teams schema, Dynamic Workflows)
- Corrected all "27 events" references to actual 9 supported events

### Added

### Changed

### Fixed

### Removed

### Security

## [7.0.0] - 2026-06-06

### Added
- `effort` parameter support in SIVS config — Claude `max` and Codex `xhigh` with automatic cross-engine mapping via `effort-compat.mjs`
- Compaction API settings in svs-config.schema.json (enabled, strategy: server/client/auto)
- Skill Budget auto-management — `skill-budget.mjs` monitors token usage across 183 skills with overflow warnings at session start
- 6 harness engineering metrics: Task Resolution Rate, Code Churn, Verification Tax, Harness Constraint Effect, Defect Escape Rate, Pass@1 — collected via `metrics-collector.mjs`
- Session telemetry JSONL export via `telemetry.mjs` — daily `.qe/telemetry/` files
- Agent decision trace logger via `trace-logger.mjs` — `.qe/traces/` JSONL files
- HUD metrics summary panel (`metrics-panel.mjs`)
- Agent Teams v2 config with JSON Schema (`agent-teams.schema.json`) — 16 fields including effort, isolation, color
- Import System documentation (`docs/IMPORT_SYSTEM.md`)
- Upgrade guide v7 (`docs/UPGRADE_GUIDE_v7.md`)
- `Edependency-auditor` agent — dependency security/license/outdated auditing
- `Eperformance-profiler` agent — build/runtime performance profiling

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
