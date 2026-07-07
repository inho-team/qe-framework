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

Install QE Framework first. It provides the skills, agents, hooks, and Codex
assets:

```bash
claude plugin marketplace add inho-team/qe-framework
claude plugin install qe-framework@inho-team-qe-framework
```

Then install the normal user-facing MCP companion:

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
qe-mcp sync --dry-run --client claude
qe-mcp sync --dry-run --client codex
```

Apply to one client:

```bash
qe-mcp sync --client codex
qe-mcp sync --client claude
qe-mcp sync --client gemini
```

The external package registers `qeExpertLibrary`, not an in-framework MCP
server. `qe-framework` and `qe-mcp` are expected to run together: the framework
owns workflow orchestration, while `qe-mcp` owns the external expert corpus and
cross-agent runner tools. Without `qe-mcp`, core QE skills still load, but MCP
expert lookup and MCP runner tools are unavailable.

The user-facing MCP exposes compact expert search, explicit full-read tools, and
active cross-agent runner tools such as:

- `qe_search_experts`
- `qe_recommend_expert`
- `qe_read_expert`
- `qe_read_methodology`
- `qe_run_codex_agent`
- `qe_run_claude_agent`
- `qe_run_openai_compat_agent` (experiment-only, env-gated)
- `qe_cross_agent_help`
- `qe_delegate_agent`

After syncing, restart Claude Code or Codex and verify with:

```bash
qe-mcp doctor
qe-mcp-server
```

## Trust Boundary

- QE Framework no longer ships the large expert corpus.
- The external `qe-mcp` package owns expert-library packaging, registry sync,
  selftests, and MCP server updates.
- Expert reads are explicit; search and recommendation stay compact by default.
- Treat migrated expert records as guidance and verify current APIs before
  implementation.
- QE admin workflows are not default user skills. Maintainers install and
  connect `qe-admin-mcp` separately, then use `qe_admin_search_skills`,
  `qe_admin_read_skill`, and `qe_admin_prompt` to load release, bump,
  skill-test, audit, and migration guidance.
