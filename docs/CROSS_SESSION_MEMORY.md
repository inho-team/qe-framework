# Cross-Session Memory Patterns

> How QE Framework persists and restores context across sessions.

---

## Memory Layers

QE uses a layered memory architecture. Each layer has different scope and lifetime:

| Layer | Location | Scope | Lifetime |
|-------|----------|-------|----------|
| **Auto Memory** | `~/.claude/projects/{path}/memory/` | Per-project, per-user | Permanent (user-managed) |
| **CLAUDE.md** | Project root | Per-project, shared | Permanent (git-tracked) |
| **Unified State** | `.qe/state/unified-state.json` | Per-project | Session-scoped (reset on start) |
| **Session Context** | `.qe/context/sessions/{sid}/` | Per-session | Until compaction/cleanup |
| **Handoff Docs** | `.qe/handoffs/` | Per-session | Until consumed |
| **Task Log** | `.qe/TASK_LOG.md` | Per-project | Permanent (append-only) |

## QE Compaction Flow (Qcompact → Qresume)

### Saving Context (Qcompact)

When context pressure is detected or the user requests `/Qcompact`:

1. **Qcompact** resolves the active session and delegates bounded context capture.

2. **Ecompact-executor** agent saves:
   - Current task state snapshot
   - Key decisions and findings
   - File modification summary
   - Next steps / TODO items

3. In manual handoff mode, the same **Ecompact-executor** generates:
   - Session summary (what was done)
   - Active context (what's in progress)
   - Restoration instructions (how to resume)

### Restoring Context (Qresume)

When starting a new session after compaction:

1. SessionStart may show `[Session State] ...` with the active plan, resume
   source, and Codex background job status. The compaction path is now
   SessionStart-driven; there is no separate PreCompact dependency.
2. `/Qresume` reads the resolver output from both domains:
   `.qe/context/sessions/{sid}/` and `.qe/handoffs/sessions/{sid}/`.
3. If the active sid is empty, Qresume falls back to the newest other bucket
   unless the user explicitly passed `--from {sid}`.
4. Restores task state from `.qe/tasks/in-progress/`.
5. Reloads unified-state with session context.
6. Re-establishes active plan binding.

For Codex-routed background work, a completed or running job in SessionStart is
a reminder to retrieve the result before final reporting:
`/codex:status` then `/codex:result <job-id>`.

## Auto Memory Directory

Claude Code's built-in auto memory at `~/.claude/projects/{path}/memory/`:

- `MEMORY.md` — always loaded into context (first 200 lines)
- Topic files (e.g., `patterns.md`, `debugging.md`) — linked from MEMORY.md
- Best for: stable patterns, user preferences, recurring decisions

**QE vs Auto Memory**:
- Auto Memory: general project knowledge, user preferences
- QE State: task-specific state, session continuity, SIVS loop progress

## Best Practices

### What to Persist

- Architectural decisions (with rationale)
- Recurring error patterns and fixes
- User preferences (language, style, workflow)
- Project conventions confirmed across sessions
- Key file paths and entry points

### What NOT to Persist

- In-progress task details (use TASK_REQUEST instead)
- Temporary debugging state
- Speculative conclusions from one file read
- Information duplicated in CLAUDE.md
- Session-specific variables or paths

### Memory Hygiene

1. Review `.qe/state/` periodically — remove stale session dirs
2. Keep Auto Memory `MEMORY.md` under 200 lines
3. Let the deterministic Stop sweep archive completed handoff docs
4. Prune unified-state of obsolete keys on session start
