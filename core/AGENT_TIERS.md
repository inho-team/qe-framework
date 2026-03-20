# Agent Tiers — Automatic Model Selection

## Overview
A tiered system that automatically selects the appropriate model based on task complexity.
Optimizes cost while maintaining quality.

## Tier Definitions

| Tier | Model | Use Case | Examples |
|------|-------|----------|---------|
| **LOW** | haiku | Simple lookups, file copy, format conversion | Eprofile-collector, Earchive-executor, Ecommit-executor |
| **MEDIUM** | sonnet | Standard implementation, code writing, review | Etask-executor, Ecode-reviewer, Ecode-test-engineer, Edoc-generator |
| **HIGH** | opus | Complex analysis, architecture design, deep research | Edeep-researcher, Eqa-orchestrator (judgment phase) |

## Auto-Selection Criteria

### LOW Tier (haiku)
- File move / copy / delete
- Simple text transformation
- State file read / write
- Pattern collection (profiling)
- Expected execution time: under 10 seconds

### MEDIUM Tier (sonnet)
- Code writing / modification
- Test writing
- Code review
- Documentation generation
- General debugging
- Expected execution time: 1–5 minutes

### HIGH Tier (opus)
- Architecture design decisions
- Technical comparison analysis (deep research)
- Complex refactoring strategy
- Quality loop final judgment
- Expected execution time: 5+ minutes

## Agent-to-Tier Mapping

| Agent | Default Tier | Escalation |
|-------|-------------|------------|
| Eprofile-collector | LOW | — |
| Earchive-executor | LOW | — |
| Ecommit-executor | LOW | — |
| Etask-executor | MEDIUM | HIGH (complex checklists) |
| Ecode-debugger | MEDIUM | HIGH (unknown root cause) |
| Ecode-reviewer | MEDIUM | — |
| Ecode-test-engineer | MEDIUM | — |
| Ecode-doc-writer | MEDIUM | — |
| Edoc-generator | MEDIUM | — |
| Egrad-writer | MEDIUM | HIGH (Discussion section) |
| Epm-planner | MEDIUM | HIGH (complex PRD) |
| Edeep-researcher | HIGH | — |
| Eqa-orchestrator | MEDIUM | HIGH (after 3 failures) |
| Erefresh-executor | MEDIUM | — |
| Ecompact-executor | MEDIUM | — |
| Ehandoff-executor | MEDIUM | — |

## Escalation Rules
- 2 failures at MEDIUM → auto-escalate to HIGH
- Failure at HIGH → report to user
- Log escalations in `.qe/changelog.md`

## Cost Optimization
- 60% of all tasks handled at LOW / MEDIUM
- HIGH used only for judgment and analysis phases
- Never use HIGH for simple repetitive tasks

## Agent Teams Model Selection

> Agent Teams spawns separate Claude Code instances. Each teammate runs at its own model tier.

| Team Pattern | Lead Model | Teammate Model | Notes |
|-------------|------------|----------------|-------|
| Quality Review (Eqa-orchestrator) | opus | sonnet per teammate | Lead does synthesis + fixes |
| Parallel Implementation (Etask-executor) | sonnet | sonnet per file group | Lead does shared-file edits |
| Research (Edeep-researcher) | opus | sonnet per researcher | Devil's Advocate also sonnet |

### Per-Teammate Escalation
- Escalation rules apply individually: if a specific teammate fails 2x, escalate **that** teammate's model
- Lead model stays fixed (already at the pattern's designated tier)
- Teammate model changes do not affect other teammates

### Cost Awareness
Agent Teams multiplies cost by teammate count. Prefer subagents for tasks where:
- Independent contexts are not needed
- Communication between workers is minimal
- Total items < 5
