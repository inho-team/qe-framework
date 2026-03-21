---
name: Qproject-sync
description: "Synchronizes a project with a reference/standard project. Use when syncing project code with a template or upstream standard, merging upstream changes, or keeping a project aligned with a canonical base. Trigger phrases: 'project sync', 'sync standard', 'sync template', 'merge upstream', '프로젝트 동기화', '스탠다드 싱크', '템플릿 동기화'. Distinct from Qrefresh which refreshes .qe/ analysis data — this syncs actual project source files with a reference/standard project."
user_invocable: true
metadata:
  author: anthropic
  version: "1.0.0"
---

# Qproject-sync — Project Sync with Standard/Reference

## Role

Synchronizes the current project with a reference (standard/template) project.
Classifies each changed file by sync category, shows a report, and applies selective merges based on user choices.

> **MANDATORY:** All user confirmations MUST use the `AskUserQuestion` tool. Never output options as plain text.

## Examples

```
User: "스탠다드 싱크해줘"
→ Qproject-sync: diff against configured standard, show classification report, apply chosen merges

User: "sync this project with ~/templates/front-std"
→ Qproject-sync: accepts explicit path, runs full sync workflow

User: "프로젝트 동기화 dry-run"
→ Qproject-sync: shows classification report only, applies nothing

User: "merge upstream changes automatically"
→ Qproject-sync: --auto mode, applies only "Standard update" files without asking per file
```

---

## Step 0: Resolve Reference Path

1. Check if user provided an explicit path (quoted or inline).
2. If not, check `.qe/config.json` or `.qe/sync.json` for `standardProjectPath`.
3. If still not found, use `AskUserQuestion` to ask: "Enter the path to the reference/standard project."
4. Verify the path exists. If not, report error and stop.

---

## Step 1: Diff Analysis

For each file in the reference project:

```bash
# List files relative to root in both projects
diff -rq --exclude=".git" --exclude="node_modules" --exclude="dist" \
  <reference_path> <current_path>
```

Additionally, track git history to detect customizations:
- A file is **customized** if the current project has commits modifying it beyond the initial template copy.
- A file is **default** if the current project file matches the original template baseline (or has no local commits touching it).

---

## Step 2: Classify Each Changed File

Assign each differing file to one of four categories:

| Category | Condition | Default Action |
|----------|-----------|----------------|
| **Standard update** | Reference changed, current is at baseline (not customized) | Auto-merge |
| **Project-specific** | Current customized AND reference also changed | Manual review |
| **New in standard** | File exists only in reference | Suggest adding |
| **Removed from standard** | File removed from reference, still in current | Suggest removing |

Heuristics for "customized":
- File has local commits not present in the template's initial commit hash (if tracked).
- File content differs from both the reference AND a stored baseline snapshot in `.qe/sync-baseline/`.
- When baseline is unavailable, treat any content difference as potentially customized and flag for review.

---

## Step 3: Classification Report

Always show this report before any changes are applied.

```
== Qproject-sync Report ==

Reference: <path>
Current:   <cwd>

[Standard update]  (safe to auto-merge — N files)
  src/lib/api-client.ts
  config/vite.config.ts

[Project-specific] (manual review required — N files)
  src/features/auth/AuthPage.tsx   <-- both sides changed
  .env.example

[New in standard]  (not in current project — N files)
  src/shared/ui/Toast.tsx

[Removed from standard] (reference deleted — N files)
  src/legacy/OldModal.tsx

Mode: <dry-run | auto | interactive>
```

If `--dry-run`, stop here. Output the report and exit.

---

## Step 4: Execute Selective Sync

### --dry-run mode
Output the report only. No file changes.

### --auto mode
- Apply all **Standard update** files automatically.
- Skip **Project-specific** files (log them as "skipped — manual review needed").
- For **New in standard**: apply automatically only if the file has no counterpart in current project.
- For **Removed from standard**: skip (never auto-delete; always ask).
- Report a summary of applied vs skipped files.

### --interactive mode (default when no flag given)
For each file group, use `AskUserQuestion` with these options:

**Standard update group:**
- Apply all (N files)
- Review each file individually
- Skip all

**Project-specific group:**
- Open 3-way diff view instruction (show command to run)
- Apply reference version (overwrite local — confirm once more)
- Keep current version
- Skip

**New in standard:**
- Add all suggested files
- Select which to add
- Skip

**Removed from standard:**
- Remove files from current project
- Keep files
- Skip

---

## Step 5: API Signature Migration

After file merges are applied, detect renamed or changed function signatures between reference and current.

1. Run a grep-based scan on the merged files for exported function/type names that appear in the reference but not in the current codebase (or vice versa).
2. Build a rename map: `{ oldName -> newName }` based on reference diff context.
3. For each call site in the current project that uses an old name:
   - Report the file and line number.
   - Propose the renamed call.
4. Use `AskUserQuestion`: "Apply these N API renames automatically?" (Yes / Review each / Skip).
5. Apply approved renames via targeted file edits (preserve surrounding code).

---

## Step 6: Summary Report

After sync completes:

```
== Sync Complete ==

Applied:  N files
Skipped:  N files (manual review)
Added:    N new files
Removed:  N files
API renames applied: N

Files requiring manual review:
  - src/features/auth/AuthPage.tsx
  - .env.example

Run `git diff` to review all changes before committing.
```

Suggest running Qcommit after review.

---

## Modes Reference

| Flag | Behavior |
|------|----------|
| `--dry-run` | Report only, no changes |
| `--auto` | Apply safe merges without per-file prompts |
| `--interactive` | Per-file decisions via AskUserQuestion (default) |

---

## Will

- Accept explicit reference path or read from `.qe/` config
- Run diff analysis and classify files into four categories
- Show classification report before any changes
- Apply selective sync based on mode and user choices
- Detect and auto-migrate renamed API signatures at call sites
- Support --dry-run, --auto, and --interactive modes

## Will Not

- Auto-delete files from the current project without confirmation
- Overwrite **Project-specific** files in --auto mode
- Sync `.git/`, `node_modules/`, `dist/`, or secrets (`.env`)
- Modify files outside the current project root
- Substitute for Qrefresh (which refreshes .qe/ analysis, not project source)
