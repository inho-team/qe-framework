---
name: Qcc-setup
description: 'Sets up Claude Code and Codex shell aliases (cc, ccc, ccd, cx, cxd, cxde) for quick terminal launch. Supports macOS/Linux (zsh/bash) and Windows (PowerShell). Use when the user wants "claude shortcut", "codex shortcut", "cc alias", "cx alias", "shell alias setup", or "terminal shortcut".'
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---


# Qcc-setup — Claude Code & Codex Shell Alias Setup

## Role
Registers shell aliases so users can launch Claude Code and Codex with short commands instead of typing the full command each time.

## Aliases

| Alias | Command | Description |
|-------|---------|-------------|
| `cc` | `claude` | Launch Claude Code |
| `ccc` | `claude --chrome` | Chrome browser integration mode |
| `ccd` | `claude --dangerously-skip-permissions --chrome` | Skip permissions + Chrome integration |
| `cx` | `codex` | Launch Codex |
| `cxd` | `codex --dangerously-bypass-approvals-and-sandbox` | Skip all approvals + sandbox, interactive (Codex equivalent of `ccd`) |
| `cxde` | `codex exec --dangerously-bypass-approvals-and-sandbox` | Same bypass, non-interactive (`codex exec`) — for scripts/automation |

> Codex has no `--chrome` equivalent, so there is no `cxc`. The bypass flag is
> `--dangerously-bypass-approvals-and-sandbox` (EXTREMELY DANGEROUS — only for externally
> sandboxed environments). `cxd` is the interactive TUI; `cxde` is the non-interactive
> `codex exec` form for scripts/CI. Confirm with the user before adding `cxd`/`cxde`.

## Workflow

### Step 1: Detect OS and Shell

1. Run `uname -s` to detect the OS
2. Classify:
   - **macOS / Linux** → proceed to Step 2A
   - **Windows (MINGW/MSYS/CYGWIN or PowerShell)** → proceed to Step 2B

### Step 2A: macOS / Linux

#### Detect Shell Config File
1. Check `$SHELL` to determine the active shell
2. Target file:
   - zsh → `~/.zshrc`
   - bash → `~/.bashrc`
   - fish → `~/.config/fish/config.fish` (use `abbr` instead of `alias`)

#### Check for Existing Aliases
1. Read the target config file
2. Search for existing `alias cc=`, `alias ccc=`, `alias ccd=`, `alias cx=`, `alias cxd=`, `alias cxde=` lines
3. If any exist, inform the user and ask whether to overwrite or skip

#### Append Aliases
Add the following block to the end of the config file:

```bash
# Claude Code shortcuts
alias cc="claude"
alias ccc="claude --chrome"
alias ccd="claude --dangerously-skip-permissions --chrome"
# Codex shortcuts
alias cx="codex"
alias cxd="codex --dangerously-bypass-approvals-and-sandbox"
alias cxde="codex exec --dangerously-bypass-approvals-and-sandbox"
```

For **fish** shell, use:
```fish
# Claude Code shortcuts
abbr -a cc claude
abbr -a ccc claude --chrome
abbr -a ccd claude --dangerously-skip-permissions --chrome
# Codex shortcuts
abbr -a cx codex
abbr -a cxd codex --dangerously-bypass-approvals-and-sandbox
abbr -a cxde codex exec --dangerously-bypass-approvals-and-sandbox
```

#### Apply
Run `source <config-file>` to apply immediately.

### Step 2B: Windows (PowerShell)

#### Detect Profile Path
1. PowerShell profile path: `$PROFILE` (typically `~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`)
2. If the profile file does not exist, create it: `New-Item -Path $PROFILE -ItemType File -Force`

#### Check for Existing Aliases
1. Read the profile file
2. Search for existing `function cc`, `function ccc`, `function ccd`, `function cx`, `function cxd`, `function cxde` definitions
3. If any exist, inform the user and ask whether to overwrite or skip

#### Append Functions
Add the following block to the end of the profile file:

```powershell
# Claude Code shortcuts
function cc { claude $args }
function ccc { claude --chrome $args }
function ccd { claude --dangerously-skip-permissions --chrome $args }
# Codex shortcuts
function cx { codex $args }
function cxd { codex --dangerously-bypass-approvals-and-sandbox $args }
function cxde { codex exec --dangerously-bypass-approvals-and-sandbox $args }
```

> Note: PowerShell `Set-Alias` cannot pass arguments, so `function` is used instead.

#### Apply
Run `. $PROFILE` to apply immediately.

## Post-Setup

After successful setup, display:

```
Claude Code & Codex shortcuts installed!

  cc  → claude
  ccc → claude --chrome
  ccd → claude --dangerously-skip-permissions --chrome
  cx   → codex
  cxd  → codex --dangerously-bypass-approvals-and-sandbox
  cxde → codex exec --dangerously-bypass-approvals-and-sandbox

Restart your terminal or run `source <config>` to apply.
```

## Will
- Detect OS and shell automatically
- Check for duplicate aliases before adding
- Add Claude Code and Codex aliases to the appropriate config file
- Apply changes immediately

## Will Not
- Modify aliases unrelated to Claude Code or Codex
- Remove existing user aliases
- Add aliases without user confirmation
- Change shell settings beyond alias registration
