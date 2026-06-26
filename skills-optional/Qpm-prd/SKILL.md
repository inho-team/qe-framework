---
name: Qpm-prd
description: Writes PRDs (Product Requirements Documents) with P0/P1/P2 prioritization and 10-section template. Use for 'write a PRD', 'product spec', 'requirements document', 'product planning', 'write PRD', 'requirements document'. Distinct from Qpm-user-story (individual stories) — this produces the full PRD document.
invocation_trigger: When product discovery, requirements, or roadmap planning is required.
recommendedModel: sonnet
---

## Scope Boundary
**Distinct from:** Qpm-user-story (individual stories), Qpm-roadmap (timeline). This skill writes the full PRD document encompassing all sections from executive summary through dependencies. For breaking a PRD into individual user stories, delegate to /Qpm-user-story; for sequencing PRD epics into Now/Next/Later phases, delegate to /Qpm-roadmap.

## Purpose
Write structured PRDs from problem definition through engineering handoff. Transforms scattered notes and Slack threads into clear, comprehensive PRDs for stakeholder alignment, engineering context, and as a source of truth.

## PRD Standard Structure

```markdown
# [Feature/Product Name] PRD

## 1. Executive Summary
- One-paragraph overview (problem + solution + impact)

## 2. Problem Statement
- Who has this problem?
- What is the problem?
- Why is it painful?
- Evidence (customer interviews, data, research)

## 3. Target Users & Personas
- Primary persona
- Secondary persona
- Jobs-to-be-done

## 4. Strategic Context
- Business objectives (OKRs)
- Market opportunity
- Competitive landscape
- Why now?

## 5. Solution Overview
- High-level description
- User flows or wireframes
- Key features

## 6. Success Metrics
- Primary metric (what to optimize)
- Secondary metrics
- Targets (current → goal)

## 7. User Stories & Requirements
- Epic hypothesis
- User stories with acceptance criteria
- Edge cases, constraints

## 8. Out of Scope
- What will not be built (with reasons)

## 9. Dependencies & Risks
- Technical dependencies
- External dependencies
- Risks and mitigation

## 10. Open Questions
- Unresolved decisions
- Areas needing further discovery
```

## Workflow

### Phase 1: Executive Summary (30 min)
"We are building [solution] for [persona] to solve [problem], which will deliver [impact]."

### Phase 2: Problem Definition (60 min)
- Write who, what, and why it hurts — with evidence
- Include customer interview quotes, data, and support tickets

### Phase 3: Target Users (30 min)
- Write concrete persona profiles
- Include role, goals, pain points, and current behavior

### Phase 4: Strategic Context (45 min)
- Link to OKRs, market opportunity, competitive analysis, and "why now"

### Phase 5: Solution Overview (60 min)
- High-level description (no UI details — that's for design collaboration)
- User flows and key feature list

### Phase 6: Success Metrics (30 min)
- One primary metric (what to optimize)
- Secondary metrics and guardrail metrics

### Phase 7: User Stories & Requirements (90-120 min)
- Write epic hypotheses
- 3-10 user stories with acceptance criteria

### Phase 8: Out of Scope & Dependencies (30 min)
- Explicitly list excluded features
- Technical/external/team dependencies and open questions

## Requirement Prioritization

Classify all requirements using priority tiers:

| Priority | Meaning | Criteria |
|----------|---------|----------|
| **P0** | Must-have (launch blocker) | Without this, the product cannot ship |
| **P1** | Should-have (high value) | Significant user/business impact, target for v1 |
| **P2** | Nice-to-have (future) | Valuable but can wait for subsequent releases |

Apply to User Stories table:
```markdown
| ID | Story | Priority | Effort |
|----|-------|----------|--------|
| US-01 | As a... | P0 | M |
```

## Non-goals & Open Questions

Every PRD must explicitly include:

**Non-goals** — What will NOT be built and why. Prevents scope creep.
```markdown
## Non-goals
- [Feature X]: Out of scope because [reason]. Revisit in Q3.
- [Feature Y]: Covered by existing [system].
```

**Open Questions Tracker** — Unresolved decisions with owners and deadlines.
```markdown
## Open Questions
| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| 1 | Which auth provider? | @eng-lead | 03/25 | Open |
```

## Iterative Workflow Pattern

After initial PRD generation, offer follow-up actions:
1. **Scope refinement** — Tighten P0/P1/P2 boundaries
2. **Pre-mortem** → delegate to `/Qpm-retro`
3. **User story breakdown** → delegate to `/Qpm-user-story`
4. **Stakeholder communication** — Extract executive summary for leadership

## Anti-Patterns
- Write alone then present to team → collaborate while writing
- Problem definition without evidence → include data/interviews
- Overly detailed specs → stay high-level
- No success metrics → always define a primary metric
- No out of scope → prevents scope creep
- Vague success metrics ("improve NPS") → be specific ("improve NPS from 32 to 45 within 90 days")
- No priority tiers → always classify P0/P1/P2
- Large monolithic PRD → phase into Phase 1 (detailed) + Phase 2 (outline)

## Usage Examples
```
User: Write a PRD for the new notification system
User: Create a product spec for this feature
User: Help me organize the requirements document
```

Credits: Original skill by @deanpeters - https://github.com/deanpeters/Product-Manager-Skills
Credits: 8-section template and iterative patterns adapted from phuryn/pm-skills (MIT)
