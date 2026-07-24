# QE MCP Setup

QE Framework operates standalone. MCP servers are optional integrations that
users connect per client when a workflow needs external tools. Framework release
administration is local: `Qrelease` performs mutations and `Qversion` performs
read-only version lookup.

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

## Release and version paths

- Use `Qrelease` for version bump, changelog update, release commit, tag, optional
  push, and optional GitHub Release. Remote publication requires the confirmations
  defined by the skill.
- Use `Qversion` only to inspect the current version; it never mutates release state.
- Run `npm run eval:skills` when a deterministic skill manifest is needed. If a
  behavioral judgment is required, delegate it manually to `Qcritical-review` and
  record the result; there is no automatic external skill-test service.

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

## Manual audit and migration procedure

Audit and migration work is intentionally handled as a documented manual procedure:

1. State the scope, preconditions, and expected outcome in the task spec.
2. List the exact files or records in scope and establish a backup or rollback point.
3. Write and review the ordered mutation steps before executing them.
4. Inspect the resulting diff or configuration delta and run the repository's
   existing targeted validators.
5. Record validation evidence, residual risks, and exact rollback instructions.

Do not assume a replacement admin service or invent a command that the repository
does not provide.

## Trust Boundary

- QE Framework does not require a default MCP server to load core skills.
- MCP servers are optional client integrations and should be trusted explicitly.
- Keep secrets out of client config; use environment variables or a secret
  manager.
- Release mutation stays inside the reviewed `Qrelease` skill; `Qversion` is
  read-only. Audit and migration use the documented manual procedure above.
