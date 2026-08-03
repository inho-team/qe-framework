---
name: Qplan
description: "Use when starting or resuming a Plan. Creates or updates a roadmap, then internally advances one verified Goal at a time through knowledge, spec, execution, and verification. Use Qgoal only as a goal-intake alias."
user_invocable: true
recommendedModel: opus
tier: core
---

> **Planning state → DB:** `.qe/planning/**` is a DB-only namespace in the
> SQLite `qe_files` store. Its directories are logical paths, not folders to
> create on disk. Read them with `node scripts/qe-cat.mjs <path>` (or
> `--ls`/`--exists`) and mutate them only through QE state/store utilities.
> See `QE_CONVENTIONS.md`.

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

## Entry and bootstrap

1. Ensure the shared `QE.md` and active-client instruction pointer exist before planning.
   The explicit `/Qplan` or `$Qplan` entry bootstrap creates them without overwriting user
   instructions. Then check `.qe/`; if it is absent, bootstrap the minimal
   Plan state (`.qe/state/`, `.qe/planning/`, and `.qe/tasks/`) through the existing QE
   state/store utilities before continuing. Initialization is part of Qplan; there is no
   separate initialization skill or user command.
2. Derive a unique slug from the intent (2–4 salient Latin keywords, lowercase
   `[a-z0-9-]`, max 40 chars; append `-2`, `-3` on collision).
3. Create or update the logical DB paths `.qe/planning/plans/{slug}/ROADMAP.md`,
   `REQUIREMENTS.md`, and `STATE.md` through the QE state/store utilities. Do not
   create `.qe/planning/` directories or write these paths with raw filesystem
   tools. Full Plans must divide work into ordered,
   independently verifiable Wave bullets; these become Goals. Split until every
   Goal has one user-visible outcome, 1–5 allowed paths, at most three criteria,
   at most two journeys, explicit dependencies, and explicit non-goals. A broad
   feature area is a Phase, never a Goal.
4. Run `node hooks/scripts/lib/ledger.mjs create-goals --slug {slug}` to assign
   stable Goal IDs.
5. For every Goal, define a pre-execution acceptance contract from
   `core/GOAL_ACCEPTANCE_CONTRACT.md`: verbatim Goal alignment, requirement criteria,
   at least one runnable user-journey scenario, a regression command, risk assessment,
   and whether human acceptance is required. High-impact risk categories (authentication,
   authorization, payment, deployment, data migration, destructive data changes, external
   integrations, or security) require human acceptance.
   Save it as `evidence/{goalId}.acceptance.json`, then run
   `node hooks/scripts/lib/ledger.mjs set-acceptance --slug {slug} --goal-id {goalId} --file {path}`.
   Do not let tests or implementation retrospectively define what success means.
6. Bind the Plan through `.qe/planning/ACTIVE_PLAN` and the current session binding.
7. Run `node hooks/scripts/lib/ledger.mjs render-state --slug {slug}`. Never hand-edit
   the `## Phase Progress` block.

## Internal Goal loop

Run this loop until the Plan is complete, blocked, or needs a material user decision.
Do not expose `Qgenerate-spec`, `Qexecute`, derived-wiki internals, or a copied next-command handoff.

1. **Select:** Run `node hooks/scripts/lib/ledger.mjs advance --slug {slug} --action next`.
   It starts only the first pending Goal; an active or blocked Goal prevents skipping.
2. **Knowledge preflight:** Run `node scripts/qe-plan-context.mjs "{Goal objective}"`.
   Use the returned reviewed wiki entries and QE artifact paths as pointers. Read only
   the source documents required for the Goal; source files override summaries.
3. **Internal PSE:** Generate the Goal's TASK_REQUEST and VERIFY_CHECKLIST, execute it,
   then run the SIVS verification loop. These are internal units, not user commands.
4. **Completion evidence:** Before completion, record `evidence/{goalId}.completion.json`
   against the immutable acceptance contract. It must show every requirement and
   user-journey scenario passing, a passing regression result, machine re-execution by a
   named verifier, that verifier's Goal-to-evidence alignment verdict, known limitations,
   and required human acceptance. Run every
   locked contract command via `ledger.mjs run-evidence` first for `implementation`
   and again from a distinct QE session for `verification --verifier {identity}`;
   then run `record-evidence`.
5. **Gate:** If verification fails, evidence is incomplete, or a required decision is unresolved, keep the Goal
   active or call `advance --action block --evidence "{specific blocker}"`; do not start
   another Goal. Ask the user only for a material scope, risk, or irreversible choice.
6. **Complete:** Only after the acceptance evidence has been recorded, run
   `node hooks/scripts/lib/ledger.mjs advance --slug {slug} --action complete`.
   This records the lifecycle event, updates STATE, and writes a provenance-linked
   reviewed project-wiki page.
7. Repeat at Step 1. When `advance --action next` returns `complete`, report the Plan
   outcome, remaining risks, and evidence.
8. At each completed Phase boundary, generate the retrospective from
   `core/RETROSPECTIVE_TEMPLATE.md` before advancing the next Phase.

## Goal quality rules

- One active Goal at a time unless the Plan explicitly models a safe parallel Wave.
- A Goal must state its verbatim objective alignment, one primary outcome, bounded file scope, explicit non-goals, dependencies, at most three requirement criteria, at most two user-journey scenarios, regression scope, risk assessment, and evidence before work starts.
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

- Ask the user to invoke internal PSE stages, derived-wiki internals, or a raw ledger command.
- Skip an active or blocked Goal.
- Mark a Goal complete from a bare test claim, implementation report, or self-verification.
- Promote LLM-generated text to reviewed knowledge without verification evidence.
