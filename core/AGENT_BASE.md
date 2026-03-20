# Agent Base Patterns

Common behavioral patterns shared across all agents. Agent-specific behaviors are defined in each agent's own file.

## Will
- Stay within the defined role scope — delegate out-of-scope work to the appropriate specialist agent
- Follow existing code style, naming conventions, and project patterns consistently
- Report progress briefly upon completing each step
- Report errors immediately with context and a proposed response plan
- Follow constraints and decisions specified in CLAUDE.md

## Will Not
- Expand scope beyond the assigned task or role boundary
- Make arbitrary decisions on matters requiring user judgment — report and wait for instructions
- Modify CLAUDE.md directly (propose changes through the appropriate skill/workflow)
- Introduce security vulnerabilities (OWASP Top 10)
- Include sensitive information (credentials, API keys, personal data) in outputs

## Agent Collaboration Protocol

### 1. Shared Analysis Pool (Required)
Before starting work, read `.qe/analysis/` if it exists:
- `project-structure.md` — directory tree, file count
- `tech-stack.md` — dependencies, versions
- `entry-points.md` — API endpoints, routes
- `architecture.md` — layer structure, module relationships

This avoids redundant Glob/Grep. If `.qe/analysis/` is missing or stale (>1 hour), proceed without it.

### 2. Agent Result Bus
After completing work, write a result summary to `.qe/agent-results/{agent-name}-latest.md`:

```markdown
---
agent: {agent-name}
timestamp: {ISO 8601}
task_uuid: {UUID if applicable}
---
## Result
{1-3 line summary}

## Key Findings
- {finding 1}
- {finding 2}

## Changed Files
- {file list}
```

**Rules:**
- Only keep the latest result per agent (overwrite previous)
- Max 30 lines per result file
- Omit sections with no content

### 3. Pre-built Context Injection
When spawning another agent, **check `.qe/agent-results/` for relevant prior results** and include them in the prompt. Relevance map:

| Spawning Agent | Include Results From |
|----------------|---------------------|
| Ecode-test-engineer | Ecode-reviewer (review findings inform test targets) |
| Ecode-reviewer | Ecode-test-engineer (test coverage gaps inform review focus) |
| Ecode-debugger | Ecode-test-engineer (test failures), Ecode-reviewer (code smells) |
| Etask-executor | Erefresh-executor (project state), Eprofile-collector (user patterns) |
| Esecurity-officer | Ecode-reviewer (architecture findings) |
| Ecode-quality-supervisor | Ecode-reviewer + Ecode-test-engineer (both) |

Format: append `## Prior Agent Context\n{result content}` to the delegation prompt.

### 4. Proactive Agent Chaining
When an agent detects a condition that another agent should handle, it writes a trigger file to `.qe/agent-triggers/{target-agent}.trigger.md`:

```markdown
---
from: {source-agent}
trigger: {reason}
timestamp: {ISO 8601}
---
{context for the target agent}
```

Trigger conditions:

| Source Agent | Condition | Triggers |
|-------------|-----------|----------|
| Erefresh-executor | Architecture change detected | Ecode-quality-supervisor |
| Erefresh-executor | New dependency added | Esecurity-officer |
| Ecode-reviewer | Security concern found | Esecurity-officer |
| Ecode-test-engineer | Coverage below 50% | Ecode-quality-supervisor |
| Eprofile-collector | Repeated error pattern | Ecode-debugger |

The orchestrating skill (Qrun-task, Qutopia) checks `.qe/agent-triggers/` after each agent completes and spawns triggered agents automatically.
