---
name: Qmigrate-tasks
description: "Migrates TASK_REQUEST/VERIFY_CHECKLIST files from project root into .qe/tasks/ and .qe/checklists/ directories. Use when task files are scattered in the root, when upgrading to the .qe/ structure, or when CLAUDE.md needs convention updates."
---


# Task File Migration Skill

## Role
Migrates existing `TASK_REQUEST_*.md` and `VERIFY_CHECKLIST_*.md` files in the project root into the `.qe/tasks/` and `.qe/checklists/` directory structure, and updates `CLAUDE.md` to match the latest conventions.

## Role Boundaries
- This skill focuses **only on file migration and CLAUDE.md updates**.
- It does not modify task content or create new tasks.

## Target Directory Structure

```
project-root/
├── CLAUDE.md
└── .qe/
    ├── tasks/
    │   ├── pending/          ← 🔲 Not yet started
    │   ├── in-progress/      ← 🔶 In progress
    │   ├── completed/        ← ✅ Done
    │   └── on-hold/          ← ⏸️ On hold
    └── checklists/
        ├── pending/
        ├── in-progress/
        ├── completed/
        └── on-hold/
```

## Execution Steps

### Step 1: Scan

1. Search the project root for `TASK_REQUEST_*.md` and `VERIFY_CHECKLIST_*.md` files
2. **Skip** files already located inside `.qe/tasks/` or `.qe/checklists/`
3. Read `CLAUDE.md` to determine task status for each UUID

**If no files need migration:**
```
No files to migrate in the project root.
All files are already in the .claude/ directory structure, or no TASK_REQUEST/VERIFY_CHECKLIST files exist.
```
→ Proceed directly to Step 2 (CLAUDE.md update check)

### Step 2: Determine Status

Read the status of each UUID from the task list table in `CLAUDE.md` to determine the target directory.

| CLAUDE.md Status | Target Directory |
|------------------|-----------------|
| 🔲 (or no status) | `pending/` |
| 🔶 | `in-progress/` |
| ✅ | `completed/` |
| ⏸️ | `on-hold/` |

- If `CLAUDE.md` is missing or the UUID's status cannot be found, default to `pending/`
- If all items in a `VERIFY_CHECKLIST` are checked (`- [x]`), classify as `completed/` regardless of status

### Step 3: Preview and Approval

Show the migration plan to the user and obtain approval.

**Preview Format:**
```markdown
## Migration Plan

**Target Files: N**

| File | Current Location | Destination | Status |
|------|-----------------|-------------|--------|
| TASK_REQUEST_a1b2c3d4.md | root | .qe/tasks/pending/ | 🔲 |
| VERIFY_CHECKLIST_a1b2c3d4.md | root | .qe/checklists/pending/ | 🔲 |
| TASK_REQUEST_e5f6g7h8.md | root | .qe/tasks/completed/ | ✅ |
| VERIFY_CHECKLIST_e5f6g7h8.md | root | .qe/checklists/completed/ | ✅ |

**CLAUDE.md Update:** Updates the file rules section to the latest convention.

Proceed?
```

**Do not continue until user approval is received.**

### Step 4: Move Files

1. Create the necessary directories (`mkdir -p .qe/tasks/{pending,in-progress,completed,on-hold}`, etc.)
2. Move each file to its target directory (`mv`)
3. Place TASK_REQUEST and VERIFY_CHECKLIST with the same UUID in the same status directory

### Step 5: Update CLAUDE.md

Check whether the "File Rules" section in `CLAUDE.md` is in the old format, and replace it with the latest convention.

**Old Format Indicators:**
- The `### File Name Rules` section lists `TASK_REQUEST_{UUID}.md` without a directory path
- No directory structure tree is present
- The status table has no `Directory` column
- The ⏸️ on-hold status is absent

**Replacement Target:** From `## File Rules` up to (but not including) the next `##` section

**New Format:**
```markdown
## File Rules

### Directory Structure
\```
project-root/
├── CLAUDE.md
└── .qe/
    ├── tasks/
    │   ├── pending/          ← Immediately after creation (not yet started)
    │   ├── in-progress/      ← Work in progress
    │   ├── completed/        ← Work complete
    │   └── on-hold/          ← Work on hold
    └── checklists/
        ├── pending/
        ├── in-progress/
        ├── completed/
        └── on-hold/
\```

### File Name Rules
- Task request: `.qe/tasks/{status}/TASK_REQUEST_{UUID}.md`
- Verification checklist: `.qe/checklists/{status}/VERIFY_CHECKLIST_{UUID}.md`
- One task shares the same UUID across both files.
- `{status}` is one of: `pending`, `in-progress`, `completed`, `on-hold`.

### Task Status
| Status | Directory | Meaning |
|--------|-----------|---------|
| 🔲 Not started | `pending/` | Work not yet begun |
| 🔶 In progress | `in-progress/` | Currently being worked on |
| ⏸️ On hold | `on-hold/` | Temporarily paused |
| ✅ Complete | `completed/` | All VERIFY_CHECKLIST items checked. **No further reference needed.** |

### Completion Criteria
- ✅ Complete when **all checkboxes in VERIFY_CHECKLIST are checked**
- Completed files are moved to the `completed/` directory
- Completed task files **do not need to be referenced again.**
```

**Note:**
- Do not modify the `## Task List` table or other sections (to prevent data loss)
- If already in the latest format, skip the update and notify the user

### Step 6: Report Results

```markdown
## ✅ Migration Complete

**Files Moved:** N
- tasks: A (pending: X, in-progress: Y, completed: Z, on-hold: W)
- checklists: B

**CLAUDE.md Updated:** File rules section updated (or "Already up to date")

**Note:** Completed (✅) task files are stored in .qe/tasks/completed/ and do not need to be referenced again.
```

## Special Cases

### When CLAUDE.md Does Not Exist
- Move all files to `pending/`
- Skip CLAUDE.md update
- Recommend the user create CLAUDE.md with `/Qgenerate-spec`

### When Only TASK_REQUEST Exists Without VERIFY_CHECKLIST (or Vice Versa)
- Move only the existing files
- Notify the user of the missing paired file

### When the Same UUID File Exists Both in .claude/ Structure and the Root
- Prioritize the file in .claude/, do not move the root file
- Notify the user of the conflict and recommend manual resolution
