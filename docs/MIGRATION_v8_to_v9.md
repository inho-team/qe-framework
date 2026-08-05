# Migrating from v8 to v9 — Progressive Assurance

v9 makes explicit **Plan entry** the Full SIVS boundary. `Qplan` is the primary
entry and `Qgoal` is its single-Goal alias. The former PSE skills (spec/execute)
are internal units: calling them directly is hard-blocked unless an existing
Plan-owned task is continuing.

## Breaking change: direct PSE skill calls are blocked

The hard-block set (authoritative source: `PSE_SKILLS` in
`hooks/scripts/pre-tool-use.mjs`) is:

| v8 direct call | Blocked in v9? | v9 replacement |
|---|---|---|
| `/Qgs {목표}` | **Yes** | `/Qgoal {목표}` (legacy alias removed; Plan owns specification) |
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

- **Commands**: `/Qplan {목표}` and `/Qgoal {목표}` are explicit Full SIVS
  entries. `Qgoal` is the single-Goal alias of `Qplan`.
- **Natural language**: ordinary prompts stay on the active client's native
  execution path regardless of size, file count, planning vocabulary, or risk
  vocabulary. The hook may recommend `Qplan`, but a recommendation never
  activates Full SIVS.

## Triage (diagnostic only)

`goal-router` may classify a request by scale for diagnostics and
recommendations, but scale no longer selects the execution route:

| Signal | Scale | Route |
|---|---|---|
| ordinary natural-language request | Any | native |
| explicit `/Qplan` or `/Qgoal` | Any | **Full SIVS** (plan→execute→verify) |

Legacy `!direct` and `!full` tokens do not override this boundary. Only an
explicit `Qplan` or `Qgoal` invocation activates Full SIVS.

## Escape hatches (when a direct PSE call must pass)

The gate admits a blocked call when any of these hold (see
`pre-tool-use.mjs` → `permitted`):

1. A **fresh pipeline marker** issued by the goal router this session.
2. **Task-artifact continuity** — the call references an existing
   `pending`/`in-progress`/`on-hold` task (so resuming a task is not blocked).
3. A fresh **utopia** state inside an already entered Plan-owned execution.
4. The **`allowDirect`** debug flag in `.qe/config.json` (`goalRuntime.allowDirect`, default false).

## Doc convention layer (v9)

Newly generated execution documents carry a title-first `qe-doc-frontmatter`
block (`core/DOC_CONVENTIONS.md`). Legacy `.qe` documents were bulk-migrated
onto the convention in Phase 4 (`scripts/migrate-qe-docs.mjs`).

## What did NOT change

- Ordinary prompts and non-PSE skills remain on the native execution path.
- Claude uses `/Qplan` and `/Qgoal`; Codex uses `$Qplan` and `$Qgoal`.
- Safety Kernel guards, completion-evidence checks, and QE response style remain active on both paths.
- Commit / release / version discipline: `/Qcommit`, the repository release workflow, and `/Qversion`.

## Migration checklist

1. Replace direct `Qgenerate-spec`/`Qexecute` instructions with one explicit
   `Qplan` entry; use `Qgoal` when only one Goal is needed.
2. Remove automation that depends on prompt length, risk words, `!full`, or
   `!direct` selecting a route.
3. Keep existing task UUIDs for continuation; active task artifacts remain
   compatible across Claude and Codex.
4. Treat `hook_profile` as interaction-depth configuration, not a safety-off
   switch. Core commit/version/bypass guards remain enforced.
5. Compare policy changes with the four-condition protocol in
   `HARNESS_EVALUATION.md` before tuning defaults.
