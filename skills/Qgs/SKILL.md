---
name: Qgs
description: "Use when a Qplan handoff or routed goal needs TASK_REQUEST + VERIFY_CHECKLIST generation — router-owned internal PSE alias for Qgenerate-spec. Use Qgoal to enter; use Qexecute after specs exist."
user_invocable: false
recommendedModel: haiku
tier: core
---

> **`.qe` reads → DB:** `.qe/` content is stored in the SQLite store (`qe_files`), so a path may have **no file on disk**. Read `.qe/` content with `node scripts/qe-cat.mjs <path>` (or `--ls`/`--exists`) and structured state with `node scripts/qe-query.mjs …` — do not assume the raw file exists. See `QE_CONVENTIONS.md`.

# Qgs — Spec Generation (PSE Chain Step 2)

> Internal PSE unit. Users start work with `{adapter.commandPrefix}Qgoal {목표}`; `user_invocable` is catalog/documentation metadata only. Runtime enforcement is the G010 PreToolUse gate. Router handoffs retain their explicit next command.

This is the canonical shortcut for `Qgenerate-spec`.

## Client Adapter Compatibility

`Qgs` is the same skill regardless of client; only the user-visible command
prefix changes.

- Claude handoff/rendering: `/Qgs ...`
- Codex handoff/rendering: `$Qgs ...`

Pass arguments through unchanged after the active client has resolved the skill
invocation.

## Behavior
1. Invoke `{adapter.commandPrefix}Qmcp ensure` before spec generation only when the spec depends on a user-requested MCP server (see `Qgenerate-spec` → Optional MCP Preflight).
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
/Qgs <회의록/요구사항 원문 붙여넣기>   # Context dump — 비정형 덤프 수용, AI가 부족한 컨텍스트를 역질문
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
