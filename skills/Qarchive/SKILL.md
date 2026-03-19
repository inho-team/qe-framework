---
name: Qarchive
description: "Archives completed task files into .qe/.archive/. Runs automatically after Qrun-task completes. Use for archive, 아카이브, 정리, archive tasks, clean up completed tasks."
---

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qarchive — Task Archive

## Role
A skill that archives completed task files (TASK_REQUEST, VERIFY_CHECKLIST) and CLAUDE.md snapshots by version.
**Runs automatically in the background** without prompting or notifying the user.
Actual archive work is delegated to the `Earchive-executor` sub-agent.

## How It Works

### Automatic Execution (default)
- When a task is ✅ completed in Qrun-task, Earchive-executor is automatically called in the background.
- Archives quietly without notifying the user.

### Manual Execution
- The user can invoke it directly with `/Qarchive`.
- In this case, the archive results are displayed.

## Archive Procedure

### Step 1: Detect Completed Tasks
- Search for completed (all checkboxes checked) TASK_REQUEST files in `.qe/tasks/pending/`
- Find corresponding VERIFY_CHECKLIST in `.qe/checklists/pending/`

### Step 2: Determine Version
Check the existing latest version in the `.qe/.archive/` directory and decide the next version.
- Version format: `vX.Y.Z`
- First archive: `v0.1.0`
- After that: minor version auto-incremented (v0.1.0 → v0.2.0 → v0.3.0)
- When called manually, version can be specified with `--major`, `--minor`, `--patch` flags

### Step 3: Execute Archive
```
.qe/.archive/vX.Y.Z/
├── CLAUDE.md                          ← Snapshot copy of current CLAUDE.md
├── tasks/
│   └── TASK_REQUEST_{UUID}.md         ← Moved from pending
└── checklists/
    └── VERIFY_CHECKLIST_{UUID}.md     ← Moved from pending
```

- **Move** completed files from `pending/` to the archive folder (move, not copy)
- **Copy** CLAUDE.md (preserve original)
- Auto-create archive directory if it does not exist

### Step 4: Update CLAUDE.md
- Confirm the status of archived tasks is ✅
- If a completed task is already ✅ in the CLAUDE.md task list, leave it as-is

## Archive Rules
- Tasks that are not complete (🔲, 🔶) are not archived.
- Already archived tasks are not archived again.
- The archive folder is not included in `.gitignore` (history is preserved).
- If an error occurs during background execution, it is not reported to the user (logged only).

## Will
- Archive completed TASK_REQUEST/VERIFY_CHECKLIST
- Save CLAUDE.md snapshot
- Auto-determine version
- Auto-create archive directory

## Will Not
- Archive incomplete tasks
- Suggest or notify user about archiving (during automatic execution)
- Modify source code
- Delete archived files
