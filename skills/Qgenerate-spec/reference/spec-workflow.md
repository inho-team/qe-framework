# Qgenerate-spec Workflow Details

## Context acquisition

Resolve an explicit `{slug}:` prefix first, then the current session binding,
then `.qe/planning/ACTIVE_PLAN`, and finally legacy flat planning files. Read the
resolved ROADMAP and STATE and use the active phase criteria as source of truth.
If no planning context exists, stop and route the user through Qplan.

## Context dumps and clarification

Input of 300 or more Unicode characters, meeting notes, mail, chat fragments,
or other unstructured text is a context dump. Accept it without demanding
reformatting. For Small-or-larger ambiguous work, ask only the highest-impact
questions across actor, priorities, data model, completion level, UX references,
and constraints. Micro work and requests with exact files/reproduction steps
skip this gate. Any delegated AI default is recorded under `## 가정 (AI 결정)`
with `[ASSUMED]`.

## Premise verification

Verify external claims before drafting: CLI help/version, a known working plugin
manifest, existing hook events, official APIs, or `npm info`. Mark unresolved
claims `[UNVERIFIED]`; remove disproved premises and report them.

## Spec quality and self-reference gate

Check single responsibility, objective verification, pair consistency,
constraint conflicts, dependencies, output paths, ordering, and observable
completion. Then always run Qcritical-review at `--stage spec` with isolated
Structural, Critical, and Edge Case roles. FAIL is revised up to two times and
remains execution-blocking; WARN/PASS may proceed with notes.

## Create and execute

The interaction adapter offers Generate Only or Generate & Execute. A blocked
spec may only be saved or revised. Four or more independent items recommend a
wave. Non-interactive Codex defaults to Generate Only unless execution was
already explicitly requested or chained. Generated artifacts always enter
their pending directories.
