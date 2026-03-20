---
name: Qcommand-creator
description: A skill for creating Claude Code slash commands. Use when the user requests "create a command", "add a slash command", or wants to turn a repetitive workflow into a reusable command.
---


# Command Creator

This skill guides the creation of Claude Code slash commands. Slash commands are reusable workflows callable as `/command-name` within a Claude Code conversation.

## What Are Slash Commands

Slash commands are markdown files stored in `.claude/commands/` (project level) or `~/.claude/commands/` (global/user level) that expand into prompts when invoked. They are suitable for:

- Repetitive workflows (code review, PR submission, CI fixes)
- Multi-step processes requiring consistency
- Agent delegation patterns
- Project-specific automation

## When to Use This Skill

- When the user says "create a command" or "make a slash command"
- When the user wants to automate a repetitive workflow
- When the user wants to document a consistent process as reusable
- When the user says "I keep doing X, can we make it a command?"

## Bundled Resources

- **references/patterns.md** - Command patterns (workflow automation, iterative fixing, agent delegation, simple execution)
- **references/examples.md** - Real command examples with full source
- **references/best-practices.md** - Quality checklist, common mistakes, writing guidelines

## Command Structure Overview

Every slash command is a markdown file with the following structure:

```markdown
---
description: Brief description shown in /help (required)
argument-hint: <placeholder> (optional, if the command accepts arguments)
---

# Command Title

[Detailed instructions for the agent to execute autonomously]
```

## Command Creation Workflow

### Step 1: Determine Location

**Automatically detect the appropriate location:**

1. Check git repository status: `git rev-parse --is-inside-work-tree 2>/dev/null`
2. Default location:
   - Inside a git repository → project level: `.claude/commands/`
   - Outside a git repository → global: `~/.claude/commands/`
3. If the user specifies "global" → `~/.claude/commands/`
4. If the user specifies "project" → `.claude/commands/`

Inform the user of the chosen location before proceeding.

### Step 2: Guide Command Pattern

Load **references/patterns.md** to review available patterns:

- **Workflow Automation** - analyze → execute → report (e.g., submit-stack)
- **Iterative Fixing** - run → parse → fix → repeat (e.g., ensure-ci)
- **Agent Delegation** - context → delegate → iterate (e.g., create-implementation-plan)
- **Simple Execution** - run a command with arguments (e.g., codex-review)

Ask the user: "Which pattern is closest to what you have in mind?"

### Step 3: Gather Command Information

#### A. Command Name and Purpose

- "What should the command be named?" (for the filename)
- "What does this command do?" (for the description field)

Guidelines:
- Must use kebab-case (hyphens only, no underscores)
  - Correct: `submit-stack`, `ensure-ci`
  - Incorrect: `submit_stack`, `ensure_ci`
- The filename becomes the command name: `my-command.md` → invoked as `/my-command`

#### B. Arguments

- "Does this command take arguments?"
- Required arguments: `<angle-brackets>`, optional arguments: `[square-brackets]`

#### C. Workflow Steps

- "What are the specific steps this command should follow?"
- "In what order should they proceed?"
- "What tools or commands will be used?"

#### D. Tool Restrictions and Guidance

- "Are there specific agents or tools that must be used?"
- "Are there any tools or actions that should be avoided?"

### Step 4: Generate an Optimized Command

Reference **references/best-practices.md** to create the command file with agent-optimized instructions.

Core principles:
- Use imperative/verb-first form
- Write clearly and specifically
- Include expected outcomes
- Provide concrete examples
- Define clear error handling

### Step 5: Create the Command File

1. Determine the full file path
2. Verify the directory exists: `mkdir -p [directory path]`
3. Write the command file using the Write tool
4. Confirm with the user: file location, summary, and how to use it

### Step 6: Test and Iterate (Optional)

1. Suggest a test: "Try running this command with `/command-name [arguments]` to test it"
2. Iterate based on feedback
3. Update the file as needed

## Quick Tips

**Common patterns to remember:**
- Use the Bash tool for `pytest`, `pyright`, `ruff`, `prettier`, `make`, etc.
- Use the Task tool to invoke sub-agents for specialized work
- Check for the existence of specific files before proceeding
- Mark todos complete immediately, do not batch
- Include clear error handling instructions and success criteria

## Summary

1. **Detect location** (project vs. global)
2. **Guide pattern** - frame the conversation
3. **Gather information** (name, purpose, arguments, steps, tools)
4. **Generate optimized command** - agent-executable instructions
5. **Create the file** - in the appropriate location
6. **Confirm and iterate** - as needed
