---
name: Qskill-creator
description: "Create, modify, diagnose, and benchmark QE Framework skills. Use when creating a skill from scratch, editing/optimizing an existing one, or fixing a skill that incorrectly blocks, misroutes, or mishandles a request. Trigger phrases: 'create a skill', 'fix this skill', 'skill is blocking', 'improve skill logic', 'tune the framework'."
metadata:
  author: anthropic
  version: "3.0.0"
---


# Skill Creator

Creates new skills and diagnoses/fixes existing ones.

## Shared Rules (Apply to Both Create and Modify)

- **All skill files must be written in English.** No exceptions.
- **SKILL.md must not exceed 250 lines.** Do not truncate — condense. Move detailed content into `reference/` subdirectory files.
- One skill = one clear responsibility. If a skill does two things, split it.
- Distinguish from existing skills in description ("Distinct from X which does Y").
- **Semantic over syntactic.** Rules should check intent, not match literal strings.
- **Test cases are mandatory.** Every skill ships with trigger examples; every fix ships with 2+ test prompts.
- **Source and cache must stay in sync.** After modifying a skill, update both:
  - Source: `skills/<Name>/SKILL.md`
  - Cache: `~/.claude/plugins/cache/inho-team-qe-framework/qe-framework/<ver>/skills/<Name>/SKILL.md`
- **Update QE_CONVENTIONS.md on every skill/agent change.** When creating, renaming, deleting, or changing the purpose of a skill or agent, update the corresponding entry in `QE_CONVENTIONS.md`. This file is the skill/agent registry that Claude reads at every session.

## File Locations

| Component | Source | Cache |
|-----------|--------|-------|
| Skill | `skills/<Name>/SKILL.md` | `~/.claude/plugins/cache/.../skills/<Name>/SKILL.md` |
| Agent | `agents/<Name>/AGENT.md` | `~/.claude/plugins/cache/.../agents/<Name>/AGENT.md` |
| Hook | `hooks/<name>` | Same path (runs from source) |
| Global | `~/.claude/skills/<name>/SKILL.md` | N/A |
| Local | `.claude/skills/<name>/SKILL.md` | N/A |

---

## Mode 1: Create a New Skill

### Phase 1: Define Purpose

1. **What does this skill do?** — One sentence.
2. **When should it trigger?** — Specific phrases, keywords, scenarios.
3. **When should it NOT trigger?** — Negative triggers, similar skills.
4. **What is the output?** — Code, document, analysis, configuration?
5. **Does it need user interaction?** — One-shot or collaborative?

### Phase 2: Design Structure

**Simple** (single file):
```
skills/Qname/
└── SKILL.md
```

**Complex** (with references — use when detailed content exceeds ~50 lines per topic):
```
skills/Qname/
├── SKILL.md              ← Workflow, validation gates, quick reference
└── reference/            ← Detailed domain guides
    ├── topic-a.md
    └── topic-b.md
```

### Phase 3: Write SKILL.md

**Frontmatter:**
```markdown
---
name: Qskill-name
description: "Action. Trigger conditions. Distinction from similar skills."
metadata:
  author: name
  version: "1.0.0"
---
```

**Choose a workflow pattern:**

| Pattern | Use When | Structure |
|---------|----------|-----------|
| Sequential Steps | Procedural tasks | Step 0 → 1 → 2 → Validate → Confirm |
| Collaborative Phases | Documents, plans, reports | Structure agreement → Section-by-section → Visual polish → Export |
| Gate-and-Execute | Validation/review tasks | Read → Apply rules → Report |

**Add validation gates** if the skill produces quality-sensitive output:
```markdown
## Validation (Required — Every Output)
1. Check A → condition = **FAIL**
2. Check B → condition = **FAIL**
```

**Add component-based execution** for large outputs:
```markdown
Do not build everything at once. One unit at a time:
1. Decompose → 2. Prioritize → 3. Implement one → 4. User confirms → next
```

**Make tool integrations explicit and mandatory**, not optional suggestions.

**End with** Quick Reference + Never Use sections.

### Phase 4: Test and Iterate

1. Test with 3-5 real prompts
2. Check trigger accuracy (fires when should, silent when shouldn't)
3. Check output quality against validation gates
4. Check for unhandled scenarios
5. Rewrite → expand test set → repeat

---

## Mode 2: Diagnose and Fix an Existing Skill

**Scope:** QE Framework internals only. Not for user project tasks.

### When to Use

| Situation | Example |
|-----------|---------|
| Skill incorrectly blocks a valid request | Gate fires on a legitimate prompt |
| Skill routes to the wrong handler | `Qcommit` triggers on general commit questions |
| Trigger condition is too narrow or broad | Skill never fires, or fires on unrelated prompts |
| Decision rule uses wrong threshold | Word count limit rejects valid prompts |
| Workflow step produces incorrect behavior | Auto-approves when it should verify |

### Step 1 — Reproduce the Failure

Collect:
- Which skill/agent misbehaved?
- Exact user prompt?
- Observed vs expected output?

### Step 2 — Locate the Defective Rule

Read the SKILL.md/AGENT.md. For each candidate rule:
1. Is the rule's **intent** correct?
2. Is the rule's **logic** correct?
3. Is the rule **structurally sound** (not a brittle hardcoded list)?

### Step 3 — Root Cause Classification

| Class | Description | Fix Direction |
|-------|-------------|---------------|
| **Threshold** | Numeric cutoff miscalibrated | Adjust with justification |
| **Missing signal** | Valid signal not recognized | Add signal type (not keyword) |
| **Brittle encoding** | Matches literals, not semantics | Rewrite to check intent |
| **Scope mismatch** | Guards the wrong thing | Redefine what rule checks |
| **Missing case** | Valid scenario unhandled | Add with reasoning |

> If a fix requires adding more keywords to a list, the rule itself is likely wrong. Fix the principle, not the list.

### Step 4 — Propose the Fix

Present before/after diff with:
- Root cause (one sentence)
- Before (exact current text)
- After (proposed replacement)
- Why this fix is correct
- Test cases (2+ prompts: one pass, one gate)

### Step 5 — Apply and Sync

Apply fix to both source and cache files (see File Locations above).

### Step 6 — Regression Check

- Prompts that should be gated are still gated
- Prompts that should pass now pass
- No other skill's trigger overlaps with the changed rule

### Fix Output Format

```
## Diagnosis
**Skill/Agent:** <name>
**Defect class:** <class>
**Root cause:** <one sentence>

## Fix
**Before:** <exact current text>
**After:** <proposed replacement>
**Why:** <reasoning>

## Test Cases
| Prompt | Expected | Reason |
|--------|----------|--------|
| ... | Pass | ... |
| ... | Gate | ... |
```

## Fix Quality Rules

1. **Semantic over syntactic.** Check intent, not literal strings.
2. **One fix, one cause.** Don't bundle unrelated changes.
3. **Justify every threshold.** Document why that number is correct.
4. **No copy-paste between skills.** Extract shared logic, don't duplicate.
5. **Test cases are mandatory.** Every fix ships with 2+ test prompts.
