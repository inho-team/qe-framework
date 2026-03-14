---
name: Qmcp-builder
description: "MCP(Model Context Protocol) 서버 생성 가이드. Python(FastMCP) 또는 TypeScript(MCP SDK)로 LLM이 외부 서비스와 상호작용하는 MCP 서버를 빌드할 때 사용."
metadata:
  source: https://skills.sh/anthropics/skills/mcp-builder
  author: anthropic
---

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

## References
- TypeScript SDK: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
