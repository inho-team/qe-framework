---
source-skill: Qmcp-ensure
subcommand: Qmcp ensure
---

# Qmcp ensure - MCP Configuration Health Check

## Role
Check whether the current environment has usable MCP client configuration and
report clear next steps. This subcommand is a diagnostic preflight for general
MCP server setup; it does not install an external QE expert library and does not
run package-specific registry repair commands.

Use it when a workflow depends on MCP tools, when a user asks whether MCP is
configured correctly, or before editing client MCP config.

## Scope

`Qmcp ensure` verifies local configuration surfaces:

- Claude global config: `~/.claude.json`
- Codex config: `~/.codex/config.toml`
- Gemini config: `~/.gemini/settings.json`
- Project-local setup notes under `.qe/` or `docs/`, when present
- Whether the requested MCP server command appears to exist on `PATH`

It treats missing optional clients as `WARN`, not `FAIL`. It fails only when the
active client or the requested server is clearly misconfigured.

## Execution Procedure

### Step 1: Identify the target

If the user named a service or server, use that as the target. Otherwise inspect
the active client and report general MCP readiness.

Ask for clarification only when applying changes would be ambiguous. Read-only
checks can proceed with the current working directory and home-directory config
files.

### Step 2: Inspect client config files

Use read-only checks first:

```bash
test -f ~/.claude.json && node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude.json', 'utf8')); console.log('claude config: json ok')" || true
test -f ~/.codex/config.toml && sed -n '/^\[mcp_servers\./,/^\[/p' ~/.codex/config.toml || true
test -f ~/.gemini/settings.json && node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.gemini/settings.json', 'utf8')); console.log('gemini config: json ok')" || true
```

Report:

- `PASS` when the active client has the requested server configured and the
  referenced command is available.
- `WARN` when no MCP servers are configured, an optional client is missing, or a
  referenced command cannot be checked from the current shell.
- `FAIL` when the active client's config is unreadable, invalid JSON/TOML, or
  points at a command that is definitely missing.

### Step 3: Validate server command shape

For each configured server, inspect command and args without exposing secrets:

- Command should be absolute or resolvable through `command -v`.
- Arguments should not contain plaintext tokens, passwords, or API keys.
- Secrets should be passed through environment variables or the user's secret
  manager, not hardcoded config values.
- Server names should be stable and service-specific.

Do not print environment variable values. It is safe to print variable names.

### Step 4: Recommend repair

Prefer client-native setup commands when they exist. For Claude, use
`claude mcp` commands. For Codex, edit `~/.codex/config.toml` according to the
client's MCP server schema. For Gemini, edit `~/.gemini/settings.json` according
to Gemini's MCP configuration schema.

If a stale server entry references a command that no longer exists, recommend
removing or updating only that entry. Do not delete unrelated MCP servers.

### Step 5: Report a compact result

Use this shape:

```text
Qmcp ensure: PASS|WARN|FAIL
- Active client: {claude|codex|gemini|unknown}
- Checked configs: {list}
- MCP servers found: {count or names}
- Issues: {none|summary}
- Next action: {specific command or config edit}
```

## Will
- Check MCP configuration files without assuming a QE-owned MCP server
- Validate command availability and config readability
- Identify stale or dangling MCP server entries
- Provide client-specific repair guidance

## Will Not
- Install external expert libraries
- Run package-specific registry sync or repair commands
- Use `sudo`
- Delete MCP config automatically
- Print secret values
