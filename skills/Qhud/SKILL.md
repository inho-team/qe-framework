---
name: Qhud
description: 'Toggles the QE HUD statusline (context %, session tokens, SIVS engine routing) by writing the statusLine entry into settings.json — global ~/.claude by default, per-project with --project. Use for /Qhud, HUD on, HUD off, statusline show, turn HUD on, enable HUD.'
invocation_trigger: When the user wants to turn the QE HUD statusline on or off, or check its current state.
recommendedModel: haiku
---

# Qhud — QE Framework Statusline Toggle

## Role
CLI-style skill that wires the QE HUD statusline into Claude Code by adding/removing a `statusLine` entry in `.claude/settings.json`. The HUD itself lives at `hooks/scripts/statusline.mjs`; this skill only manages activation.

## Scope
- **Default:** user/global scope → `~/.claude/settings.json`. Turn the HUD on once and it appears in every project; per-project context (SIVS routing, current phase, active task) is resolved at runtime by `statusline.mjs` from `process.cwd()`, so no per-project install is needed.
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
```

| Subcommand | Description |
|------------|-------------|
| (none) / `show` | Print current state (installed? where? preview output) |
| `on`   | Install statusLine entry |
| `off`  | Remove statusLine entry |
| `summary "<text>"` | Set this session's one-line summary ("what am I working on") shown by the `summary` element. `summary --clear` removes it. |
| `--help` | Usage guide |

| Flag | Description |
|------|-------------|
| `--project` | Install into project scope `<PROJECT_ROOT>/.claude/settings.json` instead of the global default (per-project override) |
| `--user` | Force user/global scope `~/.claude/settings.json` — same as the default; kept as a backward-compatible alias |
| `--preset <name>` | Pick an element preset: `session` (default), `focused`, `qe`, `mix`, `full` |

## Execution Procedure

### Step 0: Parse
Extract subcommand (`show` | `on` | `off` | `summary`), the scope flags `--project` and `--user`, and an optional `--preset <name>` value. For `summary`, capture the quoted `<text>` argument (or the `--clear` flag) and jump straight to the **`summary`** procedure — scope/preset flags do not apply. Valid preset names: `session`, `focused`, `qe`, `mix`, `full`. Anything else → fall back to `session`. On `--help` or invalid input, jump to **Step HELP**.

**Scope resolution:** default = user/global. `--project` selects project scope; `--user` is an explicit alias for the global default. If both `--project` and `--user` are passed, `--project` wins (the narrower, explicitly-requested override) and a one-line warning is printed: `[!] --project and --user both given; using --project (project scope).`

### Step 1: Resolve paths
1. **Script path** — Resolve the absolute path of `hooks/scripts/statusline.mjs` relative to this plugin (walk up from the skill directory until `hooks/scripts/statusline.mjs` exists). Store as `SCRIPT_ABS`. Because `SCRIPT_ABS` is absolute, a single global install runs correctly from any project directory.
2. **Settings path** — `--project` → `<PROJECT_ROOT>/.claude/settings.json` (project root resolved via the detection walk above); otherwise (default, or `--user`) → `$HOME/.claude/settings.json`.

### Step 2: Route by subcommand

#### `show` (default)
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
  /Qhud on                    Install globally into ~/.claude/settings.json (default)
  /Qhud off                   Remove the statusLine entry
  /Qhud on --project          Install into <PROJECT_ROOT>/.claude/settings.json (per-project override)
  /Qhud on --user             Same as the default (global); backward-compatible alias
  /Qhud on --preset focused   Install with the "focused" element preset
  /Qhud summary "<text>"      Set this session's one-line summary (shown by focused/qe/full)
  /Qhud summary --clear       Remove this session's summary
  /Qhud --help                Show this help

Presets:
  session  ctx · 5h/7d · model · tokens · SIVS   (default, v6.6.3 shape)
  focused  summary · ctx · phase · task · SIVS   (current PSE state + session intent)
  qe       summary · SIVS · phase · task         (planning layer only)
  mix      ctx · O:S:H:X token distribution · SIVS
  full     every element (widest terminal)

  Note: `summary` self-skips until set via `/Qhud summary "..."`, so focused/qe/full
  look identical to before on sessions with no summary.

HUD shows:  ctx N% (used)  │  <tokens> tok  │  SIVS C/C/C/C
            green <50 · yellow 50–80 · red ≥80
            SIVS letters: spec / implement / verify / supervise
                          C = claude, X = codex
Script:     hooks/scripts/statusline.mjs
Phase 2 (not yet in MVP): 5h / 7d rate limit %, model name, session cost.
```

## Safety Rules
- Never write to `settings.local.json`.
- Never overwrite a foreign `statusLine` entry without explicit confirmation.
- Preserve all unrelated keys when merging into settings.json **or** the session binding file (`summary` must not drop `activePlanSlug`).
- On JSON parse failure, stop and report the exact path; do not auto-rewrite.
- Always write a pretty-printed JSON with 2-space indent and a trailing newline.
- `summary` writes only to `<PROJECT_ROOT>/.qe/planning/.sessions/<session_id>.json` — never settings.json.

## Will
- Add or remove a single `statusLine` entry in a single settings.json file.
- Set/clear this session's `summary` field in the project's session binding file (merge-only).
- Preview the rendered HUD string via a synthetic stdin payload.
- Detect and refuse to clobber a non-QE statusline without confirmation.

## Will Not
- Modify any file other than the chosen settings.json (for `on`/`off`) or the session binding file (for `summary`).
- Touch plugin.json, hooks.json, or the script itself.
- Install into project scope without the `--project` flag (the default is always global).
