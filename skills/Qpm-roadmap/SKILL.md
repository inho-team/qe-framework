---
name: Qpm-roadmap
description: Plans strategic product roadmaps. Includes prioritization, epic definition, stakeholder alignment, and release sequencing. Use for requests like "create a roadmap", "quarterly plan", "product strategy roadmap", or "priority sorting".
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


## Purpose
Transform scattered feature requests into a cohesive, outcome-driven roadmap through strategic roadmap planning. Aligns stakeholders, sequences work logically, and communicates strategic intent.

## Roadmap Types

| Type | Description | Best For |
|------|-------------|----------|
| **Now/Next/Later** | Three-stage: current/next/future | Agile teams, high uncertainty |
| **Theme-based** | Organized by strategic themes | Executive presentations, communicating intent |
| **Timeline (Quarterly)** | Q1, Q2, Q3 structure | Resource planning, stakeholder communication |

## Workflow (5 Phases, 1-2 Weeks)

### Phase 1: Gather Inputs (Day 1-2)

**Review business objectives:**
- Company OKRs, strategy memos
- Key metrics to move (revenue, retention, acquisition, efficiency)

**Review customer problems:**
- Discovery interviews, support tickets, NPS feedback
- Top 3-5 validated customer problems

**Review technical constraints:**
- Tech debt, scaling issues
- Required platform upgrades

**Collect stakeholder requests:**
- Sales, marketing, CS, executive requests

### Phase 2: Define Initiatives (Epics) (Day 3-4)

Write a hypothesis for each epic:
```
"We believe that [building X] will achieve [outcome] for [persona].
Because [assumption]."
```

**T-shirt sizing:**
- S: 1-2 weeks (1-2 engineers)
- M: 3-4 weeks (2-3 engineers)
- L: 2-3 months (3-5 engineers)
- XL: 3+ months (5+ engineers)

### Phase 3: Prioritization (Day 5)

**RICE Scoring:**
```
RICE = (Reach × Impact × Confidence) / Effort
```

| Epic | Reach | Impact | Confidence | Effort | RICE |
|------|-------|--------|------------|--------|------|
| Epic A | 10,000 | 3 | 80% | 1 month | 24,000 |
| Epic B | 500 | 3 | 90% | 2 months | 675 |

### Phase 4: Sequencing (Day 6-7)

**Map dependencies then assign to quarters:**
```
Q1 (Now - Committed):
├─ Guided Onboarding (retention)
├─ Enterprise SSO (acquisition)
└─ Mobile Workflow (engagement)

Q2 (Next - High Confidence):
├─ Advanced Reporting (depends on Q1 data pipeline)
└─ Slack Integration

Q3 (Later - Low Confidence):
├─ Mobile App
└─ AI Recommendations
```

### Phase 5: Stakeholder Communication (Week 2)

**Presentation structure (30-45 min):**
1. Strategic context (business objectives, customer problems)
2. Roadmap overview (Q1, Q2, Q3)
3. Per-quarter deep dive (epics, hypotheses, success metrics)
4. Out of scope items and reasons
5. Dependencies and risks

## Roadmap Template

```markdown
# [Product Name] Roadmap - [Year] [Quarter]

## Strategic Objectives
- OKR 1: [objective]
- OKR 2: [objective]

## Now (Q1 - Committed)
| Epic | Hypothesis | Success Metric | Size |
|------|-----------|----------------|------|
| [Epic name] | [hypothesis] | [metric] | M |

## Next (Q2 - High Confidence)
| Epic | Hypothesis | Success Metric | Size |
|------|-----------|----------------|------|

## Later (Q3+ - Exploring)
| Epic | Hypothesis | Success Metric | Size |
|------|-----------|----------------|------|

## Out of Scope
- [Feature]: [reason for exclusion]

## Risks
- [Risk]: [mitigation]
```

## Anti-Patterns
- Feature list roadmap (no context) → include hypothesis + success metrics
- HiPPO prioritization → use frameworks like RICE
- Treating roadmap as a promise → communicate as "a plan subject to change as we learn"
- Not mapping dependencies → explicitly map in Phase 4
- Building alone → collect stakeholder input

Credits: Original skill by @deanpeters - https://github.com/deanpeters/Product-Manager-Skills
