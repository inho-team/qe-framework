# PRINCIPLES.md
# Shared Engineering Principles — Followed by All Skills and Agents

---

## Pre-Check (Required Before Every Skill Execution)

If no initialized project instruction artifact exists at the project root (for example `CLAUDE.md`, `AGENTS.md`, or the expected QE instruction file), the QE framework is not initialized.
- **Halt the currently invoked skill** and instruct the user to run the active-client `Qinit` command first.
- Qinit itself skips this check.

## Git Operations (Absolute Rule)

**Never run `git commit`, `git push`, or other git write commands directly.**
All git commit/push operations MUST go through the `/Qcommit` skill, which delegates to the `Ecommit-executor` agent.
- User says "commit", "push" → invoke the active-client `Qcommit` skill
- After task completion and user requests commit → invoke the active-client `Qcommit` skill
- No exceptions. Direct git commands for commit/push are prohibited.

---

## SIVS Loop Core Principles

The SIVS (Spec → Implement → Verify → Supervise) Loop is the framework's central execution model. These 4 principles govern how it operates:

> The SIVS Loop operates inside the PSE Chain's Execute and Verify steps. See `core/PHILOSOPHY.md` for the full SIVS specification and `QE_CONVENTIONS.md` for the PSE-SIVS relationship.

### 1. Post-spec Status Clarity
After the active-client `Qgenerate-spec` command creates spec documents, explicitly show:
- **What was created**: project instruction artifact when applicable, TASK_REQUEST, VERIFY_CHECKLIST (plans only)
- **What is NOT yet done**: actual output files (code, docs, analysis results)
- Then ask user via the QE interaction adapter whether to run the active-client `Qrun-task` command immediately.

### 2. Task Type Banner
In the active-client `Qrun-task` Step 2, display a prominent type banner at the TOP of the summary before any details:
- `⚠️ TYPE: CODE` — will create/modify source code
- `📄 TYPE: DOCS` — will create/modify documentation
- `🔍 TYPE: ANALYSIS` — read-only analysis, no new files
- `❓ TYPE: UNSET` — type not specified, review carefully

This ensures the user knows exactly what will happen before approving.

### 3. Automatic Remediation Loop
When supervision returns **FAIL**, the REMEDIATION flow runs automatically:
- Create REMEDIATION_REQUEST → delegate to Etask-executor → re-execute → re-verify → re-supervise
- Maximum 3 iterations, **no interaction prompt between iterations**
- User is contacted only upon PASS/PARTIAL (completion) or after 3 failed iterations (escalation)

### 4. Minimal User Contact Points
The user is contacted at exactly these points — everything else is automatic:

| # | When | Tool |
|---|------|------|
| (a) | Spec generation confirmation | interaction adapter (Qgenerate-spec Step 3) |
| (b) | Immediate execution prompt | interaction adapter (Qgenerate-spec Step 5) |
| (c) | Task execution approval | interaction adapter (Qrun-task Step 2) |
| (d) | Task completion | Completion report (Qrun-task Step 5) |
| (e) | 3x supervision failure | escalation interaction prompt (Qrun-task Step 4.5) |

Quality loops (Eqa-orchestrator), remediation iterations, and inter-task progress are all automatic.

---

## Skill Scope Enforcement

- **Guide skills are not execution tools.** A skill that explains how to set up or configure something (e.g., Qstitch-cli, Qmcp-setup) must NOT attempt to execute the operations it describes. If the user requests an action that requires external tools (MCP tools, CLI commands), check if those tools are available first.
- **Pre-check before action.** Before invoking external tools (MCP, API, CLI), verify they are actually connected/available. Do not call tools that are not registered — this produces errors and confuses the user.
- **Exit when out of scope.** If a user's request falls outside the skill's defined role, say so clearly and redirect to the correct tool or skill. Do not improvise functionality.

---

## Code Quality Principles

- **SOLID**: Single Responsibility, Open-Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY**: No repeated logic — extract common logic into shared components
- **High-Signal Documentation Rule**: Every major decision, research finding, and phase plan MUST be persisted as an individual Markdown file. This ensures a clean git history, enables context isolation, and facilitates human auditability.
- **Modular Context**: Prefer many small, focused files over one monolithic state file. AI agents should only load the specific "Artifact" relevant to their current task.
- **KISS**: Prefer simple solutions — eliminate unnecessary complexity
- **YAGNI**: Implement only what is needed now — no speculative design
- **Evidence-based decisions**: Do not guess. When uncertain, read the file and verify.
- **Minimal change principle**: Modify only what was requested. Do not refactor adjacent code.

---

## Communication Principles

- **Respond in the user's language**: Check `.qe/profile/language.md` for the user's preferred language and respond accordingly.
- **Clarify ambiguous requirements**: Always confirm unclear requirements before implementing.
- **Concise responses**: Omit unnecessary explanation, preamble, and repeated summaries.
- **Conclusion first**: Answer in the order — conclusion then reasoning.

---

## Safety Principles

