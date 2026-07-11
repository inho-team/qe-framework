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

- **Goal Satisfaction Report** (`ledger.mjs phase-report --slug S --phase N` +
  `scripts/check-phase-report.mjs`). Generates a four-axis reconciliation report
  at `.qe/planning/plans/{slug}/reports/PHASE_{N}_REPORT.md` that aligns
  ROADMAP goal/requirements, REQUIREMENTS DoD targets (numeric-comparable vs
  qualitative classification), goals.json statuses, DECISION_LOG relevant
  decisions, and `measurement` ledger events in one auditable document.
  Conservative numeric-target extraction: a DoD is numeric-comparable only when
  exactly one isolated `<comparator><number>[unit]` token appears — ranges,
  arrow multi-values, and multi-number baseline noise classify as `unmeasurable`
  (no first-number grab, no fabrication). Verdicts: `met` (measured satisfies
  numeric target) | `deferred` (cites DECISION_LOG decision ID) |
  `unmeasurable` (qualitative/multi-value DoD or absent measurement) | `unknown`.
  Deferred-check takes precedence over numeric comparison. Status desync
  (goals.json all-pending + zero ledger lifecycle events) surfaces as
  `achievement=UNVERIFIED` with a provenance caveat — never asserts "shipped"
  from unread sources. `EVENT_ENUM` gains `'measurement'` for future measured
  evidence recording; all existing commands and enum values unchanged.
  Backfill-safe: all error paths exit 0 (missing/malformed sources degrade only
  that row; no exit 1 from the phase-report dispatch path). `phaseNum` validated
  `^\d+$` (rejects path traversal). Wired into Qplan Step 4 (Post-Execution) to
  require report review before phase transition; `core/RETROSPECTIVE_TEMPLATE.md`
  added with phase-report attachment and achievement summary sections.
  Dogfood: Phase 1-3 reports for `sivs-gate-consolidation` generated against
  the live plan — R003/R004=deferred (D-c0127487-1), R010=unmeasurable
  (qualitative), achievement=UNVERIFIED (desync exposed, not hidden).

- **SIVS loop-safety limits** (`hooks/scripts/lib/loop-guard.mjs` +
  `scripts/check-loop-guard.mjs`). Caps the previously-unbounded FAIL recursion:
  the remediation-round limit (3) is now enforced **deterministically** by the
  PreToolUse hook, which intercepts `REMEDIATION_REQUEST_{UUID}_{N}.md` writes and
  hard-blocks a 4th round with a user-escalation handoff; the backward-routing
  depth limit (5, `QE_SIVS_DEPTH_LIMIT` override) is code-computed and enforced by
  the Verify/Supervise gate protocols. Per-UUID counters live in
  `unified-state.json`; loop-scoped-corrupt state fails closed (that UUID's
  remediation only, with a `/Qdoctor` repair path — never wedges the session),
  a session-start sweep clears abandoned counters keyed on last activity (an active
  at-limit run is preserved), and Qdoctor surfaces the loop budget before it is
  exhausted. Enforcement layering recorded in DECISION_LOG D-5033dbc3-1.
- **Enforced-but-silent device guard** (`scripts/check-enforced-devices.mjs`,
  auto-discovered by `check-all`). Warning-only health check that flags a savings
  device declared "Enforced" whose activity counters are still zero after
  `tool_calls ≥ 50`. Reads only `{cwd}/.qe/state/unified-state.json`; missing/
  corrupt/fresh state grace-skips; never fails the build. Device→counter mapping
  is a code constant, documented in `skills/Qdoctor/SKILL.md`.
- **Skill front-matter guard** (`scripts/check-skill-frontmatter.mjs`,
  auto-discovered by `check-all`). Verifies every `skills/<Name>/SKILL.md` has a
  YAML front matter block with non-empty `name`/`description`, a `name` matching
  its directory, and no duplicate skill names across directories. Directory-only
  scan (plain files like `skills/CATALOG.md` are ignored). Manual line parsing,
  no YAML dependency (quoted scalars like `name: "Foo"` normalized), read-only.
  Supports `--warn-only` for soft launches.
