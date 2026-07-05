---
name: Qmcp
description: Unified MCP operations for QE: ensure the external qe-mcp companion, guide MCP server setup, and sync QE-managed MCP registry entries across supported clients.
user_invocable: true
allowed-tools: "Bash(command:*), Bash(npm:*), Bash(qe-mcp:*)"
invocation_trigger: When the user wants MCP preflight, MCP server setup guidance, or MCP config sync across Claude, Codex, Gemini, or QE-managed clients.
recommendedModel: haiku
---

# Qmcp - MCP Operations

## Role
Unified entry point for QE MCP companion and MCP setup workflows.

Use:

```text
Qmcp <ensure|setup|sync> [args]
```

The original skills (`Qmcp-ensure`, `Qmcp-setup`, `Qmcp-sync`) remain valid for
backward compatibility. This skill adds the consolidated command surface only.

## Subcommands

| Subcommand | Use when | Details |
|------------|----------|---------|
| `Qmcp ensure` | A QE workflow needs the external `@inho-team/qe-mcp` companion before MCP-backed expert lookup, registry sync, or runner tools. | [reference/ensure.md](reference/ensure.md) |
| `Qmcp setup [service]` | The user wants to connect or configure an MCP server for an external service. This is guidance only; use connected MCP tools for service operations. | [reference/setup.md](reference/setup.md) |
| `Qmcp sync [--dry-run|--client <name>]` | The user wants QE-managed MCP config unified across Claude, Codex, Gemini, or another supported client. Requires `Qmcp ensure` PASS first. | [reference/sync.md](reference/sync.md) |

## Entry Conditions

### `ensure`
- Run before MCP-dependent QE workflows such as `Qupdate`, `Qplan`, `Qgs`, or
  `Qmcp sync`.
- Skip only when the task is explicitly offline/no-install or does not need MCP.
- Treat `PASS` as usable, `WARN` as optional/degraded, and `FAIL` as a blocker
  for MCP-dependent claims.

### `setup`
- Use for setup requests such as "connect GitHub MCP" or "set up Google Drive".
- First check whether the server is already connected in the active client.
- For Claude, `claude mcp` commands are acceptable; for Codex or other clients,
  use their native MCP config surface or provide a manual config block.

### `sync`
- Use for syncing QE registry entries to supported client configs.
- Invoke `Qmcp ensure` first and continue only after `PASS`.
- Prefer `qe-mcp sync --dry-run` before applying changes.

## Dispatch Rules

1. If no subcommand is provided, ask the user to choose `ensure`, `setup`, or
   `sync`.
2. Do not duplicate detailed procedures in this file; follow the linked
   reference for the selected subcommand.
3. Keep behavior compatible with the original standalone skills while they
   coexist.

## Will
- Route MCP companion preflight to `ensure`
- Route MCP server configuration guidance to `setup`
- Route QE registry/client sync work to `sync`

## Will Not
- Delete or replace legacy MCP skills
- Store plaintext credentials in code or git-tracked files
- Claim all clients expose identical MCP behavior
