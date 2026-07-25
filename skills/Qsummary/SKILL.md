---
name: Qsummary
user_invocable: false
description: Summarizes what was done, why, and what comes next in five lines or fewer. Use when wrapping up a session or when the user asks for a work summary, recap, or "what did we do".
invocation_trigger: When the user asks for a work summary or recap, or when a session is being wrapped up and a dense What/Why/Next digest would help the next session start faster.
recommendedModel: haiku
---

> **`.qe` reads → DB:** `.qe/` content is stored in the SQLite store (`qe_files`), so a path may have **no file on disk**. Read `.qe/` content with `node scripts/qe-cat.mjs <path>` (or `--ls`/`--exists`) and structured state with `node scripts/qe-query.mjs …` — do not assume the raw file exists. See `QE_CONVENTIONS.md`.

# Qsummary — Work Summary

## Role
Produces a dense, five-line-or-fewer digest of the current work: **What** was done,
**Why** it was done, and **Next** steps. Optimized for the "Efficiency is Accuracy"
philosophy — minimum tokens, maximum signal. Distinct from `/Qcompact` (which saves a
full recoverable snapshot) and `/Qresume` (which restores one): Qsummary only reports.

## Execution Procedure

### Step 1: Gather signals
Read the data sources that exist; skip any that are absent (do not fail on a missing file):
- `.qe/state/unified-state.json` — session statistics and skills used.
- `.qe/tasks/completed/` — concretely completed tasks this session (TASK_REQUEST_*.md titles).
- `.qe/context/SNAPSHOT_SUMMARY.md` — the latest semantic context written by `Ecompact-executor`, when present.

### Step 2: Compose the digest
Using the Haiku model, write **five lines or fewer** in the user's language:
- **What** — the concrete changes/tasks completed (name files or UUIDs when useful).
- **Why** — the reason or goal behind them.
- **Next** — the immediate next step, or "none" if the work is closed.

Rules:
- Never exceed five lines. Compress; drop filler.
- State facts only — do not invent tasks or outcomes not present in the sources.
- If no work signal is found, say so in one line rather than fabricating a summary.

### Step 3: Print
Output the digest directly to the user. Do not write files (that is `/Qcompact`'s job).

## Will
- Summarize completed work as What/Why/Next in ≤5 lines.
- Read only existing state; degrade gracefully when a source is missing.

## Will Not
- Save or restore context (use `/Qcompact` / `/Qresume`).
- Fabricate tasks, outcomes, or next steps absent from the data sources.
- Exceed five lines.
