# QE Framework Skill Catalog

> **MANDATORY READ FOR AGENTS**: Before performing any complex task manually, search this catalog for a matching skill. Prioritize using skills over manual labor to ensure consistency and speed.
>
> **Client prefix contract**: Claude renders QE skills as `/Q...`; Codex renders the same skills as `$Q...`.

## Master Orchestrator (Primary Entry Point)

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qplan` / `$Qplan` | When starting any project or milestone. | **Master entry point.** Manages the Plan-Spec-Execute (PSE) Loop. |

## Core Components (Internal PSE Chain)

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qgs` / `$Qgs` | Alias for `Qgenerate-spec`. | Generates Haiku-Ready atomic specs. |
| `/Qatomic-run` / `$Qatomic-run` | When a TASK_REQUEST contains atomic items. | High-speed Haiku Wave execution. |
| `/Qrt` / `$Qrt` | Alias for `Qrun-task`. | Standard task execution engine. |

## Specialized Quality & Debugging

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qdebate` | When the user wants to debate tradeoffs with opposing agents or Codex. | Multi-round structured debate (agent-vs-agent, codex-vs-claude, self-debate). |
| `/Qsource-verifier` | When you need to verify if source code matches the provided specs. | Deep integrity check between implementation and TASK_REQUEST. |
| `/Qqa-council` | When you want a role-separated multi-agent QA loop over a live app, or a PR-triggered QA bot. | Explore (black-box) → codify → heal → report, with bounded agents and optional GitHub Actions scaffold. |
| `/Qgc` | When codebase needs quality audit or cleanup. | Scans for doc-code drift, rule violations, dead code. Auto-fixes simple issues. |

## Management & Automation

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qutopia` / `$Qutopia` | When you want to enable fully autonomous execution mode. | Switches framework to ultra-mode (auto-approvals, auto-remediation). |
| `/Qplan` | When a multi-phase project roadmap or high-level strategic planning is needed. | Manages PROJECT.md, ROADMAP.md and phases within .qe/planning/. |
| `/Qcontext` | When managing folder-aware context memory (create, refresh, status). | Optimizes Claude's context window by loading only relevant folder context. |
| `/Qinit` | When starting a new project or initializing the QE framework. | Sets up directory structure, conventions, and core configuration. |
| `/Qmcp sync` | When MCP settings should be shared across Claude, Codex, and Gemini. | Keeps one QE-managed MCP registry and syncs clients from it. |
| `/Qmcp ensure` / `$Qmcp ensure` | When a QE skill needs the external qe-mcp companion before using expert lookup or runner tools. | Installs missing `@inho-team/qe-mcp`, initializes the registry, and verifies health. |
| `/Qsecret` | When API keys or tokens must be stored or used safely. | Keeps plaintext secrets out of the repo while supporting secure env injection. |
| `/Qissue` | When the user wants to file a bug report, feature request, or question against the qe-framework repo. | Single-command issue filing via `gh` CLI with one-time PAT onboarding. |
| `/Quser-action` / `$Quser-action` | When Claude or Codex needs the user to perform an external action. | Creates durable `.qe/user-actions/` requests for hook trust, login, 2FA, secrets entry, console work, or acceptance checks. |
| `/Qupdate` | When the QE framework, its Codex assets, or the codex-plugin-cc bridge need updating. | One command: updates the framework body (Claude + Codex) and checks/updates the codex-plugin-cc bridge. |
| `/Qmistake` | When user points out a mistake or corrects behavior. | Records to .qe/MISTAKE.md, loaded every session start. |
| `/Qversion` | When you need to check the current framework version. | Displays version info and recent changelog. |
| `/Qsivs-config` | When you need to view or change SIVS engine routing (claude/codex per stage). | CLI-style config manager for `.qe/sivs-config.json`. |
| `/Qgc archive` | When a task is completed and needs to be archived. | Moves files to archive and cleans up temporary state. |

## Design & Frontend

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|

## Documentation & Research

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qautoresearch` | When deep domain knowledge or external API research is needed. | Automates technical research and summarizes findings. |
| `/Qwriting-clearly` | When documentation or reports need to be more concise and clear, or when text sounds robotic or AI-like. | Improves readability, removes AI writing patterns (Strunk + AI pattern removal). |

---
