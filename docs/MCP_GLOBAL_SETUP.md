# MCP Setup Boundary

QE no longer exposes an MCP-management skill. Configure MCP servers with the active client's native configuration and permission model. Keep secrets in the client's supported secret store or environment integration; do not commit credentials to QE state.

QE's shipped lifecycle and routing behavior does not require a global MCP server. Optional external servers must be treated as client-owned integrations and verified independently in Claude and Codex.

Framework release metadata is managed with `npm run qe:release -- bump <semver>`. Version lookup remains available through `Qversion`.
