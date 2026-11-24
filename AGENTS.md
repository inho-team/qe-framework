# AGENTS.md

## Project

- Name: `@inho-team/qe-framework` (Claude Code plugin `qe-framework`; not published to npm)
- Purpose: one path for coding work — 이해 → 계획 → 실행 → 검증 → 마무리 — in a small set of skills,
  leaving plain-markdown plan and verify docs per goal under `~/.qe/tasks/` (a git repo shared by all
  sessions on the PC), gated by a red-team verdict before "done", then exported to the project's `docs/qe/`.
- Version sync: `package.json`, `.claude-plugin/plugin.json`, and the `qe-framework`
  entry in `.claude-plugin/marketplace.json` must stay identical.

## Structure

- `skills/`: the skills — path: `Qunderstand`, `Qplan`, `Qexecute`, `Qverify`;
  then `Qfinish`; alongside: `Qdebugging`, `Qtdd`, `Qreview`, `Qfeedback`, `Qskill`, `Qcompact`, `Qresume`,
  `Qboard` (read-only local dashboard: `board.mjs` server + `board.html`).
  Each folder has `SKILL.md` plus its templates, subagent prompts, or scripts.
- `hooks/`: `hooks.json` registers every hook through `run.sh` (finds node, runs the script named by `QE_HOOK`);
  `guide.md` is the path guide injected at session start.
  - `session-start.mjs` — injects `guide.md`, this project's open `~/.qe` goals, the latest handoff,
    the session id, and legacy `docs/qe` tasks under an "이전 위치" heading.
  - `post-tool-use.mjs` (Write|Edit) — records the session and worktree that touched a goal in its `status.json`.
  - `subagent-stop.mjs` — writes a verifier's `QE-VERDICT:` line to the goal's `verdicts/`.
  - `pre-tool-use.mjs` (Write|Edit) — denies marking `status.json` done without a 충족 verdict for that
    commit, and denies writes to `verdicts/`.
  - `stop.mjs` — blocks a stop once per plan state when the plan is fully checked but has no verdict.
  - `lib/` — shared helpers: `qe-home.mjs` (`~/.qe` paths, atomic writes, git commits),
    `tasks.mjs` (goal folders, status, verdicts), `alerts.mjs` (dashboard warnings).
- `tests/`: `node:test` tests for the hooks, the dashboard, and static checks on skills and evals.
- `evals/`: behavior eval cases for `claude plugin eval` (`trigger-*`: the right skill fires;
  `gate-*`: path behavior, compared against a no-plugin run). `evals/results/` is not tracked.
- Design specs and plans are kept locally under `research/` and are not tracked by git.

## Working Rules

- Skills may grow, but each is written as reasons; do not add machinery that replaces model
  judgment (numeric caps, schemas, behavior-policing hooks or scripts, DBs). One exception passed the
  question below: the completion gate (PreToolUse/Stop/SubagentStop) exists because users repeatedly
  saw "the AI said it was done but it was not". It only records, blocks a stop once, or refuses "done"
  without a red-team verdict; it never judges the work itself. Do not extend it to other behavior
  without the same kind of observed failure.
- Never put substitution tokens such as `$1` or `$ARGUMENTS` in skill text; the harness may
  replace them.
- Before adding any rule, hook, check, or numeric limit, ask: "이게 없으면 모델이 실제로
  실패하는가?" If the answer is not clearly yes, leave it out. Write rules as reasons, not caps.
- Skill text is Korean, written as what-and-why. Keep each `SKILL.md` short (aim ≤ 150 lines,
  tests cap it at 200): long skill bodies get cut after compaction, and detail belongs in support
  files linked from SKILL.md.
- How to create or change a skill (control run first, reasons over rules, trigger checks) is in
  `skills/Qskill/SKILL.md`; the bullets here are the QE-repo-specific rules.
- Hooks must never fail a session start or a tool call: guard every filesystem read and git call,
  fail open on their own errors, always exit 0.
- No DB. Allowed state is the `~/.qe` git repo of goal folders: the task docs, each goal's `status.json`,
  hook-written `verdicts/`, and `.stop-blocked-*` markers. Progress is still read from
  `implement-plan.md` checkboxes, `verify.md`, and `handoff.md`. Add no other state store.
- When changing the path or the doc layout, update `hooks/guide.md`, `README.md`, and the
  affected skills together.

## Validation

- `npm test` — hook, dashboard, and static tests.
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
