# AGENT_TEAMS.md — Agent Teams Integration Guide

> Agent Teams are **experimental**. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

## How Agent Teams Work

Agent Teams spawns **separate Claude Code instances** as teammates, each with its own context window. This is fundamentally different from the Agent tool (subagents).

| Aspect | Subagents (Agent tool) | Agent Teams |
|--------|----------------------|-------------|
| **Spawning** | `Agent()` tool call within session | Natural language request; separate Claude instance |
| **Context** | Inherits caller's context + spawn prompt | Independent context window; loads CLAUDE.md fresh |
| **Communication** | Returns result to caller only | Peer-to-peer messaging, broadcast, shared task list |
| **Coordination** | Caller manages all work | Self-coordination via shared task list |
| **File editing** | Sequential within one session | Parallel across instances (must partition files) |
| **Token cost** | Lower (summary returned) | Higher (each teammate is full instance) |
| **Hooks** | Standard PreToolUse/PostToolUse | TeammateIdle, TaskCompleted |

## When to Use Agent Teams vs Subagents

| Criteria | Subagent | Agent Team |
|----------|----------|------------|
| Independent contexts beneficial | No | Yes |
| 3+ parallel workers needed | Optional | Recommended |
| Workers need to share findings | No | Yes |
| Same-file editing | OK (sequential) | Forbidden (partition required) |
| Cost sensitivity | Lower cost | Higher cost |
| Single focused task | Use Subagent | Overkill |

### Decision Rule
1. Is the work parallelizable with 3+ independent streams? → Consider Teams
2. Do workers need to challenge each other (debate, review)? → Use Teams
3. Is it a single focused task with one result? → Use Subagent
4. Are you editing the same files? → Use Subagent (sequential)

## Activation

Add to `.claude/settings.json` or project settings:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### Detection in Hooks
Hook scripts detect team context via input data fields:
```javascript
import { isTeamsEnabled, getTeamContext } from './lib/team-detect.mjs';

// Check env var
if (isTeamsEnabled()) { /* teams feature on */ }

// Check if running as a teammate
const ctx = getTeamContext(hookInputData);
if (ctx.isTeam) {
  console.log(`Teammate: ${ctx.teammateName}, Team: ${ctx.teamName}`);
}
```

## Team Creation

Teams are created via **natural language request** to the lead Claude instance:

```
Create a team with 3 teammates:
- "test-engineer" (sonnet): Write and run tests. You own: tests/, *.test.*.
- "reviewer" (sonnet): Review code quality. Read-only access.
- "implementer" (sonnet): Implement items [1,2,3]. You own: src/auth/.
```

The lead evaluates the request and spawns separate Claude Code instances.

## Communication

| Mechanism | Purpose | Direction |
|-----------|---------|-----------|
| Messages | Direct peer-to-peer | Teammate → Teammate |
| Broadcast | One-to-all announcement | Teammate → All |
| Shared task list | Work coordination, dependencies | System-managed |
| Idle notifications | Lead knows when teammate finished | Automatic |

## File Ownership Rule

Each teammate MUST own distinct files within a wave/phase:
1. Partition work by file/module boundaries before creating team
2. Assign file ownership in the spawn prompt
3. No two teammates edit the same file
4. Shared files (package.json, config) are handled by Lead after teammates finish

## Team Size Guidelines
- 2-4 teammates optimal for most workflows
- More teammates != faster results (coordination overhead increases)
- Start small, scale only when genuinely beneficial

## QE Framework Team Patterns

### Pattern 1: Quality Review (Eqa-orchestrator)
| Role | Model | Owns |
|------|-------|------|
| Lead | opus | Fix-phase edits (sequential) |
| test-engineer | sonnet | Test files only |
| reviewer | sonnet | Read-only (no edits) |

### Pattern 2: Parallel Implementation (Etask-executor)
| Role | Model | Owns |
|------|-------|------|
| Lead | sonnet | Shared files, wave orchestration |
| impl-{group} (1 per file group) | sonnet | Assigned file group |

### Pattern 3: Competing Hypotheses Research (Edeep-researcher)
| Role | Model | Owns |
|------|-------|------|
| Lead | opus | Final synthesis report |
| researcher-{N} | sonnet | Assigned research angle |
| devils-advocate | sonnet | Read-only, challenges findings |

## Hooks

| Hook | When | Exit Codes |
|------|------|------------|
| `TeammateIdle` | Teammate about to go idle | 0=idle, 2=keep working (feedback via stderr) |
| `TaskCompleted` | Task marked complete | 0=accept, 2=reject (feedback via stderr) |

## Limitations

- **No session resumption**: `/resume` does not restore in-process teammates
- **One team per session**: Lead can manage only one team at a time
- **No nested teams**: Teammates cannot spawn their own teams
- **Lead is fixed**: The session that creates the team is always the lead
- **Permissions inherited**: All teammates start with lead's permission mode
- **tmux required for split panes**: In-process mode is the default (works anywhere)
