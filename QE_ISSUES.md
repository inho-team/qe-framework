# QE-Framework Issues Tracker

Generated: 2026-03-15
Tested with: midolog blog project (Next.js 15 + Nest.js monorepo)

## All Resolved (15/15)

| # | Issue | Severity | Fix | Commit |
|---|-------|----------|-----|--------|
| 1 | coding-experts 72 SKILL.md name missing Q prefix | High | Batch rename | 9bb86a5 |
| 2 | INTENT_GATE only 19 routes (124 skills) | High | Expanded to 56 + centralized intent-routes.json | ae6a2c4 |
| 3 | notification.mjs only 3 agent chains | Medium | Expanded to 16 agents | ae6a2c4 |
| 4 | Non-standard frontmatter (Qgenerate-spec, Qqa-test-planner) | Low | Standardized to user_invocable | ae6a2c4 |
| 5 | Secret Scanner false positive on 40-char strings | High | Context-aware regex | 6ad88ae |
| 6 | No auto intent classification | High | Added to prompt-check.mjs | 815cc71 |
| 7 | No debugging skill suggestion on tool failures | Medium | Added 3+/5+ escalation | 815cc71 |
| 8 | CRITICAL intent warning repeats every tool call | Medium | Grace period (3 calls) + throttle (every 10th) | 005df72 |
| 9 | Utopia mode not checked by agents | Medium | Added to PRINCIPLES.md Safety section | 005df72 |
| 10 | Agent tier formatting brittle in pre-compact | Low | Centralized config.mjs | 58b5a7b |
| 11 | Secret Scanner block mode too aggressive | Medium | Changed to warn mode | 34a25c1 |
| 12 | No auto-compaction on high context pressure | Medium | 250+ trigger with Utopia awareness | 005df72 |
| 13 | Profile collector comment/code mismatch | Low | Renamed to "recent" (90s window) | 34a25c1 |
| 14 | Intent keyword matching too loose (substring) | Medium | Exact word 2x weight scoring | 422ffa5 |
| 15 | Analysis hint only for Glob, not Grep/Read | Low | Extended to broad Grep and Read patterns | 005df72 |

## Open Issues

None.
