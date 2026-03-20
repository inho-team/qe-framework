---
name: Qcontent-research-writer
description: "Research-driven content writing assistant. Use when writing articles, reports, or documentation that requires research, citations, and iterative refinement. Conducts research, adds citations, improves hooks, provides section-by-section feedback while preserving the writer's voice."
metadata:
  source: https://github.com/ComposioHQ/awesome-claude-skills
  author: ComposioHQ
  version: "1.0.0"
  domain: writing
  triggers: write article, write report, research and write, content writing, draft article, blog post, newsletter, write with citations, improve writing
  role: specialist
  scope: implementation
  output-format: document
  related-skills: Qwriting-clearly, Qhumanizer, Qfact-checker
keywords: content writing, research, citations, articles, reports, editing, hooks, drafting
---


# Content Research Writer — Research-Driven Content Writing

A writing partner that conducts research, adds citations, provides section-by-section feedback, while preserving the writer's unique voice.

## Workflow

```
1. Understand requirements → 2. Collaborate on outline → 3. Research → 4. Draft → 5. Section feedback → 6. Final review
```

## Step 1: Understand Requirements

When a content writing request arrives, confirm:

| Item | Question |
|------|---------|
| Topic | What is the topic and key argument? |
| Audience | Who is the target audience? |
| Length/Format | What length and format is desired? |
| Purpose | Educational / persuasive / explanatory / reporting? |
| Existing material | Is there research or sources to include? |
| Style | Formal / conversational / technical? |

## Step 2: Collaborate on Outline

```markdown
# Outline: [Title]

## Introduction
- [Opening — story/statistic/question]
- [Why the reader should care]
- [What this piece covers]

## Body

### Section 1: [Title]
- Key point A
- Key point B
- Examples/evidence
- [Research needed: specific topic]

### Section 2: [Title]
- Key point C
- Data/citation needed

### Section 3: [Title]
- Key point D
- Counter-arguments and resolution

## Conclusion
- Key summary
- Call to action
- Closing

## Research To-Do
- [ ] Find data on [topic]
- [ ] Find examples of [concept]
- [ ] Cite sources for [claim]
```

## Step 3: Research

Use the WebSearch tool to find and structure relevant information.

### Research Results Format

```markdown
## Research: [Topic]

### Key Findings

1. **[Finding 1]**: [Explanation] [1]
2. **[Finding 2]**: [Explanation] [2]
3. **[Finding 3]**: [Explanation] [3]

### Expert Quotes
- "[Quote]" — [Name], [Affiliation] [4]

### Case Studies
1. **[Case 1]**: [Explanation] — Source: [citation]
2. **[Case 2]**: [Explanation] — Source: [citation]

### Sources
[1] [Author]. ([Year]). "[Title]". [Publisher].
[2] ...
```

## Step 4: Strengthen the Hook

When the writer shares a draft introduction, analyze it and suggest alternatives.

### Introduction Analysis Format

```markdown
## Introduction Analysis

**Strengths of current introduction:** [positive elements]
**Areas to strengthen:** [improvement areas]

### Alternative 1: Data-driven
> [example]
*Why it works: [explanation]*

### Alternative 2: Question-based
> [example]
*Why it works: [explanation]*

### Alternative 3: Narrative
> [example]
*Why it works: [explanation]*

### Checkpoint
- Does it spark curiosity?
- Does it promise value?
- Is it specific enough?
- Is it right for the audience?
```

## Step 5: Section-by-Section Feedback

Provide a review after each section is written.

```markdown
## Feedback: [Section Name]

### Strengths
- [Strength 1]
- [Strength 2]

### Improvement Suggestions

**Clarity**
- [Problem] → [Suggestion]

**Flow**
- [Transition issue] → [Improvement]

**Evidence**
- [Claim needing evidence] → [Suggest adding source]

**Style**
- [Tone inconsistency] → [Adjustment]

### Specific Revision Suggestions

Original:
> [original text]

Revised:
> [improved version]

Reason: [explanation]
```

## Step 6: Final Review

```markdown
## Final Review

### Overall Assessment
**Strengths:** [list main strengths]
**Impact:** [assess overall effectiveness]

### Structure and Flow
- [Organization feedback]
- [Transition quality]
- [Pacing]

### Content Quality
- [Argument strength]
- [Evidence sufficiency]
- [Example effectiveness]

### Technical Quality
- Grammar/expression: [assessment]
- Consistency: [assessment]
- Citations: [completeness check]

### Pre-publication Checklist
- [ ] All claims have sources
- [ ] Citation format is consistent
- [ ] Examples are clear
- [ ] Transitions are natural
- [ ] Call to action included
- [ ] Proofreading complete
```

## Citation Management

Choose format based on writer preference:

**Inline**: `According to research, productivity increased 40% (McKinsey, 2024).`

**Numbered**: `According to research, productivity increased 40% [1].`

**Footnote**: `According to research, productivity increased 40%^1`

Always maintain a source list:
```markdown
## References
1. [Author]. ([Year]). "[Title]". [Publisher].
2. ...
```

## Style Preservation Principles

1. **Learn**: Read existing writing samples to understand style
2. **Suggest, don't replace**: Offer options without imposing
3. **Match tone**: Align to formal/conversational/technical tone
4. **Respect choice**: Support writer's version if they prefer it
5. **Enhance, don't overwrite**: Make the writing better, not different

## Execution Rules

### MUST DO
- Use WebSearch tool for research
- Use only verifiable sources for citations
- Preserve the writer's voice
- Include specific revision suggestions in section feedback

### MUST NOT DO
- Do not fabricate statistics or data without sources
- Do not write in your own style while ignoring the writer's tone
- Do not rewrite everything — suggest improvements only
- Do not write "according to" without actual research
