# AGENTS.md

## Project

- Name: `@inho-team/qe-framework` (Claude Code plugin `qe-framework`; not published to npm)
- Purpose: one path for coding work — 이해 → 계획 → 실행 → 검증 — in a small set of skills,
  leaving plain-markdown plan and verify docs per task under the user's `docs/qe/`.
- Version sync: `package.json`, `.claude-plugin/plugin.json`, and the `qe-framework`
  entry in `.claude-plugin/marketplace.json` must stay identical.

## Structure

- `skills/`: the skills — path: `Qunderstand`, `Qplan`, `Qexecute`, `Qverify`;
  then `Qfinish`; alongside: `Qdebugging`, `Qtdd`, `Qreview`, `Qfeedback`, `Qskill`, `Qcompact`, `Qresume`.
  Each folder has `SKILL.md` plus its templates or subagent prompts.
- `hooks/`: `hooks.json` (SessionStart only), `session-start.mjs`, `guide.md`
  (the path guide injected at session start).
- `tests/`: `node:test` tests for the hook and static checks on skills and evals.
- `evals/`: behavior eval cases for `claude plugin eval` (`trigger-*`: the right skill fires;
  `gate-*`: path behavior, compared against a no-plugin run). `evals/results/` is not tracked.
- Design specs and plans are kept locally under `research/` and are not tracked by git.

## Working Rules

- Skills may grow, but each is written as reasons; do not add machinery that replaces model
  judgment (numeric caps, schemas, behavior-policing hooks or scripts, DBs).
- Never put substitution tokens such as `$1` or `$ARGUMENTS` in skill text; the harness may
  replace them.
- Before adding any rule, hook, check, or numeric limit, ask: "이게 없으면 모델이 실제로
  실패하는가?" If the answer is not clearly yes, leave it out. Write rules as reasons, not caps.
- Skill text is Korean, written as what-and-why. Keep each `SKILL.md` short (aim ≤ 150 lines,
  tests cap it at 200): long skill bodies get cut after compaction, and detail belongs in support
  files linked from SKILL.md.
- How to create or change a skill (control run first, reasons over rules, trigger checks) is in
  `skills/Qskill/SKILL.md`; the bullets here are the QE-repo-specific rules.
- The hook must never fail a session start: guard every filesystem read, always exit 0.
- Keep code comments sparse. Use them to explain a decision, constraint, or invariant that
  is hard to infer from the code. Keep messages in the code aligned with what it actually
  does. Track unfinished work in the task plan and record actual verification commands
  and results in `verify.md`.
- No DB, no state files beyond the task docs. State is read from `implement-plan.md` checkboxes,
  `verify.md`, and `handoff.md`.
- When changing the path or the doc layout, update `hooks/guide.md`, `README.md`, and the
  affected skills together.

## Validation

- Run `npm ci` to install the development tools. `npm test` runs lint, hook tests, and static checks.
- `npm run lint` checks `.mjs` hooks using [scripts/lint-hooks.mjs](scripts/lint-hooks.mjs). Read
  lint diagnostics in full, fix the affected behavior, and rerun the relevant test and lint.
- When investigating a hook change or lint failure, use `codebase-memory-mcp` to index the
  current checkout and trace callers of the affected symbol. With the CLI, run
  `codebase-memory-mcp cli index_repository --repo-path . --mode fast`, then
  `codebase-memory-mcp cli trace_path --project <project> --function-name <symbol> --direction inbound`.
  Use `--mode full --doc-candidates false` in the indexing command when tracing code under
  `scripts/` or `tests/`. Fast mode skips those paths.
  Use the project name returned by indexing and confirm the reported call path in the source.
  If the tool is unavailable, follow the call sites in the source.
- Local plugin check: `claude --plugin-dir .` and confirm every Q skill loads.
- Before a release: `npm run eval:trigger` and `npm run eval:gate` (live Claude runs; they cost
  money and take minutes, so they are not in CI). A case passes at 2 of 3 runs; any failing case
  means the release is incomplete. The with/without delta is informational. Record the result as
  "N of M cases" in the CHANGELOG entry. When a case fails, first check whether the case itself
  misdescribes the situation before changing a skill.

## Response Style

- <!-- qe:response-language=latest-user-message -->
- Reply in the language of the user's most recent message.
- Keep explanations concise and technical as needed.
