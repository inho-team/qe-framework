---
name: Qsivs-config
description: 'View and modify SIVS engine routing configuration. Change which engine (claude/codex) handles each stage (spec/implement/verify/supervise). Use when the user wants to check or change SIVS routing, engine config, model assignment, or effort level.'
invocation_trigger: When the user wants to view, modify, or reset SIVS engine routing configuration.
recommendedModel: haiku
tier: core
---

# Qsivs-config — SIVS Engine Routing Manager

## Role
A CLI-style skill for viewing and modifying `.qe/sivs-config.json`.
Allows quick changes to which engine (claude/codex) handles each SIVS stage,
with optional model and effort overrides.

Default routing is environment-aware: without Codex, all stages run on Claude;
with Codex available, Spec and Supervise stay Claude-led while Implement and
Verify prefer Codex to reduce Claude session token pressure. Explicit
`.qe/sivs-config.json` entries override those defaults stage-by-stage.

> **Note — verification gates are always on.** This config only chooses the
> *engine* per stage. The mandatory **stage verification gates** (the
> self-reference defense; PHILOSOPHY.md Mandatory Obligation #8) run regardless of
> engine configuration — including all-Claude or all-Codex homogeneous setups,
> which is exactly the case they exist to defend. Setting a stage to one engine
> does not disable its gate; when Codex is reachable the gate's strongest critic
> is auto-upgraded to a cross-model engine, otherwise the same-engine baseline
> runs. See `skills/Qcritical-review/reference/*-gate-protocol.md`.

## Fallback
Engine assignment is a preference, not a hard requirement. At runtime
`resolveEngine()` degrades a stage to the reachable engine when the requested one
is unavailable:
- **codex → claude** — a stage set to `codex` runs on Claude when codex-plugin-cc
  is not installed (Claude-base sessions).
- **claude → codex** — a stage set to `claude` runs on Codex when the session is
  Codex-native (`base: 'codex'`) and Claude is unreachable.

`show` reports the requested engine; the fallback warning names the effective
engine used. Homogeneous profiles (`all-claude` / `all-codex`) never trigger
fallback because both roles target the same engine.

## Cross-engine invocation (MCP only)
When the Head engine must call the Body engine (or vice versa) — e.g. a
Claude-led Supervise stage asking Codex for a second-opinion review, or a
Codex-led Spec stage asking Claude to resolve an ambiguity — route the call
**through the qe-mcp expert-library MCP tools**, never a direct CLI shell-out:

- `mcp__qeExpertLibrary__qe_run_codex_agent` — invoke Codex
- `mcp__qeExpertLibrary__qe_run_claude_agent` — invoke Claude
- `mcp__qeExpertLibrary__qe_delegate_agent` — engine-agnostic (`target_engine`)

These carry `call_depth` / `call_chain_id` / `origin_engine` recursion guards and
a `max_concurrent_runs: 1` bound. **Do not** invoke `codex-companion.mjs` (or any
`node .../scripts/*.mjs` runner) directly for cross-engine work; direct library
shell-outs bypass the recursion guard and the audit trail.

## Per-Scope Config Authority (Phase 5 / D-f876457e-1)

`loadSivsConfig(cwd)` uses **exact-path loading** — it reads `<cwd>/.qe/sivs-config.json` with no directory walk-up. The hook cwd equals the session cwd; therefore each repo's `.qe/sivs-config.json` is an independent authority scope. A wrapper workspace config and a sub-repo config are two separate scopes and do not conflict in a single session — the session applies whichever config corresponds to its cwd.

Authority rules:
- Each repo's `.qe/sivs-config.json` is the authoritative SIVS config for sessions whose cwd is that repo.
- A wrapper workspace config is the authoritative config for sessions whose cwd is that workspace root.
- Differences between the two configs reflect intentional per-project SIVS settings, not a conflict to be resolved.
- Config files are read fresh on every hook invocation; editing a config takes effect immediately for the current session without restart.
- `qe-framework/.qe/sivs-config.json` may be untracked + gitignored (local developer override). The workspace root may not be a git repo. In both cases config changes are not tracked in git diff — record before/after values explicitly in DIAG when changing config for auditable decisions.
- Rollback: restore the DIAG-recorded before value manually; git revert does not apply.

## Storage Location
`.qe/sivs-config.json`

## CLI Interface

### Parse Arguments
Parse the user's input after the active-client command (`{adapter.commandPrefix}Qsivs-config`) as positional and flag arguments:

```
{adapter.commandPrefix}Qsivs-config [subcommand] [stage] [engine] [options]
```

**Subcommands:**
| Subcommand | Description |
|------------|-------------|
| (none)     | Show current configuration (same as `show`) |
| `show`     | Show current configuration with status |
| `profile`  | Apply a named Head/Body role profile to all stages at once |
| `set`      | Set engine/model/effort for a stage |
| `reset`    | Reset a stage or all stages to environment-aware defaults |
| `--help`   | Show usage guide |

**Profiles (Head = spec + supervise, Body = implement + verify):**
| Profile | spec | implement | verify | supervise | Meaning |
|---------|------|-----------|--------|-----------|---------|
| `claude-head` | claude | codex | codex | claude | Claude designs/judges (Head), Codex executes (Body). Default posture. |
| `codex-head` | codex | claude | claude | codex | Codex designs/judges (Head), Claude executes (Body). |
| `all-claude` | claude | claude | claude | claude | Homogeneous Claude (Codex absent or unused). |
| `all-codex` | codex | codex | codex | codex | Homogeneous Codex (Claude absent or unused). |
| `implement-fugu-verify-claude` | claude | fugu | claude | claude | **Experimental.** Fugu (OpenAI-compatible) executes; Claude verifies/designs. Fugu is experiment-only. |

A profile is a thin preset over the four stage entries. `show` reports the
effective profile derived from the stage engines; a per-stage `set` that breaks a
named pattern surfaces as `custom`. The stage engines remain the source of truth
for routing — the stored `profile` field is metadata only.

## Engine independence and verification gates

Engines are modeled in `core/engines.json` as a `vendor` drawing from a provider
`pool` (`claude`→anthropic, `codex`→openai, `fugu`→fugu). When a profile splits
Implement and Verify across different engines, `checkSivsPoolDisjoint(config)` in
`hooks/scripts/lib/sivs-enforcer.mjs` can prove provider-pool disjointness. The
`implement-fugu-verify-claude` preset is the explicit pool-disjoint preset.

The default `claude-head` posture is different by design: Claude owns the Head
stages (Spec + Supervise), while Codex owns the Body stages (Implement + Verify)
to keep code execution and validation out of the Claude session. Its verification
independence comes from fresh-context Verify, mandatory SIVS verification gates,
and protocol-owned cross-model critics inside `Qcritical-review`; do not describe
`claude-head` as Implement/Verify pool-disjoint.

Homogeneous profiles (`all-claude` / `all-codex`) are intentionally single-engine
profiles and rely on the same mandatory gate baseline rather than provider-pool
separation.

**Stages:** `spec`, `implement`, `verify`, `supervise`

**Engines:** `claude`, `codex`

**Options:**
| Flag | Description | Example |
|------|-------------|---------|
| `--model <name>` | Set model override | `--model gpt-5.4` |
| `--effort <level>` | Set effort level (low/medium/high/max/xhigh) | `--effort high` |
| `--background <true|false>` | For Codex stages, allow background mode | `--background true` |
| `--all` | Apply to all stages (with `set` or `reset`) | `reset --all` |

## Execution Procedure

### Step 0: Parse input
Parse the user's arguments according to the CLI Interface section above.
If `--help` flag is present anywhere, jump to **Step HELP**.

### Step 1: Route by subcommand

#### Subcommand: `show` (or no arguments)
1. Read `.qe/sivs-config.json` (fall back to `.qe/svs-config.json` for legacy)
2. If no config file exists, show defaults
3. Check Codex readiness for the active base client:
   - Claude base: check codex-plugin-cc availability via `isCodexPluginAvailable()` from `scripts/lib/codex_bridge.mjs`.
   - Codex base: check native Codex readiness and hook trust state; do not require Claude plugin installation.
4. Display as a table:

```
SIVS Engine Routing (.qe/sivs-config.json)
──────────────────────────────────────────
  Profile:  claude-head   (Head=Claude, Body=Codex)

  Stage        Engine   Model          Effort
  spec         claude   -              -
  implement    codex    gpt-5.4        high
  verify       codex    -              -
  supervise    claude   -              -

Codex plugin: installed (v1.2.3)
```

Derive the Profile line via `resolveProfileName(config)` from
`scripts/lib/codex_bridge.mjs`. If the stored `profile` field disagrees with the
engines actually set, show both, e.g. `codex-head (declared) / custom (effective)`.

If any stage uses codex but plugin is not installed, append:
```
[!] Codex bridge not available for this base client.
    Claude-base sessions: Codex stages fall back to Claude unless codex-plugin-cc is installed.
    Codex-native sessions: verify Codex hook trust/readiness through the Codex installer and /hooks.
```

#### Subcommand: `set`
1. Validate: stage must be one of spec/implement/verify/supervise (or `--all`)
2. Validate: engine must be claude or codex (if provided)
3. Validate: effort must be low/medium/high/xhigh (if provided)
4. Read existing config (or start from `{}` if none exists)
5. Merge the change:
   - If engine provided: set `{stage}.engine`
   - If `--model` provided: set `{stage}.model`
   - If `--effort` provided: set `{stage}.effort`
   - If `--background` provided: set `{stage}.background`
   - If `--all`: apply to all 4 stages
6. Write `.qe/sivs-config.json`
7. Display the updated config (same format as `show`)

**Examples:**
```
{adapter.commandPrefix}Qsivs-config set implement codex              # implement -> codex
{adapter.commandPrefix}Qsivs-config set implement codex --model gpt-5.4 --effort high
{adapter.commandPrefix}Qsivs-config set verify codex --background true
{adapter.commandPrefix}Qsivs-config set spec claude                  # spec -> claude
{adapter.commandPrefix}Qsivs-config set --all codex --effort medium  # all stages -> codex
```

Rendered examples:
```
Claude: /Qsivs-config show
Codex:  $Qsivs-config show
```

**Shorthand (without `set` keyword):**
If the first argument is a valid stage name and the second is a valid engine,
treat it as an implicit `set`:
```
{adapter.commandPrefix}Qsivs-config implement codex                  # same as: set implement codex
{adapter.commandPrefix}Qsivs-config spec claude high                 # same as: set spec claude --effort high
```

#### Subcommand: `profile`
1. Validate: profile name must be one of `claude-head`, `codex-head`, `all-claude`, `all-codex`
2. Expand the profile into explicit stage engines via `expandProfile(name)` from `scripts/lib/codex_bridge.mjs`; this returns a `profile` field plus one `{ engine }` entry per stage
3. Write `.qe/sivs-config.json` with the expanded object (preserving any existing per-stage `model`/`effort`/`background`/`compaction` overrides where the engine is unchanged)
4. Check engine readiness for the active base client and warn on any stage whose engine is unreachable (fallback still applies at runtime — see **Fallback**)
5. Display the updated config (same format as `show`), including the profile name

**Examples:**
```
{adapter.commandPrefix}Qsivs-config profile codex-head     # Codex Head / Claude Body
{adapter.commandPrefix}Qsivs-config profile claude-head    # Claude Head / Codex Body (default)
{adapter.commandPrefix}Qsivs-config profile all-codex      # homogeneous Codex
{adapter.commandPrefix}Qsivs-config profile all-claude     # homogeneous Claude
```

#### Subcommand: `reset`
1. If `--all` or no stage specified: delete `.qe/sivs-config.json` entirely
2. If stage specified: remove that stage's entry from config (falls back to environment-aware default)
3. Display the resulting config

**Examples:**
```
{adapter.commandPrefix}Qsivs-config reset implement     # reset implement to default
{adapter.commandPrefix}Qsivs-config reset --all         # delete config, use environment-aware defaults
```

### Step HELP: Display usage guide
Print the following help text:

```
Qsivs-config — SIVS Engine Routing Manager

Usage:
  {adapter.commandPrefix}Qsivs-config                              Show current config
  {adapter.commandPrefix}Qsivs-config show                         Show current config (verbose)
  {adapter.commandPrefix}Qsivs-config profile <name>               Apply a Head/Body role profile
  {adapter.commandPrefix}Qsivs-config set <stage> <engine> [opts]  Set engine for a stage
  {adapter.commandPrefix}Qsivs-config <stage> <engine> [opts]      Shorthand for set
  {adapter.commandPrefix}Qsivs-config reset [stage|--all]          Reset to defaults
  {adapter.commandPrefix}Qsivs-config --help                       Show this help

Profiles: claude-head | codex-head | all-claude | all-codex
Stages:   spec | implement | verify | supervise
Engines:  claude | codex

Options:
  --model <name>     Model override (e.g., gpt-5.4, gpt-5-codex-mini)
  --effort <level>   Reasoning effort: low | medium | high | xhigh
  --background <bool> Codex background mode: true | false
  --all              Apply to all stages

Examples:
  Claude: /Qsivs-config implement codex --model gpt-5.4 --effort high
  Codex:  $Qsivs-config implement codex --model gpt-5.4 --effort high
  Claude: /Qsivs-config verify codex --background true
  Codex:  $Qsivs-config verify codex --background true
  {adapter.commandPrefix}Qsivs-config set --all claude
  {adapter.commandPrefix}Qsivs-config reset --all
  {adapter.commandPrefix}Qsivs-config spec claude

### Compaction Settings

  {adapter.commandPrefix}Qsivs-config set spec compaction.enabled true
  {adapter.commandPrefix}Qsivs-config set spec compaction.strategy server
  {adapter.commandPrefix}Qsivs-config set implement compaction.strategy auto

Config file: .qe/sivs-config.json
Schema:      core/schemas/svs-config.schema.json
```

## Validation Rules
- Profile (for `profile` subcommand) must be one of: `claude-head`, `codex-head`, `all-claude`, `all-codex`
- Stored `profile` field must be one of the above or `custom`
- Stage must be one of: `spec`, `implement`, `verify`, `supervise`
  - **Stage options:** `engine`, `model`, `effort`, `background`, `compaction`
- Engine must be one of: `claude`, `codex`
- Effort must be one of: `low`, `medium`, `high`, `max`, `xhigh`
  - `low` / `medium` / `high` — Both Claude and Codex
  - `max` — Claude label; maps to Codex `xhigh` automatically
  - `xhigh` — Codex only (maps to Claude `max` automatically)
- Model must be a non-empty string
- Background must be boolean (`true` or `false`) and only affects Codex routing
- On invalid input, show the error and print `--help` output
- If setting engine to `codex`, check `isCodexPluginAvailable()` and warn if not installed (but still save the config)

## Legacy Migration
- If `.qe/svs-config.json` exists but `.qe/sivs-config.json` does not:
  - Read from legacy file
  - On any `set` or `reset`, write to the new `.qe/sivs-config.json` path
  - Print: `Migrated from .qe/svs-config.json -> .qe/sivs-config.json`

## Will
- Read, display, and modify `.qe/sivs-config.json`
- Apply named Head/Body role profiles (`profile <name>`) and report the effective profile
- Validate inputs against the schema
- Warn about missing bridge/readiness for the active base client
- Handle legacy config migration
- Show help on `--help` or invalid input

## Will Not
- Install or manage codex-plugin-cc (use `{adapter.commandPrefix}Qupdate` for framework updates)
- Modify any files other than `.qe/sivs-config.json`
- Auto-assign models or effort levels without user instruction
