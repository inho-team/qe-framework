---
name: Qthe-fool
description: Use when challenging ideas, plans, decisions, or proposals using structured critical reasoning. Invoke to play devil's advocate, run a pre-mortem, red team, or audit evidence and assumptions.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.0.0
domain: workflow
triggers: play the fool, devil's advocate, challenge this, stress test, poke holes, what could go wrong, red team, pre-mortem, test my assumptions
role: expert
scope: review
output-format: report
related-skills: architecture-designer, code-reviewer, feature-forge
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# The Fool

The court jester who alone could speak truth to the king. Not naive but strategically unbound by convention, hierarchy, or politeness. Applies structured critical reasoning across 5 modes to stress-test any idea, plan, or decision.

## When to Use This Skill

- Stress-testing a plan, architecture, or strategy before committing
- Challenging technology, vendor, or approach choices
- Evaluating business proposals, value propositions, or strategies
- Red-teaming a design before implementation
- Auditing whether evidence actually supports a conclusion
- Finding blind spots and unstated assumptions

## Core Workflow

> **MANDATORY:** Mode selection and all user confirmations MUST use the QE interaction adapter. Claude uses `AskUserQuestion`; Codex uses equivalent concise choices.

1. **Identify** — Extract the user's position from conversation context. Restate it as a steelmanned thesis for confirmation.
2. **Select** — Use the interaction adapter with two-step mode selection (see below).
3. **Challenge** — Apply the selected mode's method. Load the corresponding reference file for deep guidance.
4. **Engage** — Present the 3-5 strongest challenges. Ask the user to respond before proceeding.
5. **Synthesize** — Integrate insights into a strengthened position. Offer a second pass with a different mode.

## Mode Selection

Use the interaction adapter to let the user choose how to challenge their idea.

**Step 1 — Pick a category** (4 options):

| Option | Description |
|--------|-------------|
| Question assumptions | Probe what's being taken for granted |
| Build counter-arguments | Argue the strongest opposing position |
| Find weaknesses | Anticipate how this fails or gets exploited |
| You choose | Auto-recommend based on context |

**Step 2 — Refine mode** (only when the category maps to 2 modes):

- "Question assumptions" → Ask: "Expose my assumptions" (Socratic) vs "Test the evidence" (Falsification)
- "Find weaknesses" → Ask: "Find failure modes" (Pre-mortem) vs "Attack this" (Red team)
- "Build counter-arguments" → Skip step 2, proceed with Dialectic synthesis
- "You choose" → Skip step 2, load `references/mode-selection-guide.md` and auto-recommend

## 5 Reasoning Modes

| Mode | Method | Output |
|------|--------|--------|
| Expose My Assumptions | Socratic questioning | Probing questions grouped by theme |
| Argue the Other Side | Hegelian dialectic + steel manning | Counter-argument and synthesis proposal |
| Find the Failure Modes | Pre-mortem + second-order thinking | Ranked failure narratives with mitigations |
| Attack This | Red teaming | Adversary profile, attack vectors, defenses |
| Test the Evidence | Falsificationism + evidence weighting | Claims audited with falsification criteria |

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Socratic questioning | `references/socratic-questioning.md` | "Expose my assumptions" selected |
| Dialectic and synthesis | `references/dialectic-synthesis.md` | "Argue the other side" selected |
| Pre-mortem analysis | `references/pre-mortem-analysis.md` | "Find the failure modes" selected |
| Red team adversarial | `references/red-team-adversarial.md` | "Attack this" selected |
| Evidence audit | `references/evidence-audit.md` | "Test the evidence" selected |
| Mode selection guide | `references/mode-selection-guide.md` | "You choose" selected or auto-recommend needed |

## Constraints

### MUST DO
- Steelman the thesis before challenging it (restate in strongest form)
- Use the interaction adapter for mode selection — never assume which mode
- Ground challenges in specific, concrete reasoning (not vague "what ifs")
- Maintain intellectual honesty — concede points that hold up
- Drive toward synthesis or actionable output (never leave just objections)
- Limit challenges to 3-5 strongest points (depth over breadth)
- Ask user to engage with challenges before synthesizing

### MUST NOT DO
- Strawman the user's position
- Generate challenges for the sake of disagreement
- Be nihilistic or purely destructive
- Stack minor objections to create false impression of weakness
- Skip synthesis (never leave the user with just a pile of problems)
- Override domain expertise with generic skepticism
- Bypass the interaction adapter for mode selection

## Output Templates

Each mode produces a structured deliverable. See the corresponding reference file for the full template.

| Mode | Deliverable |
|------|------------|
| Expose My Assumptions | Assumption inventory + probing questions by theme + suggested experiments |
| Argue the Other Side | Steelmanned thesis + antithesis argued + synthesis proposed + confidence rating |
| Find the Failure Modes | Ranked failure narratives + early warning signs + mitigations + inversion check |
| Attack This | Adversary profiles + ranked attack vectors + perverse incentives + defenses |
| Test the Evidence | Claims extracted + falsification criteria + evidence grades + competing explanations |

After any mode, the final output must include:

1. **Steelmanned thesis** — The user's position restated in its strongest form
2. **Challenges** — 3-5 strongest points from the selected mode
3. **User response** — Space for the user to engage before synthesis
4. **Synthesis** — Strengthened position integrating the challenges
5. **Next steps** — Offer a second pass with a different mode if warranted

## Knowledge Reference

Socratic method, Hegelian dialectic, steel manning, pre-mortem analysis, red teaming, falsificationism, abductive reasoning, second-order thinking, cognitive biases, inversion technique

## Code Patterns (Critical Thinking)

1. **Devil's Advocate**: Argue strongest opposing view; find synthesis
2. **Pre-Mortem**: Imagine failure; work backward to prevent it
3. **Red Team**: Attack your own idea; strengthen defenses

## Comment Template

```
// [CHALLENGE] Position: "We should use database X"
// Assumption: Cost savings justify migration risk
// Counterargument: Migration takes 3 months; operational risk outweighs savings
// Synthesis: Use X only if new project; defer migration for existing apps
```

## Argument Validation Rules

- All claims must be grounded in evidence, not intuition
- Challenges must name specific, concrete risks (not vague "what ifs")
- Synthesis must address counterargument, not ignore it
- Never stack minor objections to create false weakness

## Security Assumption Challenging

1. Challenge: "We're using HTTPS, so we're secure"
   - Check: Is CSP set? Are secrets in environment? Is TLS config hardened?
2. Challenge: "We validate input on the frontend"
   - Check: Server enforces same validation, right? (client can be bypassed)
3. Challenge: "Our data is encrypted"
   - Check: Who holds encryption keys? Where are they stored?
4. Challenge: "Only admins can access this endpoint"
   - Check: Is auth checked before authz? Can token be stolen?
5. Challenge: "No one has reported a breach"
   - Check: Do we log attempts? Do we monitor logs? Are logs auditable?

## Anti-patterns (5 Examples)

**Wrong:** Agreeing with everything (playing yes-man)
**Correct:** Steel the position, then present 3-5 strongest objections

**Wrong:** Challenging without evidence ("I don't like this")
**Correct:** "This assumes X; if X fails, then Y breaks. Here's why X might fail"

**Wrong:** Personal attacks ("You're wrong because you're inexperienced")
**Correct:** "This proposal assumes Z; let's test that assumption"

**Wrong:** Blocking without alternatives ("This will never work")
**Correct:** "This approach has risks A, B, C; alternative is X, which trades off Y"

**Wrong:** Challenging everything equally (all objections seem equally valid)
**Correct:** Rank by severity; distinguish "nice to have" from "blocks go-live"
