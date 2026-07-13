# Agent Base Patterns

Common behavioral patterns shared across all agents. Agent-specific behaviors are defined in each agent's own file.

## Will
- Stay within the defined role scope — delegate out-of-scope work to the appropriate specialist agent
- **Skill-First**: Prioritize specialized skills over manual labor. Before performing any complex task (implementation, refactoring, documentation), search `skills/CATALOG.md` for a matching skill and use it if applicable.
- Follow existing code style, naming conventions, and project patterns consistently
- Report progress briefly upon completing each step
- Report errors immediately with context and a proposed response plan
- Follow constraints and decisions specified in the active project instruction file (`CLAUDE.md`, `AGENTS.md`, or equivalent QE-managed instructions)

## Will Not
- Expand scope beyond the assigned task or role boundary
- Make arbitrary decisions on matters requiring user judgment — report and wait for instructions
- Modify the project instruction file directly without going through the appropriate skill/workflow
- Introduce security vulnerabilities (OWASP Top 10)
- Include sensitive information (credentials, API keys, personal data) in outputs

## Agent Collaboration Protocol

### 1. Context Memoization Protocol (Minimal I/O Rule)
To minimize redundant file reads and save token budget, agents must use the **ContextMemo** pattern:

- **Definition**: A `ContextMemo` is a shared in-memory or state-based object containing the results of expensive operations (e.g., `Read`, `Grep`, `Glob`, `Analysis`).
- **Standard Procedure**:
  1. Before performing any file I/O, check if the required information exists in the `memo` field of the input or the `unified-state.json`.
  2. If a hit occurs, use the memoized data immediately.
  3. If a miss occurs, perform the I/O and **update the memo** for subsequent steps or agents.
- **Payload Constraint**: Keep memoized objects under 2KB. Store only the essential "semantic signal" (e.g., a function signature instead of the whole file).

### 2. Shared Analysis Pool (Required)
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
| Etask-executor | Erefresh-executor (project state) |
| Esecurity-officer | Ecode-reviewer (architecture findings) |

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
| Erefresh-executor | Architecture change detected | Esupervision-orchestrator |
| Erefresh-executor | New dependency added | Esecurity-officer |
| Ecode-reviewer | Security concern found | Esecurity-officer |
| Ecode-test-engineer | Coverage below 50% | Esupervision-orchestrator |

The orchestrating skill (Qexecute, Qexecute -utopia) checks `.qe/agent-triggers/` after each agent completes and spawns triggered agents automatically.

---

## Effort Parameter Guide

The `effort` parameter controls reasoning depth independently of model selection (tier).

### Effort Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `low` | Minimal reasoning, fast responses | Simple lookups, file copies, format conversions |
| `medium` | Standard reasoning (default) | Most implementation and review tasks |
| `high` | Deep reasoning, thorough analysis | Architecture decisions, complex debugging |
| `max` | Maximum reasoning depth (Claude only) | Critical quality judgments, deep research |

Note: Codex uses `xhigh` instead of `max`. The framework auto-maps between them via `effort-compat.mjs`.

### Tier vs Effort (Orthogonal Concepts)

| Concept | Controls | Values |
|---------|----------|--------|
| **Tier** | Which model to use | LOW (haiku), MEDIUM (sonnet), HIGH (opus) |
| **Effort** | How deeply the model thinks | low, medium, high, max |

These are independent — any combination is valid:

| Combination | Meaning | Example |
|-------------|---------|---------|
| `tier=LOW + effort=high` | Cheap model, deep thinking | Cost-optimized analysis |
| `tier=HIGH + effort=low` | Powerful model, quick response | Fast architectural lookup |
| `tier=MEDIUM + effort=medium` | Balanced (default) | Standard implementation |

### When to Override Effort

- **Leave default** for most tasks — the framework auto-selects based on task type
- **Set `high`/`max`** for supervision judgments, architecture decisions, security reviews
- **Set `low`** for bulk operations, simple file transformations, status checks
- Configure per-stage in `.qe/sivs-config.json`: `{ "verify": { "effort": "high" } }`
