# CONTEXT_BUDGET.md -- Token Budget Allocation Strategy

> Referenced by: Ecompact-executor, MODE_TokenEfficiency.md

## Purpose

Defines how to prioritize information when context window space is limited.
Used by Ecompact-executor when saving snapshots and by all agents when deciding what to include in context.

## Budget Allocation

| Priority | Allocation | Category | Examples |
|----------|-----------|----------|----------|
| Critical | 40% | Current task execution | Active TASK_REQUEST, target source files, user requirements, checklist |
| Important | 30% | Supporting context | Related source files, test files, configuration, dependencies |
| Reference | 20% | Background knowledge | `.qe/analysis/` files, documentation, architectural context, examples |
| Reserve | 10% | Recovery buffer | Error recovery, follow-up questions, unexpected context needs |

## Application Rules

### During Snapshot Save (Ecompact-executor)

1. **Critical**: Always include in `snapshot.md` -- active task UUID, current checklist state, files being modified, key decisions made.
2. **Important**: Include if within 200-line limit -- related file paths (not content), test file paths, config that affects the task.
3. **Reference**: Include as one-line summaries only -- "Architecture: see `.qe/analysis/architecture.md`".
4. **Reserve**: Do not consume -- leave room for post-restore orientation.

### During Active Work (All Agents)

1. **Critical**: Read fully and keep in context.
2. **Important**: Read on demand, summarize after use.
3. **Reference**: Read `.qe/analysis/` summaries instead of scanning raw files.
4. **Reserve**: Do not pre-load "just in case" context.

## Context Pressure Zones

| Zone | Tool Calls | Action |
|------|-----------|--------|
| Green | 0-100 | Normal operation |
| Yellow | 100-150 | Prefer `.qe/analysis/` over raw file reads |
| Orange | 150-200 | Run Ecompact-executor snapshot save |
| Red | 200+ | Warn user, suggest `/Qcompact` |

## Anti-Patterns

- Loading entire files when only a function signature is needed
- Reading all analysis files at session start (read on demand)
- Keeping historical context that is no longer relevant to the active task
- Duplicating information already in `.qe/context/snapshot.md`
