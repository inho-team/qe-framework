# Migrating from v8 to v9 — Goal Runtime

v9 makes **goal** the single entry point. The former PSE skills (spec/execute)
are now internal units: calling them directly is **hard-blocked** by the
`PreToolUse` gate, which redirects you to the goal entry.

## Breaking change: direct PSE skill calls are blocked

The hard-block set (authoritative source: `PSE_SKILLS` in
`hooks/scripts/pre-tool-use.mjs`) is:

| v8 direct call | Blocked in v9? | v9 replacement |
|---|---|---|
| `/Qgs {목표}` | **Yes** | `/Qgoal {목표}` (legacy alias removed; router auto-runs spec) |
| `/Qgenerate-spec {목표}` | **Yes** | `/Qgoal {목표}` |
| `/Qexecute {uuid}` | **Yes** (new call) | `/Qgoal {목표}`; an existing `pending`/`in-progress`/`on-hold` task artifact lets a continuation through |
| `/Qrt` (legacy alias of Qexecute) | **Yes** | `/Qgoal {목표}` |
| `/Qplan …` | **No** (unblocked in v9) | Qplan now **owns** the goal-driven workflow; use it directly for roadmap/phase work |

An explicit `/Qplan`, `/Qgoal`, or legacy `/Qgs` entry also creates missing `QE.md`
and the active client's managed instruction pointer. This compatibility bootstrap does
not restore `Qgs` as a supported public workflow; use `/Qgoal` for new work.

> Note: the block is a **workflow-discipline gate**, not an authorization
> boundary — a process with the same filesystem write permission can forge
> marker state. It exists to keep everyone on the goal path, not to secure it.

## The goal entry

- **Command**: `/Qgoal {목표}` — explicit entry.
- **Natural language**: a clear goal typed as a normal prompt is detected by the
  `UserPromptSubmit` hook (`prompt-check.mjs`) and routed. Non-goal prompts and
  non-PSE skills are unaffected (byte-identical behavior — regression 0).

## Triage (automatic)

`goal-router` classifies each goal by scale:

| Signal | Scale | Route |
|---|---|---|
| question / micro-fix (not detected as a goal) | — | direct (PSE **not** started) |
| short natural goal, no file/verb signals | Micro / Small | direct |
| `!full`, ≥3 verb groups, ≥4 file mentions, or ≥1000 chars | Full | **pipeline** (spec→execute→verify) |
| `대규모` / adversarial-verify keywords + ≥3 verbs | Workflow | pipeline + dynamic workflow proposal |

Override tokens: `!direct` forces direct, `!full` forces the pipeline.

## Escape hatches (when a direct PSE call must pass)

The gate admits a blocked call when any of these hold (see
`pre-tool-use.mjs` → `permitted`):

1. A **fresh pipeline marker** issued by the goal router this session.
2. **Task-artifact continuity** — the call references an existing
   `pending`/`in-progress`/`on-hold` task (so resuming a task is not blocked).
3. A fresh **utopia** opt-in (`Qexecute -utopia`).
4. The **`allowDirect`** debug flag in `.qe/config.json` (`goalRuntime.allowDirect`, default false).

## Doc convention layer (v9)

Newly generated execution documents carry a title-first `qe-doc-frontmatter`
block (`core/DOC_CONVENTIONS.md`). Legacy `.qe` documents were bulk-migrated
onto the convention in Phase 4 (`scripts/migrate-qe-docs.mjs`).

## What did NOT change

- Non-goal prompts and non-PSE skills behave identically (regression 0).
- Commit / release / version discipline: `/Qcommit`, the repository release workflow, and `/Qversion`.
