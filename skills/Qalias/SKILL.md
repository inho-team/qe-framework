---
name: Qalias
description: Defines aliases for folders, paths, and commands. Allows quick reference to long paths or complex commands using short names. Use when the user requests "alias", "shortcut", or similar.
---

> Shared principles: see core/PRINCIPLES.md

# Qalias — Alias Management

## Role
A skill for registering and managing aliases for folders, paths, and commands.
Saved to `.qe/aliases.md` and referenced by all skills and agents.

## Storage Location
`.qe/aliases.md`

## Alias Format

```markdown
# QE Aliases

## Folder Aliases
| Alias | Actual Path | Description |
|-------|-------------|-------------|
| analysis-folder | .qe/analysis/ | Project analysis results |
| tasks | .qe/tasks/pending/ | Pending work items |
| archive | .qe/.archive/ | Completed work storage |
| source | src/ | Source code root |

## Command Aliases
| Alias | Actual Command | Description |
|-------|----------------|-------------|
| spec | /Qgenerate-spec | Generate task spec |
| run | /Qrun-task | Execute task |
| refresh | /Qrefresh | Refresh analysis |
```

## Usage

### Registration
Register when the user makes a natural language request:
- "I'll call the src folder 'source'"
- "Register documents/analysis as 'analysis-folder'"
- "Shorten /Qgenerate-spec to 'spec'"

Register flexibly as the user describes, without strict formatting requirements.

### Lookup
- `/Qalias` — Display the full alias list
- `/Qalias <search-term>` — Search for a specific alias

### Deletion
- "Delete the source alias"
- "/Qalias remove source"

### Automatic Resolution
All skills and agents resolve registered aliases to their actual paths/commands when encountered in user commands.
- User: "Open analysis-folder" → open `.qe/analysis/`
- User: "Make a spec" → run `/Qgenerate-spec`

## Alias Rules
- Confirm before overwriting on duplicate alias registration
- Aliases are case-insensitive
- Both Korean and English are supported
- Aliases may contain spaces (e.g., "meeting docs" → documents/meetings/)
- Paths without aliases are still usable (aliases are a convenience feature)

## Qprofile Integration
- When Qprofile detects a repeated usage pattern, it suggests registering an alias
- If the user approves, it is automatically added to `.qe/aliases.md`

## Will
- Register, look up, and delete aliases
- Flexible registration based on natural language
- Manage .qe/aliases.md
- Suggest alias candidates in coordination with Qprofile

## Will Not
- Make operation impossible without aliases (aliases are an optional convenience feature)
- Register system paths (/, /usr, etc.) as aliases
- Automatically register aliases without user consent
