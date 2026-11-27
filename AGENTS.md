# AGENTS.md

## 작업 시작

새 코딩 요청에 작업 이유(Why) 또는 관찰 가능한 완료 기준 중 하나라도 빠졌으면, 계획·수정·디버깅 전에 반드시 `Qunderstand`를 먼저 호출한다. Claude Code에서는 `qe-framework:Qunderstand`를 Skill 도구로 호출한다. 스킬 호출 도구가 없으면 아래의 스킬 원문을 열고 따른다. 앞선 대화나 저장소에 답이 있으면 다시 묻지 않는다.

스킬 원문: [Qunderstand](skills/Qunderstand/SKILL.md)

인터뷰를 진행한 창에서는 구현하지 않는다. 사용자가 의도를 확정하면 작업 폴더에 `intent.md`를 저장한다. 새 세션이 이 파일을 읽고 계획을 세운 뒤 승인을 받아 실행한다. 사용자가 서브에이전트를 고르면 인터뷰 창이 계획·실행·검증 단계를 조율하고, 계획 문서와 코드는 서브에이전트가 쓴다.

## Project

- Name: `@inho-team/qe-framework` (Claude Code plugin `qe-framework`; not published to npm)
- Purpose: an AI framework that removes the understanding bottleneck and runs work efficiently.
  It provides one workflow (이해 → 계획 → 실행 → 검증 → 마무리), specialist agents, plain-markdown
  plan and verify docs per goal under `~/.qe/tasks/` (a git repo shared by all sessions on the PC),
  gated by an independent verifier's verdict before "done", then exported to the project's `docs/qe/`, and current
  code flow contracts under the project's `docs/contracts/`.
- Version sync: `package.json`, `.claude-plugin/plugin.json`, and the `qe-framework`
  entry in `.claude-plugin/marketplace.json` must stay identical.

## Structure

- `skills/`: the skills — path: `Qunderstand`, `Qplan`, `Qexecute`, `Qverify`;
  then `Qfinish`; alongside: `Qdebugging`, `Qtdd`, `Qreview`, `Qfeedback`, `Qreport`, `Qskill`, `Qcompact`, `Qresume`,
  `Qboard` (read-only local dashboard: `board.mjs` server + `board.html`).
  shared rules: `code-craft` (doc comments as contracts, no editorial comments; main session and
  code agents) and `agent-conduct` (scope and reporting; preloaded by every agent).
  Each folder has `SKILL.md` plus its templates, subagent prompts, or scripts.
- `agents/`: specialist subagents (`code-<language>`, `code`, `planner`, `researcher`,
  `analyst`, `data-analyst`, `redteam`, `qa`, `marketer`, `contractor`). Each preloads the shared
  skills through frontmatter `skills:`; Q skills call them as `qe-framework:<name>`.
- `references/design-patterns/`: a root index and one directory per language. The main
  session and code agents consult the language `README.md` to find relevant pattern guides.
- `hooks/`: `hooks.json` registers every hook through `run.sh` (finds node, runs the script named by `QE_HOOK`);
  `guide.md` is the path guide injected at session start.
  - `session-start.mjs` — injects `guide.md`, this project's open `~/.qe` goals, the latest handoff,
    the session id, and legacy `docs/qe` tasks under an "이전 위치" heading; at startup it warns once
    when the `codebase-memory-mcp` executable is missing.
  - `post-tool-use.mjs` (Write|Edit) — records the session and worktree that touched a goal in its `status.json`.
  - `subagent-stop.mjs` — writes a verifier's `QE-VERDICT:` line to the goal's `verdicts/`.
  - `pre-tool-use.mjs` (Write|Edit) — denies marking `status.json` done, moving a done goal's `done.commit`, or keeping
    one its verdicts do not back, without a 충족 verdict for that commit, and denies writes to `verdicts/`.
  - `stop.mjs` — blocks a stop once per plan state when the plan is fully checked but has no verdict.
  - `lib/` — shared helpers: `qe-home.mjs` (`~/.qe` paths, atomic writes, git commits),
    `tasks.mjs` (goal folders, status, verdicts), `alerts.mjs` (dashboard warnings).
- `mcp/`: `codebase-memory.mjs` launches the `codebase-memory-mcp` server registered in `plugin.json`.
- `tests/`: `node:test` tests for the hooks, the dashboard, and static checks on skills, agents, manifests, and evals.
- `evals/`: behavior eval cases for `claude plugin eval` (`trigger-*`: the right skill fires;
  `gate-*`: path behavior, compared against a no-plugin run). `evals/results/` is not tracked.
- Design specs and plans are kept locally under `research/` and are not tracked by git.

## Working Rules

- Skills may grow, but each is written as reasons; do not add machinery that replaces model
  judgment (numeric caps, schemas, behavior-policing hooks or scripts, DBs). One exception passed the
  question below: the completion gate (PreToolUse/Stop/SubagentStop) exists because users repeatedly
  saw "the AI said it was done but it was not". It only records, blocks a stop once, or refuses "done"
  without an independent verifier's verdict; it never judges the work itself. Do not extend it to other behavior
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
- Follow `code-craft` when writing code: document caller-visible contracts and add inline comments
  for decisions, constraints, or invariants that are hard to infer. Track unfinished work in the
  implementation plan and record actual verification commands and results in `verify.md`.
- No DB. Allowed state is the `~/.qe` git repo of goal folders: the task docs, each goal's `status.json`,
  hook-written `verdicts/`, and `.stop-blocked-*` markers. Progress is still read from
  a confirmed `intent.md`, `implement-plan.md` checkboxes, `verify.md`, and `handoff.md`. Add no other state store.
  The enduring flow contracts in the project's `docs/contracts/` describe the current code, which is
  their source of truth.
- When changing the path, the doc layout, or the agent roster, update `hooks/guide.md`,
  `README.md`, the affected skills and agents, and the roster in `tests/static.test.mjs` together.

## Validation

- Run `npm ci` to install the development tools. `npm test` runs lint, hook, dashboard, and static tests.
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
- Local plugin check: `claude --plugin-dir .` and confirm every Q skill and every agent loads.
- Before a release, check the Codebase Memory version and tool inputs and run `npm run eval:codebase-memory` as described in the README's update checklist.
- Before a release: `npm run eval:trigger` and `npm run eval:gate` (live Claude runs; they cost
  money and take minutes, so they are not in CI). A case passes at 2 of 3 runs; any failing case
  means the release is incomplete. The with/without delta is informational. Record the result as
  "N of M cases" in the CHANGELOG entry. When a case fails, first check whether the case itself
  misdescribes the situation before changing a skill.

## Response Style

- <!-- qe:response-language=latest-user-message -->
- Reply in the language of the user's most recent message.
- Keep explanations concise and technical as needed.
