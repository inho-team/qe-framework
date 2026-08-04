# QE Interaction Adapter

QE skills must describe user questions once and render them through the active
client adapter. Do not bind a skill directly to a Claude-only interaction
primitive unless the section explicitly says "Claude adapter".

Use the interaction adapter for decisions and clarifying questions. Use a User
Action Request (`core/USER_ACTION_REQUEST.md`) when the user must
perform an external action such as login, 2FA, hook trust approval, secret entry,
console UI work, or a human acceptance check.

## Client Modes

| Client | Structured choice behavior | Command prefix |
|--------|----------------------------|----------------|
| Claude | Use `AskUserQuestion` | `/` |
| Codex interactive | Render concise plain-text choices and wait for the user's reply | `$` |
| Codex non-interactive | Use the deterministic default only when safe | `$` |
| Qexecute -utopia | Select the first recommended option, except destructive/irreversible choices | active client |

## Question Schema

Use this logical shape when a skill needs a user decision:

```json
{
  "id": "sivs-quality-profile",
  "kind": "choice",
  "question": "SIVS 고품질 검증 수준을 설정하시겠습니까?",
  "options": [
    { "label": "기본 고품질 QA (Recommended)", "value": "high-qa" },
    { "label": "나중에 설정", "value": "later" },
    { "label": "Configure later", "value": "later" }
  ],
  "default": "high-qa",
  "requiresExplicitAnswer": true
}
```

Rules:
- `id`, `kind`, `question`, and `options` are required for choices.
- One option should be marked recommended in its label when there is a safe
  default.
- `requiresExplicitAnswer: true` blocks non-interactive auto-selection unless
  Qexecute -utopia rules explicitly allow it.
- SIVS questions must not offer cross-client routing. The active client owns the
  full SIVS loop.

## Tacit-Knowledge Open Questions

Qplan intake uses the deterministic engine state, not adapter-local counters.
Before the first question, render one fatigue budget line:

```text
Questions: 30 base, up to 12 follow-ups; 3 per batch. You can pause or stop.
```

Use the actual base total in place of `30`. Each open question has this logical
shape:

```json
{
  "id": "acceptance-17",
  "kind": "open",
  "label": "[17/30]",
  "question": "What observable outcome would make this complete?",
  "material": true,
  "reversible": false
}
```

Render `label` verbatim before the question. A follow-up label is anchored to
its base ordinal and local set total, for example `[17-1/3]`; it does not consume
or renumber the base progress display. Show at most the engine-returned batch of
3. After each batch, accept answers plus the controls `pause`, `stop`, and
`skip`. The engine decides whether skip becomes an assumption or a blocker.

Claude interactive and Codex interactive render the same label and open-question
text, then wait for free-form input. Do not turn an open material question into
a recommended multiple-choice default. Claude may use a structured primitive
only when it preserves a free-form response path and the exact label.

Codex non-interactive and other non-interactive adapters never invent an open
answer. They may resolve only an engine-classified, explicitly reversible
non-material question as an assumption. If a material question is unresolved,
persist the draft, report its earliest label, and return a blocked result.
Qexecute `-utopia` does not override this rule.

## Rendering Contract

Claude adapter:
- Call `AskUserQuestion` with the same question and option labels.
- Do not print a plain-text replacement for structured choices.

Codex interactive adapter:
- Print the same options as a short numbered list.
- Accept numeric labels (`1`) or normalized option values.
- Do not continue past a materially branching question until the user answers.

Codex non-interactive adapter:
- If `requiresExplicitAnswer` is true, stop and report the required question.
- If it is false, select the `default`, otherwise the first recommended option.

Command rendering:
- Use `/Q...` only for Claude-facing handoffs.
- Use `$Q...` for Codex-facing handoffs.
- Skill templates should write `{adapter.commandPrefix}Qskill` unless the text is
  explicitly a Claude-only example.
