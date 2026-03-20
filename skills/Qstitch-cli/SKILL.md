---
name: Qstitch-cli
description: "Google Stitch MCP setup and CLI usage guide. Use when setting up Stitch MCP, configuring Stitch, or troubleshooting Stitch connections — NOT for executing Stitch design operations. Invoke for 'stitch setup', 'stitch mcp', 'connect stitch', 'stitch cli'."
---

# Qstitch-cli — Google Stitch MCP Setup & CLI

## Role Boundary (Absolute Rule)

This skill is a **setup and configuration guide only**. It does NOT execute Stitch operations.

| Request | Action |
|---------|--------|
| "stitch 설정해줘", "stitch mcp 연결" | **This skill** — guide setup |
| "스크린 만들어줘", "디자인 그려줘" | **NOT this skill** — use Stitch MCP tools directly |

### Pre-check: MCP Connection Status

```bash
claude mcp list 2>/dev/null | grep -i stitch
```

- **Connected**: Do NOT re-run setup. Tell user MCP is connected, use tools directly.
- **Not connected + design request**: "Stitch MCP가 연결되어 있지 않습니다. 먼저 설정이 필요합니다." → proceed with setup.
- **Not connected + setup request**: proceed with setup.

---

## What is Google Stitch?

AI UI design tool (stitch.withgoogle.com) that converts text/images into HTML/CSS via Gemini 2.5.

| Feature | Detail |
|---------|--------|
| Input | Text prompts, wireframes, screenshots |
| Output | HTML/CSS code + visual preview |
| Models | Gemini 2.5 Flash (350/mo), Pro (50/mo) |

---

## MCP Package Options

| Package | Auth | Best For |
|---------|------|----------|
| `@_davideast/stitch-mcp` | API Key or gcloud | General dev (recommended) |
| `stitch-mcp` | gcloud ADC | CI/automation, auto token refresh |

> Official Remote MCP requires hourly manual token refresh — not recommended.

---

## Setup: Method A — `@_davideast/stitch-mcp` (Recommended)

**1. Prerequisites:** Node.js 18+, gcloud CLI (optional for gcloud auth)

**2. Auth Setup:**
```bash
npx @_davideast/stitch-mcp init     # interactive: choose API Key, gcloud, or Access Token
npx @_davideast/stitch-mcp doctor   # verify setup
```

**3. Add to Claude Code:**
```bash
# API Key
claude mcp add stitch -e STITCH_API_KEY=your-key -- npx @_davideast/stitch-mcp proxy

# gcloud
claude mcp add stitch -e STITCH_USE_SYSTEM_GCLOUD=1 -- npx @_davideast/stitch-mcp proxy
```

Or edit `~/.claude.json`:
```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["@_davideast/stitch-mcp", "proxy"],
      "env": { "STITCH_API_KEY": "your-api-key" }
    }
  }
}
```

---

## Setup: Method B — `stitch-mcp` (gcloud ADC)

**1. gcloud Auth:**
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
gcloud beta services mcp enable stitch.googleapis.com
gcloud auth application-default login
```

**2. Add to Claude Code:**
```bash
claude mcp add stitch -e GOOGLE_CLOUD_PROJECT=your-project-id -- npx -y stitch-mcp
```

---

## Setup: Automated (Fastest)

```bash
npx -p stitch-mcp-auto stitch-mcp-auto-setup   # Claude Code + Gemini CLI + Codex CLI
```

---

## Available MCP Tools

### `@_davideast/stitch-mcp`
| Tool | Description |
|------|-------------|
| `build_site` | Map screens to routes, generate full site HTML |
| `get_screen_code` | Get screen HTML/CSS |
| `get_screen_image` | Get screen screenshot (base64) |

### `stitch-mcp` (9 tools)
| Tool | Description |
|------|-------------|
| `list_projects` / `get_project` / `create_project` | Project management |
| `list_screens` / `get_screen` | Screen listing/metadata |
| `fetch_screen_code` / `fetch_screen_image` | Get code or screenshot |
| `generate_screen_from_text` | Create screen from text prompt |
| `extract_design_context` | Extract fonts, colors, layout |

---

## CLI Commands (`@_davideast/stitch-mcp`)

```bash
npx @_davideast/stitch-mcp init                      # auth setup
npx @_davideast/stitch-mcp doctor                     # verify config
npx @_davideast/stitch-mcp logout                     # revoke auth
npx @_davideast/stitch-mcp screens -p <project-id>   # list screens
npx @_davideast/stitch-mcp serve -p <project-id>     # local preview (Vite)
npx @_davideast/stitch-mcp site -p <project-id>      # generate Astro project
npx @_davideast/stitch-mcp proxy                      # MCP proxy for Claude Code
```

---

## Verification

```bash
claude mcp list              # confirm stitch server present
claude mcp get stitch        # check config details
```
Restart Claude Code session to activate MCP tools.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `doctor` fails | Re-run `init` or check API Key |
| Token expired (A) | Re-run `init` |
| Token expired (B) | `gcloud auth application-default login` |
| Tools not visible | Restart Claude Code session |
| `stitch.googleapis.com` error | `gcloud beta services mcp enable stitch.googleapis.com` |
| Node.js version error | Install Node.js 18+ |

---

## Will
- Google Stitch MCP server setup guidance
- Auth method selection (API Key / gcloud ADC)
- CLI command execution support

## Will Not
- Store API keys or credentials in code/git
- Modify gcloud settings without user confirmation
- Delete Stitch project assets arbitrarily
