---
name: Qgs
description: "Use when the user invokes Qgs or a Qplan handoff needs TASK_REQUEST + VERIFY_CHECKLIST generation. Alias for Qgenerate-spec. Use Qplan for roadmap; use Qexecute after specs exist."
user_invocable: true
invocation_trigger: "When the user wants to generate a spec, create a task, or types /Qgs on Claude or $Qgs on Codex. Also triggered from PSE Chain handoffs after Qplan."
recommendedModel: haiku
tier: core
---

# Qgs — Spec Generation (PSE Chain Step 2)

This is the canonical shortcut for `Qgenerate-spec`.

## Client Adapter Compatibility

`Qgs` is the same skill regardless of client; only the user-visible command
prefix changes.

- Claude handoff/rendering: `/Qgs ...`
- Codex handoff/rendering: `$Qgs ...`

Pass arguments through unchanged after the active client has resolved the skill
invocation.

## Behavior
1. Invoke `{adapter.commandPrefix}Qmcp ensure` before spec generation when MCP-backed expert lookup or cross-agent runner help may be used.
2. Pass all arguments directly to `Qgenerate-spec`.
3. If the first token looks like a **plan slug** (`[a-z0-9][a-z0-9-]{0,63}` followed by `:`), Qgenerate-spec treats everything before the colon as the plan slug and reads `.qe/planning/plans/{slug}/ROADMAP.md` + `STATE.md` for that plan's active Phase.
4. Otherwise (no slug, no colon) Qgenerate-spec resolves the active plan automatically via `.qe/state/current-session.json` → `.qe/planning/.sessions/{session_id}.json` → `.qe/planning/ACTIVE_PLAN`, falling back to the flat `.qe/planning/ROADMAP.md` for legacy projects.

## Usage Examples
Claude:
```
/Qgs                              # Interactive — asks for project info
/Qgs auth-refactor: 인증 모듈     # Slug-based — reads plans/auth-refactor/
/Qgs dashboard-v2: Polish         # Another plan in parallel — no collision
/Qgs fix login bug                # Freeform — generates spec from description
```

Codex:
```
$Qgs                              # Interactive — asks for project info
$Qgs auth-refactor: 인증 모듈     # Slug-based — reads plans/auth-refactor/
$Qgs dashboard-v2: Polish         # Another plan in parallel — no collision
$Qgs codex-native-parity: Skill Compatibility
```

> **Legacy**: `/Qgs Phase 2: Codex Bridge` on Claude, or `$Qgs Phase 2: Codex Bridge` on Codex, still works against the flat `.qe/planning/ROADMAP.md` for projects that pre-date Named Plans. New projects always use slug form.

## Implementation
Invoke the `Qgenerate-spec` skill with the user's full argument string. Do not modify or interpret the arguments — pass them through as-is.
