---
name: Qclaude-rescue
description: "Delegate a SIVS claude-stage from a Codex session to the local Claude CLI (reverse of /codex:rescue). Use when a Codex base session must hand spec/verify/supervise work to Claude."
invocation_trigger: When a Codex base session must delegate a SIVS stage configured for Claude, or when reverse Claude delegation is needed.
recommendedModel: haiku
---

# Qclaude-rescue — Codex-to-Claude SIVS Stage Delegation

## Role
Acts as the base=codex counterpart of `/codex:rescue`. Invoke this skill inside a Codex session when a SIVS stage whose configured engine is `claude` must be delegated to the local Claude CLI.

## Routing Procedure
Resolve the configured engine for the current SIVS stage from the Codex base session:

```bash
BRIDGE="./scripts/lib/claude_bridge.mjs"; [ -f "$BRIDGE" ] || BRIDGE="$HOME/.codex/scripts/lib/claude_bridge.mjs"
node -e 'import(process.argv[1]).then(m => { const r = m.resolveReverseEngine(STAGE, m.loadSivsConfig()); console.log(JSON.stringify(r)); })' "$BRIDGE"
```

Branch on the resolved result:

- If `r.engine === 'claude'`: run `r.command` as a `claude -p` invocation, passing the task prompt as an argument, for example `claude -p "<prompt>"`.
- If `r.engine === 'codex'`: do NOT delegate. The Codex session handles the stage solo; print `r.warning` if present.

## Per-Stage Delegation Prompts
Pass the matching prompt to Claude for each delegated stage, mirroring `codex_bridge.mjs` `getCodexCommand` stage intent in reverse through `claude_bridge.mjs` `getClaudeCommand`:

- `spec` -> `Generate a SIVS spec for: <task>`
- `verify` -> `Validate the following output against VERIFY_CHECKLIST: <output>`
- `supervise` -> `Review the following for quality and correctness: <output>`

## Distinction from ask-claude (OMX)
`Qclaude-rescue` and `ask-claude` are separate skills with different names and roles. `Qclaude-rescue` is a QE skill for SIVS-stage-aware reverse delegation from Codex to Claude. `ask-claude` is an OMX skill for generic ad-hoc questions to Claude. They coexist without conflict. QE does NOT absorb or replace `ask-claude`.

## Base=Codex Routing Rule
When a Codex base session reaches a SIVS stage whose configured engine is 'claude', route that stage through Qclaude-rescue.

Physical installation into `~/.codex/skills` is handled by `installCodexAssets` in Phase 3.

## Security Note
Never interpolate untrusted task text into a shell string. Always pass it as a single argv to `claude -p`.
