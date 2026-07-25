---
name: Qmemory
description: "Manage project memory — add, list, prune cross-session knowledge. Use when asked to remember conventions, gotchas, or decisions."
user_invocable: false
recommendedModel: haiku
---

# Qmemory — Project Memory Manager

## Role
Manages `.qe/project-memory.json` for persistent cross-session knowledge. Stores conventions, gotchas, decisions, and patterns with TTL-based expiry.

## Commands

### `/Qmemory add "content" [--type TYPE] [--priority PRIORITY] [--tags tag1,tag2]`

Add a memory entry.

- **type**: `convention` | `gotcha` | `decision` | `pattern` (default: `convention`)
- **priority**: `permanent` | `high` | `normal` | `low` (default: `normal`)
- **tags**: comma-separated labels for filtering

**TTL by priority:**
| Priority | TTL |
|----------|-----|
| permanent | never expires |
| high | 30 days |
| normal | 7 days |
| low | 1 day |

### `/Qmemory list [--type TYPE] [--tag TAG]`

List active (non-expired) memories. Optionally filter by type or tag. Display as a table with id, type, priority, content, and expiry.

### `/Qmemory prune`

Remove expired entries. Report how many were pruned.

### `/Qmemory clear`

Clear all entries. **Confirm with the user before executing.**

## Execution Procedure

### Step 1: Parse command
Extract the subcommand (`add`, `list`, `prune`, `clear`) and any flags from the user input.

### Step 2: Execute
Use `hooks/scripts/lib/project-memory.mjs` functions:

- **add**: Call `addMemory(cwd, content, type, { priority, source: 'user', tags })`. Print the created entry.
- **list**: Call `getActiveMemories(cwd)`, or `getMemoriesByType`/`getMemoriesByTag` if filtered. Display as a formatted table.
- **prune**: Call `pruneExpired(cwd)`. Report count.
- **clear**: Confirm first, then call `clearAll(cwd)`.

### Step 3: Display result
Show a concise confirmation or table. No verbose explanations.

## Will
- Store and retrieve project-specific knowledge across sessions
- Auto-prune expired entries on list/add operations

## Will Not
- Store secrets or credentials
- Replace `.qe/analysis/` files (those are for codebase structure)
- Exceed 50 entries (warn user at 40, refuse at 50)

## Handoff
```
Project memory: {count} active entries ({permanent} permanent, {expiring} expiring)
```
