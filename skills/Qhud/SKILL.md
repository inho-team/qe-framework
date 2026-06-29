---
name: Qhud
description: 'Toggles or previews the QE HUD (context %, session tokens, SIVS engine routing). Claude uses settings.json statusLine; Codex uses the installed qe-hud command/proxy because Codex has no native statusLine hook. Use for /Qhud, $Qhud, HUD on, HUD off, statusline show, turn HUD on, enable HUD.'
invocation_trigger: When the user wants to turn the QE HUD statusline on or off, or check its current state.
recommendedModel: haiku
---

# Qhud — QE Framework HUD Toggle

## Role
CLI-style skill that wires the QE HUD into the active client:
- **Claude Code:** add/remove a `statusLine` entry in `.claude/settings.json`; the renderer is `hooks/scripts/statusline.mjs`.
- **Codex:** preview or expose the same HUD through `~/.codex/scripts/qe-hud.mjs`; the renderer wrapper is `hooks/scripts/codex/hud-codex.mjs`.

Codex does not currently provide a native statusline hook equivalent to Claude Code. Do not pretend `$Qhud on` can write a Codex statusline setting. For Codex, `on` means “verify/installable command is available and show the shell/tmux command the user can bind.”

## Scope
- **Default in Claude:** user/global scope → `~/.claude/settings.json`. Turn the HUD on once and it appears in every project; per-project context (SIVS routing, current phase, active task) is resolved at runtime by `statusline.mjs` from `process.cwd()`, so no per-project install is needed.
- **Default in Codex:** command scope → `~/.codex/scripts/qe-hud.mjs`. The command renders from `process.cwd()` and can be called manually, from a shell prompt, or from tmux status.
- **`--project` flag:** project scope → `<PROJECT_ROOT>/.claude/settings.json`, for the rare case a single project needs a different statusLine (e.g. a different preset) than the global one.
- **`--user` flag:** explicit user/global scope — identical to the default. Kept as a backward-compatible alias so existing `/Qhud on --user` muscle memory and docs keep working.
- Never touches `settings.local.json` (that is the user's private override slot).

**Project root detection** (only when `--project` is set):
Walk upward from `$PWD` until one of these markers is found:
`.git/` directory, `package.json`, `pyproject.toml`, `.qe/`, or an existing `.claude/` directory.
The first match becomes `PROJECT_ROOT`. If no marker is found before `$HOME` (or filesystem root), abort with:
```
[!] Could not detect a project root from $PWD. Run from a project directory,
    or drop --project to install globally at ~/.claude/settings.json.
```
This prevents `.claude/settings.json` from being written to a subdirectory where Claude Code will not pick it up.

## CLI Interface

```
/Qhud [subcommand] [flags]
$Qhud [subcommand] [flags]
```

| Subcommand | Description |
|------------|-------------|
| (none) / `show` | Print current state (installed? where? preview output) |
| `on`   | Claude: install statusLine entry. Codex: verify/print `qe-hud` command binding |
| `off`  | Claude: remove statusLine entry. Codex: print shell/tmux unbind guidance; no config is edited |
| `summary "<text>"` | Set this session's one-line summary ("what am I working on") shown by the `summary` element. `summary --clear` removes it. |
| `--help` | Usage guide |

| Flag | Description |
|------|-------------|
| `--project` | Install into project scope `<PROJECT_ROOT>/.claude/settings.json` instead of the global default (per-project override) |
| `--user` | Force user/global scope `~/.claude/settings.json` — same as the default; kept as a backward-compatible alias |
| `--preset <name>` | Pick an element preset: `session` (default), `focused`, `qe`, `mix`, `full` |
| `--codex` | Force Codex command behavior even when invoked from Claude |
| `--claude` | Force Claude statusLine behavior even when invoked from Codex |

## Execution Procedure

### Step 0: Parse
Extract subcommand (`show` | `on` | `off` | `summary`), client flags (`--codex` | `--claude`), the scope flags `--project` and `--user`, and an optional `--preset <name>` value. For `summary`, capture the quoted `<text>` argument (or the `--clear` flag) and jump straight to the **`summary`** procedure — scope/preset flags do not apply. Valid preset names: `session`, `focused`, `qe`, `mix`, `full`, `wiki`. Anything else → fall back to `session`. On `--help` or invalid input, jump to **Step HELP**.

**Client resolution:** `--codex` forces Codex behavior; `--claude` forces Claude behavior. Otherwise infer from invocation (`$Qhud` or `CODEX_*` env → Codex; `/Qhud` or Claude settings context → Claude). If uncertain, show both Claude state and Codex command preview.

**Scope resolution:** default = user/global. `--project` selects project scope; `--user` is an explicit alias for the global default. If both `--project` and `--user` are passed, `--project` wins (the narrower, explicitly-requested override) and a one-line warning is printed: `[!] --project and --user both given; using --project (project scope).`

### Step 1: Resolve paths
1. **Claude script path** — Resolve the absolute path of `hooks/scripts/statusline.mjs` relative to this plugin (walk up from the skill directory until `hooks/scripts/statusline.mjs` exists). Store as `SCRIPT_ABS`. Because `SCRIPT_ABS` is absolute, a single global install runs correctly from any project directory.
2. **Codex command path** — Prefer `$HOME/.codex/scripts/qe-hud.mjs`; if absent, resolve repo/plugin `scripts/qe-hud.mjs`. Store as `CODEX_HUD_ABS`.
3. **Settings path** — Claude only: `--project` → `<PROJECT_ROOT>/.claude/settings.json` (project root resolved via the detection walk above); otherwise (default, or `--user`) → `$HOME/.claude/settings.json`.

### Step 2: Route by subcommand

#### `show` (default)
**Codex behavior:**
1. If `CODEX_HUD_ABS` exists → report **available**, print `node "<CODEX_HUD_ABS>"`.
2. If absent → report **not installed**, advise re-running QE install/update so `scripts/qe-hud.mjs` is copied into `~/.codex/scripts`.
3. Run a preview with `NO_COLOR=1 node "<CODEX_HUD_ABS>" --preset <preset>` when available.
4. Print binding examples:
   - zsh prompt: `precmd() { print -r -- "$(NO_COLOR=1 node ~/.codex/scripts/qe-hud.mjs --preset focused 2>/dev/null)"; }`
   - tmux status: `set -g status-right '#(NO_COLOR=1 node ~/.codex/scripts/qe-hud.mjs --preset focused 2>/dev/null)'`

**Claude behavior:**
1. Read settings JSON if it exists; otherwise treat as `{}`.
2. If `settings.statusLine?.command` contains `statusline.mjs` from this plugin → report **installed**, print the command.
3. If `settings.statusLine` exists but points elsewhere → report **other statusline installed** (don't claim ownership).
4. If absent → report **not installed**.
5. Regardless, run a preview: pipe a synthetic payload through `SCRIPT_ABS` and print the rendered line. Example payload:
   ```json
   { "context_window": { "used_percentage": 16, "total_input_tokens": 96000, "total_output_tokens": 2000 } }
   ```
   Command: `echo '<payload>' | NO_COLOR=1 node <SCRIPT_ABS>`

#### `on`
**Codex behavior:**
1. Do not edit `~/.codex/config.toml` for HUD; Codex has no native statusline setting to write.
2. Verify `CODEX_HUD_ABS` exists. If absent, print: `[!] Codex HUD command is not installed. Re-run QE install/update so ~/.codex/scripts/qe-hud.mjs is copied.`
3. Print the exact command and shell/tmux binding examples. Include `--preset <name>` if provided.
4. Run and print a one-line preview.

**Claude behavior:**
1. Read settings JSON (or start from `{}`).
2. If `statusLine` already points at our script → print "already installed" and exit.
3. If `statusLine` exists and points elsewhere → **ask before overwriting**. Show the existing value and require explicit confirmation in the same turn.
4. Write:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node \"<SCRIPT_ABS>\""
     }
   }
   ```
   If `--preset <name>` is present, append ` --preset <name>` to the command string. Merge into existing settings (preserve all other keys). Pretty-print with 2-space indent and a trailing newline.
5. Print the resulting `statusLine` block and remind: "Restart the Claude Code session or reload the window for it to appear."

#### `off`
**Codex behavior:**
1. Do not edit files automatically.
2. Print: `Codex HUD uses your shell/tmux binding. Remove the line that calls node ~/.codex/scripts/qe-hud.mjs.`
3. If `CODEX_HUD_ABS` exists, print its path; do not delete it (it is managed by install/uninstall).

**Claude behavior:**
1. Read settings JSON. If missing → print "not installed" and exit.
2. If `statusLine?.command` does NOT contain our plugin's `statusline.mjs` → print "statusLine belongs to another source; not removing" and exit.
3. Delete the `statusLine` key and write back.
4. Print confirmation.

#### `summary "<text>"`
Sets a free-form, one-line description of what the current session is working
on. The `summary` HUD element (in the `focused`, `qe`, and `full` presets) reads
it so a user juggling several terminals can tell sessions apart. This writes to
**project scope only** — the per-session binding file under the current
project's `.qe/`, never settings.json.

1. **Resolve the session id.** Read `.qe/state/current-session.json` → `session_id` (the SessionStart hook writes this every session). If the file is missing or has no `session_id`, abort with: `[!] No active session id found (.qe/state/current-session.json). The summary element needs it to key the HUD; re-open the session or run from a project where SessionStart has run.`
2. **Resolve the project root** via the same upward marker walk used by `--project` (`.git/`, `package.json`, `pyproject.toml`, `.qe/`, `.claude/`).
3. **Target file:** `<PROJECT_ROOT>/.qe/planning/.sessions/<session_id>.json`. Create the `.sessions/` directory if absent.
4. **Merge, don't clobber.** Read the existing JSON (or `{}`), set `summary` to the trimmed `<text>` (cap at ~120 chars; the HUD truncates to 48 for display) and `summaryAt` to the current ISO timestamp, **preserving `activePlanSlug` and any other keys.** For `summary --clear`, delete the `summary` and `summaryAt` keys instead. Pretty-print with 2-space indent + trailing newline.
5. Print confirmation and a one-line HUD preview, e.g.:
   ```
   [✓] Session summary set: "Refactoring auth flow"
       Shows in HUD presets: focused · qe · full  (run /Qhud on --preset focused)
   ```
6. If the active preset is `session`/`mix` (which don't include `summary`), add a hint: `[i] Your current preset doesn't show summary — switch with /Qhud on --preset focused.`

