# QE Framework Skill Catalog

> **MANDATORY READ FOR AGENTS**: Before performing any complex task manually, search this catalog for a matching skill. Prioritize using skills over manual labor to ensure consistency and speed.
>
> **Client prefix contract**: Claude renders QE skills as `/Q...`; Codex renders the same skills as `$Q...`.

## Plan-first Entry Point

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qplan {의도}` / `$Qplan {의도}` | Start or re-plan work. | **Recommended entry point.** Qplan owns the ordered Goal queue and internal lifecycle. |
| `/Qgoal {목표}` / `$Qgoal {목표}` | State a goal as an intake alias. | Routes the intent into Qplan; it does not create a separate workflow. |

## Core Components (Internal PSE Chain)

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `Qgs`/`Qgenerate-spec`, `Qexecute`, `Qrt` | Qplan-owned Goal lifecycle only. | Internal PSE units; users do not run stage commands. |

## Specialized Quality & Debugging

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qcritical-review` | When a spec, implementation, or merge needs adversarial verification. | SIVS stage-aware stress-testing; `--debate` (multi-round debate) and `--risk` (evidence-backed risk proof) modes. |
| `/Qverify-contract` | When an implementation must be checked against a business-logic contract. | Cached PASS/FAIL verdict via the Econtract-judge agent. |
| `/Qqa` | When QA planning, scenario/E2E runs, or the multi-agent QA council is needed. | `plan` · `run` · `council` modes: explore (black-box) → codify → heal → report. |
| `/Qgc` | When codebase needs quality audit or cleanup. | Scans for doc-code drift, rule violations, dead code. Auto-fixes simple issues. |

## Management & Automation

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qcontext` | When managing folder-aware context memory (create, refresh, status). | Optimizes Claude's context window by loading only relevant folder context. |
| `/Qinit` | When starting a new project or initializing the QE framework. | Sets up directory structure, conventions, and core configuration. |
| `/Qcollect-skill` | When project-local stack guidance should be collected or refreshed. | Creates verified `.claude/skills/` guidance with TTL and user-edit protection. |
| `/Qmcp sync` | When MCP settings should be compared or shared across Claude, Codex, and Gemini. | Previews and guides named MCP server config changes while preserving unrelated servers. |
| `/Qmcp ensure` / `$Qmcp ensure` | When a workflow needs to check MCP client/server status before using tools. | Checks MCP config readability, server command availability, and stale registrations. |
| `/Qsecret` | When API keys or tokens must be stored or used safely. | Keeps plaintext secrets out of the repo while supporting secure env injection. |
| `/Qissue` | When the user wants to file a bug report, feature request, or question against the qe-framework repo. | Single-command issue filing via `gh` CLI with one-time PAT onboarding. |
| `/Qupdate` | When the QE framework, its Codex assets, or the codex-plugin-cc bridge need updating. | One command: updates the framework body (Claude + Codex) and checks/updates the codex-plugin-cc bridge. |
| `/Qmistake` | When user points out a mistake or corrects behavior. | Records to .qe/MISTAKE.md, loaded every session start. |
| `/Qversion` | When you need to check the current framework version. | Displays version info and recent changelog. |
| `/Qsivs-config` | When you need to view or change SIVS active-client model/effort settings. | CLI-style single-AI role config manager for `.qe/sivs-config.json`. |
| `/Qgc archive` | When a task is completed and needs to be archived. | Moves files to archive and cleans up temporary state. |
| `/Qhelp` | When you need the QE catalog overview or a skill summary. | Full catalog or per-skill summary in the user's language. |
| `/Qdoctor` | When QE installation or `.qe/` state looks broken. | Diagnoses and repairs framework, companion, and project-state health. |
| `/Qcommit` | When changes must be committed. | Human-style commit messages with no AI traces. |
| `/Qclaude-rescue` | When a Codex session must hand spec/verify/supervise work to Claude. | Reverse of `/codex:rescue` via the local Claude CLI. |

## Session & Memory

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qcompact` | When context must be saved or handed off before a session ends. | Structured snapshot recoverable in future sessions. |
| `/Qresume` | When resuming work after compaction or a session break. | Restores working state from the saved snapshot. |
| `/Qsummary` | When wrapping up a session or asked for a work recap. | Dense What/Why/Next digest in five lines or fewer; report-only. |
| `/Qmemory` | When conventions, gotchas, or decisions should persist across sessions. | Project memory with TTL management. |
| `/Qlearn` | When lessons from failures should be recalled in later sessions. | Time-decay-ranked learnings injected at session start. |
| `/Qshadow` | When the working tree needs checkpoints without touching real git. | Isolated shadow-git snapshots: create, diff, restore, prune. |
| `/Qrefresh` | When `.qe/analysis` data is stale. | Re-analyzes project state in one pass. |

## Documentation & Research

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qautoresearch` | When deep domain knowledge or external API research is needed. | Automates technical research and summarizes findings. |
| `/Qcollect-skill` | When a project needs local coding guidance for its detected stack. | Uses Edeep-researcher evidence and stores generated local skills outside the framework payload. |
---