- **Verify→Supervise findings pipeline** (`hooks/scripts/lib/findings-ledger.mjs`
  + `scripts/check-findings-pipeline.mjs`). Verify-stage findings persist to an
  append-only `.qe/agent-results/verify-findings-{UUID}.jsonl` stream so the
  Supervise gate reuses them (skips re-running `Ecode-reviewer`/`Ecode-test-engineer`
  on files unchanged since Verify) instead of re-analyzing the same diff — the
  real cross-stage duplication. A canonical fold (terminal precedence
  escalated > waived > resolved; no terminal → open) yields one record per finding;
  the auto-discovered guard enforces that no downgraded finding silently vanishes
  (every finding ends at exactly one terminal with a recorded reason). Supervise
  call budget documented: 6–7 → 4–5 (≤4 when no security audit). Gate protocols,
  `Esupervision-orchestrator`, and `Erisk-proof-auditor` updated with the
  consume/skip/enum-mapping rules; user command surface unchanged.

### Fixed

- **ContextMemo (Minimal I/O) now actually records and blocks.** The `PostToolUse`
  matcher excluded `Read`, so `updateContextMemo` never ran and no redundant read
  was ever blocked (`memo.files` stayed empty, `blocked_reads` stayed 0). `Read` is
  now wired into the matcher (`hooks.json` + `plugin.json`). Added mtime-based cache
  invalidation (external Bash/git edits no longer serve stale content), a
  session-start memo reset (a fresh session's first read is never blocked),
  partial-read (`offset`/`limit`) handling (no false blocks / cache poisoning), and
  `ensureMemo` hardening against partial-corrupt state (no `NaN`/throw). Blocked
  reads now count toward session activity.
- **Delegation Enforcer now recognizes real delegation payloads.** The stats gate
  fired only on a `Agent` tool name and read `agent`/`name`, so the real `Task` tool
  with `tool_input.subagent_type` was missed and `delegationStats` never moved. The
  gate now accepts `Task` (and `Agent`) and reads `subagent_type`/`subagentType`.
- **Token accounting no longer inverts input/output.** The size-estimate fallback
  charged `tool_response` (content returned to the model = input) to `output_tokens`
  and `tool_input` (model-produced) to `input_tokens` — backwards, which inflated
  output ~5×. Directions corrected; structured `tool_response` is JSON-coerced to
  avoid `"[object Object]"` undercount.

### Documentation

- **SIVS gate engine ownership and per-scope config authority documented**
  (Phase 5 / `sivs-gate-consolidation` D-f876457e-1). Resolves the mismatch
  between codex-head profile declarations and actual gate execution engines.
  Key findings:
  - G3 Verify and G5 Supervise are **mixed-engine** under `codex-head`:
    DA/Merge Blocker auto-upgrade to Codex via `Qcritical-review` protocol;
    Security Auditor, Performance Skeptic, Advocate, Judge remain Claude
    (protocol-owned — SIVS `enforceRouting` does not reach inside
    `Qcritical-review` spawns). G4 Risk Proof is Claude-only (not in SIVS
    STAGE_MAP).
  - SIVS `enforceRouting` hard-blocks only direct Agent spawns
    (`Etask-executor` → implement, `Esupervision-orchestrator` → supervise,
    `Ecode-reviewer` → verify); gate protocol sub-agents are protocol-owned.
  - `loadSivsConfig(cwd)` uses exact-path loading (no walk-up); each repo's
    `.qe/sivs-config.json` is an independent authority scope — per-scope
    config is documented design, not a conflict.
  - Updated: `QE_CONVENTIONS.md` (Codex Runtime Policy), `core/PHILOSOPHY.md`
    (SIVS Engine Routing), `skills/Qsivs-config/SKILL.md` (per-scope authority).
  - No SIVS routing code changes; all decisions are `document`/`mixed`.
  - `docs/SIVS_MEASUREMENT.md` added with before/after call counts and caveats.

- **Phase 5 final measurement** (R008/R009, `sivs-gate-consolidation`):
  - **Full SIVS cycle calls:** measured = 17회 (Phase 4 upper bound, F-findings
    remediation rounds included). R009 DoD = ≤ 15. **Verdict: unknown — does NOT
    satisfy.** The ROADMAP Phase 2 target is not yet achieved; `met` was not forced.
    Caveat: hook code runs from plugin cache 7.3.9; Phase 5 itself made no code
    changes to the cycle path.
  - **Supervise budget:** 6–7 → 4–5 (≤4 without security audit; floor = 5 when
    `Esecurity-officer` fires). Reduction from findings pipeline (Phase 2 / R002),
    not routing changes.
  - **Savings counters** (ContextMemo `blocked_reads`, Delegation Enforcer
    `autoInjections`): unmeasurable — hook code runs from cache 7.3.9; liveness
    not proven this session. Deferred to post-reinstall per D-c0127487-1.
  - **R008:** unmeasurable (qualitative DoD — evidence is D-f876457e-1 decision
    table, not a numeric measurement).

### Changed

- **BREAKING — execution skills unified into `Qexecute`.** The three execution skills
  were hard-replaced by a single `Qexecute` engine that reads the spec and auto-selects
  its mode (no compatibility shim). Migration map:

  | Removed skill | Now |
  |---|---|
  | `Qrun-task {UUID}` | `Qexecute {UUID}` (auto sequential) |
  | `Qatomic-run {UUID}` | `Qexecute {UUID}` (auto parallel wave) |
  | `Qcode-run-task {UUID}` | `Qexecute -verify {UUID}` |
  | `Qutopia` | `Qexecute -utopia` (modifier) |
  | `Qutopia --work` | `Qexecute -utopia` |
  | `Qutopia --qa` | `Qexecute -utopia -verify` |
  | `Qutopia --ralph` | `Qexecute -utopia -ralph` |

  Qexecute classifies sequential vs parallel-wave from the TASK_REQUEST itself
  (≥5 items, wave width ≥2, non-overlapping file ownership) instead of the caller
  pre-selecting. The former `Qutopia` autonomous-execution skill was absorbed into
  the `-utopia` modifier — the safety rails (`utopia-guard.mjs`), state contract
  (`utopia-state.json` / `ralph-state.json`), and Stop-hook ralph loop are unchanged;
  only the user-facing invocation moved from `/Qutopia` to `/Qexecute -utopia`.
  Routing, auto-chaining, docs, agents, core, validators, and the eval case were
  updated accordingly.

### Deprecated / Merged skills

These compatibility shims auto-delegate to their merged replacements and will be removed in 7.1.0.

| Deprecated skill | Superseded by |
|---|---|
| `Qdebate` | `Qcritical-review --debate` |
| `Qrisk-proof` | `Qcritical-review --risk` |
| `Qqa-council` | `Qqa council` |
| `Qqa-test-planner` | `Qqa plan` |
| `Qscenario-test` | `Qqa run` |
| `Qmcp-ensure` | `Qmcp` |
| `Qmcp-setup` | `Qmcp` |
| `Qmcp-sync` | `Qmcp` |
| `Qarchive` | `Qgc` |
| `Qsweep` | `Qgc` |

### Fixed

### Removed

### Security

## [8.2.5] - 2026-07-01

### Added

### Changed

### Fixed

- `Qupdate` now removes stale Claude plugin-cache files and legacy Codex skill
  installs before copying current framework assets.

### Removed

### Security

## [8.2.4] - 2026-07-01

### Added

- Shared `CONTEXT_BUDGET.md` policy metadata now drives context pressure
  thresholds across hooks and docs.

### Changed

- Context pressure is now evaluated as a ratio of the active model window, with
  per-client/session/model cache scoping for concurrent Claude and Codex
  terminals.
- HUD/statusline runtime files and tests are no longer shipped in the framework
  payload.

### Fixed

- Codex context handling now reads native `model_context_window` session logs
  and no longer treats 1M/200k assumptions as universal constants.

### Removed

### Security

## [8.2.3] - 2026-07-01

### Fixed

- `Qupdate` and `Qmcp-ensure` now sync the QE MCP companion into supported
  client configs, and SessionStart repairs missing `qeExpertLibrary`
  registration after v7 to v8 upgrades when `qe-mcp` is already installed.

### Removed

### Security

## [8.2.2] - 2026-07-01

### Added

### Changed

### Fixed

- `/Qcommit` now gets a hook-owned one-shot commit capability when the skill is
  entered, so autonomous clients no longer need to write
  `.qe/state/skill-bypass.json` just to pass the raw `git commit` guard.
- Completed PSE phases now keep the next step actionable: state routing emits a
  copy-pasteable phase-transition command, and `Qcode-run-task` final reports
  must end with the next phase handoff when a plan continues.

### Removed

### Security

## [8.2.1] - 2026-07-01

### Added

- `Qmcp-ensure` shared MCP preflight workflow for installing the external
  `@inho-team/qe-mcp` companion, initializing the registry, and checking health
  before MCP-backed skills proceed.
- Subagent lifecycle cleanup reporting contract, user documentation, and
  deterministic `check-subagent-lifecycle` guard for stale `Waiting for ...`
  cleanup cases.

### Changed

- MCP-related skills now route shared prerequisite checks through
  `Qmcp-ensure` instead of maintaining duplicated per-skill preflight blocks.
- Qcode-run-task, Qatomic-run, Qcritical-review, and Eqa-orchestrator now require
  final lifecycle summaries that report `open handles: 0` or stale warnings.

### Fixed

- Completed subagent handles now have explicit wait/collect/close reporting
  guidance so users can distinguish normal slow waits from stale cleanup
  warnings.

### Removed

### Security

## [8.2.0] - 2026-07-01

### Added

- State-aware PSE routing hints for active plans, pending task specs,
  uncommitted implementation changes, and completed phase detection, backed by
  deterministic prompt-check subprocess tests.
- Catalog pressure reporting for repo skills, installed Codex skills, agents,
  route keyword pressure, description length, and collision clusters.

### Changed

- Skill routing documentation now defines state-aware soft hints, catalog
  surface classes, slim-catalog guidance, and the high-value E-agent wrapper
  policy.

### Fixed

- TASK_LOG rows marked as implementation-complete but Qcode-pending no longer
  count as completed phase evidence for PSE state routing.

### Removed

### Security

## [8.1.0] - 2026-07-01

### Added

- `Qdoctor` skill for diagnosing QE Framework, QE MCP companion, and project
  `.qe/` state health with safe repair guidance.

### Changed

- `Qupdate` now treats `@inho-team/qe-mcp` as a first-class update target
  alongside the framework body and Codex bridge plugin.

## [7.5.0] - 2026-06-29

### Added

- QE interaction adapter contract and helpers now define client-specific command
  rendering and choice handling, so Claude and Codex skills can share one
  logical question schema while rendering `/Q...` or `$Q...` correctly.

## [7.4.0] - 2026-06-29

### Added

- Environment-aware SIVS Codex defaults: when Codex is available, Implement and
  Verify now prefer Codex while Spec and Supervise stay Claude-led. The runtime
  policy also allows configurable Codex background mode for long Implement/Verify
  jobs, with mandatory result retrieval before final reporting.
- `Qsivs-config` now accepts a per-stage `background` option and documents the
  Codex-assisted Spec/Supervise pattern for token-heavy Claude sessions.
- `Qcc-setup` documents a `cxde` shortcut for non-interactive `codex exec` with
  the same explicit bypass mode as `cxd`.

### Changed

- SIVS execution guidance now resolves routing through `resolveEngine()` instead
  of assuming static Claude defaults, so Codex-capable sessions receive Codex
  delegation hints for Implement/Verify even without an explicit config file.

### Fixed

- Codex asset installation migrates deprecated `[features].codex_hooks` config
  keys to `[features].hooks`, preventing repeated Codex startup warnings while
  preserving user-authored config outside QE-managed fences.

## [7.3.14] - 2026-06-29

### Added

- Cross-session build admission control: a memory probe (macOS `vm_stat` / Linux
  `MemAvailable` / `os.freemem` fallback) plus a machine-global build lock now gate
  heavy builds (gradle/mvn/npm) through the PreToolUse hook and release them on
  PostToolUse, so concurrent builds across independent sessions no longer
  OOM-kill each other. Tunable via `QE_BUILD_MIN_FREE_MB` (default 1536) and
  `QE_BUILD_ADMISSION=off`; stale locks are reaped via process-liveness checks.

### Fixed

- Parallel wave workers no longer die from build OOM: concurrent build workers are
  capped at `min(cpuCount-2, 3)` with a FIFO queue, build/test verification moved
  out of each worker into a single Lead-owned post-wave run, and abnormal worker
  exits (exit 137 / SIGKILL) are captured with one automatic retry.
- Codex companion orphan crashes are now detected: the poll watcher probes the
  companion PID and emits a terminal `crashed` status within one poll interval
  instead of staying "running" for the full timeout; orphaned running jobs are
  reaped at session start, and retry identity is unified on
  `(taskUuid, workerId, itemId)` so a worker retries at most once regardless of
  how it died.

## [7.3.13] - 2026-06-27

### Added

- Terminal sessions are now auto-named from the work in progress. When a session
  has no name, qe injects a one-line nudge (at most twice) asking Claude to name
  it from the current task via `/Qsession-name set`; once named, every few prompts
  it re-checks and renames only on a clear topic shift, so a continuous task keeps
  a stable name. State is tracked per session id in unified-state.
- Stale `.qe/analysis` is now auto-refreshed by a detached background job on
  session start, so project context stays fresh without a manual `/Qrefresh`.

### Changed

### Fixed

- `/Qsession-name set` saved an empty name. The Step 3 snippet assigned
  `SESSION_NAME` without `export`, so the separately-spawned node process never
  received it via `process.env` and always stored an empty string. The variable
  is now exported.
- The Qcommit bypass-flag sequence could be blocked when the flag was written and
  `git commit` were combined into a single Bash command — the PreToolUse hook
  inspects the command before it runs, so the flag was not yet on disk. The
  Ecommit-executor now writes the flag with the Write tool (structurally separate
  from the commit call), and the hook falls back to the flag file's mtime for the
  120-second TTL when no `ts` field is present. Bash-written flags with `ts`
  (Mbump/Mrelease) stay backward compatible.

### Removed

### Security

## [7.3.12] - 2026-06-27

### Added

- Automatic reaping of stale Codex background jobs. When a background job's
  worker process is confirmed gone but its status is still `running`, qe now
  cancels it through the Codex `cancel` path (state corrected to `cancelled`)
  both on session start and when checking Codex results — so SIVS never polls
  a dead job forever. Only confirmed `process-dead` jobs are auto-reaped; weak
  `log-silent` signals are surfaced but left for the user to judge.
- Code-enforced artifact context injection for SIVS Codex delegations. When a
  stage is delegated to Codex, the PreToolUse hook now reads the active
  TASK_REQUEST / VERIFY_CHECKLIST and injects their content into the codex
  subagent prompt via `hookSpecificOutput.updatedInput` — previously the
  artifacts were only referenced by path and could be skipped if the model
  never opened them. New `buildDelegationContext` / `buildDelegationPayload`
  helpers in `codex_bridge.mjs` (64 KiB per-artifact cap, UTF-8-safe
  truncation, graceful skip on missing files) and a new
  `codex-context-injector.mjs` hook module that resolves the active artifacts
  (in-progress over pending, newest first) and performs the injection.
  Injections are recorded as metadata-only audit entries in
  `.qe/agent-results/codex-context-audit.log` (no artifact body, no secrets).
- Reverse delegation (Codex base session → `claude -p` via Qclaude-rescue) now
  shares the same artifact context builder through
  `buildReverseDelegationPayload` in `claude_bridge.mjs`. This path is soft
  (skill-invoked) rather than hook-enforced because Codex hooks cannot mutate
  tool input; the Qclaude-rescue skill prepends the built context to the Claude
  prompt as a single argv.
- Multi-terminal session naming and an active-session registry. Each QE session
  can carry a human-readable name (`/Qsession-name set <name>`, capped at 48
  chars) recorded in `.qe/state/sessions-registry.json`, so concurrent
  terminals are aware of each other. SessionStart injects the current name and
  other active sessions into context, Stop cleans the entry, stale rows (>2h)
  and invalid SIDs are pruned, and the
  `/Qsession-name` skill (show / set / list) surface it.

### Changed

### Fixed

### Removed

### Security

## [7.3.11] - 2026-06-27

### Added

- Codex background-job staleness detection. When qe reads a Codex job's
  status (`getLatestCodexJobStatus`), it now probes the recorded worker
  process and recent log activity, so a crashed background job that Codex
  still records as `running` is surfaced as stale. SIVS polling and the
  result-handler hook no longer wait forever on a job that will never finish.
  Threshold is tunable via `CODEX_STALE_LOG_SILENCE_MS`.

### Fixed

- Reverse delegation (claude rescue) now checks Claude CLI authentication
  before routing a stage to `claude -p`. When the CLI is not logged in it
  falls back to Codex solo with a clear warning, instead of silently failing
  on an unauthenticated invocation.

- `/Mrelease` no longer has to swap the skill-bypass flag mid-run. The
  PreToolUse `git commit` guard now also honors an active `Mbump` bypass flag
  (in addition to `Qcommit`), so the release-train version-bump commit passes
  without the Ecommit-executor rewriting the flag. Unrelated skills are still
  blocked.

## [7.3.10] - 2026-06-27

### Fixed

- Codex agent role TOML no longer emits `qe_model_hint`,
  `qe_reasoning_effort_hint`, or `qe_tools_hint` as top-level keys. Codex CLI
  (>=0.142.x) strict-deserializes these files and rejected every generated
  agent with "malformed agent role definition" warnings, silently dropping all
  27 native agents. The hint values remain available inside
  `developer_instructions` (compatibility note), so no information is lost.

## [7.3.9] - 2026-06-26

### Changed

- Documented measured Claude/Codex parity across setup, PSE handoffs, SIVS
  routing, native agent conversion, hook support, and known degraded paths. The
  new verification matrix is the source of truth for supported, degraded,
  manual-trust, unsupported, and not-tested behavior.
- Codex-facing PSE guidance now renders native `$Q...` skill commands, while
  Claude-facing examples keep slash commands.
- Codex agent conversion and delegation docs now distinguish native explicit
  subagent invocation from Claude Agent tool auto-delegation, with
  `codex-inline-degrade` documented as the fallback.

### Fixed

- Codex hook install now matches representative shell tool names
  (`Bash`, `Shell`, `shell`, `exec_command`) and Codex safety blocks point to
  `$Qcommit`, `$Qbranch`, and `$Mbump`.
- Codex cleanup manifest now includes `Qclaude-rescue`, so purge cleanup can
  remove the reverse-delegation skill it installs.

## [7.3.8] - 2026-06-26

### Added
- `Qcc-setup` now also installs Codex launcher aliases: `cx` (`codex`) and `cxd` (`codex --dangerously-bypass-approvals-and-sandbox`, the Codex equivalent of `ccd`). Covers zsh/bash/fish and PowerShell. Codex has no `--chrome` flag, so there is no `cxc`.

## [7.3.7] - 2026-06-26

### Changed
- `Qupdate` is now the single update entry point. It updates the framework body (Claude + Codex assets) and also checks/installs/updates the codex-plugin-cc bridge — work previously split across `Qupdate` and `QCodexUpdate`. It also documents the native `claude plugin update qe-framework` path for plugin-mode installs.

### Removed
- `QCodexUpdate` skill. Its codex-plugin-cc check/install/update flow is absorbed into `/Qupdate`. References in `Qsivs-config`, `Qinit`, and `Qplan` now point to `/Qupdate`.

## [7.3.6] - 2026-06-26

### Added
- Bidirectional SIVS engine routing. A Codex base session can now delegate Claude-stages back to Claude, the reverse of the existing Claude→Codex path. New `scripts/lib/claude_bridge.mjs` (mirror of `codex_bridge.mjs`) resolves reverse delegation, and the new `Qclaude-rescue` skill is the Codex-side surface (counterpart of codex-plugin-cc's `/codex:rescue`).
- `installCodexAssets` now copies `scripts/` into `~/.codex/scripts` (dual-target, mirroring the Claude-side installer) so the reverse bridge is available in global Codex sessions, with symmetric cleanup and an empty-`homeDir` guard.

### Changed
- README Multi-Engine Routing and `core/PHILOSOPHY.md` SIVS routing now describe routing as base-agnostic and bidirectional; with no config, each base still runs solo (zero-dependency).

## [7.3.5] - 2026-06-26

### Added
- `doctor` now cross-checks the Codex `config.toml` QE fence against the agent `.toml` files it references and reports any whose `config_file` is missing — surfacing the exact drift that makes Codex log "malformed agent role definition" warnings.

### Fixed
- `qe-framework-install` now also syncs `~/.codex` agent assets (dual-target), so a standard CLI re-install repairs Codex config-fence drift. Previously only `install.js` and the Claude-side SessionStart auto-sync refreshed Codex, leaving Codex-primary users with a stale fence pointing at missing `.toml` files. Graceful no-op when `~/.codex` is absent.

## [7.3.4] - 2026-06-26

### Added
- Codex asset auto-sync: SessionStart now detects when the loaded plugin version is ahead of the version stamped into `~/.codex/.qe-codex-version` and kicks off a fully detached background `installCodexAssets()` re-sync, so Codex-side QE skills/agents follow plugin updates without a manual `/Qupdate`. `installCodexAssets()` writes the version stamp on every run; `~/.codex` absent → no-op (not a Codex user).

## [7.3.3] - 2026-06-26

### Added
- Codex Runtime Policy: Codex (`codex:codex-rescue`, SIVS codex routing) now runs in the foreground by default so its stdout is visible in the conversation; background jobs must be retrieved via `/codex:status` → `/codex:result <job-id>` before the turn ends. Documented in `QE_CONVENTIONS.md` and enforced as a `[QE CODEX RUNTIME]` pointer injected into the SessionStart hook context.

## [7.3.2] - 2026-06-26

### Added
- Reversible skill demotion mechanism (`scripts/skill-demote.mjs`): move a skill between the active catalog (`skills/`) and `skills-optional/` (outside the plugin's skill globs) and back, with an exact-restore manifest. `--demote` / `--restore` / `--list`. Refuses `tier:core` and INTENT_GATE-routed skills, rejects cross-device moves, and rolls back on a failed manifest write. A self-contained guard covers it.
- Skill usage telemetry: a per-skill forward invocation counter in the PreToolUse hook plus `scripts/skill-usage-report.mjs` (never-used + frequency report), and `scripts/measure-session-injection.mjs` to measure the SessionStart token footprint.

### Changed
- **Catalog diet — active skills 183 → 104.** 79 stack-/domain-specific skills (coding-experts languages/backend/frontend/data/infra/ai, plus product-management, design/visual, stitch, research) moved to opt-in `skills-optional/`. They still ship and are restorable via `node scripts/skill-demote.mjs --restore <name>`; cross-cutting quality, workflow, and INTENT_GATE-routed skills stay. Cuts roughly 8,000 tokens from the per-session skill catalog.
- SessionStart injection slimmed ~50%: the OVERRIDE MAP and OUTPUT STYLE blocks are now compact pointers with fallbacks, and recorded-mistake lines are truncated.
- PreToolUse command guards are region-aware via a new zero-dependency shell scanner: `git commit`, `gh pr create`, `plugin.json` version writes, and in-place edits fire only on real command invocations, not inside quoted strings, heredoc bodies, or comments (and `bash -c`/substitution/heredoc still block real commits).

### Security
- Closed a fail-open guard bypass: deeply nested `$(...)` substitution could overflow the command scanner, and the hook's fail-open then disabled all PreToolUse guards. The scanner now caps recursion and fails closed.
- Closed a path-traversal in the demotion manifest: crafted `originalPath`/`demotedPath` entries could move directories outside the repo or clobber a live skill on restore. Manifest paths are now validated (with symlink resolution) against the catalog and optional roots.

## [7.3.1] - 2026-06-26

### Added
- **Codex dual-target install**: `qe-framework-install` now installs QE into `~/.codex` as well as `~/.claude` — skills, agents (`*.toml`), a managed agent fence, and a `[[hooks.PreToolUse]]` safety-hook fence in `~/.codex/config.toml`. Skipped silently when `~/.codex` is absent.
- **Codex safety hook**: a Codex PreToolUse hook enforces the same normal-mode guards as Claude (raw `git commit`, `gh pr create`, in-place `sed -i`, direct `plugin.json` version writes), reusing the existing shell-scanner/block-emitter. Run `/hooks` in Codex once to approve it.
- `qe-framework-uninstall --purge-codex` cleans up Codex assets symmetrically; plain uninstall reports orphans in dry-run.

### Changed
- Docs (USAGE_GUIDE + README ko/zh/ja) updated from "Codex = engine only" to the dual-target reality, with the honest parity ceiling: full parity for install + safety guards; automatic E-agent delegation degrades to inline on Codex (platform limit — Codex only spawns sub-agents on explicit `/agent`).

## [7.3.0] - 2026-06-25

### Added
- Skill-usage telemetry: a forward counter plus a never-used skills report.
- Stop-hook OUTPUT_STYLE drama gate.

### Changed
- Uninstall now removes orphaned Codex assets.

### Fixed
- Prevent CJK script leakage in the language directive.
- Correct inaccurate Codex install claims in the setup guides.

## [7.2.11] - 2026-06-25

### Added
- Region-aware shell scanner (shell-scanner.mjs) separating executable command positions from string/comment regions, so hook guards match real invocations only.
- measure-session-injection.mjs to quantify SessionStart context injection size.

### Changed
- Leaner SessionStart context injection (reduced token footprint).

### Fixed
- PreToolUse guards (git commit, gh pr create) no longer false-block commands that merely mention those phrases inside strings, echo text, grep patterns, or comments.

## [7.2.10] - 2026-06-25

### Fixed

- Expose the 72 `coding-experts` skills under the `qe-framework:` plugin namespace. They live 3 levels deep (`skills/coding-experts/<category>/<name>/SKILL.md`), but the plugin skill loader scans only one level, so `qe-framework:Qthe-fool` (and all 72) returned "Unknown skill". The `skills` field in `plugin.json` is now an array listing each category directory, so every coding-expert resolves under the namespace while bare invocation stays backward-compatible.

## [7.2.9] - 2026-06-25

### Added

- **Qqa-council**: optional `+visual` Auditor pass — a white-box, read-only role that composes `Qvisual-qa`, `Qweb-design-guidelines`, and `Qdesign-audit` to catch the Explorer's blind spots (spacing/alignment outliers, layout breakage, contrast, keyboard/focus, design-token drift). Adds Step 3.5, a Mode flag (`explore+visual` / `full+visual`), and a role-boundary validation gate.
- **Eqa-explorer**: new interaction/event pass — exercises every control for dead/no-op buttons, panel open/close via overlay + `Escape`, keyboard reachability (Tab/Enter), hover feedback, and counter/total state consistency.

## [7.2.8] - 2026-06-25

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

## [7.2.2] - 2026-06-22

### Added

- `Qmcp-setup`: added Playwright (`@playwright/mcp`) and Chrome DevTools (`chrome-devtools-mcp`) browser servers to the recommended-MCP catalog, fixing the previously dangling `/Qmcp-setup playwright` reference in `Qvisual-redesign`.
- **Qwiki — project knowledge wiki** (Karpathy LLM-Wiki pattern over `.qe/wiki/`): new skills `Qwiki-ingest` / `Qwiki-compile` / `Qwiki-query` / `Qwiki-lint`, a zero-dep canonicalization+sharding authority (`scripts/lib/wiki-router.mjs`), page templates + conventions seed (`core/wiki-conventions.template.md`, `core/wiki-templates/`), a SessionStart inbox-queue notice, and a usage guide (`docs/QWIKI.md`). Synthesize-once/accumulate knowledge with provenance + intent-routing; commits go through Qcommit only; compile/query/lint are Claude-only. Boundary vs Qmemory/Qcontext/`.qe/analysis` recorded in DECISION_LOG D-WIKI-02.
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


### Changed

- `core/OUTPUT_STYLE.md` reworked for clarity: added a top-priority **Tier 0 (clarity over rule-compliance)** principle, density-control rules (one idea per line, single ★ per answer), a stream-of-consciousness ban, and good/bad (`❌`/`✅`) examples for every rule.

### Fixed


## [7.1.5] - 2026-06-14

### Fixed
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
- Harness metrics (6 metrics) via `metrics-collector.mjs`, telemetry JSONL, trace logger
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
- **Session → Plan bridge** — `hooks/scripts/session-start.mjs` writes `.qe/state/current-session.json` so model-side skills can discover their own `session_id` and bind plans to terminals.
- `hooks/scripts/lib/plan-resolver.mjs` — shared resolver for `resolveActivePlanSlug` / `resolveStatePath` / `resolveRoadmapPath` with strict slug validation against path traversal.
- Qcritical-review: integrate OMC 9-step protocol (Pre-commitment / Multi-perspective / Pre-Mortem / Ambiguity Scan / Devil's Advocate / Self-audit / Realist / Adversarial / Gap Analysis) — adapted from oh-my-claudecode (MIT)
- Etracer agent: evidence-based causal trace lane (Observation/Inference separation, 6-tier evidence, ≥2 hypotheses, disconfirmation, next probe) — adapted from oh-my-claudecode (MIT)
- Safety hooks: post-tool-failure-guard (5-retry alternative-approach prompt), persistence-safety (max iterations + stale guard), context-guard (75/95% threshold + MAX_BLOCKS=2) — adapted from oh-my-claudecode (MIT)

### Changed
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

### Changed
- Mbump is now a sub-step of `/Mrelease`; direct `/Mbump` invocation still works for explicit overrides but is no longer the recommended release path.

## [6.6.2] - 2026-04-24

### Added

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