- **Confirm before destructive actions**: Deletion, overwriting, force push, etc. require user approval before execution.
- **All git commits via Qcommit**: Never run raw `git commit` or `git push` commands directly. Always use the active-client `Qcommit` skill for all commit and push operations.
- **Protect sensitive information**: Never expose PATs, passwords, or API keys in logs, responses, or files.
- **Prevent OWASP Top 10**: Guard against SQL Injection, XSS, missing authentication, and other basic vulnerabilities.
- **Confirm only high-impact file operations**: Ask the user for permission before destructive, irreversible, or unusually broad file operations. Routine in-scope edits should proceed with minimal interruption.
- **Utopia mode check**: Before prompting through the interaction adapter, check `.qe/state/utopia-state.json`. If `enabled: true`, skip confirmations and auto-select the first (recommended) option. For complex requests (3+ steps, multi-file, new features), automatically route through `Qgenerate-spec → Qrun-task → verify` pipeline. Simple task criteria: see `skills/Qutopia/SKILL.md` SIMPLE classification. Utopia mode does NOT skip destructive git operations or file deletions outside `.qe/`.
- **Pre-execution Gate**: In Utopia --work / --qa modes, before autonomous execution of complex tasks, check if the prompt has concrete anchor signals (file paths, function names, issue numbers, etc.). If the prompt is vague (no anchors + ≤15 words), redirect to Qgenerate-spec normal flow for proper scoping. Users can bypass with `force:` or `!` prefix. See the "Pre-execution Gate" section in Qgenerate-spec SKILL.md for details.

---

## Comment Enforcement

All code written through the QE Framework must include documentation comments on public functions and classes.

### Rules
1. **Public functions/classes require documentation**: Every public function, method, class, struct, trait, or interface must have a documentation comment in the language's standard format
2. **Automatic detection**: The `post-tool-use` hook runs `comment-checker` after every Write/Edit operation and reports missing documentation
3. **Language-standard format**: Use the language's canonical documentation format (JSDoc for JS/TS, docstring for Python, Javadoc for Java, GoDoc for Go, rustdoc for Rust, etc.)
4. **Coverage threshold**: 80% minimum comment coverage for public API in verification (Qcode-run-task)
5. **Private/internal exempt**: Functions/methods prefixed with `_`, `#`, or marked `private` are exempt

### Why
- Undocumented code is untransferable. If a function has no description, the next developer (or AI agent) must read the implementation to understand intent — burning tokens and time.
- Documentation comments enable IDE tooltips, auto-generated API docs, and AI context efficiency.
- The 80% threshold allows pragmatic exceptions (simple getters, one-line helpers) without requiring documentation on every single function.

---

## Task Principles

- **Check `.qe/analysis/` first**: Before exploring project structure, tech stack, entry points, or architecture via Glob/Grep/Read, read `.qe/analysis/` files first. This saves tokens and improves context efficiency.
- **Separate planning from execution when it adds value**: For large, risky, or ambiguous work, clarify the plan first. For straightforward in-scope work, proceed directly and keep the loop moving.
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
2. **Explicit user instructions** — project instruction files and direct directives
3. **Auto-detection** — Context-based inference (last resort)

Decision rules:
- When unsure, ask. Do not guess.
- When there are 3 or more alternatives, present them in a comparison table.
- A small, correct change beats a large, clever one.

---

## Model Routing (Claude Only)

Agent invocation should consider model complexity and availability within Claude's model tiers. Each agent has a `recommendedModel` field in its frontmatter that guides model selection. The recommended model is **advisory** — the skill or caller makes the final decision.

**Routing Criteria:**

| Model | Complexity | Use Cases | Examples |
|-------|-----------|-----------|----------|
| **haiku** | Low | Simple, repetitive, background tasks | Archiving, data refresh, profile collection, basic formatting |
| **sonnet** | Medium | Standard development work | Code implementation, debugging, testing, code review |
| **opus** | High | Complex analysis, design, research | Architecture design, deep system analysis, strategic planning |

**Agent Routing Table:**

| Agent | Recommended Model | Rationale |
|-------|------------------|-----------|
| Earchive-executor | haiku | Archival = simple metadata collection & storage |
| Erefresh-executor | haiku | Refresh = straightforward data update loops |
| Ecode-debugger | sonnet | Debugging = intermediate complexity analysis & tracing |
| Ecode-reviewer | sonnet | Code review = pattern matching & quality assessment |
| Ecode-test-engineer | sonnet | Testing = standard engineering (test design, implementation) |
| Etask-executor | sonnet | Task execution = multi-step implementation work |
| Epm-planner | opus | Planning = architecture & strategic decisions |
| Edeep-researcher | opus | Research = deep analysis & synthesis across domains |

**Implementation:**
- Agents declare `recommendedModel:` in YAML frontmatter (e.g., `recommendedModel: sonnet`)
- Skills and callers inspect `recommendedModel` when invoking agents via Claude Code Agent tool
- Model selection respects rate limits and availability — recommended model is a preference, not a guarantee
- **Delegation Enforcer (hook-enforced):** The `pre-tool-use` hook automatically checks Agent tool calls against the target agent's `recommendedModel`. If no model is specified, the recommended model is auto-injected. If a higher-cost model is specified (e.g., opus for a haiku task), a cost-awareness warning is emitted. Lower-cost overrides are always allowed. Stats are tracked in `unified-state.json` under `delegationStats`.
