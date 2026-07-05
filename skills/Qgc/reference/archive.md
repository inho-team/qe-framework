---
source-skill: Qarchive
subcommand: Qgc archive
delegate: Earchive-executor
---

# Qgc archive - Task Archive

## Role
A subcommand that archives completed task files (TASK_REQUEST,
VERIFY_CHECKLIST) and CLAUDE.md snapshots by version.
**Runs automatically in the background** without prompting or notifying the
user when invoked by task completion flows.

Actual archive work is delegated to the `Earchive-executor` sub-agent. Preserve
that delegation contract; do not inline archive file-moving logic into `Qgc`.

## How It Works

### Automatic Execution (default)
- When a task is completed in Qrun-task, Earchive-executor is automatically
  called in the background.
- Archives quietly without notifying the user.

### Manual Execution
- The user can invoke it directly with `/Qgc archive`.
- In this case, the archive results are displayed.

## Archive Procedure

### Step 1: Detect Completed Tasks
- Search for completed (all checkboxes checked) TASK_REQUEST files in
  `.qe/tasks/pending/`
- Find corresponding VERIFY_CHECKLIST in `.qe/checklists/pending/`

### Step 2: Determine Version
Check the existing latest version in the `.qe/.archive/` directory and decide
the next version.
- Version format: `vX.Y.Z`
- First archive: `v0.1.0`
- After that: minor version auto-incremented (`v0.1.0` -> `v0.2.0` -> `v0.3.0`)
- When called manually, version can be specified with `--major`, `--minor`,
  `--patch` flags

### Step 3: Execute Archive
```text
.qe/.archive/vX.Y.Z/
|-- CLAUDE.md
|-- tasks/
|   `-- TASK_REQUEST_{UUID}.md
`-- checklists/
    `-- VERIFY_CHECKLIST_{UUID}.md
```

- **Move** completed files from `pending/` to the archive folder (move, not copy)
- **Copy** CLAUDE.md (preserve original)
- Auto-create archive directory if it does not exist

### Step 4: Update Task Log
- Confirm the status of archived tasks is complete in `.qe/TASK_LOG.md`
- If a completed task is already complete in the task log, leave it as-is

## Archive Rules
- Tasks that are not complete are not archived.
- Already archived tasks are not archived again.
- The archive folder is not included in `.gitignore` (history is preserved).
- If an error occurs during background execution, it is not reported to the user
  (logged only).

## Delegation Contract

Invoke `Earchive-executor` for actual archive work.

`Earchive-executor` owns:
- detecting completed pending TASK_REQUEST files
- matching VERIFY_CHECKLIST files
- selecting `.qe/.archive/vX.Y.Z/`
- moving task/checklist files
- copying CLAUDE.md
- preventing duplicate archives
- logging background errors without notifying the user

## Will
- Archive completed TASK_REQUEST/VERIFY_CHECKLIST
- Save CLAUDE.md snapshot
- Auto-determine version
- Auto-create archive directory

## Will Not
- Archive incomplete tasks
- Suggest or notify user about archiving during automatic execution
- Modify source code
- Delete archived files