### Step HELP
Print:
```
Qhud — QE HUD statusline toggle

Usage:
  /Qhud                       Show current state and preview
  $Qhud                       Show Codex HUD command availability and preview
  /Qhud on                    Install globally into ~/.claude/settings.json (default)
  $Qhud on --preset focused   Print Codex shell/tmux binding using ~/.codex/scripts/qe-hud.mjs
  /Qhud off                   Remove the statusLine entry
  $Qhud off                   Explain how to remove the user-owned shell/tmux binding
  /Qhud on --project          Install into <PROJECT_ROOT>/.claude/settings.json (per-project override)
  /Qhud on --user             Same as the default (global); backward-compatible alias
  /Qhud on --preset focused   Install with the "focused" element preset
  /Qhud summary "<text>"      Set this session's one-line summary (shown by focused/qe/full)
  /Qhud summary --clear       Remove this session's summary
  /Qhud --codex               Force Codex command behavior
  /Qhud --claude              Force Claude statusLine behavior
  /Qhud --help                Show this help

Presets:
  session  ctx · 5h/7d · model · tokens · SIVS   (default, v6.6.3 shape)
  focused  summary · ctx · phase · task · SIVS   (current PSE state + session intent)
  qe       summary · SIVS · phase · task         (planning layer only)
  mix      ctx · O:S:H:X token distribution · SIVS
  full     every element (widest terminal)
  wiki     ctx · phase · wiki · SIVS

  Note: `summary` self-skips until set via `/Qhud summary "..."`, so focused/qe/full
  look identical to before on sessions with no summary.

HUD shows:  ctx N% (used)  │  <tokens> tok  │  SIVS C/C/C/C
            green <50 · yellow 50–80 · red ≥80
            SIVS letters: spec / implement / verify / supervise
                          C = claude, X = codex
Claude script: hooks/scripts/statusline.mjs
Codex cmd:    ~/.codex/scripts/qe-hud.mjs
Phase 2 (not yet in MVP): 5h / 7d rate limit %, model name, session cost.
```

