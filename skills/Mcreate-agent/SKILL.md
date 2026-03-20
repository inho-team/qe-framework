---
name: Mcreate-agent
description: "Creates new QE Framework agents (E-prefix background/sub-agents). Use when creating an agent from scratch, or when the user says 'create an agent', 'add a new agent', 'build a sub-agent', or 'I need a background agent for X'. Distinct from Mcreate-skill (which creates user-facing skills) — this skill creates background agents that skills delegate work to."
metadata:
  author: qe-framework
  version: "1.0.0"
---


# Agent Creator

Creates new QE Framework agents (E-prefix sub-agents that run in the background).

## Skills vs Agents

| | Skill (Q-prefix) | Agent (E-prefix) |
|---|---|---|
| **Invoked by** | User directly | Skills or other agents |
| **Purpose** | Orchestrate workflow | Execute delegated work |
| **File** | `skills/Qname/SKILL.md` | `agents/Ename.md` (single file) |
| **Registration** | Auto-scanned from `skills/` dir | Listed in `plugin.json` agents array |
| **Tools** | Inherited | Declared in frontmatter |

**Rule**: If the user invokes it directly → Skill. If a skill delegates to it → Agent.

## Agent Creation Process

### Phase 1: Define Purpose

1. **What work does this agent do?** — One sentence, specific.
2. **Which skill(s) will delegate to it?** — Agents don't exist alone; a skill must call them.
3. **What tools does it need?** — Only grant tools it actually uses (least-privilege).
4. **What model should it use?** — haiku (simple), sonnet (standard), opus (complex).
5. **Does it need memory?** — `user` (user preferences), `project` (project patterns), or none.

### Phase 2: Overlap & Merge Check (Required)

Before writing a new agent, check existing agents for overlap. **This step is mandatory — skip it and you risk creating redundant agents.**

1. **Read `QE_CONVENTIONS.md`** — scan the Agents table for similar purpose descriptions
2. **Search agent files** — `grep -rl "<keyword>" agents/` for the new agent's core responsibility
3. **For each candidate overlap, answer:**
   - Does the existing agent already cover 70%+ of the new agent's responsibility? → **Merge** into the existing agent
   - Does the existing agent cover a related but distinct concern? → **Keep separate**, but add "Distinct from X" in the description
   - Does the existing agent partially overlap? → **Extract shared logic** into a common section or merge the smaller one into the larger

4. **Report the decision** before proceeding:
   ```
   Overlap check:
   - Ecode-reviewer: 30% overlap (both read code) — KEEP SEPARATE (reviewer audits, new agent does X)
   - Ecode-debugger: 0% overlap — NO CONFLICT
   Decision: CREATE NEW — no existing agent covers this responsibility
   ```

   Or:
   ```
   Overlap check:
   - Ecode-quality-supervisor: 80% overlap — MERGE into existing agent
   Decision: MERGE — extend Ecode-quality-supervisor with new capability
   ```

5. **If merging:** update the existing agent's AGENT.md (add new sections to Will, methodology, output format) instead of creating a new file.

### Phase 3: Write AGENT.md

#### Frontmatter (Required)

```yaml
---
name: Ename
description: "What it does. When to use it. Use for 'trigger phrase 1', 'trigger phrase 2'."
tools: Read, Grep, Glob, Bash, Write, Edit  # only what's needed
memory: project                              # user | project | omit if none
recommendedModel: sonnet                     # haiku | sonnet | opus
color: cyan                                  # optional: terminal color
maxTurns: 50                                 # optional: limit iterations
permissionMode: acceptEdits                  # optional: auto-accept edits
---
```

**Frontmatter fields:**

| Field | Required | Values |
|-------|:--------:|--------|
| `name` | Yes | `E` + descriptive name (kebab-case) |
| `description` | Yes | Action + trigger conditions. English only. |
| `tools` | Yes | Comma-separated list. Only grant what's needed. |
| `memory` | No | `user` or `project` |
| `recommendedModel` | No | `haiku`, `sonnet`, `opus` (default: inherits from caller) |
| `color` | No | Terminal output color |
| `maxTurns` | No | Max iteration limit |
| `permissionMode` | No | `acceptEdits` to auto-accept file changes |

