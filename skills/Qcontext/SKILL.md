---
name: Qcontext
user_invocable: false
description: 'Folder-aware context memory manager. Creates, views, updates, and refreshes per-folder context files in .qe/context/. Use when the user wants to manage folder-level context, optimize Claude memory, or set up context partitioning.'
invocation_trigger: When the user wants to create, view, update, or refresh folder-aware context files.
recommendedModel: sonnet
tier: core
---

# Qcontext — Folder-Aware Context Manager

## Role
Manages `.qe/context/` — a folder-aware context memory system that loads only relevant context based on the current working directory. This optimizes Claude's context window by partitioning project knowledge by domain.

## Why This Exists
Claude's context window is finite. A monorepo CLAUDE.md that describes frontend design systems, backend API patterns, infra provisioning rules, and data pipeline conventions wastes tokens when you're only editing a single controller. Qcontext splits that knowledge into folder-scoped files and loads only what matches the current working directory.

## Storage

```
.qe/context/
├── _registry.json       # folder-to-context mapping + timestamps
├── root.md              # always loaded (project-wide rules)
├── frontend.md          # loaded when working in src/frontend/**
├── backend.md           # loaded when working in src/backend/**
└── ...
```

## _registry.json Schema

```json
{
  "version": 1,
  "autoRefresh": true,
  "contexts": [
    {
      "name": "root",
      "file": "root.md",
      "pattern": "**/*",
      "description": "Project-wide conventions and rules",
      "updatedAt": "2026-04-07T09:00:00Z"
    },
    {
      "name": "frontend",
      "file": "frontend.md",
      "pattern": "src/frontend/**",
      "description": "React component patterns, design system tokens",
      "updatedAt": "2026-04-07T09:00:00Z"
    }
  ]
}
```

## CLI Interface

```
/Qcontext [subcommand] [options]
```

| Subcommand | Description |
|------------|-------------|
| (none)     | Show current context loading status for cwd |
| `show`     | Show all registered contexts with status |
| `init`     | Initialize .qe/context/ with root.md |
| `add`      | Register a new folder context |
| `edit`     | Open/update an existing context file |
| `remove`   | Unregister a context |
| `refresh`  | Refresh context files (scan target folders) |
| `status`   | Show which contexts would load for a given path |
| `--help`   | Show usage guide |

## Execution Procedure

### Step 0: Parse input
Parse the user's arguments. If `--help`, jump to **Step HELP**.

### Subcommand: `init`
1. Create `.qe/context/` directory if not exists
2. Create `_registry.json` with version 1 and empty contexts array
3. Create `root.md` with project-wide context:
   - Read CLAUDE.md and extract key conventions
   - Read project structure (top-level directories)
   - Read tech stack from package.json / build files
   - Write a concise summary (target: under 200 lines)
4. Register root.md in `_registry.json` with `pattern: "**/*"`
5. Add Context Loading section to CLAUDE.md if not present:

```markdown
## Context Loading
This project uses folder-aware context partitioning.
- Always read `.qe/context/root.md` at session start.
- Check `.qe/context/_registry.json` for folder-specific contexts.
- Load matching context files based on the current working directory.
```

6. Display summary

### Subcommand: `add`
**Usage:** `/Qcontext add <name> <glob-pattern> [--description "..."]`

**Examples:**
```
/Qcontext add frontend "src/frontend/**" --description "React patterns, design tokens"
/Qcontext add backend "src/backend/**"
/Qcontext add api "src/api/**" --description "REST endpoints, auth middleware"
```

**Procedure:**
1. Validate name is unique in registry
2. Validate glob pattern is valid
3. Create `.qe/context/{name}.md` with initial content:
   - Scan the target folder structure
   - Identify key files, patterns, dependencies
   - Generate a concise context summary (target: under 150 lines)
4. Add entry to `_registry.json`
5. Display the generated context for user review

### Subcommand: `edit`
**Usage:** `/Qcontext edit <name>`

