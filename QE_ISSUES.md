# QE-Framework Issues Tracker

Generated: 2026-03-15
Version tested: v1.11.1

## Resolved

| # | Issue | Severity | Fix | Commit |
|---|-------|----------|-----|--------|
| 1 | coding-experts 72 SKILL.md name missing Q prefix | High | Batch rename | 9bb86a5 |
| 2 | INTENT_GATE only 19 routes (124 skills) | High | Expanded to 56 + centralized | ae6a2c4 |
| 3 | notification.mjs only 3 agent chains | Medium | Expanded to 16 | ae6a2c4 |
| 4 | Non-standard frontmatter (Qgenerate-spec, Qqa-test-planner) | Low | Standardized to user_invocable | ae6a2c4 |
| 5 | Secret Scanner false positive on 40-char strings | High | Context-aware regex | 6ad88ae |
| 6 | No auto intent classification | High | Added to prompt-check.mjs | 815cc71 |
| 7 | No debugging skill suggestion on tool failures | Medium | Added to post-tool-use.mjs | 815cc71 |

## Open

### B-1: CRITICAL intent warning repeats on every tool call
- **Severity:** Medium
- **Location:** hooks/scripts/pre-tool-use.mjs
- **Cause:** prompt-check.mjs writes intent-route.json, but pre-tool-use.mjs runs first
- **Fix:** Suppress warning for first 3 tool calls, or check if UserPromptSubmit already ran

### B-2: Utopia mode not checked by agents
- **Severity:** Medium
- **Location:** agents/*.md
- **Cause:** Agents don't read .qe/state/utopia-state.json
- **Fix:** Add Utopia check instruction to agent AGENT.md files

### B-3: Agent tier formatting brittle
- **Severity:** Low
- **Location:** hooks/scripts/pre-compact.mjs
- **Cause:** LOW_haiku -> LOW(haiku) string manipulation fragile
- **Fix:** Store display format in intent-routes.json

### B-4: Secret Scanner should warn by default, block only high-confidence
- **Severity:** Medium
- **Location:** hooks/scripts/pre-tool-use.mjs
- **Cause:** Original design blocked all matches
- **Fix:** Already changed to warn mode by linter. Verify current behavior.

### B-5: No auto-compaction on high context pressure
- **Severity:** Medium
- **Location:** hooks/scripts/pre-tool-use.mjs or post-tool-use.mjs
- **Cause:** 200+ warning shown but no auto action
- **Fix:** Auto-trigger Ecompact-executor at 250+ in Utopia mode

### B-6: Profile collector comment/code mismatch
- **Severity:** Low
- **Location:** hooks/scripts/post-tool-use.mjs
- **Cause:** Comment says "every 50" but code uses % 20
- **Fix:** Align comment with code

### B-7: Intent keyword matching too loose
- **Severity:** Medium
- **Location:** hooks/scripts/prompt-check.mjs
- **Cause:** includes() matches substrings (commit -> uncommitted)
- **Fix:** Word boundary or token-based matching

### B-8: Analysis hint only for Glob, not Grep/Read
- **Severity:** Low
- **Location:** hooks/scripts/pre-tool-use.mjs
- **Cause:** Inner condition only checks Glob patterns
- **Fix:** Add broad-search detection for Grep and Read too
