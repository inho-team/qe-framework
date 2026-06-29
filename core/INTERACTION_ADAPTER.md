# QE Interaction Adapter

QE skills must describe user questions once and render them through the active
client adapter. Do not bind a skill directly to a Claude-only interaction
primitive unless the section explicitly says "Claude adapter".

Use the interaction adapter for decisions and clarifying questions. Use a User
Action Request (`core/USER_ACTION_REQUEST.md`, `Quser-action`) when the user must
perform an external action such as login, 2FA, hook trust approval, secret entry,
console UI work, or a human acceptance check.

## Client Modes

| Client | Structured choice behavior | Command prefix |
|--------|----------------------------|----------------|
| Claude | Use `AskUserQuestion` | `/` |
| Codex interactive | Render concise plain-text choices and wait for the user's reply | `$` |
| Codex non-interactive | Use the deterministic default only when safe | `$` |
| Qutopia | Select the first recommended option, except destructive/irreversible choices | active client |

## Question Schema

Use this logical shape when a skill needs a user decision:

```json
{
  "id": "sivs-routing",
  "kind": "choice",
  "question": "SIVS 엔진 라우팅을 설정하시겠습니까?",
  "options": [
    { "label": "Claude + Codex Hybrid (Recommended)", "value": "hybrid" },
    { "label": "Claude single-engine", "value": "claude" },
    { "label": "Configure later", "value": "later" }
  ],
  "default": "hybrid",
  "requiresExplicitAnswer": true
}
```

Rules:
- `id`, `kind`, `question`, and `options` are required for choices.
- One option should be marked recommended in its label when there is a safe
  default.
- `requiresExplicitAnswer: true` blocks non-interactive auto-selection unless
  Qutopia rules explicitly allow it.
- SIVS engine-routing questions must always include a Codex or Hybrid option.

## Rendering Contract

Claude adapter:
- Call `AskUserQuestion` with the same question and option labels.
- Do not print a plain-text replacement for structured choices.

Codex interactive adapter:
- Print the same options as a short numbered list.
- Accept numeric labels (`1`) or normalized option values (`hybrid`).
- Do not continue past a materially branching question until the user answers.

Codex non-interactive adapter:
- If `requiresExplicitAnswer` is true, stop and report the required question.
- If it is false, select the `default`, otherwise the first recommended option.

Command rendering:
- Use `/Q...` only for Claude-facing handoffs.
- Use `$Q...` for Codex-facing handoffs.
- Skill templates should write `{adapter.commandPrefix}Qskill` unless the text is
  explicitly a Claude-only example.
