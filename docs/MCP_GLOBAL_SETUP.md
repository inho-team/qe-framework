# QE MCP Setup

QE's optional MCP servers are maintained outside this framework package.

Expert-library MCP:

```text
https://github.com/inho-team/qe-mcp
```

Maintainer-only admin MCP:

```text
https://github.com/inho-team/qe-admin-mcp
```

This keeps `@inho-team/qe-framework` installs small while allowing MCP-only
updates for optional expert guidance and maintainer-only admin workflows.

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

Admin workflow development:

```bash
git clone https://github.com/inho-team/qe-admin-mcp.git
cd qe-admin-mcp
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
- QE admin workflows are not default user skills. Maintainers connect
  `qe-admin-mcp` and use `qe_admin_search_skills`, `qe_admin_read_skill`, and
  `qe_admin_prompt` to load release, bump, skill-test, audit, and migration
  guidance.
