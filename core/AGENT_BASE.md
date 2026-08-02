# Agent Base Patterns

Common behavioral patterns shared across all agents. Agent-specific behaviors are defined in each agent's own file.

## User-facing response contract

Every response or report that can reach a user follows `core/OUTPUT_STYLE.md`, including its action-first opening, per-turn state, minute estimate, visible wins, five-item list cap, matter-of-fact errors, and single concrete next step. Machine-only structured payloads are exempt.

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

The machine-readable contract is `core/AGENT_DELEGATION_CONTRACT.md`. Every caller and
agent must follow it. The short rules below are non-optional.

### 1. Complete, bounded delegation

- A non-fork agent starts from fresh context. The caller supplies `run_id`, objective,
  allowed/forbidden paths, evidence, output schema, and stop conditions.
- Missing task identity, scope, or expected output is `status=blocked`; do not infer a
  broader scope.
- Respect the frontmatter `maxTurns` ceiling and the packet's smaller tool/iteration budget.
- Only the caller may expand scope, persist returned reports, or launch a follow-up agent.

### 2. Least privilege and artifact ownership

- Read-only reviewers return data; they never receive `Write` or `Edit` merely to save a report.
- The caller persists results under
  `.qe/agent-results/runs/{run_id}/{agent-name}.json`. Never use a shared `*-latest.md` file.
- Workflow-owned canonical artifacts such as `risk-proof-{UUID}.md` remain valid, but the
  owning skill writes them after validating the returned result.
- Mutating workers may touch only `allowed_paths`. Shared files belong to the lead unless
  the packet explicitly transfers ownership.

### 3. Independent first pass

- Test, code-review, security, and risk roles run a blind first pass from task-local evidence.
- Do not inject another evaluator's conclusion into the first pass. The orchestrator may
  request a second reconciliation pass after all independent results have returned.
- ContextMemo may cache immutable source facts, hashes, and command output. It must not cache
  a prior verdict as if it were evidence.

### 4. Explicit chaining

- Agents return `handoffs[]` in their result; they do not write trigger files.
- The caller validates every requested handoff against `core/agent-registry.json`, records
  why it is needed, and decides whether to invoke it.
- Parallel calls are allowed only when their path ownership and evidence dependencies are
  disjoint. Otherwise run sequentially.

### 5. Result envelope

Internal agent results use one JSON object with `run_id`, `agent`, `status`, `summary`,
`evidence`, `findings`, `changed_files`, `handoffs`, and `metrics`. User-facing prose is
rendered by the caller after validation. Do not wrap the JSON in explanatory prose.

---

## Effort Parameter Guide

The `effort` parameter controls reasoning depth independently of model selection (tier).

### Effort Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `low` | Minimal reasoning, fast responses | Simple lookups, file copies, format conversions |
| `medium` | Standard reasoning (default) | Most implementation and review tasks |
| `high` | Deep reasoning, thorough analysis | Architecture decisions, complex debugging |
| `xhigh` | Deeper than `high` | Codex's top level; also a valid Claude `--effort` value |
| `max` | Maximum reasoning depth (Claude) | Critical quality judgments, deep research |

Note: Claude accepts both `xhigh` and `max`; Codex has `xhigh` but **no `max`**. The framework auto-maps
`max` ↔ `xhigh` across engines via `effort-compat.mjs` (`max`→`xhigh` for Codex, `xhigh`→`max` for Claude).

### Tier vs Effort (Orthogonal Concepts)

| Concept | Controls | Values |
|---------|----------|--------|
| **Tier** | Which model to use | LOW (haiku), MEDIUM (sonnet), HIGH (opus) |
| **Effort** | How deeply the model thinks | low, medium, high, xhigh, max |

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
