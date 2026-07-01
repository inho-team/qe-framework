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
| `set`      | Set engine/model/effort for a stage |
| `reset`    | Reset a stage or all stages to defaults (claude) |
| `--help`   | Show usage guide |

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
  Stage        Engine   Model          Effort
  spec         claude   -              -
  implement    codex    gpt-5.4        high
  verify       codex    -              -
  supervise    claude   -              -

Codex plugin: installed (v1.2.3)
```

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

#### Subcommand: `reset`
1. If `--all` or no stage specified: delete `.qe/sivs-config.json` entirely
2. If stage specified: remove that stage's entry from config (falls back to default claude)
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
  {adapter.commandPrefix}Qsivs-config set <stage> <engine> [opts]  Set engine for a stage
  {adapter.commandPrefix}Qsivs-config <stage> <engine> [opts]      Shorthand for set
  {adapter.commandPrefix}Qsivs-config reset [stage|--all]          Reset to defaults
  {adapter.commandPrefix}Qsivs-config --help                       Show this help

Stages:  spec | implement | verify | supervise
Engines: claude | codex

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
- Validate inputs against the schema
- Warn about missing bridge/readiness for the active base client
- Handle legacy config migration
- Show help on `--help` or invalid input

## Will Not
- Install or manage codex-plugin-cc (use `{adapter.commandPrefix}Qupdate` for framework updates)
- Modify any files other than `.qe/sivs-config.json`
- Auto-assign models or effort levels without user instruction
