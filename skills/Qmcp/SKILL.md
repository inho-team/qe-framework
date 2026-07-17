---
name: Qmcp
description: Unified MCP operations for QE: check MCP client/server status, guide MCP server setup, and synchronize generic MCP config across supported clients.
user_invocable: true
allowed-tools: "Bash(command:*), Bash(node:*), Bash(claude mcp:*), Bash(test:*), Bash(sed:*)"
invocation_trigger: When the user wants MCP preflight, MCP server setup guidance, or MCP config sync across Claude, Codex, Gemini, or QE-managed clients.
recommendedModel: haiku
---

# Qmcp - MCP Operations

## Role
Unified entry point for local MCP configuration, setup, and diagnostics.

Use:

```text
Qmcp <ensure|setup|sync> [args]
```

The original skills (`Qmcp-ensure`, `Qmcp-setup`, `Qmcp-sync`) remain valid for
backward compatibility. This skill adds the consolidated command surface only.

## Subcommands

| Subcommand | Use when | Details |
|------------|----------|---------|
| `Qmcp ensure` | A workflow needs to know whether MCP client config and server commands are usable. | [reference/ensure.md](reference/ensure.md) |
| `Qmcp setup [service]` | The user wants to connect or configure an MCP server for an external service. This is guidance only; use connected MCP tools for service operations. | [reference/setup.md](reference/setup.md) |
| `Qmcp sync [--dry-run|--client <name>]` | The user wants MCP server config compared or synchronized across Claude, Codex, Gemini, or another supported client. | [reference/sync.md](reference/sync.md) |

## Entry Conditions

### `ensure`
- Run before MCP-dependent workflows or before changing MCP client config.
- Treat `PASS` as usable, `WARN` as optional/degraded, and `FAIL` as a blocker
  for claims that the active MCP server is usable.

### `setup`
- Use for setup requests such as "connect GitHub MCP" or "set up Google Drive".
- First check whether the server is already connected in the active client.
- For Claude, `claude mcp` commands are acceptable; for Codex or other clients,
  use their native MCP config surface or provide a manual config block.

### `sync`
- Use for comparing or updating named MCP server entries across supported
  client configs.
- Prefer a dry-run report before applying changes.
- Preserve unrelated MCP servers and never write plaintext secrets.

## Dispatch Rules

1. If no subcommand is provided, ask the user to choose `ensure`, `setup`, or
   `sync`.
2. Do not duplicate detailed procedures in this file; follow the linked
   reference for the selected subcommand.
3. Keep behavior compatible with the original standalone skills while they
   coexist.

## Will
- Route MCP configuration health checks to `ensure`
- Route MCP server configuration guidance to `setup`
- Route client config comparison and synchronization guidance to `sync`

## Will Not
- Delete or replace legacy MCP skills
- Store plaintext credentials in code or git-tracked files
- Claim all clients expose identical MCP behavior