## Safety Rules
- Never write to `settings.local.json`.
- Never claim Codex has a native statusline setting unless Codex exposes one; Codex HUD is command/proxy based.
- Never overwrite a foreign `statusLine` entry without explicit confirmation.
- Preserve all unrelated keys when merging into settings.json **or** the session binding file (`summary` must not drop `activePlanSlug`).
- On JSON parse failure, stop and report the exact path; do not auto-rewrite.
- Always write a pretty-printed JSON with 2-space indent and a trailing newline.
- `summary` writes only to `<PROJECT_ROOT>/.qe/planning/.sessions/<session_id>.json` — never settings.json.

## Will
- Add or remove a single `statusLine` entry in a single settings.json file.
- Verify and preview the Codex HUD command path.
- Print shell/tmux binding examples for Codex users.
- Set/clear this session's `summary` field in the project's session binding file (merge-only).
- Preview the rendered HUD string via a synthetic stdin payload.
- Detect and refuse to clobber a non-QE statusline without confirmation.

## Will Not
- Modify any file other than the chosen settings.json (Claude `on`/`off`) or the session binding file (for `summary`).
- Edit shell rc files, tmux config, or `~/.codex/config.toml` automatically for HUD.
- Touch plugin.json, hooks.json, or the script itself.
- Install into project scope without the `--project` flag (the default is always global).
