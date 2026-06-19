---
name: Qrequirements-clarity
description: Clarifies ambiguous requirements through focused dialogue before implementation. Use when requirements are unclear, the feature is complex (2+ days), or cross-team collaboration is needed. Secures clarity before coding through two core questions — Why? (YAGNI check) and Simpler? (KISS check).
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---


# Requirements Clarity Skill

## Description

Automatically converts ambiguous requirements into actionable PRDs through a systematic clarification process scored on a 100-point scale.

## Usage Guidelines

When invoked, detect the following types of ambiguous requirements:

1. **Unclear feature requests**
   - "Add login", "implement payment", "create dashboard"
   - Missing: how, with what technology, under what constraints?

2. **Absent technical context**
   - Tech stack not mentioned, integration points not identified, no performance/security constraints

3. **Incomplete specification**
   - No acceptance criteria, no success metrics, edge cases not considered, error handling not mentioned

4. **Ambiguous scope**
   - Unclear boundaries, no distinction between MVP and future improvements, missing "what's not included"

**Do not activate when**: there are specific file paths, code snippets, references to existing functions/classes, or bug fixes with clear reproduction steps.

## Pre-Spec Gate Mode

This skill can be invoked as a **conditional gate** by `Qgenerate-spec` (Step 1.5) before spec drafting, in addition to its standalone use. In gate mode the goal is not a full PRD but a fast PASS/CLARIFY verdict.

**Entry point:** `Qgenerate-spec` calls this skill when `ambiguous(requirement) AND scale ≥ Small` (Micro always skips — see `D019` in `.qe/planning/DECISION_LOG.md`). The caller passes the raw requirement and the resolved Phase Success Criteria (if any).

**Behavior in gate mode:**
1. Run Step 1 (scoring). Treat the gate threshold as the existing **clarity score ≥ 90** bar, scoped to the single incoming requirement.
2. If already ≥ 90 → return `PASS` immediately with the sharpened one-line requirement. **No questions, no friction.**
3. If < 90 → run at most **one** focused clarification round (Step 3, 2–3 questions). Re-score.
4. Do **not** generate the full PRD document in gate mode — that is reserved for standalone invocation.

**Return contract (to `Qgenerate-spec`):**

| Verdict | Meaning | Caller action |
|---------|---------|---------------|
| `PASS` | Clarity ≥ 90 (immediately or after one round) | Proceed to spec drafting with the sharpened requirement |
| `CLARIFY` | Clarity still < 90 after one round | Surface the open questions to the user; do **not** draft specs yet |

The gate is a **clarification prompt, not a hard block**: a `PASS` returns control with zero added friction. This is the deliberate, scale-aware contrast with Superpowers' blanket-mandatory brainstorming.

## Core Principles

1. **Systematic questioning** — focused and specific, one category at a time (2–3 per round), building on previous answers
2. **Quality-driven iteration** — continuously evaluate clarity score (0–100), iterate until score reaches 90+
3. **Actionable output** — concrete specifications, measurable acceptance criteria, executable steps

## Clarification Process

### Step 1: Initial Requirements Analysis

**Scoring Criteria:**
```
Functional Clarity: /30
- Clear inputs/outputs: 10
- User interaction defined: 10
- Success conditions stated: 10

Technical Specificity: /25
- Tech stack mentioned: 8
- Integration points identified: 8
- Constraints specified: 9

Implementation Completeness: /25
- Edge cases considered: 8
- Error handling mentioned: 9
- Data validation addressed: 8

Business Context: /20
- Problem clearly defined: 7
- Target users identified: 7
- Success metrics defined: 6
```

**Initial Response:**
```markdown
I understand the requirement. Let me help sharpen the specification.

**Current Clarity Score**: X/100

**Clear so far**: [list]
**Needs clarification**: [list]

I will systematically clarify the following...
```

### Step 2: Identify Gaps

Identify missing information across four dimensions:

1. **Functional scope** — core features, boundaries, out-of-scope, edge cases
2. **User interaction** — how users interact, inputs/outputs, success/failure scenarios
3. **Technical constraints** — performance, compatibility, security, scalability
4. **Business value** — problem being solved, target users, success metrics, priority

### Step 3: Interactive Clarification

**Questioning Strategy:**
1. Start with the most impactful gap
2. 2–3 questions per round
3. Progressively build context
4. Use the user's own language
5. Provide examples when needed

**After Each User Response:**
1. Update the clarity score
2. Reflect new information in the PRD outline
3. Identify remaining gaps
4. Score < 90: continue to the next round
5. Score >= 90: proceed to PRD generation

### Step 4: Generate PRD

When clarity score reaches 90+, generate a comprehensive PRD.

**Output File:** `./docs/prds/{feature_name}-v{version}-prd.md`

## PRD Document Structure

```markdown
# {Feature Name} - Product Requirements Document (PRD)

## Requirements Description

### Background
- **Business problem**: [problem to solve]
- **Target users**: [user group]
- **Value proposition**: [value this feature delivers]

### Feature Overview
- **Core features**: [list of main capabilities]
- **Feature boundaries**: [included / excluded]
- **User scenarios**: [common usage scenarios]

### Detailed Requirements
- **Inputs/Outputs**: [specific I/O specification]
- **User interaction**: [interaction flow]
- **Data requirements**: [data structure, validation]
- **Edge cases**: [edge case handling]

## Design Decisions

### Technical Approach
- **Architecture**: [decisions and rationale]
- **Key components**: [technical components]
- **Data storage**: [model and storage solution]
- **Interfaces**: [API/interface specification]

### Constraints
- **Performance**: [response time, throughput]
- **Compatibility**: [system compatibility]
- **Security**: [security considerations]
- **Scalability**: [future expansion]

### Risk Assessment
- **Technical risks**: [risks and mitigations]
- **Dependency risks**: [external dependencies and alternatives]
- **Schedule risks**: [timeline risks]

## Acceptance Criteria

### Functional Acceptance
- [ ] Feature 1: [specific condition]
- [ ] Feature 2: [specific condition]

### Quality Standards
- [ ] Code quality: [standards and review]
- [ ] Test coverage: [requirements]
- [ ] Performance metrics: [pass criteria]
- [ ] Security review: [requirements]

## Implementation Steps

### Step 1: Preparation
- [ ] Task: [specific description]
- **Deliverables**: [step deliverables]

### Step 2: Core Development
- [ ] Task: [specific description]
- **Deliverables**: [step deliverables]

### Step 3: Integration and Testing
- [ ] Task: [specific description]
- **Deliverables**: [step deliverables]

### Step 4: Deployment
- [ ] Task: [specific description]
- **Deliverables**: [step deliverables]

---

**Document Version**: 1.0
**Created**: {timestamp}
**Clarification Rounds**: {rounds}
**Quality Score**: {score}/100
```

## Behavioral Guidelines

### Will
- Ask specific, targeted questions
- Build on previous answers
- Guide the user with examples
- Maintain a conversational tone
- Stay in clarification mode until score reaches 90+

### Will Not
- Ask all questions at once
- Make assumptions without confirmation
- Generate PRD below 90 points
- Skip required sections
- Proceed without user responses

## Success Criteria

- Clarity score >= 90/100
- All PRD sections completed with substantive content
- Acceptance criteria in checklist format
- Implementation steps actionable with specific tasks
- User has approved the final PRD
- Ready for developer handoff
