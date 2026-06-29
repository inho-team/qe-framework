---
name: Qmistake
description: Record mistakes so they are never repeated. When the user points out a mistake, confirms it and saves to .qe/MISTAKE.md. Loaded at every session start.
invocation_trigger: When the user says something was wrong, points out a mistake, corrects behavior, or says "don't do that again". Also triggered by /Qmistake directly.
recommendedModel: haiku
---

# Qmistake — Mistake Registry

## Role
Records mistakes that Claude made so they are never repeated. Each mistake is stored in `.qe/MISTAKE.md` which is loaded at every session start via the session-start hook.

## When to Trigger
- User explicitly says: "that's wrong", "mistake", "don't do that", "you keep doing X"
- User corrects Claude's behavior or output
- User calls `/Qmistake` directly
- After a bug is traced back to Claude's incorrect approach

## Workflow

### Step 1: Identify the Mistake

Parse the user's complaint/correction. Extract:
- **What happened**: What Claude did wrong
- **What should have happened**: The correct behavior
- **Context**: Which skill/agent/file was involved (if applicable)

### Step 2: Confirm with User

Use the QE interaction adapter to confirm before recording:

```
Mistake identified:

  What went wrong: {description}
  Correct behavior: {what should happen instead}
  Context: {skill/file/situation}

Record this mistake?
  (a) Yes, record it
  (b) Edit description first
  (c) Cancel
```

If user picks (b), ask for the corrected description, then confirm again.

### Step 3: Write to MISTAKE.md

Append the entry to `.qe/MISTAKE.md`. Create the file if it doesn't exist.

**File format:**
```markdown
# Mistake Registry

> These mistakes were identified by the user. Do NOT repeat them.
> This file is loaded at every session start.

---

### M001: {short title}
- **Date**: {YYYY-MM-DD}
- **Wrong**: {what Claude did wrong}
- **Correct**: {what should happen instead}
- **Context**: {skill/agent/file involved}
- **Severity**: {critical / important / minor}

---
```

**Entry numbering**: M001, M002, M003... Auto-increment by reading the last entry number.

**Severity levels**:
- `critical` — Causes data loss, breaks builds, sends wrong output to user
- `important` — Wrong approach, wasted time, incorrect assumption
- `minor` — Style issue, suboptimal choice, cosmetic

### Step 4: Confirm

Report: "Recorded as M{NNN}. This will be loaded at every session start."

## Subcommands

### `/Qmistake` (no args)
Show current mistake count and last 5 entries.

### `/Qmistake add`
Interactive: ask what went wrong, confirm, save.

### `/Qmistake list`
Show all entries from `.qe/MISTAKE.md`.

### `/Qmistake resolve M{NNN}`
Mark a mistake as resolved (add `[RESOLVED]` prefix). Resolved mistakes stay in the file for reference but are de-prioritized in session injection.

### `/Qmistake learn`
Promote **auto-extracted** recurring failure patterns into the registry (Phase 4, D021).

1. Run the extractor (deterministic, zero-dep, no model calls):
   ```bash
   npm run learn:failures   # → node scripts/learn-from-failures.mjs
   ```
   It scans `.qe/learning/failures/**` (auto-captured on Stop by `failure-capture.mjs`),
   counts each pattern by **distinct task_uuid**, and writes recurring ones
   (≥ 2 distinct tasks) to `.qe/learning/mistake-candidates.md`.
2. Read `.qe/learning/mistake-candidates.md`. For each candidate, present it via
   the interaction adapter exactly as in **Step 2** above — the user decides whether it is a
   genuine systemic mistake worth recording.
3. On confirmation, write it through the normal **Step 3** path (M{NNN} entry in
   `.qe/MISTAKE.md`). Skip candidates the user rejects.

This is candidate-suggestion only: the extractor never writes to `.qe/MISTAKE.md`, and
promotion always passes through user confirmation (D011 user-in-the-loop).

## Session Integration

The `session-start.mjs` hook reads `.qe/MISTAKE.md` and injects its content into the session context. This ensures every new conversation starts with awareness of past mistakes.

**Injection format** (in hook output):
```
[MISTAKES] {N} recorded mistakes. Critical: {X}, Important: {Y}.
Top entries:
- M001: {title} — {wrong behavior}
- M002: {title} — {wrong behavior}
Full list: .qe/MISTAKE.md
```

Only unresolved entries are injected. If there are more than 10, show only critical + important.

## Will
- Record user-identified mistakes with confirmation
- Auto-number entries
- Integrate with session-start hook for cross-session persistence
- Surface auto-extracted recurring-failure **candidates** (`/Qmistake learn`) for user-confirmed promotion

## Will Not
- Auto-**record** mistakes without user confirmation (auto-extraction produces candidates only; promotion is always user-confirmed)
- Delete entries (only resolve)
- Modify project code or framework files
