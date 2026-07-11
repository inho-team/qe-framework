---
name: Qgc
description: Unified garbage collection for QE: archive completed tasks, sweep stale .qe artifacts, and analyze code garbage such as doc-code drift, rule violations, and dead code.
user_invocable: true
invocation_trigger: When the user wants archive, sweep, .qe cleanup, garbage collection, code cleanup, stale code checks, quality debt audits, dead code detection, or drift analysis.
recommendedModel: sonnet
---

# Qgc - Garbage Collection

## Role
Unified entry point for QE cleanup workflows.

Use:

```text
Qgc <archive|sweep|analyze> [args]
```

`Qgc analyze` is the existing code garbage-collection behavior. `Qgc archive`
and `Qgc sweep` preserve the original `Qarchive` and `Qsweep` behavior through
reference files while those original skills continue to exist.

## Subcommands

| Subcommand | Scope | Details |
|------------|-------|---------|
| `Qgc archive [--major|--minor|--patch]` | Archive completed TASK_REQUEST/VERIFY_CHECKLIST files into `.qe/.archive/`. Delegates actual archive work to `Earchive-executor`. | [reference/archive.md](reference/archive.md) |
| `Qgc sweep [--apply]` | Clean stale or completed `.qe/` artifacts using status/date signals. Preserves `Earchive-executor` task archive contract and sweep analyzer/executor invocation details. | [reference/sweep.md](reference/sweep.md) |
| `Qgc analyze [drift|lint|dead|fix]` | Scan code quality debt and produce a GC report. This is the original `Qgc` behavior. | This file |

If the user runs `Qgc` with no subcommand, default to `analyze` for backward
compatibility.

## Analyze Modes

| Command | Scope |
|---------|-------|
| `/Qgc` or `/Qgc analyze` | Full scan (all 3 categories + skill catalog budget) |
| `/Qgc analyze drift` | Doc-Code Drift only |
| `/Qgc analyze lint` | Rule Violations only |
| `/Qgc analyze dead` | Dead Code only |
| `/Qgc analyze budget` | Skill Catalog Token Budget only |
| `/Qgc analyze fix` | Auto-fix all fixable issues from last report |

## Analyze Workflow

### Step 1: Analyze
Run gc-analyzer from `hooks/scripts/lib/gc-analyzer.mjs`:
1. **Doc-Code Drift**: Compare CLAUDE.md/README vs actual deps/structure
2. **Rule Violations**: Run comment-checker + lint detection on recent files
3. **Dead Code**: Find 90-day untouched files + orphan files (no imports)
4. **Skill Catalog Budget**: Scan `skills/*/SKILL.md` files and estimate total tokens using chars/4 heuristic. Reports top N skills by size and catalog total. All token estimates are labeled "자체 산정 추정치(chars/4)". Note: Korean-body skills may be ~2x undercounted due to CJK character width.

### Step 2: Report
Generate `.qe/gc/GC_REPORT.md` with findings:

```
# GC Report — {date}

## Summary
| Category | Found | Auto-fixable | Needs Manual |
|----------|-------|-------------|-------------|
| Doc-Code Drift | N | M | K |
| Rule Violations | N | M | K |
| Dead Code | N | 0 | K |

## Details
### Doc-Code Drift
- [severity] description

### Rule Violations  
- [severity] file:line — rule — description

### Dead Code
- [severity] file — reason — last modified
```

Log execution to `.qe/gc/gc-history.jsonl`:
```json
{"date":"2026-04-05","mode":"full","found":12,"fixed":5,"manual":7,"duration":3200}
```

### Step 3: Fix (if /Qgc fix or auto-fix enabled)
- **Auto-fixable**: lint --fix, unused import removal, stale analysis → /Qrefresh hint
- **Manual required**: Generate TASK_REQUEST with grouped issues → suggest /Qexecute
- Use `AskUserQuestion` before applying fixes: "Found N auto-fixable issues. Apply fixes?"

### Step 4: Summary
Display GC results to user:
```
GC Complete: {date}
  Scanned: {N} files
  Found: {M} issues (drift: X, violations: Y, dead: Z)
  Auto-fixed: {K}
  Manual tasks: {L} (see .qe/gc/GC_REPORT.md)
```

## Session Integration
session-start hook checks `.qe/gc/gc-history.jsonl`:
- Last run > 7 days ago → "[GC] Last garbage collection was N days ago. Run /Qgc to scan."
- No history → "[GC] No garbage collection has been run. Consider /Qgc."

## Archive And Sweep Delegation

- `Qgc archive` must delegate actual archive operations to `Earchive-executor`;
  see [reference/archive.md](reference/archive.md).
- `Qgc sweep` must preserve the `Earchive-executor` task archive contract and
  the `hooks/scripts/lib/sweep-analyzer.mjs` invocation details; see
  [reference/sweep.md](reference/sweep.md).
- Do not edit `Earchive-executor.md`, `sweep-analyzer.mjs`, or
  `gc-analyzer.mjs` for this entry-point merge.

## Will
- Route archive and sweep cleanup workflows to their references
- Scan for doc-code drift, rule violations, dead code
- Generate structured report
- Auto-fix simple issues with confirmation
- Generate TASK_REQUESTs for complex issues

## Will Not
- Run builds or modify project configuration
- Delete files without user confirmation
- Auto-fix complex architectural issues
