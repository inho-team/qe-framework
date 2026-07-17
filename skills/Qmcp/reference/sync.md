---
source-skill: Qmcp-sync
subcommand: Qmcp sync
---

# Qmcp sync

## Role
Guide safe synchronization of MCP server configuration across supported clients.
This subcommand is now a generic MCP config workflow: it compares desired server
entries with client config files, previews changes, and tells the user how to
apply them. It does not depend on an external QE expert-library registry.

## When To Use

Use `Qmcp sync` when:

- The same MCP server should be available in more than one client.
- A user wants a dry-run before editing MCP client config.
- Existing client config needs to be normalized after a server command or path
  changed.
- A stale MCP entry should be removed consistently from multiple clients.

Run `Qmcp ensure` first when the current state is unknown.

## Inputs

Collect or infer:

- Server name
- Server command
- Server args
- Required environment variable names
- Target clients: Claude, Codex, Gemini, or another explicitly named client
- Dry-run vs apply intent

If any command or secret handling is ambiguous, stop at dry-run guidance.

## Dry-Run Procedure

1. Read the target client config files.
2. Parse JSON configs with a JSON parser; avoid ad hoc string edits.
3. For TOML configs, preserve unrelated sections and show the intended MCP
   server block.
4. Compare by server name and command.
5. Report additions, updates, removals, and conflicts without changing files.

Suggested report:

```text
Qmcp sync --dry-run
- Claude: add|update|remove|unchanged|not installed
- Codex: add|update|remove|unchanged|not installed
- Gemini: add|update|remove|unchanged|not installed
- Secrets: env var names only
- Apply: {client-native command or exact file/section to edit}
```

## Apply Procedure

Only apply changes when the user explicitly asks for it and the target entries
are unambiguous.

Rules:

- Preserve unrelated MCP servers.
- Preserve comments and formatting where the client format allows it.
- Back up the original config or present the exact diff before overwriting.
- Never write plaintext secrets.
- Prefer client-native commands when available.

For Claude, `claude mcp add` / `claude mcp remove` may be used when it matches
the requested change. For Codex and Gemini, use their current config schema and
modify only the named server entry.

## Secret Handling

If a server needs credentials:

- Store token values outside git-tracked files.
- Put only environment variable names in MCP config.
- Use `Qsecret` when the user wants QE-managed secret storage guidance.
- Never echo secret values in the final report.

## Deprecated Behavior

Older QE installations used a dedicated expert-library registry and package
sync command. That coupling has been removed from the core framework. If a user
still has an old server entry, treat it as a stale generic MCP registration:
identify the client config file, show the entry name, and instruct the user to
remove or replace that entry.

## Will
- Preview and guide MCP config synchronization across clients
- Keep unrelated MCP servers intact
- Handle stale entries as explicit config cleanup
- Explain client-specific differences

## Will Not
- Depend on a QE-owned external registry
- Auto-trust third-party or remote MCP servers
- Store plaintext secrets in config files
- Claim all clients expose identical tool behavior
