---
name: Qmcp-sync
description: 'Use the external qe-mcp package to sync QE expert-library MCP server definitions to Claude, Codex, and Gemini configs.'
invocation_trigger: When the user wants to unify MCP configuration across Claude, Codex, Gemini, or other QE-managed clients.
recommendedModel: haiku
---

# Qmcp-sync

## Role
Use the external `@inho-team/qe-mcp` package to manage QE expert-library MCP config.

The MCP server and large expert corpus are intentionally not shipped inside
`@inho-team/qe-framework`.

Before running any command below, invoke `{adapter.commandPrefix}Qmcp-ensure`. Continue
only after it returns `PASS`; `Qmcp-sync` is MCP-dependent by definition.

## Commands

### Initialize the global registry
```bash
qe-mcp init-registry
```

### Inspect paths and registry health
```bash
qe-mcp doctor
```

### Preview sync
```bash
qe-mcp sync --dry-run
```

### Apply sync
```bash
qe-mcp sync
```

### Sync one client only
```bash
qe-mcp sync --client codex
qe-mcp sync --client gemini
qe-mcp sync --client claude
```

## Registry Behavior

The default registry lives at:

```text
~/.qe/mcp/registry.json
```

If `qe-mcp` is not on `PATH`, use `{adapter.commandPrefix}Qmcp-ensure`; do not duplicate
install logic here.

The default external registry entry is `qeExpertLibrary`.

## Secret Handling

If a server needs credentials:
- do not store plaintext tokens in the client config
- store them with `Qsecret`
- reference them through `envSecrets` in the registry

Secret-backed launch for generic MCP servers is owned by the external MCP package when needed.

## Expected Behavior
- Use this skill when the user wants one MCP configuration source for Claude, Codex, and Gemini.
- Prefer the QE registry over editing three client config files by hand.
- Explain honestly that client behavior still differs even when the same server is synced to all three.
- Explain that QE's expert library is distributed by `inho-team/qe-mcp`; it is not restored into the default QE Framework skill catalog.
- Recommend `sync --dry-run` before applying MCP config changes, especially when a client has existing MCP servers.

## Will
- Keep the external MCP registry as the source of truth
- Sync shared config to supported clients
- Preserve the expert-library trust boundary: compact search by default, full expert reads only by explicit MCP call

## Will Not
- Claim all clients interpret prompts or tools identically
- Store plaintext secrets in the synced config files
- Auto-trust third-party or remote MCP servers
