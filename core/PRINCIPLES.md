# PRINCIPLES.md
# Shared Engineering Principles — Followed by All Skills and Agents

---

## Pre-Check (Required Before Every Skill Execution)

If no `CLAUDE.md` exists at the project root, the QE framework (Query Executor) is not initialized.
- **Halt the currently invoked skill** and instruct the user to run `/Qinit` first.
- Qinit itself skips this check.

## Git Operations (Absolute Rule)

**Never run `git commit`, `git push`, or other git write commands directly.**
All git commit/push operations MUST go through the `/Qcommit` skill, which delegates to the `Ecommit-executor` agent.
- User says "commit", "push" → invoke `/Qcommit`
- After task completion and user requests commit → invoke `/Qcommit`
- No exceptions. Direct git commands for commit/push are prohibited.

---

## SVS Loop Core Principles

The SVS (Spec → Verify → Supervise) Loop is the framework's central execution model. These 4 principles govern how it operates:

### 1. Post-spec Status Clarity
After `/Qgenerate-spec` creates spec documents, explicitly show:
- **What was created**: CLAUDE.md, TASK_REQUEST, VERIFY_CHECKLIST (plans only)
- **What is NOT yet done**: actual output files (code, docs, analysis results)
- Then ask user via `AskUserQuestion` whether to run `/Qrun-task` immediately.

### 2. Task Type Banner
In `/Qrun-task` Step 2, display a prominent type banner at the TOP of the summary before any details:
- `⚠️ TYPE: CODE` — will create/modify source code
- `📄 TYPE: DOCS` — will create/modify documentation
- `🔍 TYPE: ANALYSIS` — read-only analysis, no new files
- `❓ TYPE: UNSET` — type not specified, review carefully

This ensures the user knows exactly what will happen before approving.

### 3. Automatic Remediation Loop
When supervision returns **FAIL**, the REMEDIATION flow runs automatically:
- Create REMEDIATION_REQUEST → delegate to Etask-executor → re-execute → re-verify → re-supervise
- Maximum 3 iterations, **no AskUserQuestion between iterations**
- User is contacted only upon PASS/PARTIAL (completion) or after 3 failed iterations (escalation)

### 4. Minimal User Contact Points
The user is contacted at exactly these points — everything else is automatic:

| # | When | Tool |
|---|------|------|
| (a) | Spec generation confirmation | AskUserQuestion (Qgenerate-spec Step 3) |
| (b) | Immediate execution prompt | AskUserQuestion (Qgenerate-spec Step 5) |
| (c) | Task execution approval | AskUserQuestion (Qrun-task Step 2) |
| (d) | Task completion | Completion report (Qrun-task Step 5) |
| (e) | 3x supervision failure | Escalation AskUserQuestion (Qrun-task Step 4.5) |

Quality loops (Eqa-orchestrator), remediation iterations, and inter-task progress are all automatic.

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

- **Respond in the user's language**: Check `.qe/profile/language.md` for the user's preferred language and respond accordingly.
- **Clarify ambiguous requirements**: Always confirm unclear requirements before implementing.
- **Concise responses**: Omit unnecessary explanation, preamble, and repeated summaries.
- **Conclusion first**: Answer in the order — conclusion then reasoning.

---

## Safety Principles

- **Confirm before destructive actions**: Deletion, overwriting, force push, etc. require user approval before execution.
- **All git commits via Qcommit**: Never run raw `git commit` or `git push` commands directly. Always use the `/Qcommit` skill for all commit and push operations.
- **Protect sensitive information**: Never expose PATs, passwords, or API keys in logs, responses, or files.
- **Prevent OWASP Top 10**: Guard against SQL Injection, XSS, missing authentication, and other basic vulnerabilities.
- **Confirm file modification permissions**: Ask the user for permission before creating, modifying, or deleting any file.
- **Utopia mode check**: Before calling AskUserQuestion, check `.qe/state/utopia-state.json`. If `enabled: true`, skip confirmations and auto-select the first (recommended) option. For complex requests (3+ steps, multi-file, new features), automatically route through `Qgenerate-spec → Qrun-task → verify` pipeline. Simple requests (1-2 step single-file edits) execute directly. Utopia mode does NOT skip destructive git operations or file deletions outside `.qe/`.
- **Pre-execution Gate**: In Utopia/ultrawork/ultraqa modes, before autonomous execution of complex tasks, check if the prompt has concrete anchor signals (file paths, function names, issue numbers, etc.). If the prompt is vague (no anchors + ≤15 words), redirect to Qgenerate-spec normal flow for proper scoping. Users can bypass with `force:` or `!` prefix. See the "Pre-execution Gate" section in Qgenerate-spec SKILL.md for details.

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

---

## Model Routing

Agent invocation should consider model complexity and availability. Each agent has a `recommendedModel` field in its frontmatter that guides model selection. The recommended model is **advisory** — the skill or caller makes the final decision.

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
| Eprofile-collector | haiku | Profile collection = basic I/O operations |
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
- No enforcement: if a caller invokes an agent with a different model, it is not an error
