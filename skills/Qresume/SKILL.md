---
name: Qresume
description: Restores saved context after compaction or session break. Use when resuming work, restoring context, continuing from where you left off, or loading a previous session.
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---


# Qresume — Context Restoration

## Role
A skill that restores context after compaction from **two domains**:
- `.qe/context/sessions/{sid}/` — automatic snapshots (volatile, latest-only)
- `.qe/handoffs/sessions/{sid}/` — manual `/Qcompact` handoff documents (durable)

Loads the previous session's task state, decisions, and pending items to resume work seamlessly. Both domains are partitioned by sid, so a `/Qcompact` handoff and a `/Qresume` must read the same domains or they will miss each other.

## Per-Session Layout (Auto-Named)
Snapshots are partitioned by Claude session id so each terminal sees its own context, not the latest sibling's. The 8-char `sid` is auto-derived by the SessionStart hook and surfaced as `[Session] sid:XXXXXXXX` in additionalContext — read it from there. There is no manual naming.

## How It Works

### Auto Load (Same Session)
Integrated with the pre-check in PRINCIPLES.md:
- When the skill is called immediately after compaction, Ecompact-executor checks whether `.qe/context/sessions/{sid}/snapshot.md` exists for the active sid
- If it exists, automatically loads the context and reflects it in the current session
- Notifies the user with a single line: "Previous context has been restored"

### Manual Execution
- `/Qresume` — restore the active sid's snapshot (default; what you want 95% of the time)
- `/Qresume --list` — list all session buckets newest-first (use when picking up another terminal's work). The list is built by `listSessionBuckets()` in `hooks/scripts/lib/session-resolver.mjs`. Pick a sid, then `/Qresume --from {sid}`
- `/Qresume --from {sid}` — restore a specific session bucket by its 8-char sid (or `_legacy` / `_unknown`)

## Restoration Procedure

### Step 1: Locate & Read Context (single resolver, both domains)
**Do not reimplement path/fallback logic in prose** — the authoritative resolution lives in one place: `resolveResumeContext(projectRoot, overrideSid)` in `hooks/scripts/lib/session-resolver.mjs`. Qcompact's RESUME workflow calls the same function, so the two can no longer diverge. Run it to get the descriptor:

```bash
node -e "import('./hooks/scripts/lib/session-resolver.mjs').then(m=>console.log(JSON.stringify(m.resolveResumeContext(process.cwd(), process.argv[1]||null),null,2)))" [sid-from---from]
```

It returns `{ sid, requestedSid, source, fellBackFrom, contextDir, contextFiles[], handoffDir, latestHandoff, isEmpty }`. Then:

- Read every path in `contextFiles[]` (`snapshot.md`, `decisions.md`, `SNAPSHOT_SUMMARY.md`, `compact-trigger.json`) **and** `latestHandoff` if non-null — a `/Qcompact` handoff lands in `handoffDir`, NOT in `context/`, so both domains are covered.
- **`source: 'fallback'`** → the active sid was empty in both domains and the resolver loaded the newest other bucket. **Tell the user**: "active sid `{fellBackFrom}` was empty — restored from `{sid}`."
- **`source: 'empty'`** → nothing to restore anywhere; say so and offer `/Qresume --list`.
- An explicit `/Qresume --from {sid}` is passed as `overrideSid` and is honored even when empty (no fallback).

### Step 2: Restore State
- Check in-progress tasks (cross-reference with .qe/tasks/pending/)
- Check checklist progress
- Present list of pending items

### Step 3: Suggest Next Actions
Propose next actions based on restored context:
- If there are incomplete tasks → guide with `/Qrun-task {UUID}`
- If new work is needed → guide with `/Qgenerate-spec`
- If decisions need review → display decision list

## .qe/analysis/ Integration
When restoring context, also read `.qe/analysis/` files to understand the latest project state.
This allows starting work immediately without re-scanning the project with Glob/Grep, saving tokens.

## Will
- Load BOTH `.qe/context/sessions/{sid}/` snapshots AND `.qe/handoffs/sessions/{sid}/` handoffs for the active sid
- Fall back to the most recent other bucket (handoffs first) when the active sid is empty in both domains, and tell the user which bucket was used
- Support `--list` and `--from {sid}` for cross-terminal pickup
- Restore previous task state
- Suggest next actions
- Integrate with .qe/analysis/ to understand project state

## Will Not
- Error when context files are missing (silently ignore if not found)
- Cross-load another terminal's context when the active sid HAS its own context (fallback only triggers when the active sid is empty in both domains)
- Blindly follow restored context (user can change direction)
- Force-apply stale context (notify "Context is stale" when 24+ hours have passed)
