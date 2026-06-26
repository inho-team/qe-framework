---
name: Qatlassian-mcp
description: Integrates with Atlassian products to manage project tracking and documentation via MCP protocol. Use when querying Jira issues with JQL filters, creating and updating tickets with custom fields, searching or editing Confluence pages with CQL, managing sprints and backlogs, setting up MCP server authentication, syncing documentation, or debugging Atlassian API integrations.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: platform
triggers: Jira, Confluence, Atlassian, MCP, tickets, issues, wiki, JQL, CQL, sprint, backlog, project management
role: expert
scope: implementation
output-format: code
related-skills: mcp-developer, api-designer, security-reviewer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Atlassian MCP Expert

## When to Use This Skill

- Querying Jira issues with JQL filters
- Searching or creating Confluence pages
- Automating sprint workflows and backlog management
- Setting up MCP server authentication (OAuth/API tokens)
- Syncing meeting notes to Jira tickets
- Generating documentation from issue data
- Debugging Atlassian API integration issues
- Choosing between official vs open-source MCP servers

## Core Workflow

1. **Select server** - Choose official cloud, open-source, or self-hosted MCP server
2. **Authenticate** - Configure OAuth 2.1, API tokens, or PAT credentials
3. **Design queries** - Write JQL for Jira, CQL for Confluence; validate with `maxResults=1` before full execution
4. **Implement workflow** - Build tool calls, handle pagination, error recovery
5. **Verify permissions** - Confirm required scopes with a read-only probe before any write or bulk operation
6. **Deploy** - Configure IDE integration, test permissions, monitor rate limits

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Server Setup | `references/mcp-server-setup.md` | Installation, choosing servers, configuration |
| Jira Operations | `references/jira-queries.md` | JQL syntax, issue CRUD, sprints, boards, issue linking |
| Confluence Ops | `references/confluence-operations.md` | CQL search, page creation, spaces, comments |
| Authentication | `references/authentication-patterns.md` | OAuth 2.0, API tokens, permission scopes |
| Common Workflows | `references/common-workflows.md` | Issue triage, doc sync, sprint automation |

## Quick-Start Examples

### JQL Query Samples
```
# Open issues assigned to current user in a sprint
project = PROJ AND status = "In Progress" AND assignee = currentUser() ORDER BY priority DESC

# Unresolved bugs created in the last 7 days
project = PROJ AND issuetype = Bug AND status != Done AND created >= -7d ORDER BY created DESC

# Validate before bulk: test with maxResults=1 first
project = PROJ AND sprint in openSprints() AND status = Open ORDER BY created DESC
```

### CQL Query Samples
```
# Find pages updated in a specific space recently
space = "ENG" AND type = page AND lastModified >= "2024-01-01" ORDER BY lastModified DESC

# Search page text for a keyword
space = "ENG" AND type = page AND text ~ "deployment runbook"
```

### Minimal MCP Server Configuration
```json
{
  "mcpServers": {
    "atlassian": {
      "command": "npx",
      "args": ["-y", "@sooperset/mcp-atlassian"],
      "env": {
        "JIRA_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "user@example.com",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}",
        "CONFLUENCE_URL": "https://your-domain.atlassian.net/wiki",
        "CONFLUENCE_EMAIL": "user@example.com",
        "CONFLUENCE_API_TOKEN": "${CONFLUENCE_API_TOKEN}"
      }
    }
  }
}
```
> **Note:** Always load `JIRA_API_TOKEN` and `CONFLUENCE_API_TOKEN` from environment variables or a secrets manager — never hardcode credentials.

## Constraints

### MUST DO
- Respect user permissions and workspace access controls
- Validate JQL/CQL queries before execution (use `maxResults=1` probe first)
- Handle rate limits with exponential backoff
- Use pagination for large result sets (50-100 items per page)
- Implement error recovery for network failures
- Log API calls for debugging and audit trails
- Test with read-only operations first
- Document required permission scopes
- Confirm before any write or bulk operation against production data

### MUST NOT DO
- Hardcode API tokens or OAuth secrets in code
- Ignore rate limit headers from Atlassian APIs
- Create issues without validating required fields
- Skip input sanitization on user-provided query strings
- Deploy without testing permission boundaries
- Update production data without confirmation prompts
- Mix different authentication methods in same session
- Expose sensitive issue data in logs or error messages

## Output Templates

When implementing Atlassian MCP features, provide:
1. MCP server configuration (JSON/environment vars)
2. Query examples (JQL/CQL with explanations)
3. Tool call implementation with error handling
4. Authentication setup instructions
5. Brief explanation of permission requirements

## Jira/Confluence API Patterns (3 Core Examples)

1. **JQL Probe Query** — Start with `maxResults=1` to validate permissions before bulk fetch: `GET /rest/api/3/search?jql=project=KEY&maxResults=1`
2. **Pagination Loop** — Fetch in pages: `startAt=0, maxResults=50` then increment `startAt` by 50 until `isLast=true`
3. **Error Recovery** — Catch 429 (rate limit) and retry with exponential backoff: `wait = 2^attempt * 1000ms`

## JSDoc/TypeScript Comment Template

```typescript
/**
 * Fetches Jira issues matching JQL filter.
 * @param jql - JQL query string (validated against project permissions)
 * @param maxResults - Max issues per page (default: 50, max: 100)
 * @param startAt - Pagination offset (default: 0)
 * @returns Promise<{issues: Issue[], total: number, isLast: boolean}>
 * @throws {APIError} if JQL is invalid or user lacks permission
 * @throws {RateLimitError} if rate limit exceeded; includes retry-after header
 */
async function searchIssues(jql: string, maxResults = 50, startAt = 0): Promise<SearchResult> {
    // Implementation with pagination and error handling
}
```

## eslint / tsc Configuration Rules

Run: `eslint . --fix && tsc --noEmit`
- **no-hardcoded-secrets** — Fail if API token found in source (use env vars only)
- **@typescript-eslint/no-floating-promises** — All async calls must await or .catch()
- **no-unhandled-promise-rejections** — Every Promise catch rate limit/auth errors

## API Token Security Checklist (5+ Items)

- [ ] Credentials: Never hardcode API tokens; load from `process.env.JIRA_API_TOKEN` or secrets manager
- [ ] Token Scope: Limit PAT to read-only (`JIRA:Issues:read`) for queries; write scope only when needed
- [ ] Rate Limiting: Monitor `X-RateLimit-Remaining` header; pause if < 10 remaining; retry on 429 with backoff
- [ ] Permission Scoping: Validate user has access to issue/space with probe query before bulk operations
- [ ] Error Logging: Never log request body/token; sanitize before logging (remove auth headers, API keys)

## Anti-patterns (5 Wrong/Correct)

| Wrong | Correct |
|-------|---------|
| `const token = "api_token_abc123"` hardcoded in config | `const token = process.env.JIRA_API_TOKEN` loaded at runtime |
| `for (let i = 0; i < 1000; i++) { fetch(url) }` (no pagination) | Fetch with `startAt=0, maxResults=50` loop; increment `startAt+=50` |
| `fetch(url).then(...)` without error catch (unhandled 429) | `.catch(err => { if (err.status === 429) { wait & retry } })` |
| `GET /rest/api/3/issue/ISSUE-1` then `ISSUE-2` then `ISSUE-3`... (N+1 queries) | `GET /rest/api/3/search?jql=key in (ISSUE-1,ISSUE-2,ISSUE-3)` one call |
| Update issue without confirm: `PUT /issue/:id {...data}` in bulk loop | Add confirmation prompt; test with read-only probe first before mutation |
