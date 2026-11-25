---
type: llm
focus: last_message
---

Context: the user chose "subagent" only as the handoff method (who writes the plan). The execution method (per-step fresh implementer and reviewer subagents, versus building it directly in one session and verifying once at the end) has not been chosen yet.
PASS if the reply presents the plan for approval and asks the user to choose the execution method, naming both options (optionally with a recommendation).
FAIL if the reply does not ask about the execution method, or treats the earlier "subagent" handoff answer as having already chosen it (for example "you chose subagents, so each step will be done by a subagent").
