# AGENT_TEAMS.md — Agent Teams Integration Guide

> Agent Teams are **experimental**. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

## How Agent Teams Work

Agent Teams spawns **separate Claude Code instances** as teammates, each with its own context window. This is fundamentally different from the Agent tool (subagents).

| Aspect | Subagents (Agent tool) | Agent Teams |
|--------|----------------------|-------------|
| **Spawning** | `Agent()` tool call within session | Natural language request; separate Claude instance |
| **Context** | Inherits caller's context + spawn prompt | Independent context window; reloads the active project instruction artifact fresh |
| **Communication** | Returns result to caller only | Peer-to-peer messaging, broadcast, shared task list |
| **Coordination** | Caller manages all work | Self-coordination via shared task list |
| **File editing** | Sequential within one session | Parallel across instances (must partition files) |
| **Token cost** | Lower (summary returned) | Higher (each teammate is full instance) |
| **Hooks** | Standard PreToolUse/PostToolUse | TeammateIdle, TaskCompleted |

## Three parallelism axes: Subagents vs Agent Teams vs Dynamic Workflows

There are **three** distinct mechanisms, not two. Dynamic Workflows (`/workflows`) is a separate
native Claude Code feature — see `docs/CLAUDE_CODE_FEATURES.md`.

| Criteria | Subagent (Agent tool) | Agent Team | Dynamic Workflow (`/workflows`) |
|----------|----------|------------|-------------------------------|
| How it starts | `Agent()` call in-session | Natural-language request; separate Claude instances | JS orchestration script Claude writes; runs in background |
| Independent contexts | No (inherits caller) | Yes (each teammate full instance) | Yes (each agent isolated) |
| 3+ parallel workers | Optional | Recommended | Built for scale (up to 1,000 total agents; `min(16, max(2, cpu cores - 2))` concurrent) |
| Workers share findings | No | Yes (peer messaging) | Via the script's data flow, not peer messaging |
| Same-file editing | OK (sequential) | Forbidden (partition required) | Isolated per agent (worktree) |
| Cost | Lower | Higher | Highest at scale |
| Best for | Single focused task | 3–5 collaborating workers | Large fan-out (10+ items/files), migrations, audits |
| Trigger | `Agent()` tool | "Create a team …" | "Create a workflow …" or the `ultracode` prompt keyword |

Single `parallel()`/`pipeline()` call in a workflow takes at most **4096 items**. `16` concurrent is a
ceiling, not a fixed value — a 12-core machine runs ~10 at a time.

### Decision Rule
1. Is it a single focused task with one result? → Use **Subagent**
2. Are you editing the same files sequentially? → Use **Subagent**
3. Is the work 3–5 streams that must challenge each other (debate, review)? → Use **Agent Team**
4. Is it a large fan-out (≥10 independent items/files, migration, broad audit)? → Use a **Dynamic Workflow**

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

## Multi-Agent Collaboration Standard

### 0. Subagent Handle Lifecycle
Any workflow that spawns subagents through the active client adapter owns the
handle lifecycle until the final report is rendered.

1. Record every spawned handle with the worker role, task item, start time, and
   expected exit condition.
2. Use `wait_agent` or the active client equivalent to collect each completed,
   failed, or timed-out result before synthesis.
3. After a result is collected, call `close_agent` or the active client
   equivalent for every completed handle before writing the final report.
4. If close cleanup fails, do not mark the whole task failed solely because of
   cleanup. Record a warning with the handle id, role, and last known status.
5. The final report must include lifecycle status: `open handles: 0` or a
   `stale warning` entry that explains which handle is still open and why.

`Waiting for ...` means the lead is still waiting for a live handle or timeout
window. It is normal while the worker is active. It becomes stale when the
worker's exit condition has passed, the process is known dead, or no progress is
observed past the workflow timeout. Stale waits are reported as warnings unless
their missing result blocks task correctness.

### 1. Lead/Team Relationship
In any multi-agent execution (Subagents or Agent Teams), roles are strictly defined:
- **Lead Agent**: Responsible for high-level strategy, dependency analysis, and final synthesis. Owns "Shared Files" (e.g., `package.json`).
- **Team Agent**: Responsible for executing a specific scoped requirement within a partitioned file set. Operates autonomously within the assigned boundary.

### 2. Handoff Packet Standard (UUID + Memo + Requirements)
When delegating a task, the Lead MUST provide a **Handoff Packet** to ensure the Team Agent has sufficient context without redundant I/O:

```markdown
---
uuid: {UUID}
memo: {ContextMemo Object}
parent_task: {Parent UUID}
expected_outcome: {Detailed description of success}
known_constraints: {Specific limitations or anti-patterns to avoid}
---
## Requirements
- {Specific goal 1}
- {Specific goal 2}

## Assigned Files (Ownership)
- {Path 1}
- {Path 2} (Read-only/Edit)
```

- **UUID**: Unique transaction ID for tracking and result aggregation.
- **Expected Outcome**: Defines exactly what the Lead expects to see upon completion (e.g., "A passing test suite for the auth module with 80% coverage").
- **Known Constraints**: List any project-specific constraints or anti-patterns the Team Agent must respect (e.g., "Do not use external libraries for encryption").
- **Memo**: Pre-collected context (Phase 3 Protocol) to prevent re-reading the same specs or config.
- **Requirements**: Clear, concise implementation or analysis goals.

