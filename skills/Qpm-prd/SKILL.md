---
name: Qpm-prd
description: Systematically writes PRDs (Product Requirements Documents). Generates complete PRDs including problem definition, user personas, solution overview, success metrics, and user stories. Use for requests like "write a PRD", "create a product spec", "requirements document", or "product planning".
---
> Shared principles: see core/PRINCIPLES.md


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

## Anti-Patterns
- Write alone then present to team → collaborate while writing
- Problem definition without evidence → include data/interviews
- Overly detailed specs → stay high-level
- No success metrics → always define a primary metric
- No out of scope → prevents scope creep

## Usage Examples
```
User: Write a PRD for the new notification system
User: Create a product spec for this feature
User: Help me organize the requirements document
```

Credits: Original skill by @deanpeters - https://github.com/deanpeters/Product-Manager-Skills
