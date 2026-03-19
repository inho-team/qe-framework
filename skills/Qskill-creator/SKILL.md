---
name: Qskill-creator
description: "Create new skills, modify/improve existing skills, and measure skill performance. Use when creating a skill from scratch or when editing, optimizing, evaluating, or benchmarking one."
metadata:
  source: https://skills.sh/anthropics/skills/skill-creator
  author: anthropic
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


# Skill Creator

## Skill Creation Process
1. Determine purpose and approach
2. Write a draft
3. Run with test prompts
4. Qualitative and quantitative evaluation
5. Rewrite based on feedback
6. Iterate
7. Expand the test set

## SKILL.md Format
```markdown
---
name: skill-name
description: Description including trigger conditions
---
# Skill Title
Content...
```

## Description Guide
- Clearly state when to trigger
- Include specific examples ("when the user requests X")
- Include negative triggers ("do not use when Y")

## Installation Location
- Global: `~/.claude/skills/<name>/SKILL.md`
- Local: `.claude/skills/<name>/SKILL.md`
