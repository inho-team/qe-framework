---
name: Qcompact
description: Context preservation and session handoff. When run automatically in the background, saves context to .qe/context/. When invoked manually, generates a detailed handoff document in .qe/handoffs/. Use for save state, handoff, save context, end session, 저장, 핸드오프, 세션 저장, 이어하기, or continue later requests.
---

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qcompact — Context Preservation & Handoff

## Role
A skill that automatically preserves context under context window pressure, and generates detailed handoff documents on user request.

## Operating Modes

### Automatic Mode (Background Call)
Ecompact-executor detects context pressure and runs automatically in the background.
- Saves quietly without notifying the user
- Triggered when entering MODE_TokenEfficiency Yellow zone (75%+)
- Saves current state to `.qe/context/snapshot.md`
- Accumulates decisions in `.qe/context/decisions.md`

### Manual Mode (User Invocation)
Calling `/Qcompact` directly generates a detailed handoff document.
- Delegates to Ehandoff-executor sub-agent
- Creates `.qe/handoffs/HANDOFF_{date}_{time}.md`
- Displays saved context + handoff summary to the user

---

## Automatic Mode Details

### Save Location
`.qe/context/`

### Saved Content

#### `snapshot.md` — Context Snapshot
Overwritten on each save (only the latest state is retained):

```markdown
# Context Snapshot
> Saved at: 2026-03-14 10:30

## Current Task
- In-progress task UUID and title
- Checklist progress (completed/total)
- Checklist item currently being worked on

## Key Decisions
- Major decisions made this session
- Directions explicitly instructed by the user

## Changed Files
- Files created/modified/deleted this session

## Pending Items
- Work not yet finished
- What to do next

## Notes
- Constraints or requirements to remember specifically
```

#### `decisions.md` — Accumulated Decision History
Accumulated per session (reverse order, newest first):

```markdown
## [2026-03-14] Session
- Decided to separate framework data into .qe/ folder
- Changed agent prefix from A → E
- Branded as QE framework (Query Executor)
```

---

## Manual Mode Details

### CREATE Workflow

#### Step 1: Delegate to Ehandoff-executor
Call the Ehandoff-executor sub-agent to generate the handoff document.
- Create `.qe/handoffs/` directory (if not present)
- Create `HANDOFF_{date}_{time}.md` file
- Auto-collect current task state, git changes, and decisions

#### Step 2: Write Handoff Document
1. **Current status summary** — what the situation is right now
2. **Important context** — key information the next agent must know
3. **Immediate next steps** — clear, actionable first step
4. **Decisions** — choices that include not just the outcome but the reason

#### Step 3: Verify
- No `[TODO: ...]` placeholders remain
- Required sections exist and are filled in
- No potentially confidential information (API keys, passwords, tokens)
- Referenced files exist

#### Step 4: Report to User
- Handoff file location
- Summary of captured context
- First action item for the next session

### RESUME Workflow

#### Step 1: Look Up Handoff
Scan the `.qe/handoffs/` directory and display the list of handoffs.

#### Step 2: Check Freshness
| Level | Meaning |
|-------|---------|
| FRESH | Safe to resume — minimal changes |
| SLIGHTLY_STALE | Review changes before resuming |
| STALE | Carefully verify context |
| VERY_STALE | Consider creating a new handoff |

#### Step 3: Load Handoff and Start Work
- Read the handoff document and start from item #1 of "Immediate next steps"
- If there are chained handoffs, also reference previous ones

### Handoff Chaining
In long-running projects, link handoffs to each other to maintain context lineage:
```
HANDOFF_1.md → HANDOFF_2.md → HANDOFF_3.md
```

---

## Save Location Summary

| Mode | Location | Purpose |
|------|----------|---------|
| Automatic | `.qe/context/snapshot.md` | Latest context (overwrite) |
| Automatic | `.qe/context/decisions.md` | Accumulated decisions |
| Manual | `.qe/handoffs/HANDOFF_*.md` | Detailed handoff document |

## Will
- Automatic: save context snapshot, accumulate decisions
- Manual: generate detailed handoff document, verify, chain
- Delegate to Ecompact-executor (automatic)
- Delegate to Ehandoff-executor (manual)

## Will Not
- Save entire conversation (extract key points only)
- Copy entire code (record file paths only)
- Notify user (during automatic execution)
- Include confidential information
