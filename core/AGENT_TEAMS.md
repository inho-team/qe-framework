# AGENT_TEAMS.md — Agent Teams Integration Guide

> Agent Teams are **experimental**. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

## When to Use Agent Teams vs Subagents

| Criteria | Subagent | Agent Team |
|----------|----------|------------|
| Inter-agent communication needed | No | Yes |
| Independent contexts beneficial | No | Yes |
| 3+ parallel workers | Optional | Recommended |
| Same-file editing | OK (sequential) | Forbidden |
| Task type | Any | Prefer type: code |
| Cost sensitivity | Lower | Higher |

## Decision Rule
1. Is the work parallelizable with 3+ independent streams? --> Consider Teams
2. Do workers need to share findings or challenge each other? --> Use Teams
3. Is it a single focused task with one result? --> Use Subagent
4. Are you editing the same files? --> Use Subagent (sequential)

## Activation
Add to `.claude/settings.json` or project settings:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## Team Size Guidelines
- 3-5 teammates optimal for most workflows
- 5-6 tasks per teammate keeps everyone productive
- Start small, scale only when genuinely beneficial
- More teammates != faster results (coordination overhead)

## File Ownership Rule
Each teammate MUST own distinct files. Before creating a team:
1. Partition the work by file/module boundaries
2. Assign file ownership in the spawn prompt
3. No two teammates edit the same file

## QE Framework Team Patterns

### Pattern 1: Quality Review Team (Eqa-orchestrator)
- Teammate A: Test Engineer -- write and run tests
- Teammate B: Code Reviewer -- review quality/security/performance
- Lead: Synthesize findings, execute fixes sequentially
- Communication: Reviewers share findings via Mailbox

### Pattern 2: Parallel Implementation Team (Etask-executor)
- Teammates: One per independent checklist group
- Lead: Monitor progress, reassign if stuck
- Communication: Minimal -- independent work with shared task list

### Pattern 3: Research Team (Edeep-researcher)
- Teammates: 3-5 researchers, each assigned different sources/perspectives
- One teammate as Devil's Advocate -- challenges others' findings
- Lead: Synthesize into final research report
- Communication: Active debate via Mailbox

## Hooks
- `TeammateIdle`: Enforce quality checks when a teammate finishes
- `TaskCompleted`: Validate deliverables before marking done
