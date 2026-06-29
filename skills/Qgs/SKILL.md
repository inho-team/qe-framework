---
name: Qgs
description: "Generate spec documents (TASK_REQUEST + VERIFY_CHECKLIST). Shortcut for Qgenerate-spec. PSE Chain Step 2: Spec. (Alias for Qgenerate-spec — all arguments passed through)"
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
1. Pass all arguments directly to `Qgenerate-spec`.
2. If the first token looks like a **plan slug** (`[a-z0-9][a-z0-9-]{0,63}` followed by `:`), Qgenerate-spec treats everything before the colon as the plan slug and reads `.qe/planning/plans/{slug}/ROADMAP.md` + `STATE.md` for that plan's active Phase.
3. Otherwise (no slug, no colon) Qgenerate-spec resolves the active plan automatically via `.qe/state/current-session.json` → `.qe/planning/.sessions/{session_id}.json` → `.qe/planning/ACTIVE_PLAN`, falling back to the flat `.qe/planning/ROADMAP.md` for legacy projects.

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
