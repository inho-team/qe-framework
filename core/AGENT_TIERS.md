# Agent Tiers — Automatic Model Selection

## Overview
A tiered system that automatically selects the appropriate model based on task complexity.
Optimizes cost while maintaining quality.

## Tier Definitions

| Tier | Model | Use Case | Examples |
|------|-------|----------|---------|
| **LOW** | haiku | Simple lookups, file copy, format conversion | Earchive-executor, Ecommit-executor |
| **MEDIUM** | sonnet | Standard implementation, code writing, review | Etask-executor, Ecode-reviewer, Ecode-test-engineer, Edoc-generator |
| **HIGH** | opus | Complex analysis, architecture design, deep research | Edeep-researcher, Eqa-orchestrator (judgment phase) |

## Auto-Selection Criteria

### LOW Tier (haiku)
- File move / copy / delete
- Simple text transformation
- State file read / write
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

---

## Tier vs Effort

Two independent dimensions control agent behavior:

| Dimension | What it controls | Set by |
|-----------|-----------------|--------|
| **Tier** | Model selection (haiku/sonnet/opus) | Agent definition, auto-escalation |
| **Effort** | Reasoning depth within the model | sivs-config.json, per-invocation |

### Key Distinction

- **Tier** answers: "Which model should run this?"
- **Effort** answers: "How deeply should it think?"

These are orthogonal — changing one does not affect the other:

```
tier=LOW  + effort=high  → Haiku thinks deeply (cost-optimized depth)
tier=HIGH + effort=low   → Opus responds quickly (speed-optimized power)
tier=LOW  + effort=low   → Haiku responds instantly (minimum cost)
tier=HIGH + effort=max   → Opus at full power (maximum quality)
```

### Default Behavior

- Tier defaults are set per agent in `AGENT_BASE.md` and this file
- Effort defaults to `medium` unless overridden in sivs-config.json
- Opus 4.7+ defaults to `effort=high` at the API level

## Agent-to-Tier Mapping

| Agent | Default Tier | Escalation |
|-------|-------------|------------|
| Earchive-executor | LOW | — |
| Ecommit-executor | LOW | — |
| Etask-executor | MEDIUM | HIGH (complex checklists) |
| Ecode-debugger | MEDIUM | HIGH (unknown root cause) |
| Ecode-reviewer | MEDIUM | — |
| Ecode-test-engineer | MEDIUM | — |
| Ecode-doc-writer | MEDIUM | — |
| Edoc-generator | LOW | MEDIUM (batch docs) |
| Egrad-writer | MEDIUM | HIGH (Discussion section) |
| Epm-planner | MEDIUM | HIGH (complex PRD) |
| Edeep-researcher | HIGH | — |
| Eqa-orchestrator | MEDIUM | HIGH (after 3 failures) |
| Erefresh-executor | LOW | — |
| Ecompact-executor | LOW | — |
| Ehandoff-executor | LOW | — |
| Esecurity-officer | LOW | HIGH (vulnerability audit) |
| Esupervision-orchestrator | LOW | HIGH (quality audit) |
| Qplan | HIGH | — |
| Etracer | MEDIUM | HIGH (deep investigation) |
| Econtract-judge | MEDIUM | — |
| Edependency-auditor | LOW | MEDIUM (deep CVE analysis) |
| Eperformance-profiler | MEDIUM | HIGH (complex profiling) |

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
