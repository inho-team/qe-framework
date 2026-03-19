---
name: Qmcp-setup
description: "MCP (Model Context Protocol) server setup and configuration guide for Claude Code. Use when adding external service integrations (Google Drive, Slack, GitHub, databases, etc.) via MCP servers. Invoke for 'mcp setup', 'mcp add', 'connect service', 'integrate with', 'add mcp server'."
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

## Role Boundary (Absolute Rule)

This skill is a **setup and configuration guide only**. It does NOT execute MCP operations.

| Request | Correct action |
|---------|---------------|
| "MCP 서버 설정해줘", "connect Google Drive" | **This skill** — guide setup steps |
| "Google Drive에서 파일 가져와", "Slack 메시지 보내" | **NOT this skill** — use connected MCP tools directly |

### Pre-check: MCP Server Status

Before guiding setup, check if the requested MCP server is already connected:

```bash
claude mcp list 2>/dev/null | grep -i {service-name}
```

**If connected**: "이미 연결되어 있습니다. MCP 도구를 직접 사용하세요." — exit skill.
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

### Google Drive (`@piotr-agier/google-drive-mcp`)

**1. Google Cloud Console Setup:**
- Go to https://console.cloud.google.com
- Create a project or use existing
- Enable APIs: Google Drive API, Google Docs API, Google Sheets API, Google Slides API
- Create OAuth 2.0 Client ID (Desktop application type)
- Download the JSON credentials file

**2. Place Credentials:**
```bash
mkdir -p ~/.config/google-drive-mcp
mv ~/Downloads/client_secret_*.json ~/.config/google-drive-mcp/gcp-oauth.keys.json
```

**3. Add to Claude Code:**
```bash
claude mcp add google-drive -- npx @piotr-agier/google-drive-mcp
```

**4. First Run:**
Browser opens for Google OAuth login. Approve permissions. Tokens auto-save to `~/.config/google-drive-mcp/tokens.json`.

**Capabilities:** File CRUD, search, shared drives, folder navigation, Google Docs/Sheets/Slides editing, Calendar management.

---

### GitHub (`@modelcontextprotocol/server-github`)

**1. Create Personal Access Token:**
- Go to https://github.com/settings/tokens
- Generate token with required scopes (repo, read:org, etc.)

**2. Add to Claude Code:**
```bash
claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx -- npx @modelcontextprotocol/server-github
```

**Capabilities:** Repo management, issues, PRs, file operations, branch management, search.

---

### Slack (`@anthropics/mcp-server-slack`)

**1. Create Slack App:**
- Go to https://api.slack.com/apps
- Create new app > From scratch
- Add OAuth scopes: channels:history, channels:read, chat:write, users:read
- Install to workspace, copy Bot User OAuth Token

**2. Add to Claude Code:**
```bash
claude mcp add slack -e SLACK_BOT_TOKEN=xoxb-xxx -e SLACK_TEAM_ID=T0xxx -- npx @anthropics/mcp-server-slack
```

**Capabilities:** Read/send messages, list channels, search messages, manage threads.

---

### PostgreSQL (`@modelcontextprotocol/server-postgres`)

```bash
claude mcp add postgres -- npx @modelcontextprotocol/server-postgres postgresql://user:pass@localhost:5432/dbname
```

**Capabilities:** Query execution, schema inspection, read-only by default.

---

### Filesystem (`@modelcontextprotocol/server-filesystem`)

```bash
claude mcp add filesystem -- npx @modelcontextprotocol/server-filesystem /path/to/allowed/directory
```

**Capabilities:** Read/write files, directory listing, search, within allowed paths only.

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
