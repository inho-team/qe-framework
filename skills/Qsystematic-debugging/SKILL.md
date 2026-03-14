---
name: Qsystematic-debugging
description: "버그, 테스트 실패, 예상치 못한 동작 시 수정 전에 사용. 체계적 디버깅으로 근본 원인을 먼저 찾고, 가설 테스트 후 수정."
metadata:
  source: https://skills.sh/obra/superpowers/systematic-debugging
  author: obra
---

# Systematic Debugging

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