### 3. Standardized Return Format
All Team Agents must return results in a consistent format for the Lead to synthesize:

| Field | Type | Purpose |
|-------|------|---------|
| `status` | Enum | `SUCCESS`, `FAILURE`, `PARTIAL`, `ESCALATE` |
| `findings` | Array | Key technical discoveries or blockers |
| `changed_files`| Array | List of modified files with brief summaries |
| `usage` | Object | Token usage stats for the sub-session |

### 4. Communication Patterns
... (omitted) ...
| Mechanism | Purpose | Direction |

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

- **No process resurrection**: `/resume` cannot restore in-process teammate contexts. QE's durable team runtime can preserve completed tasks, reclaim expired claims, and redeliver unacknowledged mailbox entries, but the host must start replacement workers.
- **One team per session**: Lead can manage only one team at a time
- **No nested teams**: Teammates cannot spawn their own teams
- **Lead is fixed**: The session that creates the team is always the lead
- **Permissions inherited**: All teammates start with lead's permission mode
- **tmux required for split panes**: In-process mode is the default (works anywhere)

## Durable Team Runtime

QE can persist an optional project-local task and mailbox runtime in `qe.db`.
The runtime is separate from the host's live agent handles: it preserves work
intent and delivery state across a crash, but it does not recreate an in-process
teammate.

- Task claims execute under a SQLite `BEGIN IMMEDIATE` transaction. A task is
  claimable only after every dependency is complete, and one active owner/token
  wins. Repeating the same owner's claim is idempotent.
- Mailbox messages use a caller-stable message id. Unacknowledged messages are
  returned on every receive and increment `deliveryCount`, providing
  at-least-once delivery without pretending it is exactly once.
- Session bindings store `teamId` and `memberId`. Resume reconciliation labels
  each member `live`, `dead`, or `unknown`; dead claims and expired unknown
  claims return to pending, while completed tasks and unacknowledged messages
  remain durable.
- Reconciliation never force-completes work and never guesses that an unknown,
  unexpired member is dead. No remote queue or multi-host consensus is provided.

## Durable coordination state

`hooks/scripts/lib/team-runtime.mjs` provides an optional single-host SQLite coordination layer for task and mailbox continuity. Task claims use `BEGIN IMMEDIATE`, honor completed dependencies, and require an opaque claim token for completion. Mailbox delivery is at-least-once: an unacknowledged lease is requeued after expiry, while an acknowledged message is never delivered again.

On resume, reconciliation classifies recorded members as `live`, `dead`, or `unknown`. It preserves completed tasks, reclaims expired reservations or work owned by a confirmed-dead member, and leaves a non-expired unknown owner untouched. This is local durability, not a remote broker or multi-host consensus protocol.

---

## Agent Definition Fields (--agents flag)

The `--agents` flag accepts a JSON array of agent definitions. Each agent supports these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique agent identifier |
| `description` | string | No | Short description (3-5 words) |
| `prompt` | string | No | System prompt for the agent |
| `tools` | string[] | No | Allowed tools (e.g., ["Read", "Write", "Bash"]) |
| `model` | string | No | Model override: "haiku", "sonnet", "opus" |
| `permissionMode` | string | No | Permission mode for the agent |
| `mcpServers` | object[] | No | MCP server configurations per agent |
| `hooks` | object | No | Agent-specific hook overrides |
| `maxTurns` | integer | No | Maximum conversation turns |
| `skills` | string[] | No | Available skills for the agent |
| `initialPrompt` | string | No | First message sent to the agent on start |
| `memory` | string | No | Memory/context configuration |
| `effort` | string | No | Reasoning effort: "low", "medium", "high", "xhigh", "max" |
| `background` | boolean | No | Run agent in background (default: false) |
| `isolation` | string | No | "worktree" for git worktree isolation |
| `color` | string | No | Terminal color identifier for the agent |

## Worktree Isolation Pattern

When `isolation: "worktree"` is set, the agent runs in a temporary git worktree:
- Separate working directory — no file conflicts with main checkout
- Changes are isolated until explicitly merged
- Worktree is auto-cleaned if no changes are made
- Parent agent's prompt cache is reused for cost efficiency

**Best for**: experimental changes, parallel refactoring, risky operations.

## Writer/Reviewer Pattern

Split implementation and review into separate agents to eliminate self-bias:

```json
[
  { "name": "writer", "model": "haiku", "tools": ["Read", "Write", "Edit"], "prompt": "Implement the feature..." },
  { "name": "reviewer", "model": "sonnet", "tools": ["Read", "Grep", "Bash"], "prompt": "Review writer's changes..." }
]
```

**Key**: The reviewer has no Write/Edit tools — it can only report findings.

## Exit Condition Best Practices

Always specify clear exit conditions for teammates:
- "Complete after processing all 10 files"
- "Stop after 3 test failures"
- "Return findings after examining 20 files"
- Avoid open-ended tasks without termination criteria
- Set `maxTurns` as a safety ceiling
