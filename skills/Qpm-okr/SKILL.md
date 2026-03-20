---
name: Qpm-okr
description: "Brainstorms and writes OKRs with SMART validation, initiative mapping, and roadmap connection. Use for 'OKR', 'objectives', 'key results', 'quarterly goals', '목표 설정', '핵심결과', '분기 목표'. Distinct from Qpm-roadmap (work sequencing) — this defines measurable goals and success criteria."
---


## Purpose
Guide OKR creation from objective brainstorming through key result validation to initiative mapping. Ensures OKRs are aspirational yet measurable, connected to roadmap execution, and free of common anti-patterns.

## OKR Writing Workflow

### Phase 1: Define Objectives (30 min)
An Objective answers: "Where do we want to go?"

**Rules:**
- Qualitative and inspirational — no numbers in the objective itself
- Time-bound (typically quarterly)
- Aligned to company/team mission
- 1-3 objectives per team per quarter

**Prompt questions:**
- What is the most important thing we must achieve this quarter?
- If we could only accomplish one thing, what would it be?
- What would make our users noticeably happier?

### Phase 2: Write Key Results (45 min)
A Key Result answers: "How do we know we got there?"

**Rules:**
- Quantitative and measurable — must have a number
- 3-5 Key Results per Objective
- Outcome-based, not activity-based
- Stretch but achievable (70% completion = success)
- Each KR is independently verifiable

**Formula:**
```
[Verb] [metric] from [current baseline] to [target] by [date]
```

### Phase 3: Map Initiatives (30 min)
An Initiative answers: "What will we do to move the needle?"

**Rules:**
- Each initiative links to one or more KRs
- Initiatives are projects, experiments, or tasks
- Not all initiatives need to succeed for KRs to be met
- Prioritize by expected impact on KR

## SMART Validation Checklist

Run this check for **every Key Result** before finalizing:

| Criterion | Question | Pass? |
|-----------|----------|-------|
| **S**pecific | Is it clear what is being measured? No ambiguity? | |
| **M**easurable | Is there a number with a current baseline and target? | |
| **A**chievable | Is 70% completion realistic with available resources? | |
| **R**elevant | Does achieving this KR meaningfully advance the Objective? | |
| **T**ime-bound | Is there a clear deadline (quarter end or specific date)? | |

If any criterion fails, rewrite the KR before proceeding.

## OKR-Roadmap Connection Guide

OKRs set direction; roadmaps define execution. Connect them explicitly:

```
Objective (quarterly goal)
  └─ Key Result (measurable outcome)
       └─ Initiative (project/epic on roadmap)
            └─ Sprint Goals (2-week milestones)
                 └─ User Stories (development tasks)
```

**Connection rules:**
- Every roadmap epic should trace back to at least one KR
- If an epic has no KR connection, question its priority
- Sprint goals should reference which KR they advance
- During sprint review, report KR progress alongside velocity

**Alignment check questions:**
- Which KR does this epic move?
- If we ship this feature, which metric changes?
- Are we spending time on work that moves no KR?

## OKR Template

```markdown
## Objective: [qualitative goal]
**Owner:** [team or person]
**Quarter:** [Q1/Q2/Q3/Q4 YYYY]

### Key Results
- KR1: [metric] from [current] to [target] by [date]
- KR2: [metric] from [current] to [target] by [date]
- KR3: [metric] from [current] to [target] by [date]

### Initiatives
- [ ] Initiative A → drives KR1
- [ ] Initiative B → drives KR1, KR2
- [ ] Initiative C → drives KR3

### Mid-Quarter Check-in
| KR | Baseline | Current | Target | Confidence |
|----|----------|---------|--------|------------|
| KR1 | | | | |
| KR2 | | | | |
| KR3 | | | | |
```

## Good Example

```markdown
## Objective: Make onboarding so smooth that new users succeed on their own
**Owner:** Growth Team
**Quarter:** Q2 2025

### Key Results
- KR1: Increase Day-7 activation rate from 34% to 50% by Jun 30
- KR2: Reduce median time-to-first-value from 12 min to 5 min by Jun 30
- KR3: Decrease onboarding support tickets from 180/week to 80/week by Jun 30

### Initiatives
- [ ] Redesign onboarding wizard with progressive disclosure → drives KR1, KR2
- [ ] Add interactive product tour for top 3 use cases → drives KR1, KR2
- [ ] Build self-service knowledge base with video walkthroughs → drives KR3
- [ ] Implement onboarding health score email triggers → drives KR1
```

## Anti-Patterns

- **Binary KRs** — "Launch feature X" is a task, not a measurable outcome. Rewrite as the metric the launch should move.
- **Too many KRs** — More than 5 KRs per Objective dilutes focus. If you have 7, merge or drop the weakest.
- **Activity-based KRs** — "Ship 10 features" measures output, not outcome. Ask: "What changes for the user?"
- **Sandbagging** — Setting targets you already hit. KRs should require stretch; 70% completion = good.
- **No baseline** — "Improve NPS" is meaningless without "from X to Y". Always measure the starting point first.
- **Orphan initiatives** — Work that connects to no KR. Either link it or deprioritize it.
- **Set and forget** — OKRs without mid-quarter check-ins drift. Schedule reviews at week 3 and week 7.

## Usage Examples
```
User: Help me write OKRs for next quarter
User: OKR 브레인스토밍 도와줘
User: 분기 목표 설정하고 핵심결과 작성해줘
User: Review my OKRs and check if they're SMART
```

Credits: Frameworks adapted from phuryn/pm-skills (MIT)
