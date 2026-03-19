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

**Why 40/30/20/10:**
The split is ordered by recoverability cost. If Critical context is absent, the agent cannot proceed at all — it does not know what to build or where. If Important context is absent, errors occur but can be corrected with re-reads. If Reference context is absent, quality degrades but work continues. The Reserve exists because context overruns are unpredictable; without a buffer, a single unexpected tool call can cause truncation of Critical context, which is the worst failure mode. The 10% reserve is the minimum that absorbs common overruns (one extra file read, a longer-than-expected tool response) without wasting significant budget.

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

**Why these zone boundaries:**
- **Green (0-100):** Empirically, the first 100 tool calls in a session rarely fill more than 50% of the context window for typical tasks. Full operation without restriction is safe.
- **Yellow (100-150):** Context accumulation accelerates after 100 calls as agent responses grow in length. Switching to summary reads (`.qe/analysis/`) at this threshold reduces per-call token cost by ~60% compared to raw file reads, buying time before compaction is needed.
- **Orange (150-200):** At 150 calls the context window is typically 70-80% full. A snapshot at this point captures the full task state while there is still room to write it cleanly. Waiting until 200 risks the snapshot itself causing truncation.
- **Red (200+):** Beyond 200 calls, context pressure is severe enough that further tool calls risk losing earlier conversation turns. User intervention (/Qcompact) is required because automated compaction at this stage may itself be truncated mid-write.

## Anti-Patterns

- Loading entire files when only a function signature is needed
- Reading all analysis files at session start (read on demand)
- Keeping historical context that is no longer relevant to the active task
- Duplicating information already in `.qe/context/snapshot.md`
