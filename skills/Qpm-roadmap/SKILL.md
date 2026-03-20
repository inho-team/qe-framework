---
name: Qpm-roadmap
description: "Plans outcome-focused strategic roadmaps with RICE prioritization and stakeholder communication. Use for 'create a roadmap', 'quarterly plan', 'product roadmap', 'priority sorting', '로드맵', '분기 계획'. Distinct from Qpm-okr (goal-setting) — this sequences and visualizes work across time horizons."
---


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

## Outcome-Focused Roadmap Transformation

Output-focused roadmaps create false precision. Outcome-focused roadmaps clarify customer problems and business value.

### Transformation Process

For each initiative on the roadmap:
1. **Identify the Output**: What feature or project is planned?
2. **Uncover the Outcome**: Why are we building it? What changes for customers or business?
3. **Rewrite as Outcome Statement**:
```
Enable [customer segment] to [desired customer outcome] so that [business impact]
```

### Example
| Output (Old) | Outcome (New) |
|--------------|---------------|
| Build advanced search filters | Enable customers to find products 50% faster through intuitive discovery |
| Implement AI recommendations | Increase average order value by 20% through personalized recommendations |
| Redesign dashboard | Help operators monitor all systems with 80% reduction in load time |

### Output vs Outcome Quick Check
- **Output**: "Build X" → describes what you ship
- **Outcome**: "Enable Y to Z" → describes what changes for users/business
- An outcome should be testable and measurable
- Multiple outputs may achieve one outcome — focus on the outcome

### Strategic Context Alignment
For the overall roadmap, always include:
- How outcomes align with company strategy/OKRs
- Key assumptions about customer needs (link to `/Qpm-discovery` for validation)
- Flexible release windows (quarters, not specific dates)

## Anti-Patterns
- Feature list roadmap (no context) → include hypothesis + success metrics
- HiPPO prioritization → use frameworks like RICE
- Treating roadmap as a promise → communicate as "a plan subject to change as we learn"
- Not mapping dependencies → explicitly map in Phase 4
- Building alone → collect stakeholder input
- Output-focused initiatives ("Build X") → rewrite as outcome statements
- Fixed dates on exploratory items → use confidence levels (Committed/High/Low)

Credits: Original skill by @deanpeters - https://github.com/deanpeters/Product-Manager-Skills
Credits: Outcome-focused transformation framework adapted from phuryn/pm-skills (MIT)
