---
name: Qclaude-rescue
description: Deprecated compatibility skill. SIVS no longer delegates between Claude and Codex.
user_invocable: false
recommendedModel: haiku
---

# Qclaude-rescue — Deprecated

SIVS uses one active AI client per session. This compatibility entrypoint must
not invoke Claude from Codex or Codex from Claude. Report the active-client
single-AI contract and continue the current stage with same-client subagents or
`mode=degraded-inline`.

Reference: `core/SIVS_SINGLE_AI_MODEL.md`.
