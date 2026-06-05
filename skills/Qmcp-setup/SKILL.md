---
name: Qmcp-setup
description: MCP (Model Context Protocol) server setup and configuration guide for Claude Code. Use when adding external service integrations (Google Drive, Slack, GitHub, databases, etc.) via MCP servers. Invoke for 'mcp setup', 'mcp add', 'connect service', 'integrate with', 'add mcp server'.
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

## Role Boundary (Absolute Rule)

This skill is a **setup and configuration guide only**. It does NOT execute MCP operations.

| Request | Correct action |
|---------|---------------|
| "Set up MCP server", "connect Google Drive" | **This skill** — guide setup steps |
| "Get files from Google Drive", "Send Slack messages" | **NOT this skill** — use connected MCP tools directly |

### Pre-check: MCP Server Status

Before guiding setup, check if the requested MCP server is already connected:

```bash
claude mcp list 2>/dev/null | grep -i {service-name}
```

**If connected**: "Already connected. Use MCP tools directly." — exit skill.
**If NOT connected**: proceed with setup guide.

---

# Qmcp-setup — MCP Server Setup Guide

## Role
Guides users through discovering, installing, and configuring MCP servers to connect Claude Code with external services.

## Workflow

### Step 1: Identify the Service
Ask the user which external service they want to connect. Common MCP servers:

| Service | Recommended Package | Transport |
|---------|-------------------|-----------|
| Google Drive | `@piotr-agier/google-drive-mcp` | stdio |
| Google Workspace | `google_workspace_mcp` (Python) | stdio |
| GitHub | `@modelcontextprotocol/server-github` | stdio |
| Slack | `@anthropics/mcp-server-slack` | stdio |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | stdio |
| Filesystem | `@modelcontextprotocol/server-filesystem` | stdio |
| Fetch (HTTP) | `@modelcontextprotocol/server-fetch` | stdio |
| Memory | `@modelcontextprotocol/server-memory` | stdio |
| Brave Search | `@modelcontextprotocol/server-brave-search` | stdio |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | stdio |
| Redis | `@modelcontextprotocol/server-redis` | stdio |
| SQLite | `@modelcontextprotocol/server-sqlite` | stdio |
| Sentry | `@modelcontextprotocol/server-sentry` | stdio |

If the service is not listed, search npm/PyPI/GitHub for `mcp-server-{service}` or `{service}-mcp`.

### Step 2: Check Prerequisites

#### Node.js MCP Servers
```bash
node --version  # Requires Node.js 18+
```

#### Python MCP Servers
```bash
python3 --version  # Requires Python 3.10+
pip install uv      # Recommended package manager
```

### Step 3: Add MCP Server to Claude Code

#### Method A: CLI Command (Recommended)
```bash
# npm packages
claude mcp add <server-name> -- npx <package-name>

# npm packages with env vars
claude mcp add <server-name> -e KEY=value -- npx <package-name>

# Python packages (uvx)
claude mcp add <server-name> -- uvx <package-name>

# Local scripts
claude mcp add <server-name> -- node /path/to/server.js
```

