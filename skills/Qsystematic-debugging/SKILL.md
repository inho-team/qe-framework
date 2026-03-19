---
name: Qsystematic-debugging
description: "Finds root causes of bugs through systematic hypothesis-driven investigation BEFORE applying any fixes. Use when encountering bugs, test failures, or unexpected behavior where the cause is unknown. Distinct from Ecode-debugger (which analyzes and fixes errors) — this skill enforces a disciplined 'diagnose first, fix second' methodology."
metadata:
  source: https://skills.sh/obra/superpowers/systematic-debugging
  author: obra
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


# Systematic Debugging

## When to Use
- **Use this skill** when: you need a structured debugging methodology — how to approach root cause analysis, form hypotheses, and systematically narrow down the problem
- **Use Ecode-debugger instead** when: you need to actually find and fix a specific bug in the codebase (read code, trace errors, propose concrete fixes)

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST**

## Phase 1: Root Cause Investigation
1. **Read Error Messages** - Stack traces, line numbers, error codes
2. **Reproduce Consistently** - Exact steps, every time?
3. **Check Recent Changes** - Git diff, new dependencies, config
4. **Gather Evidence** - Log at each component boundary
5. **Trace Data Flow** - Find source of bad value, fix at source

## Phase 2: Pattern Analysis
1. Find working examples in same codebase
2. Read reference implementation COMPLETELY
3. Identify every difference
4. Understand dependencies

## Phase 3: Hypothesis and Testing
1. "I think X because Y" - specific hypothesis
2. SMALLEST possible change, one variable
3. Didn't work? NEW hypothesis, don't stack fixes

## Phase 4: Implementation
1. Create failing test case FIRST
2. ONE change at a time
3. If 3+ fixes failed: STOP, question the architecture

## Red Flags - STOP
- "Quick fix for now"
- "Just try changing X"
- "I don't fully understand but..."
- Proposing solutions before tracing data flow
- "One more fix attempt" (after 2+)

| Excuse | Reality |
|--------|---------|
| "Issue is simple" | Simple issues have root causes too |
| "Emergency, no time" | Systematic is FASTER |
| "One more fix" | 3+ failures = architectural problem |
