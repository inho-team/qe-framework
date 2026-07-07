# Claude Code Feature Reference

> Verified against Claude Code v2.1.167 on 2026-06-06
> This document only includes features confirmed via `--help`, official docs, or direct execution.

---

## Session Slash Commands

### /goal — Autonomous Completion Condition
- **Min version**: v2.1.139
- **Docs**: https://code.claude.com/docs/en/goal
- **Purpose**: Sets a hard completion requirement. Claude keeps working until the condition is met.
- **Key feature**: A **separate lightweight model** evaluates the condition after each turn — not the same model doing the work. This eliminates self-preferential bias.
- **Usage**: `/goal all tests pass and lint is clean, or stop after 20 turns`
- **Status check**: `/goal` (no args) shows turns and tokens spent
- **Cancel**: `/goal clear`
- **Best with**: `auto mode` (removes per-tool prompts) + `/goal` (removes per-turn prompts) = full autonomy

### /workflows — Dynamic Workflow Orchestration
- **Min version**: v2.1.154
- **Docs**: https://code.claude.com/docs/en/workflows
- **Purpose**: Claude writes a JavaScript orchestration script that runs subagents at scale in the background.
- **Limits**: Up to 1,000 total agents, 16 concurrent
- **Trigger**: Ask "Create a workflow" or use `ultracode` effort level
- **Save**: Press `s` in workflow view → saves to `~/.claude/workflows/` or `.claude/workflows/`
- **Reuse**: Saved workflows become slash commands (e.g., `/api-auth-audit`)
- **Built-in**: `/deep-research` — multi-source research with adversarial verification

### /loop — Recurring Interval Tasks
- **Purpose**: Runs a prompt or command on a recurring interval
- **Usage**: `/loop 5m /some-command`

---

## CLI Commands

### claude ultrareview
- **Min version**: v2.1.167
- **Purpose**: Cloud-hosted multi-agent code review of current branch or PR
- **Usage**: `claude ultrareview [--json] [--timeout <minutes>]`
- **Verified**: `claude ultrareview --help` ✓

### claude agents
- **Min version**: v2.1.167
- **Purpose**: Manage background agents with effort/model/permission control
- **Key options**: `--effort <level>`, `--model <model>`, `--permission-mode <mode>`, `--json`
- **Verified**: `claude agents --help` ✓

### claude project purge
- **Min version**: v2.1.167
- **Purpose**: Delete all Claude Code state for a project
- **Verified**: `claude project --help` ✓

---

## CLI Options

| Option | Description | Verified |
|--------|-------------|----------|
| `--effort <level>` | Reasoning depth: low, medium, high, max | ✓ |
| `--agents <json>` | Custom agent definitions | ✓ |
| `--worktree [name]` | Git worktree isolation | ✓ |
| `--model <model>` | Model override (haiku/sonnet/opus) | ✓ |
| `--permission-mode <mode>` | acceptEdits, bypassPermissions, default, plan, auto | ✓ |
| `--json-schema <schema>` | Structured output validation | ✓ |

---

## Effort Levels

| Level | Description |
|-------|-------------|
| low | Minimal reasoning, fast |
| medium | Standard (default) |
| high | Deep reasoning |
| max | Maximum depth |
| ultracode | Workflow auto-trigger (v2.1.154+) |

---

## Plugin Hook Events

### plugin.json (9 events — plugin validator whitelist)
SessionStart, PreToolUse, PostToolUse, PreCompact, Stop, UserPromptSubmit, Notification, TeammateIdle, TaskCompleted

### settings.json (additional 3 confirmed working)
PermissionRequest, SessionEnd, SubagentStop

---

## QE Framework Integration Points

| Native Feature | QE Equivalent | Recommendation |
|---------------|---------------|----------------|
| `/goal` | Qexecute -verify verify loop | Use /goal for bias-free verification |
| `/workflows` | Qexecute parallel waves | Use workflows for 10+ item tasks |
| `ultrareview` | Eqa-orchestrator | Use ultrareview for external code review |
| `claude agents` | Agent tool subagents | Use agents CLI for background parallelism |
| `--effort` | SIVS effort config | Use CLI flag for per-session override |
| `--worktree` | `Qexecute --worktree` | Run wave items in isolated git worktrees when same-file editing or experimental changes need isolation (opt-in; see Qexecute "Worktree Isolation") |
