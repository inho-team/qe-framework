> Core philosophy: see core/PHILOSOPHY.md
---
name: Ttune
description: "Diagnoses and fixes behavioral issues in QE Framework skills, agents, hooks, and routing logic. Use when a skill incorrectly blocks, misroutes, or mishandles a request — NOT for user project tasks. Trigger phrases: 'this skill is wrong', 'fix the gate', 'skill is blocking', 'routing bug', 'tune the framework', 'the skill shouldn't have fired', 'improve skill logic'."
---

# Ttune — QE Framework Behavior Tuning

## Purpose

Ttune diagnoses and repairs behavioral defects in the QE Framework itself:
skills, agents, hooks, and routing logic.

**Scope:** QE Framework internals only. Not for user project tasks.

---

## When to Invoke

| Situation | Example |
|-----------|---------|
| A skill incorrectly blocks a valid request | Pre-execution Gate fires on `전수 조사해` |
| A skill routes to the wrong handler | `Qcommit` triggers when user asks about commits in general |
| A trigger condition is too narrow or too broad | Skill never fires, or fires on unrelated prompts |
| A decision rule uses the wrong threshold | Word count ≤ 15 rejects legitimate Korean prompts |
| A workflow step produces incorrect behavior | Step 2.5 auto-approves when it should verify |
| A keyword list is hardcoded when semantics should drive the rule | Gate checks for literal `전수 조사` instead of inferring scope intent |

**Do not invoke for:** writing user code, generating specs, running tasks, or any work tied to a user project.

---

## Diagnostic Protocol

### Step 1 — Reproduce the Failure

Collect the exact inputs that triggered the wrong behavior:
- Which skill or agent misbehaved?
- What was the exact user prompt?
- What was the observed output?
- What was the expected output?

### Step 2 — Locate the Defective Rule

Read the relevant SKILL.md or AGENT.md. Identify the specific section, rule, or condition responsible for the failure.

For each candidate rule, answer:
1. **Is the rule's intent correct?** (right goal, wrong implementation)
2. **Is the rule's logic correct?** (right intent, wrong encoding)
3. **Is the rule structurally sound?** (not a brittle hardcoded list that will need constant maintenance)

### Step 3 — Root Cause Classification

Classify the defect before proposing a fix:

| Class | Description | Fix Direction |
|-------|-------------|---------------|
| **Threshold** | A numeric cutoff is miscalibrated | Adjust the value with justification |
| **Missing signal** | A valid signal type is not recognized | Add the signal type (not the keyword) |
| **Brittle encoding** | Logic matches literals instead of semantics | Rewrite to check intent, not surface form |
| **Scope mismatch** | Rule guards the wrong thing | Redefine what the rule is actually checking |
| **Missing case** | A valid scenario is unhandled | Add the scenario with explicit reasoning |

> **Key principle:** If a fix requires adding more keywords to a list, that is a smell. The rule itself is likely wrong. Fix the principle, not the list.

### Step 4 — Propose the Fix

Present a before/after diff of the affected section. Include:
- **Root cause** (one sentence)
- **Fix description** (what changes and why)
- **Before** (exact current text)
- **After** (proposed replacement)
- **Test cases** (≥2 prompts: one that should pass, one that should still be gated)

### Step 5 — Apply and Sync

After confirmation (or in autonomous mode), apply the fix to:
1. Source file: `skills/<Name>/SKILL.md` or `agents/<Name>/AGENT.md` in the framework repo
2. Cache file: `~/.claude/plugins/cache/inho-team-qe-framework/qe-framework/<version>/skills/<Name>/SKILL.md`

Both files must be in sync. If the cache version differs, apply the same fix to both.

### Step 6 — Regression Check

Verify the fix does not break adjacent behavior by checking:
- Prompts that should still be gated are still gated
- Prompts that should pass now pass
- No other skill's trigger overlaps with the changed rule

---

## Fix Quality Rules

1. **Semantic over syntactic.** Prefer rules that check intent and scope over rules that match literal strings.
2. **One fix, one cause.** Do not bundle unrelated changes in a single fix.
3. **Justify every threshold.** If a number appears in a rule (word count, retry limit, cycle count), document why that number is correct.
4. **No copy-paste between skills.** If the same logic appears in two skills, that is a structural problem — do not patch both; extract the principle.
5. **Test cases are mandatory.** Every fix ships with ≥2 test prompts demonstrating the corrected behavior.

---

## Output Format

```
## Diagnosis

**Skill/Agent:** <name>
**Defect class:** <Threshold | Missing signal | Brittle encoding | Scope mismatch | Missing case>
**Root cause:** <one sentence>

## Fix

**Before:**
<exact current text>

**After:**
<proposed replacement>

**Why this fix is correct:**
<reasoning — addresses the principle, not just the symptom>

## Test Cases

| Prompt | Expected | Reason |
|--------|----------|--------|
| <prompt> | Pass | <why> |
| <prompt> | Gate | <why> |
```

---

## File Locations

| Component | Source path | Cache path |
|-----------|------------|------------|
| Skill | `skills/<Name>/SKILL.md` | `~/.claude/plugins/cache/inho-team-qe-framework/qe-framework/<ver>/skills/<Name>/SKILL.md` |
| Agent | `agents/<Name>/AGENT.md` | `~/.claude/plugins/cache/inho-team-qe-framework/qe-framework/<ver>/agents/<Name>/AGENT.md` |
| Hook | `hooks/<name>` | Same path (hooks run from source) |