1. Read the existing context file
2. Present contents to user
3. Apply user's requested changes
4. Update `updatedAt` in `_registry.json`

### Subcommand: `remove`
**Usage:** `/Qcontext remove <name>`

1. Confirm with user (name "root" requires extra confirmation)
2. Remove entry from `_registry.json`
3. Delete the context file
4. Display updated registry

### Subcommand: `show` (or no arguments)
1. Read `_registry.json`
2. For each context, check if the file exists and show staleness:

```
Folder Contexts (.qe/context/)
──────────────────────────────
  Name         Pattern             Updated        Status
  root         **/*                2h ago         current
  frontend     src/frontend/**     3d ago         stale
  backend      src/backend/**      1h ago         current

Active for cwd (src/frontend/components/):
  -> root.md
  -> frontend.md
```

A context is "stale" if files in its target pattern have been modified more recently than `updatedAt`.

### Subcommand: `refresh`
**Usage:** `/Qcontext refresh [name]`

- If name given: refresh only that context
- If no name: refresh all contexts that are stale

**Refresh procedure per context:**
1. Scan the folder matching the glob pattern
2. Detect changes since `updatedAt` (new files, deleted files, structural changes)
3. Update the context .md file with current information
4. Update `updatedAt` in `_registry.json`
5. Display what changed

### Subcommand: `status`
**Usage:** `/Qcontext status [path]`

- If path given: show which contexts would load for that path
- If no path: use current working directory

```
/Qcontext status src/backend/controllers/
  -> root.md (always)
  -> backend.md (matches src/backend/**)
```

### Step HELP

```
Qcontext — Folder-Aware Context Manager

Usage:
  /Qcontext                                    Show context status for cwd
  /Qcontext init                               Initialize .qe/context/ with root.md
  /Qcontext add <name> <pattern> [--desc ".."] Add a folder context
  /Qcontext edit <name>                        Edit a context file
  /Qcontext remove <name>                      Remove a context
  /Qcontext refresh [name]                     Refresh stale contexts
  /Qcontext show                               Show all contexts with status
  /Qcontext status [path]                      Show which contexts match a path
  /Qcontext --help                             Show this help

Examples:
  /Qcontext init
  /Qcontext add frontend "src/frontend/**" --desc "React patterns"
  /Qcontext add backend "src/backend/**"
  /Qcontext refresh
  /Qcontext status src/api/routes/

Context files: .qe/context/
Registry:      .qe/context/_registry.json
```

## Qrefresh Integration
When `/Qrefresh` is executed, it should also:
1. Check if `.qe/context/_registry.json` exists
2. If yes, detect stale contexts (files changed after `updatedAt`)
3. Auto-refresh stale contexts
4. Report refreshed contexts in the change summary

## Context Loading Rules (for all skills/agents)
1. **Always load** `root.md`
2. **Match by glob** — for each context in `_registry.json`, if the current working directory matches the pattern, load that context file
3. **Multiple matches OK** — a path can match multiple contexts (e.g., `src/frontend/api/` could match both `frontend.md` and `api.md`)
4. **Staleness warning** — if a loaded context is stale (>7 days), print a one-line warning suggesting `/Qcontext refresh`

## Content Guidelines for Context Files
Each context file should contain:
- **Domain summary** — what this area of the codebase does (2-3 lines)
- **Key conventions** — coding patterns, naming rules specific to this folder
- **Dependencies** — major libraries/frameworks used in this area
- **File structure** — important directories and their purpose
- **Common pitfalls** — things that frequently go wrong here

Keep each file **under 150 lines**. Context files are for orientation, not documentation.

## Will
- Create, read, update, delete context files in `.qe/context/`
- Manage `_registry.json` registry
- Scan folders to generate context summaries
- Detect and report stale contexts
- Add Context Loading section to CLAUDE.md

## Will Not
- Modify SIVS routing (use `/Qsivs-config`)
- Replace CLAUDE.md (context supplements it)
- Load contexts for folders outside the project
- Auto-refresh without user trigger (except via `/Qrefresh`)
