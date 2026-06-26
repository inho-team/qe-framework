# QE Framework Skill Catalog

> **MANDATORY READ FOR AGENTS**: Before performing any complex task manually, search this catalog for a matching skill. Prioritize using skills over manual labor to ensure consistency and speed.

## Master Orchestrator (Primary Entry Point)

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qplan` | When starting any project or milestone. | **Master entry point.** Manages the Plan-Spec-Execute (PSE) Loop. |

## Core Components (Internal PSE Chain)

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qgs` | Alias for `/Qgenerate-spec`. | Generates Haiku-Ready atomic specs. |
| `/Qatomic-run` | When a TASK_REQUEST contains atomic items. | High-speed Haiku Wave execution. |
| `/Qrt` | Alias for `/Qrun-task`. | Standard task execution engine. |
| `/Qsummary` | When work summary is needed. | High-density status reporting. |

## Specialized Quality & Debugging

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qdebate` | When the user wants to debate tradeoffs with opposing agents or Codex. | Multi-round structured debate (agent-vs-agent, codex-vs-claude, self-debate). |
| `/Qperspective` | When the user needs multiple viewpoints on a problem before deciding. | Parallel multi-perspective analysis (dev, PM, user, security, ops, codex). |
| `/Qsystematic-debugging` | When a bug is reported or a test fails repeatedly. | Applies scientific method to isolate and fix root causes. |
| `/Qtest-driven-development` | When starting a new feature that requires robust testing. | Implements TDD workflow (Red-Green-Refactor). |
| `/Qsource-verifier` | When you need to verify if source code matches the provided specs. | Deep integrity check between implementation and TASK_REQUEST. |
| `/Qvisual-qa` | When UI/Frontend changes need verification. | Uses screenshots and visual analysis to find regressions. |
| `/Qqa-council` | When you want a role-separated multi-agent QA loop over a live app, or a PR-triggered QA bot. | Explore (black-box) → codify → heal → report, with bounded agents and optional GitHub Actions scaffold. |
| `/Qsecurity-officer` | When security-sensitive code (auth, crypto) is modified. | Specialized security audit and vulnerability detection. |
| `/Qgc` | When codebase needs quality audit or cleanup. | Scans for doc-code drift, rule violations, dead code. Auto-fixes simple issues. |

## Management & Automation

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qutopia` | When you want to enable fully autonomous execution mode. | Switches framework to ultra-mode (auto-approvals, auto-remediation). |
| `/Qplan` | When a multi-phase project roadmap or high-level strategic planning is needed. | Manages PROJECT.md, ROADMAP.md and phases within .qe/planning/. |
| `/Qcontext` | When managing folder-aware context memory (create, refresh, status). | Optimizes Claude's context window by loading only relevant folder context. |
| `/Qinit` | When starting a new project or initializing the QE framework. | Sets up directory structure, conventions, and core configuration. |
| `/Qmap-codebase` | When onboarding to an existing project or starting work on unfamiliar code. | Spawns 4 parallel agents to map stack, architecture, quality, and concerns. |
| `/Qmcp-sync` | When MCP settings should be shared across Claude, Codex, and Gemini. | Keeps one QE-managed MCP registry and syncs clients from it. |
| `/Qsecret` | When API keys or tokens must be stored or used safely. | Keeps plaintext secrets out of the repo while supporting secure env injection. |
| `/Qissue` | When the user wants to file a bug report, feature request, or question against the qe-framework repo. | Single-command issue filing via `gh` CLI with one-time PAT onboarding. |
| `/Qupdate` | When the QE framework, its Codex assets, or the codex-plugin-cc bridge need updating. | One command: updates the framework body (Claude + Codex) and checks/updates the codex-plugin-cc bridge. |
| `/Qmistake` | When user points out a mistake or corrects behavior. | Records to .qe/MISTAKE.md, loaded every session start. |
| `/Qversion` | When you need to check the current framework version. | Displays version info and recent changelog. |
| `/Qsivs-config` | When you need to view or change SIVS engine routing (claude/codex per stage). | CLI-style config manager for `.qe/sivs-config.json`. |
| `/Qarchive` | When a task is completed and needs to be archived. | Moves files to archive and cleans up temporary state. |
| `/Qsummary` | When work summary is needed or the session is concluding. | Generates a high-density report of "What, Why, Next". |

## Design & Frontend

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qdesign` | When a project needs a design system defined before frontend work. | Creates DESIGN.md — single source of truth for colors, typography, spacing, components. |
| `/Qfrontend-design` | When implementing UI components from the design spec. | Creates production-grade frontend code following DESIGN.md. |
| `/Qdesign-audit` | When checking if implementation matches the design spec. | Validates code against DESIGN.md for consistency. |
| `/Qvisual-redesign` | When rendered UI doesn't match the design system visually. | Captures live pages, diagnoses DESIGN.md violations, auto-fixes code. |

## Documentation & Research

| Skill | Invocation Trigger | Core Benefit |
|-------|-------------------|--------------|
| `/Qdoc-comment` | When code needs JSDoc or internal comments. | Standardizes documentation across the codebase. |
| `/Qautoresearch` | When deep domain knowledge or external API research is needed. | Automates technical research and summarizes findings. |
| `/Qwriting-clearly` | When documentation or reports need to be more concise and clear, or when text sounds robotic or AI-like. | Improves readability, removes AI writing patterns (Strunk + AI pattern removal). |

---

*Note: For Best Practices by language/framework, see `skills/coding-experts/CATALOG.md`.*
