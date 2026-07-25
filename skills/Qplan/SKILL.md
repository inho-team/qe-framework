---
name: Qplan
description: "Use when starting or resuming a Plan. Creates or updates a roadmap, then internally advances one verified Goal at a time through knowledge, spec, execution, and verification. Use Qgoal only as a goal-intake alias."
user_invocable: true
recommendedModel: opus
tier: core
---

> **`.qe` reads → DB:** `.qe/` content is stored in the SQLite store (`qe_files`), so a path may have **no file on disk**. Read `.qe/` content with `node scripts/qe-cat.mjs <path>` (or `--ls`/`--exists`) and structured state with `node scripts/qe-query.mjs …` — do not assume the raw file exists. See `QE_CONVENTIONS.md`.

# Qplan — Plan-owned Goal Controller

`Qplan` is the user-facing control surface for work. A Plan owns an ordered
Goal queue; Goals are not separate user commands. The user supplies an intent,
reviews material Plan changes, and receives results. QE runs the internal work.

## Model

```text
Plan → Goal 1 → Goal 2 → … → Goal N
          │
          ├─ knowledge preflight
          ├─ spec
          ├─ execute
          ├─ verify
          └─ verified knowledge write-back
```

- **Plan** is the durable contract: roadmap, requirements, phases, and ordered Goals.
- **Goal** is the smallest independently verifiable Plan outcome.
- `.qe/` documents are evidence; `qe.db` is their lookup index; `.qe/wiki/` is a
  derived project knowledge layer. Do not treat a DB row or LLM summary as the source of truth.
- Only a verified Goal with explicit evidence may write back to the wiki.

## Entry and initialization

1. Check for `CLAUDE.md` or `AGENTS.md` and `.qe/`. If either is absent, run the
   internal Qinit bootstrap before continuing; do not ask the user to invoke it.
2. Derive a unique slug from the intent (2–4 salient Latin keywords, lowercase
   `[a-z0-9-]`, max 40 chars; append `-2`, `-3` on collision).
3. Create or update `.qe/planning/plans/{slug}/` with `ROADMAP.md`,
   `REQUIREMENTS.md`, and `STATE.md`. Full Plans must divide work into ordered,
   independently verifiable Wave bullets; these become Goals.
4. Bind the Plan through `.qe/planning/ACTIVE_PLAN` and the current session binding.
5. Run `node hooks/scripts/lib/ledger.mjs create-goals --slug {slug}` and
   `node hooks/scripts/lib/ledger.mjs render-state --slug {slug}`. Never hand-edit
   the `## Phase Progress` block.

## Internal Goal loop

Run this loop until the Plan is complete, blocked, or needs a material user decision.
Do not expose `Qgs`, `Qexecute`, `Qwiki-*`, or a copied next-command handoff.

1. **Select:** Run `node hooks/scripts/lib/ledger.mjs advance --slug {slug} --action next`.
   It starts only the first pending Goal; an active or blocked Goal prevents skipping.
2. **Knowledge preflight:** Run `node scripts/qe-plan-context.mjs "{Goal objective}"`.
   Use the returned reviewed wiki entries and QE artifact paths as pointers. Read only
   the source documents required for the Goal; source files override summaries.
3. **Internal PSE:** Generate the Goal's TASK_REQUEST and VERIFY_CHECKLIST, execute it,
   then run the SIVS verification loop. These are internal units, not user commands.
4. **Gate:** If verification fails or a required decision is unresolved, keep the Goal
   active or call `advance --action block --evidence "{specific blocker}"`; do not start
   another Goal. Ask the user only for a material scope, risk, or irreversible choice.
5. **Complete:** Only after verified evidence exists, run
   `node hooks/scripts/lib/ledger.mjs advance --slug {slug} --action complete --evidence "{evidence}"`.
   This records the lifecycle event, updates STATE, and writes a provenance-linked
   reviewed project-wiki page.
6. Repeat at Step 1. When `advance --action next` returns `complete`, report the Plan
   outcome, remaining risks, and evidence.
7. At each completed Phase boundary, generate the retrospective from
   `core/RETROSPECTIVE_TEMPLATE.md` before advancing the next Phase.

## Goal quality rules

- One active Goal at a time unless the Plan explicitly models a safe parallel Wave.
- A Goal must state an objective, observable completion criterion, dependencies, and evidence.
- Draft plans, model hypotheses, and unverified research never become reviewed project knowledge.
- Use source-backed contracts, tests, verification reports, and decisions as first-class evidence.
- Preserve an append-only ledger. Do not rewrite prior Goal events or fabricate completion.

## User communication

At Plan creation or material replan, show the ordered Goal list, current Goal, success criteria,
and any required decision. During normal progression, report concise status rather than internal
commands. On completion, provide the evidence-backed Plan result.

## Will

- Create, resume, and advance Plan-owned Goals.
- Use QE knowledge internally before each Goal and write back only verified outcomes.
- Run internal spec, execution, and verification units without user command choreography.

## Will Not

- Ask the user to invoke `Qgs`, `Qexecute`, `Qwiki-*`, or a raw ledger command.
- Skip an active or blocked Goal.
- Promote LLM-generated text to reviewed knowledge without verification evidence.