#### Method B: Manual JSON Config
Edit `~/.claude.json` or project `.claude.json`:
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["<package-name>"],
      "env": {
        "API_KEY": "your-key"
      }
    }
  }
}
```

### Step 4: Verify Connection
```bash
claude mcp list          # List configured servers
claude mcp get <name>    # Check specific server config
```

### Step 5: Test
Start a new Claude Code session and verify the MCP tools are available.

---

## Service-Specific Setup Guides

See references/service-setup-guides.md for detailed setup instructions for Google Drive, GitHub, Slack, PostgreSQL, and Filesystem.

---

## QE Framework MCP Catalog

These MCPs have dedicated setup skills in the framework. Use the dedicated skill for detailed guidance, or set up quickly from here.

### Status Dashboard

Run this to check all framework MCP connections at once:

```bash
echo "=== QE Framework MCP Status ==="
echo -n "Chrome:      "; claude mcp list 2>/dev/null | grep -qi chrome && echo "CONNECTED" || echo "NOT CONNECTED → /Qchrome"
echo -n "Stitch:      "; claude mcp list 2>/dev/null | grep -qi stitch && echo "CONNECTED" || echo "NOT CONNECTED → /Qstitch-cli"
echo -n "Agentation:  "; claude mcp list 2>/dev/null | grep -qi agentation && echo "CONNECTED" || echo "NOT CONNECTED → /Qagentation"
```

### Registered MCPs

| MCP | Purpose | Setup Skill | Quick Add |
|-----|---------|-------------|-----------|
| Claude-in-Chrome | Browser automation (navigate, click, read, GIF) | `/Qchrome` | `claude mcp add claude-in-chrome -- npx @anthropic/claude-in-chrome-mcp` |
| Google Stitch | AI UI design → HTML/CSS | `/Qstitch-cli` | `claude mcp add stitch -- npx @_davideast/stitch-mcp proxy` |
| Agentation | Visual UI feedback for agents | `/Qagentation` | `claude mcp add agentation -- npx agentation mcp` |

> For services not in this catalog (Google Drive, Slack, GitHub, etc.), see the general setup guide below.

---

## MCP Management Commands

| Command | Description |
|---------|-------------|
| `claude mcp add <name> -- <command>` | Add a new MCP server |
| `claude mcp remove <name>` | Remove an MCP server |
| `claude mcp list` | List all configured servers |
| `claude mcp get <name>` | Show server details |
| `claude mcp add <name> -s project` | Add to project scope only |
| `claude mcp add <name> -s user` | Add to user scope (default) |

## Agent Teams MCP Configuration

When using Agent Teams (`--agents` flag), each teammate can have its own MCP server configuration.

### Per-Agent MCP Servers

In the `--agents` JSON, use the `mcpServers` field:

```json
[
  {
    "name": "researcher",
    "mcpServers": [
      { "name": "brave-search", "command": "npx", "args": ["-y", "@anthropic-ai/mcp-brave-search"] }
    ]
  },
  {
    "name": "coder",
    "mcpServers": [
      { "name": "filesystem", "command": "npx", "args": ["-y", "@anthropic-ai/mcp-filesystem", "/src"] }
    ]
  }
]
```

### Shared vs Dedicated MCP Servers

| Pattern | Use Case | Setup |
|---------|----------|-------|
| **Shared** | All teammates need the same tool | Configure in project `.mcp.json` |
| **Dedicated** | Only one teammate needs it | Use `mcpServers` in agent definition |
| **Mixed** | Some shared, some dedicated | Combine both approaches |

### Best Practices

- Give each agent only the MCP servers it needs (principle of least privilege)
- Shared database MCP servers should use read-only credentials for reviewer agents
- Use dedicated MCP servers for tools that modify state (avoid race conditions)
- Agent Teams inherit project-level `.mcp.json` servers unless overridden

## Scope

| Scope | Config File | Use Case |
|-------|------------|----------|
| `user` | `~/.claude.json` | Personal tools (default) |
| `project` | `.claude.json` in project root | Team-shared tools |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server not starting | Check `node --version` >= 18, verify package name |
| Auth errors | Verify API keys/tokens in env vars |
| Tools not showing | Restart Claude Code session after adding MCP |
| Timeout | Check network, increase timeout in config |
| Permission denied | Verify OAuth scopes, re-authenticate |

## Will
- Guide MCP server discovery and installation
- Configure authentication credentials
- Verify server connection
- Provide service-specific setup instructions

## Will Not
- Store credentials in code or git-tracked files
- Install MCP servers without user confirmation
- Modify existing MCP configurations without asking

---

## Building Custom MCP Servers

> Use this section when building MCP servers from scratch. This is a **development guide only** — it does NOT auto-generate server code.

| Request | Correct action |
|---------|---------------|
| "Show me how to build MCP servers", "MCP development guide" | **This section** — guide development process |
| "Write MCP server code", "Build a server" | **NOT this section** — use standard code implementation |

### Workflow

**Phase 1: Research & Planning**
- Study MCP docs: `https://modelcontextprotocol.io/sitemap.xml`
- Recommended: TypeScript + Streamable HTTP (remote) or stdio (local)
- Plan API coverage vs workflow tools

**Phase 2: Implementation**
- Input Schema: Zod(TS) / Pydantic(Python)
- Output Schema: `outputSchema` + `structuredContent`
- Annotations: readOnlyHint, destructiveHint, idempotentHint

**Phase 3: Review & Test**
- No duplicated code (DRY)
- Consistent error handling
- Test: `npx @modelcontextprotocol/inspector`

**Phase 4: Evaluations**
- 10 complex, realistic questions
- Independent, read-only, verifiable, stable

### Presets

Pre-configured MCP server sets are available in `presets/`. Offer these to the user before building from scratch:

| Preset | File | Use Case |
|--------|------|----------|
| Recommended | `presets/recommended.json` | General-purpose (filesystem, git, fetch, memory, sequential-thinking) |
| Frontend | `presets/frontend.json` | Frontend development (browser, puppeteer, filesystem, git) |
| Full-stack | `presets/fullstack.json` | Full-stack development (filesystem, git, postgres, redis, fetch, docker) |

Usage: Copy the selected preset's `mcpServers` block into the project's `.claude.json` or MCP config file. Replace `${PROJECT_ROOT}` and other environment variables with actual values.

### References
- TypeScript SDK: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
