---
name: Qmigrate-legacy
description: Detects and archives artifacts from older QE structures into the current layout. Use when 'migrate legacy', 'clean up old structure', 'archive old qe files', '.qe migration', or '/Qmigrate-legacy'. Distinct from Qarchive (which archives completed tasks) — this skill relocates pre-current-version files like flat .qe/context/snapshot.md into the per-session sessions/_legacy/ bucket.
invocation_trigger: When the user wants to clean up old QE structure, audit legacy artifacts, or after upgrading the framework.
recommendedModel: haiku
---


# Qmigrate-legacy — Legacy Structure Migrator

## Role
Detects artifacts from previous QE structures and relocates them into the current layout. Backed by the registry in `hooks/scripts/lib/legacy-migrator.mjs` — the same engine that runs auto-eligible migrations at every SessionStart.

## How It Works

### Automatic Execution (default)
- The SessionStart hook calls `runAutoMigrations(cwd)` at every project open.
- Auto-eligible registry entries (`autoEligible: true`) run silently and idempotently.
- A one-line summary is surfaced in additionalContext only when something actually moved (`[Migrate] Legacy artifacts archived (...). Run /Qmigrate-legacy for details.`).
- The user does not need to invoke this skill manually for the common case.

### Manual Execution
- `/Qmigrate-legacy` — dry run, no filesystem changes. Lists every registered migration and the candidates it would touch.
- `/Qmigrate-legacy --apply` — apply every registered migration (including non-auto-eligible ones).
- `/Qmigrate-legacy --apply <id>` — apply a single migration by id (use this after reviewing the dry-run output).
- `/Qmigrate-legacy --list` — registry metadata only (id, description, autoEligible flag); no scanning.

## Procedure

### Step 1: Read the registry
```bash
node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const base=process.env.CLAUDE_PLUGIN_ROOT||join(process.env.HOME||process.env.USERPROFILE||'','.claude');const m=await import(pathToFileURL(join(base,'hooks','scripts','lib','legacy-migrator.mjs')).href);console.log(JSON.stringify(m.listMigrations(), null, 2))})()"
```

### Step 2: Dry-run scan
```bash
node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const base=process.env.CLAUDE_PLUGIN_ROOT||join(process.env.HOME||process.env.USERPROFILE||'','.claude');const m=await import(pathToFileURL(join(base,'hooks','scripts','lib','legacy-migrator.mjs')).href);console.log(JSON.stringify(m.dryRunAll(process.cwd()), null, 2))})()"
```
Show the user every `{id, description, candidates[]}` entry so they can decide whether to apply.

### Step 3: Apply (only when user confirms or passes `--apply`)
```bash
# All migrations:
node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const base=process.env.CLAUDE_PLUGIN_ROOT||join(process.env.HOME||process.env.USERPROFILE||'','.claude');const m=await import(pathToFileURL(join(base,'hooks','scripts','lib','legacy-migrator.mjs')).href);for (const e of m.listMigrations()) { const r = m.applyById(process.cwd(), e.id); if (r) console.log(e.id, JSON.stringify(r)); }})()"

# Single migration:
node -e "(async()=>{const {pathToFileURL}=await import('url');const {join}=await import('path');const base=process.env.CLAUDE_PLUGIN_ROOT||join(process.env.HOME||process.env.USERPROFILE||'','.claude');const m=await import(pathToFileURL(join(base,'hooks','scripts','lib','legacy-migrator.mjs')).href);console.log(JSON.stringify(m.applyById(process.cwd(), '<id>'), null, 2))})()"
```

### Step 4: Report
Summarize what moved (`{src} → {dst}`) and what was skipped (with reason). For skipped-due-to-collision entries, advise the user to inspect both the source and destination before forcing a move manually.

## Adding a New Legacy Pattern
When a future framework refactor leaves another stale structure behind, append an entry to `MIGRATIONS` in `hooks/scripts/lib/legacy-migrator.mjs`:
```js
{
  id: 'unique-kebab-id',
  description: 'Human-readable summary that surfaces in dry-run',
  autoEligible: false, // flip to true only after real-world validation
  scan: scanFn, // (root) => Array<{ src, dst }>
}
```
Add a matching unit test in `hooks/scripts/lib/__tests__/legacy-migrator.test.mjs`.

## Will
- Auto-archive flat `.qe/context/{snapshot,SNAPSHOT_SUMMARY,decisions,compact-trigger}` into `sessions/_legacy/`
- Auto-archive flat `.qe/handoffs/HANDOFF_*.md` into `sessions/_legacy/`
- Provide a dry-run report on demand
- Refuse to overwrite a destination that already exists

## Will Not
- Delete any artifact (everything moves; nothing is removed)
- Touch files outside `.qe/`
- Run non-auto-eligible migrations without an explicit `--apply`
- Block SessionStart on migration failure (the hook swallows errors)
