---
name: Qmcp-builder
description: "MCP (Model Context Protocol) server creation guide. Use when building MCP servers that allow LLMs to interact with external services using Python (FastMCP) or TypeScript (MCP SDK)."
metadata:
  source: https://skills.sh/anthropics/skills/mcp-builder
  author: anthropic
---
> Shared principles: see core/PRINCIPLES.md


# MCP Server Development Guide

## Workflow

### Phase 1: Research & Planning
- Study MCP docs: `https://modelcontextprotocol.io/sitemap.xml`
- Recommended: TypeScript + Streamable HTTP (remote) or stdio (local)
- Plan API coverage vs workflow tools

### Phase 2: Implementation
- Input Schema: Zod(TS) / Pydantic(Python)
- Output Schema: `outputSchema` + `structuredContent`
- Annotations: readOnlyHint, destructiveHint, idempotentHint

### Phase 3: Review & Test
- No duplicated code (DRY)
- Consistent error handling
- Test: `npx @modelcontextprotocol/inspector`

### Phase 4: Evaluations
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

## References
- TypeScript SDK: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
