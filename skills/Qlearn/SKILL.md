---
name: Qlearn
description: "Cross-session learning memory — records and recalls learnings (mistakes, conventions, gotchas, decisions) in .qe/learnings.md, ranked by time-decayed relevance and injected top-N at session start. Superset of Qmistake."
user_invocable: true
metadata:
  author: inho
  version: "1.0.0"
invocation_trigger: "When the user wants to remember a lesson/convention/gotcha/decision, review or search past learnings, or prune stale ones. Also /Qlearn directly."
recommendedModel: haiku
---

# Qlearn — Learning Memory

Cross-session learning registry. A superset of `Qmistake`: learnings carry a `type`
(mistake | convention | gotcha | decision) and a `severity`, and are ranked by a
**time-decayed relevance score** so the session-start hook injects the most relevant
top-N rather than an ever-growing flat list. Storage: `.qe/learnings.md`. Engine:
`hooks/scripts/lib/learnings.mjs` (pure functions — `parseLearnings`, `decayScore`,
`topLearnings`, `addLearning`, `pruneLearnings`).

```bash
Qlearn <add|review|search|prune|export> [args]
```

## Subcommands

| Subcommand | Behavior |
|------------|----------|
| `add` | Confirm with the user, then `addLearning(...)` appends a new entry (auto id `LNNN`, today's date). Ask for type, severity, title, the lesson, and context. |
| `review` | Show the decay-ranked `topLearnings(content, N)` — the same list injected at session start — so the user can see what is currently "active". |
| `search <query>` | Parse all entries and filter by substring across title/learning/context/type; print matches with their decay score. |
| `prune` | Run `pruneLearnings(content, {threshold})` in **dry-run** first (show what would be removed: `[RESOLVED]` or decayed below threshold), then apply only on confirmation. |
| `export` | Emit the active learnings as portable markdown/JSON for sharing across projects. |

## `.qe/learnings.md` schema

```markdown
### L001: <short title>
- **Type**: mistake | convention | gotcha | decision
- **Severity**: critical | important | info
- **Date**: YYYY-MM-DD
- **Reinforced**: YYYY-MM-DD   (optional — reset relevance when re-encountered)
- **Learning**: <the durable lesson>
- **Context**: <skill/file/situation>   (optional)

---
```

## Decay rule

`score = severityWeight × 0.5^(ageDays / 30)`, where `severityWeight` = critical 3 /
important 2 / info 1, and `ageDays` is measured from the later of `Date` / `Reinforced`.
Relevance halves every 30 days without reinforcement; `[RESOLVED]` entries score 0.
Re-encountering a learning should bump its `Reinforced` date (via `add`/manual) to
restore relevance.

## Session-start injection

The SessionStart hook injects the top-5 active learnings as
`[LEARNINGS] Top N by relevance …`. The `Qmistake` registry (`.qe/MISTAKE.md`) is
independent and still injected as `[MISTAKES] …`; the two coexist.

## Failure-capture proposal

After a traced bug or a repeated correction, proactively propose a `Qlearn add`
(type `mistake` or `gotcha`) summarizing the durable lesson — never the one-off detail.

## Relationship to Qmistake

`Qmistake` remains valid for the narrow "record a mistake" flow and writes
`.qe/MISTAKE.md`. `Qlearn` is the broader memory. New learnings should prefer `Qlearn`.
