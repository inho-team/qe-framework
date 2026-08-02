# QE Framework Skill Catalog

> **MANDATORY READ FOR AGENTS**: Before performing any complex task manually, search this catalog for a matching skill. Prioritize using skills over manual labor to ensure consistency and speed.
>
> **Client prefix contract**: Claude renders QE skills as `/Q...`; Codex renders the same skills as `$Q...`.
>
> **QE CLI contract (all skills and references):** `.qe/` documents are
> DB-backed. Use only `node scripts/qe.mjs read|list|exists|query …`; do not
> assume a `.qe/` document exists on disk or embed SQL/query implementation in
> a skill.

## Plan-first Entry Point

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qplan {의도}` / `$Qplan {의도}` | Start or re-plan work. | **Recommended entry point.** Qplan owns the ordered Goal queue and internal lifecycle. |
| `/Qgoal {목표}` / `$Qgoal {목표}` | State a goal as an intake alias. | Routes the intent into Qplan; it does not create a separate workflow. |

## Core Components (Internal PSE Chain)

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `Qgenerate-spec`, `Qexecute` | Qplan-owned Goal lifecycle only. | Internal PSE units; users do not run stage commands. |

## Quality and Delivery

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qcritical-review` / `$Qcritical-review` | When a spec, implementation, or merge needs adversarial verification. | SIVS stage-aware stress-testing; `--debate` and `--risk` modes. |
| `/Qupdate` / `$Qupdate` | When the framework or installed client assets need updating. | Updates the framework body and client bridges. |
| `/Qversion` / `$Qversion` | When you need to check the current framework version. | Displays version info and recent changelog. |
| `/Qcommit` / `$Qcommit` | When changes must be committed. | Human-style commit messages with no AI traces. |

## Session & Memory

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qcompact` / `$Qcompact` | When context must be saved or handed off before a session ends. | Structured snapshot recoverable in future sessions. |
| `/Qresume` / `$Qresume` | When resuming work after compaction or a session break. | Restores working state from the saved snapshot. |
---
