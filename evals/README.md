# Skill Eval Harness

Behavior-regression harness for QE skills. Extends `Mtest-skill` from **routing-only**
verification to a two-layer model. (Source: adapted from Superpowers' `evals/`; design
recorded as `D020` in `.qe/planning/DECISION_LOG.md`.)

## Two layers

| Layer | Mechanism | Scope | Determinism | Runs in CI |
|-------|-----------|-------|-------------|-----------|
| **Structural** | `scripts/check-skill-evals.mjs` (zero-dep ESM) | **All** skills + all eval cases | Fully deterministic | Yes — auto-discovered by `check-all.mjs` |
| **Behavioral** | `scripts/eval-skills-behavioral.mjs` → manifest → LLM-judge (via `Mtest-skill`) | **opt-in** (skills with an eval case) | Non-deterministic (model-judged) | No (token cost) — run on demand |

Routing verification is **not** duplicated here — it stays in `scripts/check-skill-routing.mjs`.

## What the structural layer checks

1. **Eval-case schema** — every `evals/cases/*.eval.md` has valid frontmatter with the
   required fields, and its `skill` field names a real skill under `skills/`.
2. **Cross-reference integrity** — repo-path references inside each `SKILL.md`
   (`skills/.../SKILL.md`, `core/*.md`, `docs/*.md`, `scripts/*.mjs`) resolve to files
   that actually exist. Catches the common regression where a renamed/moved file leaves
   a dangling pointer in a skill's instructions.

## Behavioral eval case format

One file per opt-in case: `evals/cases/{Skill}.eval.md`.

```markdown
---
skill: Qplan
prompt: "인증 모듈 리팩터링 계획 세워줘"
must_include:
  - "Plan:"
  - "Next Command"
must_not_include:
  - "I'll write the code"
rubric: |
  PASS if the response produces a plan slug, a phased roadmap, and ends with a
  Next Command handoff to /Qgs — without writing or modifying any source code.
---

(Optional free-form notes about why this case exists / what regression it guards.)
```

### Field contract

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `skill` | string | ✅ | Target skill dir name (must exist under `skills/`) |
| `prompt` | string | ✅ | The virtual user prompt fed to the skill |
| `must_include` | string[] | ✅ (may be empty list) | Substrings the response MUST contain |
| `must_not_include` | string[] | ✅ (may be empty list) | Substrings the response MUST NOT contain |
| `rubric` | string | ✅ | Natural-language pass criteria for the LLM judge |

## How behavioral evals run (opt-in)

1. `node scripts/eval-skills-behavioral.mjs` — discovers cases, validates schema, and
   emits a **run manifest** (`evals/.manifest.json`). It performs **no model calls**
   (zero-dep, deterministic).
2. `Mtest-skill` (the LLM) reads the manifest, executes each case's `prompt`, and judges
   the output against `must_include` / `must_not_include` (deterministic substring gate)
   plus `rubric` (LLM judgment). It writes a verdict report.

This split keeps the deterministic plumbing in scripts (CI-safe) and confines model
cost / non-determinism to the explicitly on-demand `Mtest-skill` step.

## Commands

```bash
node scripts/check-skill-evals.mjs        # structural layer (also via check-all)
node scripts/check-all.mjs                # all guards incl. structural eval
npm run eval:skills                       # behavioral manifest build (then run Mtest-skill)
```