#### Body Structure

```markdown
> Base patterns: see core/AGENT_BASE.md

## When to Use
- **Use this agent** when: [specific scenarios]
- **Use X instead** when: [distinguish from similar agents]

## Will
- [What this agent does — 3-7 bullet points]

## Will Not
- [What this agent refuses — delegate to specific agents]
- Do not [action] → delegate to **Eagent-name**

## [Core Methodology / Workflow]
[Step-by-step execution process]

## Output Format
[Structured format the agent returns to its caller]

## Rules
[Hard constraints]
```

#### Key Sections Explained

**Will / Will Not** — Define clear boundaries. Every "Will Not" should name the agent to delegate to:
```markdown
## Will Not
- Do not write tests → delegate to **Ecode-test-engineer**
- Do not implement fixes → delegate to **Etask-executor**
```

**Output Format** — Agents return results to their caller (a skill or another agent). Define a structured format so the caller can parse it:
```markdown
## Output Format
**Status:** PASS | PARTIAL | FAIL
**Findings:** N items
**Details:**
- [item 1]
- [item 2]
```

**Methodology** — The agent's core algorithm. Be specific — agents execute autonomously without user interaction.

### Phase 4: Register

After creating the agent file, register it so Claude can discover it.

**For general users** — place the agent file where Claude Code scans:
- Global: `~/.claude/agents/Ename.md`
- Local (project): `.claude/agents/Ename.md`

**For QE Framework plugin development** — additionally update these two files:

1. **`.claude-plugin/plugin.json`** — add the agent path to the `agents` array:
   ```json
   { "agents": [ ...existing..., "./agents/Enew-agent.md" ] }
   ```
2. **`QE_CONVENTIONS.md`** — add to the Agents table:
   ```markdown
   | `Enew-agent` | What it does |
   ```

### Phase 5: Verify

1. Check the calling skill references the new agent correctly
2. Verify tool list is minimal (no unnecessary tools)
3. Verify description is English-only with clear triggers
4. Confirm registration files are updated (plugin.json + QE_CONVENTIONS.md for QE Framework)

## Agent Design Patterns

### Pattern 1: Executor
Receives a task, executes it, returns results. Called by a workflow skill.
```
Caller (Qrun-task) → Etask-executor → returns Implementation Result
```
Tools: Read, Write, Edit, Grep, Glob, Bash

### Pattern 2: Supervisor
Audits completed work, returns PASS/PARTIAL/FAIL grade.
```
Caller (Esupervision-orchestrator) → Ecode-quality-supervisor → returns Grade
```
Tools: Read, Grep, Glob (read-only — supervisors don't modify)

### Pattern 3: Orchestrator
Routes work to multiple sub-agents, aggregates results.
```
Caller (Qrun-task) → Esupervision-orchestrator → [sub-agents] → aggregated Grade
```
Tools: Read, Grep, Glob, Bash, Write

### Pattern 4: Background Collector
Gathers/processes data silently. No direct output to user.
```
Caller (Qprofile) → Eprofile-collector → writes to .qe/profile/
```
Tools: Read, Write, Edit, Grep, Glob, Bash

## Model Selection Guide

| Complexity | Model | Examples |
|------------|-------|---------|
| Simple extraction, formatting | haiku | Earchive-executor, Erefresh-executor |
| Standard analysis, code review | sonnet | Ecode-debugger, Etask-executor |
| Complex orchestration, judgment | opus | Esupervision-orchestrator (escalation only) |

## Rules

- **English only** in all agent files.
- **Least-privilege tools.** Only grant tools the agent actually uses.
- **Always register** in both `plugin.json` and `QE_CONVENTIONS.md`.
- **Clear Will/Will Not.** Every boundary must name who to delegate to.
- **Structured output.** Callers must be able to parse agent results programmatically.
- **No user interaction.** Agents run in background — they return results to their caller, not to the user.
