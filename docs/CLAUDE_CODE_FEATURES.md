# Claude Code Feature Reference

> Verified against Claude Code v2.1.212 on 2026-07-17
> This document only includes features confirmed via `--help`, official docs, or direct execution —
> **except items explicitly labeled `[internal observation]`**, which come from binary reverse-engineering
> and are subject to change without notice.
> This is a point-in-time snapshot for a specific version; to re-verify, run `claude --version`,
> `claude --help`, and check `/effort`, `/goal`, `/workflows` against `.qe/analysis/prompt-hook-spike.md`.

---

## Session Slash Commands

### /goal — Autonomous Completion Condition
- **Min version**: v2.1.139
- **Docs**: https://code.claude.com/docs/en/goal
- **Purpose**: Sets a hard completion requirement. Claude keeps working until the condition is met.
- **Key feature (upside)**: A **separate lightweight model** (the default small fast model — observed
  `claude-haiku-4-5`, distinct from the working model) evaluates the condition after each turn.
  Because the evaluator is a **separate model** from the one doing the work, the
  self-preference bias of a model grading its own completion is genuinely removed.
- **Key limit (downside)** `[internal observation]`: the evaluator runs with `tools: []` and
  `thinkingConfig: disabled`, and is framed to *"answer based on transcript evidence only."* It **cannot
  run tests, read files, or verify anything outside the transcript.** It **cannot verify a claim like
  "all tests pass"** — if the working model writes "tests pass" into the transcript, the evaluator accepts
  that **false claim** at face value. It removes bias, but its evidence is weak. Use `/goal` for
  **transcript-verifiable procedural conditions** (e.g. "all checklist items are checked"), not for
  execution-evidence conditions (e.g. "all tests pass").
- **Fail-open** `[internal observation]`: an evaluator API error, JSON parse failure, schema violation, or
  timeout all resolve to `non_blocking_error` — i.e. the turn is **allowed to stop, not blocked**. A `/goal`
  gate silently opens on any evaluator failure; it is not fail-closed.
- **Usage**: `/goal all tests pass and lint is clean, or stop after 20 turns`
- **Status check**: `/goal` (no args) shows turns and tokens spent
- **Cancel**: `/goal clear`
- **Best with**: `auto mode` (removes per-tool prompts) + `/goal` (removes per-turn prompts) = full autonomy

### /workflows — Dynamic Workflow Orchestration
- **Min version**: v2.1.154
- **Docs**: https://code.claude.com/docs/en/workflows
- **Purpose**: Claude writes a JavaScript orchestration script that runs subagents at scale in the background.
- **Limits**: Up to 1,000 total agents over a workflow's lifetime. Concurrency is
  `min(16, max(2, cpu cores - 2))` `[internal observation]` — 16 is the ceiling, not a fixed value
  (e.g. a 12-core machine runs ~10 at a time). A single `parallel()`/`pipeline()` call takes at most 4096 items.
- **Trigger**: Ask "Create a workflow", or put the keyword `ultracode` in your prompt. `ultracode` is a
  session mode (= `xhigh` reasoning **+** dynamic workflow orchestration for that session), not a plain
  `--effort` value — see Effort Levels below.
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
| `--effort <level>` | Reasoning depth: `low, medium, high, xhigh, max`. `--effort ultracode` is also accepted (undocumented alias → `xhigh`, no warning) `[internal observation]` — undocumented aliases may change or be removed, so do not rely on it for stable automation. `--effort auto` is **rejected** (`Unknown --effort value 'auto'`); `auto` works only via the `/effort` slash command. | ✓ |
| `--agents <json>` | Custom agent definitions | ✓ |
| `--worktree [name]` | Git worktree isolation | ✓ |
| `--model <model>` | Model override (haiku/sonnet/opus) | ✓ |
| `--permission-mode <mode>` | acceptEdits, bypassPermissions, default, plan, auto | ✓ |
| `--json-schema <schema>` | Structured output validation | ✓ |

---

## Effort Levels

`--effort` CLI values (shown by `--help`): `low, medium, high, xhigh, max`.

| Level | Description |
|-------|-------------|
| low | Minimal reasoning, fast |
| medium | Standard (default) |
| high | Deep reasoning |
| xhigh | Deeper than high (Codex's top level; a valid Claude `--effort` value too) |
| max | Maximum depth (Claude) |

**`ultracode` is not a plain effort level** — it is a session mode meaning `xhigh` **+** dynamic workflow
orchestration for that session only (v2.1.154+). It is accepted in three places: the `/effort ultracode`
slash command, as a prompt keyword, and as an undocumented `--effort ultracode` alias (→ `xhigh`, no
warning) `[internal observation]`. Note that `--effort xhigh` alone does **not** enable workflow
orchestration; only `ultracode` sets the session workflow boolean.

`auto` is a `/effort` slash-command value only; `--effort auto` is rejected.

---

## Plugin Hook Events

### QE plugin.json (7 registered events)
SessionStart, PreToolUse, PostToolUse, Stop, UserPromptSubmit, TeammateIdle, TaskCompleted

### settings.json (additional 3 confirmed working)
PermissionRequest, SessionEnd, SubagentStop

---

## QE Framework Integration Points

| Native Feature | QE Equivalent | Recommendation |
|---------------|---------------|----------------|
| `/goal` | Qexecute -verify verify loop | Bias-free (separate evaluator model) but **evidence-poor** (transcript-only, no tools) and **fail-open**. Use for transcript-verifiable procedural conditions only — never as a replacement for QE's execution-evidence gates. See `.qe/analysis/prompt-hook-spike.md`. |
| `/workflows` | Qexecute parallel waves | Use workflows for 10+ item tasks |
| `ultrareview` | Eqa-orchestrator | Use ultrareview for external code review |
| `claude agents` | Agent tool subagents | Use agents CLI for background parallelism |
| `--effort` | SIVS effort config | Use CLI flag for per-session override |
| `--worktree` | `Qexecute --worktree` | Run wave items in isolated git worktrees when same-file editing or experimental changes need isolation (opt-in; see Qexecute "Worktree Isolation") |
