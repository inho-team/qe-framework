---
name: Qcc-setup
description: Sets up Claude Code shell aliases (cc, ccc, ccd) for quick terminal launch. Supports macOS/Linux (zsh/bash) and Windows (PowerShell). Use when the user wants "claude shortcut", "cc alias", "shell alias setup", or "터미널 단축어".
---

> Shared principles: see core/PRINCIPLES.md

# Qcc-setup — Claude Code Shell Alias Setup

## Role
Registers shell aliases so users can launch Claude Code with short commands instead of typing the full command each time.

## Aliases

| Alias | Command | Description |
|-------|---------|-------------|
| `cc` | `claude` | Claude Code 실행 |
| `ccc` | `claude --chrome` | Chrome 브라우저 연동 모드 |
| `ccd` | `claude --dangerously-skip-permissions --chrome` | 권한 스킵 + Chrome 연동 |

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
2. Search for existing `alias cc=`, `alias ccc=`, `alias ccd=` lines
3. If any exist, inform the user and ask whether to overwrite or skip

#### Append Aliases
Add the following block to the end of the config file:

```bash
# Claude Code shortcuts
alias cc="claude"
alias ccc="claude --chrome"
alias ccd="claude --dangerously-skip-permissions --chrome"
```

For **fish** shell, use:
```fish
# Claude Code shortcuts
abbr -a cc claude
abbr -a ccc claude --chrome
abbr -a ccd claude --dangerously-skip-permissions --chrome
```

#### Apply
Run `source <config-file>` to apply immediately.

### Step 2B: Windows (PowerShell)

#### Detect Profile Path
1. PowerShell profile path: `$PROFILE` (typically `~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`)
2. If the profile file does not exist, create it: `New-Item -Path $PROFILE -ItemType File -Force`

#### Check for Existing Aliases
1. Read the profile file
2. Search for existing `function cc`, `function ccc`, `function ccd` definitions
3. If any exist, inform the user and ask whether to overwrite or skip

#### Append Functions
Add the following block to the end of the profile file:

```powershell
# Claude Code shortcuts
function cc { claude $args }
function ccc { claude --chrome $args }
function ccd { claude --dangerously-skip-permissions --chrome $args }
```

> Note: PowerShell `Set-Alias` cannot pass arguments, so `function` is used instead.

#### Apply
Run `. $PROFILE` to apply immediately.

## Post-Setup

After successful setup, display:

```
Claude Code shortcuts installed!

  cc  → claude
  ccc → claude --chrome
  ccd → claude --dangerously-skip-permissions --chrome

Restart your terminal or run `source <config>` to apply.
```

## Will
- Detect OS and shell automatically
- Check for duplicate aliases before adding
- Add aliases to the appropriate config file
- Apply changes immediately

## Will Not
- Modify aliases unrelated to Claude Code
- Remove existing user aliases
- Add aliases without user confirmation
- Change shell settings beyond alias registration
