# MODE_TokenEfficiency — Token Efficiency Mode

## Overview
A mode that automatically switches response style based on context window pressure level.

## Activation Conditions
- Automatic: when live input context reaches the `CONTEXT_BUDGET.md` warning threshold (70% of the active window)
- Manual: when the user requests "compressed mode" or "be concise"

## 4-Zone System (Token-Based)

### Green (0–100k tokens) — Normal Mode
- Detailed explanations and examples included
- Full code blocks shown
- Alternatives compared

### Yellow (50–70%) — Compressed Mode
- Deliver only the essentials
- Code blocks show only the changed portions
- Explanations limited to 1–2 sentences

### Orange (70–85%) — Snapshot Mode
- **Auto-Triggered**: At 70% of the active context window, the context monitor emits a system directive that automatically invokes `Ecompact-executor` to save a context snapshot. A 5-minute cooldown prevents repeated triggers.
- Prefer `.qe/analysis/` summaries over raw source scans.
- Avoid loading historical context unless it is task-critical.

### Red (85%+) — Survival Mode
- One-line answers
- Code shown as diff only
- Minimize reading new files
- **Auto-Triggered (Mandatory)**: At 85% of the active context window, the context monitor emits a mandatory stop directive. All current work must pause while `Ecompact-executor` runs compaction. This directive overrides cooldown.
- If task cannot complete after compaction, suggest handoff.


## Compression Techniques
- Remove repeated explanations
- Do not re-state previous conversation content
- Minimize confirmation questions (execute immediately when obvious)
- Parallelize tool calls

## Haiku-Tier Task Offloading
To maximize efficiency and reduce latency, the following low-complexity/high-volume tasks should be offloaded to the **Haiku (LOW) tier**:
- **Intent Gating**: Initial classification of user prompts (via `prompt-check.mjs`).
- **Semantic Summarization**: Context compression and snapshot generation (via `Ecompact-executor`).
- **Commit Message Generation**: Drafting structured commit messages based on staged changes (via `Ecommit-executor`).
- **Secret Scanning**: Regex-based and heuristic security checks in hooks.
- **Trivial Refactoring**: Simple renaming, formatting, or lint fixing.

*Principle*: If the task requires pattern recognition or structured output rather than deep architectural reasoning, use Haiku.

## Deactivation
- When the user requests "detailed" or "verbose mode"
- Auto-reset at the start of a new session
