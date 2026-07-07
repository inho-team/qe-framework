# CONTEXT_BUDGET.md -- Token Budget Allocation Strategy

> Referenced by: Ecompact-executor, MODE_TokenEfficiency.md

## Purpose

Defines how to prioritize information when context window space is limited.
Used by Ecompact-executor when saving snapshots and by all agents when deciding what to include in context.

<!-- qe:context-policy
{
  "green_max_tokens": 100000,
  "warning_tokens": 140000,
  "critical_tokens": 170000,
  "warning_ratio": 0.70,
  "critical_ratio": 0.85,
  "default_window_tokens": 200000,
  "extended_window_tokens": 1000000,
  "tier_split_tokens": 400000,
  "debounce_tool_calls": 5
}
-->

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

| Zone | 200k Window | Ratio | 1M Window | Action |
|------|-------------|-------|-----------|--------|
| Green | 0 - 100k | 0 - 50% | 0 - 500k | Normal operation |
| Yellow | 100k - 140k | 50 - 70% | 500k - 700k | Prefer `.qe/analysis/` summaries; prepare semantic compression |
| Orange | 140k - 170k | 70 - 85% | 700k - 850k | **Auto-Triggered**: Context monitor emits directive to invoke `Ecompact-executor` |
| Red | 170k+ | 85%+ | 850k+ | **Auto-Triggered (Mandatory)**: Context monitor forces immediate compaction |

**Why these ratio-based boundaries:**
- **Green (0-50%)**: Most tasks operate safely within the first half of the active model window. Full context is preserved.
- **Yellow (50-70%)**: Token accumulation accelerates. Switch to `.qe/analysis/` summaries and prepare `Ecompact-executor` semantic compression before the window is too full.
- **Orange (70-85%)**: At 70% of the active context window, the monitor **automatically** emits a system directive instructing Claude to invoke `Ecompact-executor`. This is no longer advisory -- the hook outputs an `ACTION REQUIRED` message with the exact Agent tool invocation to run.
- **Red (85%+)**: Beyond 85%, context drift and truncation become imminent. The context monitor emits a **MANDATORY** stop directive. All current work pauses until compaction completes. This directive overrides the cooldown period.

## Auto-Compaction Behavior

When context pressure reaches the Orange zone (70% of the active context window), the `context-monitor.mjs` hook automatically:

1. **Emits a system directive** (not just an advisory) instructing Claude to invoke `Ecompact-executor` via the Agent tool.
2. **Records the trigger** in `unified-state.json` under the `contextCompaction` key:
   - `lastTriggeredAt`: ISO timestamp of when auto-compaction was triggered
   - `autoTriggered`: `true` (distinguishes from manual invocations)
   - `cooldownUntil`: ISO timestamp 5 minutes after the trigger (prevents repeated firing)
3. **Enforces a 5-minute cooldown** after each trigger to avoid redundant compaction cycles.
4. **CRITICAL overrides cooldown**: At 85% of the active context window, the mandatory directive fires regardless of cooldown state.

### Cooldown Rationale
Without cooldown, every tool call between 140k and the completion of compaction would re-emit the directive, flooding the context with duplicate instructions. The 5-minute window gives `Ecompact-executor` enough time to complete its snapshot save before the monitor checks again.

## Token Estimation Fallback (Minimal I/O Rule)

When real-time API usage metrics are unavailable, use the following calculation:
- **Rule**: `Total Characters / 4 = Estimated Tokens`
- **Application**: All hooks (`pre-tool-use`, `post-tool-use`) must use this fallback to update `unified-state.json` if the `usage` payload is missing.

## ContextMemo Enforcement (Hard Block)

The `pre-tool-use` hook **enforces** the Minimal I/O Rule by blocking redundant `Read` calls at the hook level:

- **First read**: Always allowed. Content is cached in `unified-state.json` under `memo.files` with metadata in `memo.meta`.
- **Subsequent read of the same file**: Blocked with `exit(2)` if the file has not been modified since the last read. The agent receives a `MEMO HIT` message on stderr directing it to use the cached content.
- **After Write/Edit**: The memo entry is marked `modifiedSince: true` and cached content is cleared. The next Read is allowed and re-populates the cache.
- **Tracking**: `memo.meta[filepath]` stores `{ readAt, modifiedSince, contentSize }`. `memo.blocked_reads` counts total blocked reads per session.

This is not advisory — the hook hard-blocks the tool call. Agents cannot override this behavior.

## Persistent Mode

Active multi-step pipelines (SIVS loops, Wave execution, Qexecute, Qexecute) are protected from premature stopping via **Persistent Mode**. When a pipeline enters persistent mode, two hook-level mechanisms prevent context waste:

1. **Stop hook (`stop-handler.mjs`)**: Blocks the stop and forces continuation, identical to the existing mode-state mechanism. The persistent mode state lives in `unified-state.json` under `persistentMode` so it works alongside (not instead of) dedicated mode-state files.

2. **Notification hook (`notification.mjs`)**: When a notification contains completion-like patterns ("completed", "finished", "done") while persistent mode is active, a reinforcement message is injected reminding Claude to continue the pipeline.

### Safety valves
- **Max reinforcements**: After a configurable number of reinforcements (default: 5 in stop handler, 10 in the module), persistent mode auto-exits to prevent infinite loops.
- **Staleness expiry**: Persistent mode auto-expires after 30 minutes. Zombie states from crashed sessions are cleaned up automatically.

### State shape
```json
{
  "persistentMode": {
    "active": true,
    "mode": "wave-execution",
    "reason": "Phase 2 — 3/5 items remaining",
    "startedAt": "2026-04-04T10:00:00.000Z",
    "reinforcements": 0
  }
}
```

### When to use
Skills that run multi-step pipelines should call `enterPersistentMode(cwd, mode, reason)` at execution start and `exitPersistentMode(cwd)` at their Handoff step. See `hooks/scripts/lib/persistent-mode.mjs` for the full API.

## Project Memory Budget

Project memory (`.qe/project-memory.json`) is injected at session start via `formatMemoryContext()`. It is capped at **2KB** of formatted text to stay within the Reference allocation tier.

- Entries are priority-sorted: `permanent` > `high` > `normal` > `low`.
- If total formatted output exceeds 2KB, lower-priority entries are truncated.
- Expired entries are pruned automatically at session start via `pruneExpired()`.
- TTL defaults: permanent = no expiry, high = 30 days, normal = 7 days, low = 1 day.

This budget is separate from `.qe/analysis/` summaries. Both fall under the 20% Reference allocation.

## Anti-Patterns

- Loading entire files when only a function signature is needed
- Reading all analysis files at session start (read on demand)
- Keeping historical context that is no longer relevant to the active task
- Duplicating information already in `.qe/context/sessions/{sid}/snapshot.md`
- Reading the same file twice in one session without modifying it (now enforced by hook)
