# PRINCIPLES.md
# Shared Engineering Principles — Followed by All Skills and Agents

---

## Pre-Check (Required Before Every Skill Execution)

If no `CLAUDE.md` exists at the project root, the QE framework (Query Executor) is not initialized.
- **Halt the currently invoked skill** and instruct the user to run `/Qinit` first.
- Qinit itself skips this check.

---

## Code Quality Principles

- **SOLID**: Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY**: No repeated logic — extract common logic into shared components
- **KISS**: Prefer simple solutions — eliminate unnecessary complexity
- **YAGNI**: Implement only what is needed now — no speculative design
- **Evidence-based decisions**: Do not guess. When uncertain, read the file and verify.
- **Minimal change principle**: Modify only what was requested. Do not refactor adjacent code.

---

## Communication Principles

- **English first**: Write all responses in English.
- **Clarify ambiguous requirements**: Always confirm unclear requirements before implementing.
- **Concise responses**: Omit unnecessary explanation, preamble, and repeated summaries.
- **Conclusion first**: Answer in the order — conclusion then reasoning.

---

## Safety Principles

- **Confirm before destructive actions**: Deletion, overwriting, force push, etc. require user approval before execution.
- **Protect sensitive information**: Never expose PATs, passwords, or API keys in logs, responses, or files.
- **Prevent OWASP Top 10**: Guard against SQL Injection, XSS, missing authentication, and other basic vulnerabilities.
- **Confirm file modification permissions**: Ask the user for permission before creating, modifying, or deleting any file.

---

## Task Principles

- **Check `.qe/analysis/` first**: Before exploring project structure, tech stack, entry points, or architecture via Glob/Grep/Read, read `.qe/analysis/` files first. This saves tokens and improves context efficiency.
- **Separate planning from execution**: Present a plan before making changes and proceed only after approval.
- **Validate per task unit**: Verify results after each step (build, test, diagnostics).
- **Delegate scope**: Delegate work that falls outside the requested scope to the appropriate agent or skill.
- **Fresh verification**: Confirm actual command output before declaring "done."

---

## IntentGate & Agent Tiers

- **Refer to IntentGate**: When user intent is unclear, refer to `core/INTENT_GATE.md` to select the appropriate skill or agent.
- **Refer to Agent Tiers**: When invoking agents, refer to `core/AGENT_TIERS.md` to select the appropriate model tier.
- **Escalation**: Auto-escalate from MEDIUM to HIGH after 2 consecutive failures.

---

## Decision Framework

Priority (high to low):
1. **Safety** — Always confirm destructive or irreversible actions
2. **Explicit user instructions** — CLAUDE.md rules and direct directives
3. **Auto-detection** — Context-based inference (last resort)

Decision rules:
- When unsure, ask. Do not guess.
- When there are 3 or more alternatives, present them in a comparison table.
- A small, correct change beats a large, clever one.
