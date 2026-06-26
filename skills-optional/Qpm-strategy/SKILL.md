---
name: Qpm-strategy
description: "Applies strategic analysis frameworks: Lean Canvas, SWOT, PESTLE, Porter's Five Forces, Vision/Value Proposition, pricing strategy. Use for 'product strategy', 'lean canvas', 'SWOT', 'Porter', 'pricing', 'business model', 'strategy', 'lean canvas', 'competitive analysis'. Distinct from Qpm-discovery (customer validation) — this analyzes market position and business models."
invocation_trigger: When product discovery, requirements, or roadmap planning is required.
recommendedModel: sonnet
---

## Scope Boundary
**Distinct from:** Qpm-discovery (validation), Qpm-roadmap (execution). This skill performs market/competitive analysis using frameworks like SWOT, PESTLE, and Porter's Five Forces. It does not validate customer problems through interviews or experiments (see /Qpm-discovery) or sequence work into timelines (see /Qpm-roadmap). Strategy analyzes *what market conditions exist*; discovery validates *what customers need*.

## Purpose
Provide structured strategy frameworks for product positioning, competitive analysis, and business model design. Each framework includes a ready-to-fill template and guiding questions to drive strategic thinking.

## Workflow

### Phase 1: Context Gathering
1. Clarify the product/business stage (idea, early, growth, mature)
2. Identify which framework(s) to apply
3. Collect available inputs (market data, customer insights, financials)

### Phase 2: Framework Execution
Apply one or more frameworks below based on the strategic question.

### Phase 3: Synthesis
- Cross-reference findings across frameworks
- Identify strategic themes and priorities
- Produce actionable recommendations

---

## Available Frameworks

| # | Framework | Best For |
|---|-----------|----------|
| 1 | Lean Canvas | Early-stage validation, startup pitches |
| 2 | SWOT Analysis | Competitive positioning, strategic planning |
| 3 | PESTLE Analysis | Market entry, regulatory assessment, long-term planning |
| 4 | Porter's Five Forces | Market entry decisions, competitive strategy |
| 5 | Product Vision & Value Proposition | Product launch, repositioning, team alignment |
| 6 | Business Model & Pricing Strategy | Monetization planning, pricing optimization |

See references/framework-templates.md for all templates and guiding questions.

---

## Anti-Patterns
- Using one framework in isolation → combine 2-3 for depth
- Filling templates with guesses → validate with data and customer input
- SWOT without strategic actions → always derive SO/WO/ST/WT moves
- Vision statement as internal jargon → must be understandable by customers
- Pricing without willingness-to-pay data → test before committing
- Treating frameworks as one-time exercises → revisit quarterly

## Usage Examples
```
User: Do a SWOT analysis for our product
User: Create a lean canvas for this startup idea
User: Analyze our industry using Porter's Five Forces
User: Help me define our product vision and value proposition
User: What pricing model should we use?
User: Analyze our product's competitive strategy
User: Create a lean canvas
User: Help me establish pricing strategy
```

Credits: Frameworks adapted from phuryn/pm-skills (MIT)
