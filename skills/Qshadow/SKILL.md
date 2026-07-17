---
name: Qshadow
description: Manage the QE shadow-git snapshot store — create, list, diff, restore, and prune isolated shadow snapshots. Use when the user wants to checkpoint, review, or recover working-tree state without touching any real git repo.
invocation_trigger: When the user says snapshot, shadow, checkpoint, review shadow history, restore from snapshot, or prune snapshots.
recommendedModel: haiku
---

# Qshadow — Shadow-Git Snapshot Manager

## Role
Provides safe, isolated working-tree snapshots via an internal shadow git repository
stored at `<project-root>/.qe/.snapshots/shadow.git`. The shadow store is completely
separate from any real `.git` directory — it never contaminates `qe-framework/.git`,
`nested-repo/.git`, or any other tracked repo.

Hooks trigger snapshots automatically on every `Write`/`Edit` tool use. This skill
exposes the five subcommands for manual inspection and recovery.

## Local-Only Guarantee
The shadow repo has **zero remotes** and the anti-push guard (`assertNoRemote`) runs
before every commit. No shadow data can be pushed anywhere. If a remote is ever
found, the snapshot is aborted immediately.

## Subcommands

### `snapshot` — create a checkpoint
```
node qe-framework/scripts/qe-shadow.mjs snapshot [--source <label>] [--sid <id>]
```
Stages all working-tree changes and creates one shadow commit. The commit message
records the ISO timestamp and trigger source (`edit`, `write`, `codex`, or `manual`).
Skipped gracefully if nothing has changed or if a concurrent snapshot holds the lock.

### `list` — browse recent snapshots
```
node qe-framework/scripts/qe-shadow.mjs list [<n>]
```
Prints the `n` most recent snapshot commits, newest first (default: 20).

### `diff` — inspect changes since a snapshot
```
node qe-framework/scripts/qe-shadow.mjs diff <ref>
```
Shows the diff between `<ref>` and the current shadow `HEAD`. `<ref>` can be a short
SHA from `list` output or any git expression (e.g. `HEAD~3`).

### `restore` — recover files from a snapshot
```
node qe-framework/scripts/qe-shadow.mjs restore <ref> [path] [--confirm] [--force]
```
**Dry-run by default** — prints which files would be restored without touching anything.

To actually overwrite files, both flags may be required:
- `--confirm` (or `--yes`): applies the restore.
- `--force`: additionally required if any of the target files have local modifications
  (prevents accidental data loss; the restore is aborted without it).

Path validation rules (all violations exit non-zero):
- `path` must be relative — absolute paths are rejected.
- `path` must not escape the project root via `..` components.
- `path` must not use git pathspec magic (leading `:`).
- `ref` is verified via `rev-parse --verify` before any file operation.

### `prune` — enforce the retention policy
```
node qe-framework/scripts/qe-shadow.mjs prune
```
Removes snapshots older than 72 hours or beyond the 200-commit cap using a safe
`git commit-tree` rewrite (non-destructive: aborts on any failure without modifying
the existing branch). Always keeps at least 1 recovery point — never empties the
shadow repo.

## Configuration

All knobs are optional — the defaults match the original hook behaviour.

| Variable / File | Default | Effect |
|---|---|---|
| `QE_SHADOW_DEBOUNCE_MS` | `2000` | Minimum milliseconds between auto-snapshots. If the last HEAD commit is younger than this window, the incoming snapshot is silently skipped. Set to `0` to disable debouncing entirely. |
| `QE_SHADOW_DISABLE` | _(unset)_ | Set to `1`, `true`, or `yes` to disable snapshotting globally for the current process. `list`/`diff`/`restore`/`prune` are unaffected. |
| `.qe/.shadow-disabled` | _(absent)_ | Create this empty marker file inside a project's `.qe/` directory to disable snapshotting for that project only. Remove the file to re-enable. `list`/`diff`/`restore`/`prune` still work while the marker is present. |
| `QE_SHADOW_MAX_SNAPSHOTS` | `200` | Maximum commits kept by `prune`. |
| `QE_SHADOW_PRUNE_BATCH` | `50` | Hysteresis band: `prune` is triggered automatically only when the commit count reaches `MAX_SNAPSHOTS + PRUNE_BATCH` (default 250), then trims back to `MAX_SNAPSHOTS`. |
| `QE_SHADOW_MAX_AGE_MS` | `259200000` (72 h) | Maximum age in milliseconds before `prune` drops a snapshot. |

**`snapshot --force`** bypasses the debounce window and always creates a commit (as long as there are actual changes). Use it for manual on-demand checkpoints that must record regardless of how recent the last auto-snapshot was. Hook invocations (`--source write/edit/codex`) do not pass `--force` and remain subject to debouncing.

## Store-Root Resolution
The shadow store root is resolved at runtime by walking up from `cwd` to the nearest
ancestor that contains a `.qe/` directory. In the qe-workspace wrapper this resolves
to the wrapper root, covering `qe-framework` and any nested repository under one store.
In a single-repo project it resolves to that repo's root.

## Rules
- Never run `git commit/add/push` against real repos — all git operations target
  `--git-dir .qe/.snapshots/shadow.git` only.
- Always use `--confirm` + `--force` when recovering over locally-modified files;
  understand the data-loss risk before proceeding.
- `prune` is safe to run at any time; it cannot corrupt the snapshot history because
  it aborts on any `commit-tree` failure.
- The lock file (`.qe/.snapshots/shadow.lock`) is released automatically after each
  operation. Stale locks (older than 5 s) are reclaimed on the next call.

## Procedure

1. Run `list` to identify the target snapshot SHA.
2. Run `diff <sha>` to review what changed since that snapshot.
3. If recovery is needed, run `restore <sha> [path]` (dry-run first, then with
   `--confirm` and optionally `--force`).
4. Run `prune` periodically or when the snapshot count grows large.

## Will
- Create snapshots on demand or confirm automatic hook-triggered snapshots worked.
- Show diffs and help identify when a change was introduced.
- Guide safe restoration with dry-run preview before any file is overwritten.

## Will Not
- Register any remote on the shadow repo.
- Push shadow history anywhere.
- Modify any real repo's `.git` index or history.
- Skip the `--confirm` gate or the dirty-file `--force` gate.
