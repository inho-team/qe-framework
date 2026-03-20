---
name: Qjira-cli
description: "Lightweight Jira CLI wrapper for quick issue management without MCP server setup. Use when querying issues with JQL, creating/updating tickets, managing sprints, or viewing boards from the terminal. Complements Qatlassian-mcp as a fast alternative for Jira-only tasks."
metadata:
  version: "1.0.0"
  domain: platform
  triggers: jira, jira-cli, issue, ticket, sprint, board, backlog, JQL, jira issue, jira sprint
  role: expert
  scope: implementation
  output-format: code
  related-skills: Qatlassian-mcp
allowed-tools: Bash(jira:*), Bash(jira *)
keywords: jira, cli, issue, ticket, sprint, board, backlog, JQL
---


## Pre-check: jira CLI Installation

```bash
which jira 2>/dev/null && jira version 2>/dev/null
```

**If NOT installed:**
```
설치: go install github.com/ankitpokhrel/jira-cli/cmd/jira@latest
또는: brew install ankitpokhrel/jira-cli/jira-cli
```

---

# Jira CLI — Lightweight Jira Terminal Tool

Based on `ankitpokhrel/jira-cli`. Manage Jira directly from Bash without an MCP server.

> For Confluence, use the `Qatlassian-mcp` skill.

## Prerequisites

```bash
jira version           # Check installation
jira init              # Initial setup (once)
```

Setup requires: Jira Server URL, login type (`api_token`), email, API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).

## Core Commands

### Issue Queries

```bash
jira issue list -a$(jira me)                                    # My issues
jira issue list -q "project = PROJ AND status = 'In Progress'"  # JQL search
jira issue list -p PROJ -s "To Do" -s "In Progress"             # By status
jira issue view PROJ-123                                         # Details
jira issue list -q "project = PROJ" --plain --columns key,summary,status,assignee  # Plain output
```

### Create Issues

```bash
jira issue create                                                # Interactive
jira issue create -t Bug -p PROJ -s "Login SSO error" -b "Details" -l bug --priority High  # One-liner
jira issue create -t Sub-task -p PROJ -s "Add logs" --parent PROJ-123  # Sub-task
```

### Edit Issues

```bash
jira issue move PROJ-123 "In Progress"            # Transition
jira issue edit PROJ-123 -s "Updated title"        # Edit fields
jira issue assign PROJ-123 "jane.doe"              # Assign
jira issue assign PROJ-123 $(jira me)              # Assign to self
jira issue comment add PROJ-123 "Comment text"     # Comment
jira issue link PROJ-100 PROJ-101 "Blocks"         # Link issues
```

### Sprints & Boards

```bash
jira sprint list --current                         # Current sprint
jira sprint list --prev / --next                   # Adjacent sprints
jira sprint list --board-id 42 --state active       # By board
jira sprint add <sprint-id> PROJ-100 PROJ-101      # Add to sprint
jira board list                                     # All boards
jira board list -t scrum                           # By type
```

### Epics & Projects

```bash
jira epic list -p PROJ                             # List epics
jira epic add PROJ-50 PROJ-123 PROJ-124            # Add to epic
jira project list                                   # List projects
```

## Common JQL Patterns

```bash
# High-priority open bugs
"project = PROJ AND issuetype = Bug AND priority IN (Highest, High) AND resolution IS EMPTY"

# Issues created this week
"project = PROJ AND created >= startOfWeek()"

# Stale issues (14+ days)
"project = PROJ AND updated <= -14d AND resolution IS EMPTY"

# Backlog (no sprint)
"project = PROJ AND sprint IS EMPTY AND resolution IS EMPTY"

# Release blockers
"fixVersion = '2.0' AND priority = Blocker AND resolution IS EMPTY"
```

## Output Control

```bash
jira issue list -p PROJ                            # Table (default)
jira issue list -p PROJ --plain                    # Plain text
jira issue list -p PROJ --plain --columns key,summary,status  # Select columns
jira issue list -p PROJ --plain --no-headers       # No headers
jira issue list -p PROJ --paginate 100             # Page size
```

## Practical Workflows

### Daily Standup View

```bash
echo "=== In Progress ===" && jira issue list -a$(jira me) -s "In Progress" --plain --columns key,summary
echo "=== In Review ===" && jira issue list -a$(jira me) -s "In Review" --plain --columns key,summary
echo "=== Blockers ===" && jira issue list -q "assignee = currentUser() AND status = Blocked" --plain --columns key,summary
```

## Role Division with Qatlassian-mcp

| Task | Qjira-cli | Qatlassian-mcp |
|------|-----------|----------------|
| Jira issue CRUD / JQL / Sprint | Yes | Yes |
| Confluence / CQL | No | Yes |
| No MCP server required | Yes | No |
| Native Bash piping | Yes | Partial |

## Constraints

**MUST DO:** Verify `jira init` complete; store API token securely; watch rate limits; confirm before write ops.

**MUST NOT DO:** Hardcode tokens; parse output without `--plain`; use for Confluence (use Qatlassian-mcp).
