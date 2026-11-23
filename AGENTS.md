# AGENTS.md

## Project

- Name: `@inho-team/qe-framework` (Claude Code plugin `qe-framework`; not published to npm)
- Purpose: one path for coding work — 이해 → 계획(Spec) → 실행 → 검증 — in seven skills,
  leaving plain-markdown spec and verify docs per task under the user's `docs/qe/`.
- Version sync: `package.json`, `.claude-plugin/plugin.json`, and the `qe-framework`
  entry in `.claude-plugin/marketplace.json` must stay identical.

## Structure

- `skills/`: the seven skills — path: `Qunderstand`, `Qplan`, `Qexecute`, `Qverify`;
  alongside: `Qdebugging`, `Qcompact`, `Qresume`.
  Each folder has `SKILL.md` plus its templates or subagent prompts.
- `hooks/`: `hooks.json` (SessionStart only), `session-start.mjs`, `guide.md`
  (the path guide injected at session start).
- `tests/`: `node:test` tests for the hook.
- Design specs and plans are kept locally under `research/` and are not tracked by git.

## Working Rules

- Keep the skill set at these seven. Do not add a skill when a paragraph in an existing one will do.
- Before adding any rule, hook, check, or numeric limit, ask: "이게 없으면 모델이 실제로
  실패하는가?" If the answer is not clearly yes, leave it out. Write rules as reasons, not caps.
- Skill text is Korean, written as what-and-why. Keep each `SKILL.md` short (aim ≤ 150 lines).
- The hook must never fail a session start: guard every filesystem read, always exit 0.
- No DB, no state files beyond the task docs. State is read from `plan.md` checkboxes,
  `verify.md`, and `handoff.md`.
- When changing the path or the doc layout, update `hooks/guide.md`, `README.md`, and the
  affected skills together.

## Validation

- `npm test` — hook tests.
- Local plugin check: `claude --plugin-dir .` and confirm the seven Q skills load.

## Response Style

- <!-- qe:response-language=latest-user-message -->
- Reply in the language of the user's most recent message.
- Keep explanations concise and technical as needed.
