# QE MCP Setup

QE Framework operates standalone. MCP servers are optional integrations that
users connect per client when a workflow needs external tools.

Maintainer-only admin MCP:

```text
https://github.com/inho-team/qe-admin-mcp
```

This keeps `@inho-team/qe-framework` focused on skills, agents, hooks, scripts,
and local workflow orchestration while allowing maintainers to connect admin
MCP tooling separately.

## Install

Install QE Framework first. It provides the skills, agents, hooks, and Codex
assets:

```bash
claude plugin marketplace add inho-team/qe-framework
claude plugin install qe-framework@inho-team-qe-framework
```

General MCP servers are configured per client. Use `Qmcp setup` for service
setup guidance and `Qmcp ensure` to check whether the active client can see a
configured MCP server.

Admin workflow development:

```bash
git clone https://github.com/inho-team/qe-admin-mcp.git
cd qe-admin-mcp
npm run selftest
```

## Sync

Use `Qmcp sync` when the same named MCP server should be compared or configured
across Claude, Codex, Gemini, or another supported client. Always preview the
intended config change first and preserve unrelated MCP server entries.

Cross-engine QE execution is owned by the framework bridge layer
(`scripts/lib/codex_bridge.mjs`, `scripts/lib/claude_bridge.mjs`,
`Qclaude-rescue`, and SIVS config), not by MCP runner tools.

## Migration: Remove A Stale Legacy Registration

Older QE installs may still contain a `qeExpertLibrary` MCP server entry in
client config. QE Framework no longer repairs or depends on that entry. If the
server command no longer exists, remove only that stale entry and leave unrelated
MCP servers intact.

Claude:

1. Open `~/.claude.json`.
2. Find the MCP server object named `qeExpertLibrary`.
3. Remove that object only.
4. Save the file and restart Claude Code.

Codex:

1. Open `~/.codex/config.toml`.
2. Remove the full `[mcp_servers.qeExpertLibrary]` block.
3. Save the file and restart Codex.

To detect stale entries before editing:

```bash
grep -n "qeExpertLibrary" ~/.claude.json ~/.codex/config.toml 2>/dev/null || true
```

## Trust Boundary

- QE Framework does not require a default MCP server to load core skills.
- MCP servers are optional client integrations and should be trusted explicitly.
- Keep secrets out of client config; use environment variables or a secret
  manager.
- QE admin workflows are not default user skills. Maintainers install and
  connect `qe-admin-mcp` separately, then use `qe_admin_search_skills`,
  `qe_admin_read_skill`, and `qe_admin_prompt` to load release, bump,
  skill-test, audit, and migration guidance.
