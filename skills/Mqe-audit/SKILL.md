---
name: Mqe-audit
description: "QE Framework full quality audit. Runs all test suites, validates skills/agents/hooks/docs, and generates a structured QA report with PASS/PARTIAL/FAIL grades. Use when evaluating the framework, running a full audit, quality check, framework inspection, or asking for a framework report."
---

# QE Framework Full Audit

## Role
Run a comprehensive quality inspection of the QE Framework and generate a structured report.

## Trigger
- "evaluate", "audit", "inspect", "quality check", "framework report"
- "full inspection", "run tests", "health check"

## Workflow

```
1. Run Test Suites → 2. Parallel Agent Inspections → 3. Aggregate Report
```

## Step 1: Run Test Suites

Execute all 4 test files and capture results:

```bash
node test-framework.js 2>&1
node test-hooks.js 2>&1
node test-routing.js 2>&1
node test-supervision.js 2>&1
```

Record per-suite: score (correct/total), accuracy %, error list.

## Step 2: Parallel Agent Inspections

Launch 6 agents in parallel (background):

| Agent | Type | Task |
|-------|------|------|
| Explore | Skill validation | Check all SKILL.md: frontmatter, line limits (<=250), triggers |
| Explore | Agent validation | Check all E*.md: frontmatter (name/description/tools), Will/Will Not sections |
| Explore | Cross-reference | QE_CONVENTIONS.md vs actual files, AGENT_TIERS.md coverage, intent-routes.json coverage |
| Ecode-quality-supervisor | Hooks & install | hooks.json vs scripts, install.js/uninstall.js quality |
| Ecode-quality-supervisor | Core JS code | test-*.js, install.js, uninstall.js quality review |
| Edocs-supervisor | Documentation | README accuracy, version consistency, translation sync |

## Step 3: Aggregate Report

Compile findings into this format:

```markdown
# QE Framework vX.Y.Z — QA Report

**Date:** YYYY-MM-DD | **Overall Grade: {PASS|PARTIAL|FAIL} ({letter})**

## Area Grades

| # | Area | Grade | Score | Key Issues |
|---|------|-------|-------|------------|
| 1 | Test Suites | {grade} | {correct}/{total} ({pct}%) | {summary} |
| 2 | Skill Files | {grade} | {pass}/{total} | {summary} |
| 3 | Agent Files | {grade} | {pass}/{total} | {summary} |
| 4 | Cross-Reference | {grade} | — | {summary} |
| 5 | Hooks & Install | {grade} | — | {summary} |
| 6 | Core JS Code | {grade} | — | {summary} |
| 7 | Documentation | {grade} | — | {summary} |

## FAIL Items (immediate fix required)
{table of FAIL findings with fix suggestions}

## WARN Items (improvement recommended)
{table of WARN findings grouped by category}

## Statistics Summary
| Metric | Value |
|--------|-------|
| Total Skills | {count} |
| Total Agents | {count} |
| Total Hook Scripts | {count} |
| Total FAIL | {count} |
| Total WARN | {count} |
| Overall Test Accuracy | {pct}% |
```

## Grading Rules

| Grade | Criteria |
|-------|----------|
| **PASS** | No FAIL findings, <=3 WARN |
| **PARTIAL** | No FAIL or <=2 FAIL with clear fix path, any number of WARN |
| **FAIL** | 3+ FAIL findings or critical structural issues |

### Letter Grade
| Range | Letter |
|-------|--------|
| 0 FAIL, 0-3 WARN | A |
| 0 FAIL, 4+ WARN | A- |
| 1 FAIL | B+ |
| 2 FAIL | B |
| 3+ FAIL | C or below |

## Output
Display the full report directly in conversation. Do NOT save to file unless user requests it.
