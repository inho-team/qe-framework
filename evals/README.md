# Skill Eval Harness

QE also ships an agent-contract suite in `evals/agent-cases.json`. Run
`npm run check:agents` to verify that every registered agent has a positive routing case,
a boundary case, and tool-denial expectations aligned with `core/agent-registry.json`.
The registry check additionally validates frontmatter model, tools, `maxTurns`, caller
ownership, and plugin manifest membership.

Behavior-regression harness for QE skills. It keeps the structural validator
deterministic and emits a manifest for manual behavioral review when needed.

## Two layers

| Layer | Mechanism | Scope | Determinism | Runs in CI |
|-------|-----------|-------|-------------|-----------|
| **Structural** | `scripts/check-skill-evals.mjs` (zero-dep ESM) | **All** skills + all eval cases | Fully deterministic | Yes — auto-discovered by `check-all.mjs` |
| **Behavioral** | `scripts/eval-skills-behavioral.mjs` → manifest → manual `/Qcritical-review` pass | **opt-in** (skills with an eval case) | Deterministic manifest; behavioral review is explicit/manual | No |

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
must_not_include:
  - "Qgenerate-spec"
  - "Qexecute"
  - "Next Command"
  - "I'll write the code"
rubric: |
  PASS if the response produces a plan slug and phased roadmap, then continues the
  PSE loop internally without exposing internal stage commands or modifying source code.
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
| `rubric` | string | ✅ | Natural-language pass criteria for manual behavioral review |

## How behavioral evals run (opt-in)

1. `node scripts/eval-skills-behavioral.mjs` — discovers cases, validates schema, and
   emits a **run manifest** (`evals/.manifest.json`). It performs **no model calls**
   and is safe to run repeatedly.
2. When you want behavioral review, hand the skill text or manifest to
   `/Qcritical-review` and inspect the response against the case rubric.

This split keeps the deterministic plumbing in scripts (CI-safe) and makes the
behavioral check an explicit review step instead of an implicit admin workflow.

## Skill-TDD procedure for skill-change PRs

When adding or modifying a SKILL.md or an eval case, use the pressure-scenario RED/GREEN/REFACTOR loop
with a no-guidance control baseline to validate that skill text—not just the prompt—drives behavior.

### RED: Pressure scenario (validation fails)

Run the behavior WITHOUT the skill guidance:
```bash
node scripts/eval-skills-behavioral.mjs
```

This discovers eval cases and emits a manifest (`evals/.manifest.json`) with all optional fields
present. The **no-guidance control** field (`no_guidance_control`) in the eval case documents the
baseline: does the LLM follow the skill's core policy *without* explicit instruction in the prompt?

Document what breaks when skill guidance is absent (e.g., policy drift, missing attribution,
unguarded AI markers).

### GREEN: Minimal skill text (validation passes)

Write the minimal skill text that makes the eval pass. Run the manifest build again to confirm
structure validity:
```bash
node scripts/eval-skills-behavioral.mjs
```

Then hand the case to `/Qcritical-review` to confirm the skill text produces the
desired behavior with the new skill text present.

### REFACTOR: Close loopholes

Document edge cases and improvements in the `refactor_note` field. The `red_scenario` field captures
the pressure (what broke), and `green_expectation` documents the desired behavior.

### Boundary: Local manifest vs. external execution

**Local tooling** (`eval-skills-behavioral.mjs`) does **only**:
- Discover eval case files under `evals/cases/*.eval.md`
- Parse and validate frontmatter schema (including the 4 optional fields)
- Emit a run manifest to `evals/.manifest.json`
- **Make no model calls** (deterministic, zero-dependency)

**Behavioral review** (`/Qcritical-review`) does:
- Inspect the manifest and skill text
- Check the case prompt against the desired behavior
- Use the rubric as the review guide
- Return an explicit review outcome

Do not assume local tooling can execute behavioral review by itself — it cannot.

### Optional eval-case fields for pressure scenarios

| Field | Type | Meaning |
|-------|------|---------|
| `red_scenario` | string | The pressure condition: what fails or is rationalized away without skill guidance |
| `green_expectation` | string | The desired behavior with skill text present (minimal, just enough to pass) |
| `refactor_note` | string | Edge cases, loopholes closed, or origin notes (e.g., obra/superpowers MIT ref) |
| `no_guidance_control` | string | Baseline: does the LLM follow core policy *without* explicit prompt instruction? |

**present-but-empty prohibition**: if a field is present in the frontmatter, it must not be empty.
Both `eval-skills-behavioral.mjs` and `check-skill-evals.mjs` validate this rule.

See [`evals/cases/Qcommit.eval.md`](cases/Qcommit.eval.md) for a worked example of all four fields.

### When to run

- Whenever you add or modify a `skills/.../SKILL.md`
- Whenever you add or modify an eval case in `evals/cases/*.eval.md`
- As part of PR validation before merging skill-related changes

```bash
# 1. Generate manifest (always deterministic, safe to run in CI)
node scripts/eval-skills-behavioral.mjs

# 2. Hand the manifest to /Qcritical-review for manual behavioral review
#    (this is the gate for actual behavior validation)
```

## Commands

```bash
node scripts/check-skill-evals.mjs        # structural layer (also via check-all)
node scripts/check-all.mjs                # all guards incl. structural eval
npm run eval:skills                       # behavioral manifest build (then review manually)
```
