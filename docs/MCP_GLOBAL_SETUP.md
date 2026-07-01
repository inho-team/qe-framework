# QE MCP Setup

QE's expert-library MCP server is maintained outside this framework package:

```text
https://github.com/inho-team/qe-mcp
```

This keeps `@inho-team/qe-framework` installs small while allowing MCP-only
updates for optional expert guidance.

## Install

```bash
npm install -g @inho-team/qe-mcp
```

For local development:

```bash
git clone https://github.com/inho-team/qe-mcp.git
cd qe-mcp
npm run selftest
```

## Sync

Preview:

```bash
qe-mcp sync --dry-run
```

Apply to one client:

```bash
qe-mcp sync --client codex
qe-mcp sync --client claude
qe-mcp sync --client gemini
```

The external package registers `qeExpertLibrary`, not an in-framework MCP
server. It exposes compact expert search and explicit full-read tools such as:

- `qe_search_experts`
- `qe_recommend_expert`
- `qe_read_expert`
- `qe_read_methodology`
- `qe_expert_prompt`

## Trust Boundary

- QE Framework no longer ships the large expert corpus.
- The external `qe-mcp` package owns expert-library packaging, registry sync,
  selftests, and MCP server updates.
- Expert reads are explicit; search and recommendation stay compact by default.
- Treat migrated expert records as guidance and verify current APIs before
  implementation.
