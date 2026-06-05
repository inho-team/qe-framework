# Dynamic Workflows

> **Status**: Research Preview (Opus 4.8, released 2026-05-28)
> **Experimental**: This feature may change significantly before GA.

---

## Overview

Dynamic Workflows enable orchestration of dozens to hundreds of sub-agents from a single JS script. Unlike Agent Teams (which are interactive teammates), Dynamic Workflows are programmatic — you write a script that defines, spawns, and coordinates agents.

Launched with `/workflows` command in Claude Code (Opus 4.8+).

## How It Works

1. Write a JS orchestration script that defines agent tasks
2. Run `/workflows <script.js>` in Claude Code
3. The script spawns sub-agents, each with their own context window
4. Sub-agents execute in parallel, reporting results back to the orchestrator
5. The orchestrator aggregates results and produces final output

## Limits

| Limit | Value |
|-------|-------|
| Max sub-agents per workflow | 1,000 |
| Max concurrent threads | 25 |
| Agent context | Independent per agent |
| Communication | Via orchestrator only (no peer-to-peer) |

## QE Framework Use Cases

### 1. Large-Scale Skill Deduplication

Deploy 20+ agents to each analyze a cluster of similar skills:
- Each agent reads a group of SKILL.md files
- Proposes merge strategies independently
- Orchestrator aggregates and resolves conflicts

### 2. Multi-File Refactoring

Partition a codebase into non-overlapping file groups:
- Each agent handles one group
- Worktree isolation prevents conflicts
- Orchestrator merges all changes after verification

### 3. Batch Test Generation

Generate tests for dozens of modules in parallel:
- Each agent gets one module + its dependencies
- Produces test file + coverage report
- Orchestrator assembles full test suite

### 4. Cross-Project Audit

Audit multiple QE-enabled projects simultaneously:
- Each agent scans one project
- Produces standardized audit report
- Orchestrator creates comparative dashboard

## Comparison with Existing QE Patterns

| Feature | Qatomic-run | Agent Teams | Dynamic Workflows |
|---------|-------------|-------------|-------------------|
| Max parallelism | ~10 | ~5 | 1,000 |
| Orchestration | Lead session | Shared task list | JS script |
| Communication | Result only | Peer-to-peer | Via orchestrator |
| Isolation | Optional worktree | Separate instances | Separate instances |
| Use case | Atomic checklist | Interactive collab | Batch processing |

## Integration Notes

- Dynamic Workflows complement (not replace) Qatomic-run for small parallelism
- For QE tasks with 5-15 items, Qatomic-run is still preferred
- For 50+ items or cross-project work, Dynamic Workflows are more suitable
- The QE hook system (27 events) is active in each sub-agent instance

## Getting Started

```bash
# Requires Opus 4.8+ and experimental flag
export CLAUDE_CODE_EXPERIMENTAL_DYNAMIC_WORKFLOWS=1

# Run a workflow
/workflows my-orchestrator.js
```

> **Note**: As of June 2026, this is a Research Preview feature. API and behavior may change.
