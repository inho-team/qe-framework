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

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Jira CLI — Lightweight Jira Terminal Tool

Based on `ankitpokhrel/jira-cli`. Manage Jira directly from Bash without an MCP server.

> For Confluence, use the `Qatlassian-mcp` skill.

## Prerequisites

```bash
# Check installation
jira version

# If not installed
brew install ankitpokhrel/jira-cli/jira-cli

# Initial setup (once)
jira init
```

Inputs required during `jira init`:
- Jira Server URL: `https://your-domain.atlassian.net`
- Login type: `api_token`
- Email: Your Atlassian email
- API Token: Generate at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)

## Core Commands

### Issue Queries

```bash
# Issues assigned to me
jira issue list -a$(jira me)

# Search with JQL
jira issue list -q "project = PROJ AND status = 'In Progress' ORDER BY priority DESC"

# Open issues for a specific project
jira issue list -p PROJ -s "To Do" -s "In Progress"

# View issue details
jira issue view PROJ-123

# Plain text output (for piping/parsing)
jira issue list -q "project = PROJ" --plain --columns key,summary,status,assignee

# JSON output
jira issue list -q "project = PROJ" --plain --no-headers 2>/dev/null
```

### Create Issues

```bash
# Interactive creation
jira issue create

# One-liner creation
jira issue create -t Bug -p PROJ -s "Login SSO error" -b "Cannot log in when SSO is enabled" -l bug -l production --priority High

# Create sub-task
jira issue create -t Sub-task -p PROJ -s "Add SSO debug logs" --parent PROJ-123
```

### Edit Issues

```bash
# Change status (transition)
jira issue move PROJ-123 "In Progress"

# Edit fields
jira issue edit PROJ-123 -s "Updated title" --priority Highest

# Change assignee
jira issue assign PROJ-123 "jane.doe"
jira issue assign PROJ-123 $(jira me)  # Assign to myself

# Add comment
jira issue comment add PROJ-123 "Investigating. Suspected race condition."

# Add labels (via edit)
jira issue edit PROJ-123 -l urgent -l hotfix
```

### Issue Links

```bash
# Link issues (PROJ-100 blocks PROJ-101)
jira issue link PROJ-100 PROJ-101 "Blocks"
```

### Sprints

```bash
# Current sprint issues
jira sprint list --current

# Previous/next sprint
jira sprint list --prev
jira sprint list --next

# Sprint for a specific board
jira sprint list --board-id 42 --state active

# Add issue to sprint
jira sprint add <sprint-id> PROJ-100 PROJ-101
```

### Boards

```bash
# Board list
jira board list

# Specific board type (Kanban/Scrum)
jira board list -t scrum
```

### Epics

```bash
# Epic list
jira epic list -p PROJ

# Add issue to epic
jira epic add PROJ-50 PROJ-123 PROJ-124

# View epic issues
jira epic list -p PROJ --table
```

### Projects

```bash
# Project list
jira project list

# Query by project key
jira project list --plain --columns key,name,type
```

## Common JQL Patterns

```bash
# High-priority open bugs
jira issue list -q "project = PROJ AND issuetype = Bug AND priority IN (Highest, High) AND resolution IS EMPTY"

# Issues created this week
jira issue list -q "project = PROJ AND created >= startOfWeek()"

# Issues with no updates in 14+ days
jira issue list -q "project = PROJ AND updated <= -14d AND resolution IS EMPTY"

# Backlog (not in any sprint)
jira issue list -q "project = PROJ AND sprint IS EMPTY AND resolution IS EMPTY"

# Release blockers
jira issue list -q "fixVersion = '2.0' AND priority = Blocker AND resolution IS EMPTY"

# Issues I've commented on
jira issue list -q "project = PROJ AND comment ~ currentUser()"
```

## Output Control

```bash
# Table (default)
jira issue list -p PROJ

# Plain text (for scripts)
jira issue list -p PROJ --plain

# Select columns
jira issue list -p PROJ --plain --columns key,summary,status,priority,assignee

# Without headers
jira issue list -p PROJ --plain --no-headers

# Page size
jira issue list -p PROJ --paginate 100
```

## Practical Workflows

### Daily Standup View

```bash
echo "=== My In Progress ==="
jira issue list -a$(jira me) -s "In Progress" --plain --columns key,summary

echo "=== My Awaiting Review ==="
jira issue list -a$(jira me) -s "In Review" --plain --columns key,summary

echo "=== Blockers ==="
jira issue list -q "assignee = currentUser() AND (status = Blocked OR labels = blocked)" --plain --columns key,summary
```

### Quick Bug Report

```bash
jira issue create \
  -t Bug \
  -p PROJ \
  -s "$1" \
  -b "## Steps to Reproduce\n1. \n\n## Expected Result\n\n## Actual Result\n" \
  -l bug \
  --priority High \
  -a $(jira me)
```

### Sprint Completion Rate

```bash
echo "=== Done ==="
jira sprint list --current -s Done --plain --columns key,summary | wc -l

echo "=== Not Done ==="
jira sprint list --current -s "To Do" -s "In Progress" --plain --columns key,summary | wc -l
```

## Role Division with Qatlassian-mcp

| Task | Qjira-cli | Qatlassian-mcp |
|------|-----------|----------------|
| Jira issue CRUD | Yes | Yes |
| JQL search | Yes | Yes |
| Sprint management | Yes | Yes |
| Confluence pages | No | Yes |
| CQL search | No | Yes |
| Release notes → Confluence | No | Yes |
| No MCP server required | Yes | No |
| Script/pipe integration | Yes (native Bash) | Partial |

## Constraints

### MUST DO
- Use only after `jira init` is complete
- Store API token in environment variable or `~/.config/.jira/.config.yml`
- Watch for rate limits on bulk operations (add delay between requests)
- Confirm with user before write operations

### MUST NOT DO
- Do not hardcode API tokens in code
- Do not attempt to parse output without `--plain` (contains ANSI codes)
- Do not use this skill for Confluence tasks (use Qatlassian-mcp)
