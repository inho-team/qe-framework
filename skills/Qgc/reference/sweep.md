---
source-skill: Qsweep
subcommand: Qgc sweep
delegate: Earchive-executor
analyzer: hooks/scripts/lib/sweep-analyzer.mjs
---

# Qgc sweep - .qe Folder Auto-Cleanup

## Role
Sweeps the `.qe/` directory using **status-based signals** (not just mtime),
moving confirmed-complete artifacts into `.qe/.archive/vX.Y.Z/` and purging
volatile cache folders. Complements `Qgc archive` by covering folders archive
does not touch (completed/, handoffs, security-reports, learning/failures,
agent-results).

Actual archive move policy must preserve the `Earchive-executor` delegation
contract where task archive behavior overlaps with `Qgc archive`.

## When to use
- `.qe/tasks/completed/` or `checklists/completed/` has accumulated
- Old `handoffs/HANDOFF_*.md` or `security-reports/SECURITY_REPORT_*.md` clutter
  the tree
- `learning/failures/YYYY-MM/` has folders from prior months
- `agent-results/` has stale per-run output files
- SessionStart hook surfaces `[QE Sweep] .qe cleanup available: N to archive, ...`

## How it works

### Signal priority (not mtime-first)
| Folder | Primary signal | Retention |
|---|---|---|
| `tasks/completed`, `checklists/completed` | folder-name = already completed | archive immediately |
| `tasks/pending` + matching `checklists/pending` all-checked | checkbox state (`isAllComplete`) | archive the pair |
| `tasks/pending` unfinished & old mtime | mtime > 30d | **report only** (never auto-move) |
| `handoffs/HANDOFF_YYYYMMDD_*` | filename date | archive if > 30d |
| `security-reports/SECURITY_REPORT_YYYYMMDD_*` | filename date | archive if > 14d |
| `learning/failures/YYYY-MM/` | path-embedded month | archive whole month if > 30d |
| `agent-results/` | mtime (volatile) | **delete** if > 7d |

### Folders never touched
`state/`, `planning/`, `contracts/`, `context/`, `profile/`, `ai-team/` - these
hold active session/project state.

### Automation
- **SessionStart hook**: runs analyzer (read-only), injects one-line summary if
  anything is pending:
  `[QE Sweep] .qe cleanup available: 20 to archive, 3 stale pending.`
- **Stop hook**: auto-applies archive moves and volatile purges (default).
  Announces via `systemMessage`:
  `[QE Sweep] archived 20 -> .qe/.archive/v0.2.0, purged 3 volatile`
- **Manual**: `/Qgc sweep` shows detailed plan; `/Qgc sweep --apply` forces
  execution (useful mid-session).

### Opt-out
Auto-apply can be disabled by setting `sweep_auto: false` in `.qe/config.json`:
```json
{ "hooks": { "sweep_auto": false } }
```

With auto off, only volatile (agent-results) purge runs on Stop; archive moves
become opt-in via `/Qgc sweep --apply`.

## Invocation

### `/Qgc sweep` - dry-run report
Shows:
- Archive plan grouped by category
- Stale pending report (age in days)
- Volatile purge list
- Suggested next archive version (`v0.2.0` etc.)

### `/Qgc sweep --apply` - execute
- Moves archive items to `.qe/.archive/vX.Y.Z/<category>/`
- Deletes volatile items
- Prints resulting summary (moved/deleted/errors)

### Example
```text
$ /Qgc sweep
[QE Sweep] Plan for v0.2.0:
  tasks/completed       -> archive  (10 files)
  checklists/completed  -> archive  (10 files)
  stale pending         -> report   (0 files)
  volatile              -> delete   (0 files)
Run /Qgc sweep --apply to execute.
```

## Exclusion - `.qesweep-ignore`

Place a `.qesweep-ignore` file at the project root to exempt paths. One pattern
per line, `#` for comments. Matching is glob-like against the path relative to
project root:
- `*` matches a single path segment (no `/`)
- `**` matches any number of segments
- Other characters are literal

Example:
```text
# never sweep hand-curated reference tasks
.qe/tasks/pending/TASK_REQUEST_keep*.md
# keep this month's failures accessible
.qe/learning/failures/2026-04/**
```

Applies uniformly to archive moves, volatile deletions, and stale-report
detection.

## Safety rules
- Archive moves go to `.qe/.archive/<version>/<category>/` - recoverable with
  `mv`, never deleted
- Only `agent-results/` is subject to deletion (volatile by design)
- Unfinished pending tasks are reported, never moved (even in auto mode)
- Auto-apply uses deterministic signals only (folder name, checkbox count,
  embedded date)
- Fault-tolerant: hook failure never blocks session start or stop
- Every auto-apply announces what moved via `systemMessage`; no silent file
  movement

## Related skills
- **Qgc archive** - archives checkbox-complete pending tasks only; kept aligned
  with `Qarchive` for backward compatibility and auto-trigger from Qexecute
- **Qgc analyze** - code-level garbage collection (doc-code drift, dead code);
  separate concern
- **Qrefresh** - refreshes `.qe/analysis/`; not a cleanup tool

## Implementation
- `hooks/scripts/lib/sweep-analyzer.mjs` - scans folders, builds plan (pure)
- `hooks/scripts/lib/sweep-executor.mjs` - applies plan (apply or dry-run)
- Wired into `session-start.mjs` (summary) and `stop-handler.mjs` (volatile purge)

Do not edit `sweep-analyzer.mjs`, `sweep-executor.mjs`, or
`Earchive-executor.md` as part of this merge. This reference preserves invocation
details only.

## Delegation Contract

For archive-compatible task/checklist moves, preserve the `Earchive-executor`
contract rather than duplicating task archive behavior in `Qgc`.

`Earchive-executor` owns completed TASK_REQUEST/VERIFY_CHECKLIST archive
semantics; sweep-specific analyzers own broader `.qe/` cleanup detection and
volatile purge planning.

## Will
- Scan `.qe/` by status/filename/path signals
- Move confirmed-complete artifacts to versioned archive
- Purge stale volatile folders

## Will Not
- Delete unfinished tasks
- Touch active folders (state, planning, contracts, context, profile, ai-team)
- Move files without announcing what moved
- Use mtime as primary signal (only for volatiles)
