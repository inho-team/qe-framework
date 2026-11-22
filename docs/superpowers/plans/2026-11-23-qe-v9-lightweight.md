# QE v9 Lightweight Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v8 QE framework with a 5-skill Claude Code plugin that runs one path (이해 → 계획(Spec) → 실행 → 검증) and leaves plain markdown docs per task.

**Architecture:** A Claude Code plugin with five prose skills under `skills/`, one Node SessionStart hook that injects a short path guide plus any unfinished `docs/qe/*` task and its latest `handoff.md`, and no DB, agents, CI, or check scripts. Everything else in v8 is deleted; v8 stays reachable through git history and the `v8.3.0` tag.

**Tech Stack:** Markdown skills (Claude Code plugin format), Node.js ≥ 22 ESM for the hook, `node:test` for its tests.

**Spec:** `docs/superpowers/specs/2026-11-23-qe-v9-lightweight-design.md`

## Global Constraints

- Branch: `v9-lightweight` (already created; spec already committed on it).
- Version `9.0.0` in `package.json`, `.claude-plugin/plugin.json`, and the `qe-framework` entry of `.claude-plugin/marketplace.json` — all three identical.
- Exactly five skills: `Qunderstand`, `Qplan`, `Qexecute`, `Qverify`, `Qresume`. No other skill folders.
- Each `SKILL.md` ≤ 150 lines, written as "what and why", not numeric caps or schemas. Anti-goal test for every rule: "이게 없으면 모델이 실제로 실패하는가?" — if not clearly yes, leave it out.
- Only one hook: SessionStart, matcher `startup|clear|compact`, a single Node script (no shell dependency; Windows must work).
- Task docs live in the user's project at `docs/qe/YYYY-MM-DD-<topic>/` with `spec.md`, `plan.md`, `verify.md`, and `handoff.md` (handoff only when a session is handed over).
- No `agents/`, no DB, no `scripts/`, no Jenkins/CI, no npm publishing (`private: true`).
- Skill text and user-facing docs in Korean; code identifiers in English. (Builder call from spec: README language → Korean, matching the user.)
- The model cannot run built-in `/compact`; Qresume asks the user to run it.
- `graft/` is an untracked local tool cache — do not delete it, do not commit it.

## Review Focus

1. A project with no `docs/qe/` directory (the common first-run case) → hook prints the guide only, exits 0, never errors.
2. Empty or malformed JSON on the hook's stdin → hook falls back to `process.cwd()` and still prints the guide.
3. Windows CRLF line endings and `- [X]` (uppercase) in `plan.md` → checkbox detection still counts correctly.
4. A very large `handoff.md` → injected content is truncated (with a note), not dumped whole into the session.
5. Stray files or a non-task entry inside `docs/qe/` (e.g. `docs/qe/README.md`) → skipped, not reported as a task.

---

### Task 1: Remove v8 assets and reset manifests to 9.0.0

**Files:**
- Delete (git rm -r): `core/`, `scripts/`, `hooks/scripts/`, `hooks/git/`, `hooks/hook-inventory.json`, `hooks/hooks.json`, `agents/`, `bin/`, `install.js`, `uninstall.js`, `evals/`, `plugins/`, `.agents/`, `.qe/`, `.ci/`, `Jenkinsfile`, `QE.md`, `QE_CONVENTIONS.md`, `package-lock.json`, `skills/` (all, including `CATALOG.md`), every tracked path under `docs/` except `docs/superpowers/`
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.gitignore`, `docs/superpowers/specs/2026-11-23-qe-v9-lightweight-design.md` (status line)

**Interfaces:**
- Produces: an empty plugin shell at version 9.0.0 that later tasks fill. `plugin.json` has no inline `hooks` or `agents` keys; hooks come from `hooks/hooks.json` (Task 2), skills from `./skills/`.

- [ ] **Step 1: Delete v8 tracked files**

Run the `git rm -r -q` for every path in the Delete list. For `docs/`, remove everything tracked except `docs/superpowers/` (`git ls-files docs | grep -v '^docs/superpowers/' | xargs git rm -q`).

- [ ] **Step 2: Rewrite `package.json`**

Keep only: `name` (`@inho-team/qe-framework`), `version` `9.0.0`, `private: true`, `description` (one line: 5-skill Claude Code plugin, 이해 → 계획 → 실행 → 검증), `type: "module"`, `engines.node: ">=22.5.0"`, `license`, `repository`, `homepage`, `bugs`, and `scripts: { "test": "node --test tests/" }`. Remove `files`, `bin`, `publishConfig`, all other scripts, `optionalDependencies`.

- [ ] **Step 3: Rewrite `.claude-plugin/plugin.json`**

`name` `qe-framework`, `version` `9.0.0`, new description, `author`, `homepage`, `license`, keywords (`claude-code`, `skills`, `spec`, `verification`), `skills: ["./skills/"]`. No `hooks`, no `agents`.

- [ ] **Step 4: Rewrite `.claude-plugin/marketplace.json`**

Keep the marketplace `name`/`owner`; one plugin entry `qe-framework` with `version` `9.0.0`, updated description/tags/features (5 skills; spec·verify 문서), same GitHub `source`. Remove the `qissue-adapter` entry.

- [ ] **Step 5: Clean `.gitignore` and mark spec approved**

Remove every v8-specific rule (`.qe/*` block, qe.db lines, shadow-git, baseline-prompt-check, test-routing.js etc.) and the `AGENTS.md` line (AGENTS.md is tracked and is rewritten in Task 6). Keep `node_modules/`, `.DS_Store`, `.idea`, `.claude/`, `CLAUDE.md`, `*.tgz`, `dist/`, and add `graft/`. In the spec, change `- 상태: 초안 (승인 대기)` to `- 상태: 승인됨 (2026-11-23)`.

- [ ] **Step 6: Verify**

Run: `git ls-files | cut -d/ -f1 | sort -u`
Expected: only `.claude-plugin`, `.editorconfig`, `.gitignore`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `README.md`, `THIRD_PARTY_NOTICES.md`, `docs`, `package.json`.

Run: `node -e "const r=f=>JSON.parse(require('fs').readFileSync(f,'utf8'));const v=[r('package.json').version,r('.claude-plugin/plugin.json').version,r('.claude-plugin/marketplace.json').plugins.find(p=>p.name==='qe-framework').version];console.log(v);process.exit(v.every(x=>x==='9.0.0')?0:1)"`
Expected: `[ '9.0.0', '9.0.0', '9.0.0' ]`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore!: remove v8 framework assets for v9 rewrite"
```

---

### Task 2: SessionStart hook

**Files:**
- Create: `hooks/hooks.json`, `hooks/session-start.mjs`, `hooks/guide.md`
- Test: `tests/session-start.test.mjs`

**Interfaces:**
- Produces (exported from `hooks/session-start.mjs`):
  - `findOpenTasks(projectRoot: string) -> Array<{ name: string, dir: string, unchecked: number, hasPlan: boolean, hasVerify: boolean, handoffPath: string | null, mtimeMs: number }>` — scans direct subdirectories of `<projectRoot>/docs/qe/`; a subdirectory is a task only if it contains at least one of `spec.md`, `plan.md`. A task is **open** when it has no `verify.md`, or its `plan.md` has any unchecked box. Sorted newest first by the max mtime of its files.
  - `countUnchecked(markdown: string) -> number` — counts lines matching `/^\s*[-*] \[ \]/m` (CRLF-safe); `[x]`/`[X]` are done.
  - `buildContext(projectRoot: string, guideText: string) -> string` — guide, then (if any) an "미완료 작업" list (`docs/qe/<name>` — 남은 단계 N, verify 없음/있음), then the newest open task's `handoff.md` content, truncated to `MAX_HANDOFF_CHARS = 8000` with a trailing line `…(잘림 — 전체는 <path>)`.
  - CLI behavior: reads stdin JSON; `projectRoot = input.cwd ?? process.cwd()`; on any parse/read error uses `process.cwd()`; writes `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":<string>}}` to stdout; always exits 0. Runs main only when executed directly (`import.meta.url` vs `process.argv[1]` via `pathToFileURL`).
- Consumes: `hooks/guide.md` (read relative to the script via `import.meta.url`).

- [ ] **Step 1: Write failing tests** in `tests/session-start.test.mjs` (`node:test`, `node:assert/strict`, temp dirs via `fs.mkdtempSync(os.tmpdir())`):
  - `countUnchecked` → `"- [ ] a\r\n- [x] b\r\n- [X] c\r\n  - [ ] d\n"` returns `2`.
  - `findOpenTasks` on a root without `docs/qe` → `[]`.
  - Root with `docs/qe/README.md` (file) and `docs/qe/notes/` (dir with only `a.txt`) → `[]`.
  - Task `2026-11-01-a` with `spec.md`, `plan.md` all `[x]`, and `verify.md` → not returned (done).
  - Task `2026-11-02-b` with `plan.md` containing one `- [ ]` and `verify.md` → returned, `unchecked === 1`.
  - Task `2026-11-03-c` with only `spec.md` → returned, `hasPlan === false`.
  - `buildContext` with no tasks → equals the guide text (trimmed) and does not contain `미완료 작업`.
  - `buildContext` with an open task whose `handoff.md` is 20 000 chars → contains `미완료 작업`, contains `docs/qe/2026-11-02-b`, contains `잘림`, and total length < 8000 + guide length + 1000.
  - CLI: spawn `node hooks/session-start.mjs` with stdin `not json` (cwd = an empty temp dir) → exit code 0, stdout parses as JSON, `hookSpecificOutput.hookEventName === "SessionStart"`, `additionalContext` contains the guide's first line.
  - CLI: stdin `{"cwd":"<temp root with open task>","source":"compact"}` → `additionalContext` contains that task's handoff text.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (module `hooks/session-start.mjs` not found).

- [ ] **Step 3: Write `hooks/guide.md`**

Short (≤ 40 lines) Korean guide, first line `# QE — 이해 → 계획 → 실행 → 검증`. Says: 코딩 작업은 이 길을 탄다; 새 작업은 `Qunderstand`부터; 아주 작은 일(오타·한 줄)은 문서 없이 바로 하고 결과만 보고; 단계별 스킬 한 줄씩(Qunderstand/Qplan/Qexecute/Qverify/Qresume); 문서는 `docs/qe/YYYY-MM-DD-<주제>/`; 미완료 작업이 아래에 보이면 사용자에게 먼저 알리고 이어갈지 묻는다; 세션을 넘겨야 할 때는 `Qresume`.

- [ ] **Step 4: Implement `hooks/session-start.mjs`** with the exported functions above. Use only `node:fs`, `node:path`, `node:url`. Wrap every filesystem read in try/catch so one bad entry is skipped, never thrown.

- [ ] **Step 5: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs\"", "timeout": 5 }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add hooks tests package.json
git commit -m "feat: add session-start hook that resumes open qe tasks"
```

---

### Task 3: Qunderstand and Qplan skills

**Files:**
- Create: `skills/Qunderstand/SKILL.md`, `skills/Qplan/SKILL.md`, `skills/Qplan/spec-template.md`, `skills/Qplan/plan-template.md`

**Interfaces:**
- Consumes: doc folder convention from Global Constraints.
- Produces: `spec.md` and `plan.md` formats that Qexecute, Qverify, Qresume, and the hook read. `plan.md` steps are `- [ ]` checkbox lines, each followed by an indented `확인:` line saying how that step is checked.

Frontmatter for every skill: `name` and `description` only. `description` starts with "Use when…" and says when to trigger, not what the skill does step by step.

- [ ] **Step 1: Write `skills/Qunderstand/SKILL.md`**

Content (prose, why-first): 목적 — 만들기 전에 사용자가 정말 원하는 것과 이유를 안다. 먼저 저장소와 사용자가 가리킨 자료를 읽는다; 저장소가 답하는 것은 묻지 않는다. 한 번에 질문 하나, 답이 만들 것을 바꾸는 질문만; 이유를 모르면 열린 질문으로 묻는다. 이해한 부분은 사용자 말로 되들려주고, 사용자가 말한 것과 내가 채운 것을 구분한다. 접근 방식 2–3개를 장단점과 함께 따로 내놓고 하나를 추천해 사용자가 고르게 한다. 아주 작은 일이면 이 단계를 건너뛰고 그렇게 한다고 한 줄 말한다. 끝: 사용자가 접근을 고르면 `Qplan`으로 넘어간다. 사용자가 "그냥 해"라고 하면 질문을 멈추고 주요 선택을 한 줄로 밝힌 뒤 진행한다.

- [ ] **Step 2: Write `skills/Qplan/spec-template.md` and `plan-template.md`**

spec 섹션: 의도와 이유 / 목표·비목표 / 검토한 접근과 선택 이유 / 사용자가 정한 것 / 내가 정한 것(이유 포함) / 남은 판단. plan: 제목, spec 링크, `- [ ] 단계` + `  확인: <명령 또는 방법>` 반복. 각 템플릿에 "작은 일이면 섹션당 한 줄이면 충분" 문구.

- [ ] **Step 3: Write `skills/Qplan/SKILL.md`**

목적 — 이해한 것을 다음 세션의 AI와 미래의 사용자가 읽을 수 있게 남기고, 실행 가능한 단계로 나눈다. 폴더 `docs/qe/YYYY-MM-DD-<주제>/` 생성, 템플릿으로 spec.md·plan.md 작성. 각 단계는 결과를 확인할 수 있는 크기로, 확인 방법을 함께. 사용자에게 두 문서를 보여 주고 **승인받기 전에는 실행하지 않는다** (유일한 강한 게이트 — 이유: 잘못 이해한 채 만드는 비용이 가장 크다). 내가 정한 결정은 따로 표시해 사용자가 확인하게 한다. 승인 후 `Qexecute`.

- [ ] **Step 4: Verify**

Run: `node -e "for(const s of ['Qunderstand','Qplan']){const t=require('fs').readFileSync('skills/'+s+'/SKILL.md','utf8');const n=t.split('\n').length;if(!t.startsWith('---\nname: '+s+'\n')||!/\ndescription: /.test(t)||n>150){console.error(s,n);process.exit(1)}}console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add skills/Qunderstand skills/Qplan
git commit -m "feat: add Qunderstand and Qplan skills"
```

---

### Task 4: Qexecute and Qverify skills

**Files:**
- Create: `skills/Qexecute/SKILL.md`, `skills/Qverify/SKILL.md`, `skills/Qverify/verify-template.md`, `skills/Qverify/verifier-prompt.md`

**Interfaces:**
- Consumes: `spec.md`/`plan.md` format from Task 3.
- Produces: `verify.md` format the hook relies on (existence = 검증됨).

- [ ] **Step 1: Write `skills/Qexecute/SKILL.md`**

목적 — 승인된 계획대로 만들고, 진행을 plan.md에 남겨 세션이 끊겨도 이어갈 수 있게 한다. 승인된 plan.md가 없으면 시작하지 않고 `Qplan`으로 돌아간다. 단계마다 끝나면 `- [x]`로 바꾸고 그 단계의 확인을 실제로 돌린다. 계획과 현실이 어긋나면(계획이 틀렸거나 범위가 커짐) 멈추고 사용자에게 말한다 — 조용히 계획을 바꾸지 않는다. 단계를 서브에이전트에 맡길지는 모델이 판단(독립적인 단계가 여럿이면 유리). 컨텍스트가 차오르면 `Qresume`. 모든 단계가 끝나면 `Qverify`.

- [ ] **Step 2: Write `skills/Qverify/verify-template.md`**

섹션: 검증 주체(메인/서브에이전트)와 이유 / spec 목표별 결과(충족·미충족·확인 못 함, 근거) / 실행한 명령과 결과 요약 / 확인 못 한 것 / 남은 일.

- [ ] **Step 3: Write `skills/Qverify/verifier-prompt.md`**

서브에이전트용 프롬프트: spec.md·plan.md 경로와 변경 범위(`git diff <base>..HEAD`)를 받는다; 구현자의 설명을 믿지 말고 코드와 실행 결과로 spec의 각 목표를 확인; 직접 테스트·명령을 돌린다; 고치지 말고 보고만; 결과를 verify-template 섹션 형식으로 돌려준다.

- [ ] **Step 4: Write `skills/Qverify/SKILL.md`**

목적 — "됐다"고 말하기 전에 spec 대비 증거로 확인하고, 그 증거를 남긴다. 검증 주체는 상황에 따라 고른다: 작은 변경은 메인에서; 변경이 크거나 메인이 직접 많이 쓴 코드는 자기 채점을 피하려 `verifier-prompt.md`로 새 서브에이전트에 맡긴다. 고른 쪽과 이유를 verify.md 첫 섹션에 쓴다. 증거 없는 "통과"는 쓰지 않는다; 실패·미확인은 그대로 적는다. 결과를 사용자에게 짧게 보고하고, 미충족이 있으면 `Qexecute`로 돌아갈지 사용자와 정한다.

- [ ] **Step 5: Verify**

Run the Task 3 Step 4 command with `['Qexecute','Qverify']`.
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add skills/Qexecute skills/Qverify
git commit -m "feat: add Qexecute and Qverify skills"
```

---

### Task 5: Qresume skill

**Files:**
- Create: `skills/Qresume/SKILL.md`, `skills/Qresume/handoff-template.md`

**Interfaces:**
- Consumes: hook output (Task 2) — at session start the model already sees open tasks and the latest handoff.
- Produces: `handoff.md` in the active task folder, read by the hook.

- [ ] **Step 1: Write `skills/Qresume/handoff-template.md`**

섹션: 지금 어디까지(현재 단계, plan.md 기준) / 다음 할 일(첫 행동을 구체적으로) / 주의할 점(시도했다 버린 것, 사용자가 방금 정한 것) / 작업 중 파일. 작성 시각 한 줄.

- [ ] **Step 2: Write `skills/Qresume/SKILL.md`**

두 방향:
- **넘길 때:** 현재 작업 폴더에 handoff.md를 쓰거나 덮어쓴다 (plan.md 체크박스도 최신으로). 그다음 사용자에게 `/compact` 실행을 요청한다 — 모델은 `/compact`를 직접 실행할 수 없다. compact 뒤에는 hook이 handoff를 다시 넣어 준다.
- **이어받을 때:** 세션 시작 컨텍스트에 미완료 작업이 보이면, 사용자에게 무엇이 남았는지 한두 줄로 알리고 이어갈지 묻는다. 이어가면 spec.md·plan.md·handoff.md를 읽고 해당 단계 스킬로 들어간다. 작업 폴더가 없는데 넘겨야 하면 `docs/qe/YYYY-MM-DD-<주제>/handoff.md`만이라도 만든다.

- [ ] **Step 3: Verify**

Run the Task 3 Step 4 command with `['Qresume']`, then: `ls skills` → exactly `Qexecute Qplan Qresume Qunderstand Qverify`.
Expected: `ok`, five folders.

- [ ] **Step 4: Commit**

```bash
git add skills/Qresume
git commit -m "feat: add Qresume skill for session handoff"
```

---

### Task 6: Project docs

**Files:**
- Modify: `README.md` (rewrite), `AGENTS.md` (rewrite), `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Rewrite `README.md`** (Korean, short): 무엇인가(한 문단: 가벼운 길 하나, 모델 판단을 믿는다, 작업마다 spec·verify 문서), 설치(마켓플레이스 두 줄 — 기존 README의 `claude plugin marketplace add inho-team/qe-framework` / `claude plugin install qe-framework@inho-team-qe-framework`), 길 그림(spec의 다이어그램), 스킬 5개 표, `docs/qe/` 폴더 설명, v8 사용자 안내(CHANGELOG 링크).

- [ ] **Step 2: Rewrite `AGENTS.md`**: 프로젝트 이름·목적, 구조(`skills/`, `hooks/`, `tests/`, `docs/superpowers/`), 작업 규칙(스킬 5개 유지; 규칙 추가 시 "이게 없으면 모델이 실패하는가?" 기준; 세 파일 버전 동기화), 검증(`npm test`), 응답 언어(최근 사용자 메시지 언어).

- [ ] **Step 3: Update `CHANGELOG.md`**: replace the v8-era header policy text (it references `QE_CONVENTIONS.md`) with a short format note; move the existing `[Unreleased]` content under a `## [v8 미출시 변경 — 폐기]` note or delete it (it describes removed v8 behavior — delete, it was never released); add `## [9.0.0] - 2026-11-23` with: Changed (Breaking) — 전면 재작성, 스킬 5개; Removed — 목록(DB, hooks 6종, 에이전트 12개, core, scripts, Codex/Ollama, CI, npm 배포); 기존 사용자 안내 — 수동 삭제 절차 (`~/.claude/{commands,agents,hooks,scripts}`의 QE 사본, `~/.codex`의 QE skills/agents/hooks, `~/.codex/config.toml`의 QE hook fence 블록), 같은 이름(`Qplan`/`Qexecute`/`Qresume`)의 v8 사본이 v9와 충돌할 수 있다는 경고, 프로젝트의 `.qe/`는 v9가 쓰지 않으므로 필요 없으면 지워도 된다는 안내.

- [ ] **Step 4: Update `THIRD_PARTY_NOTICES.md`**: obra/superpowers entry's "Used in" → `Qunderstand, Qplan, Qexecute, Qverify, Qresume (workflow ideas and phrasing adapted)`; remove entries whose "Used in" skills no longer exist.

- [ ] **Step 5: Verify**

Run: `grep -rn "QE_CONVENTIONS\|qe\.db\|Qgoal\|Qcompact\|scripts/" README.md AGENTS.md THIRD_PARTY_NOTICES.md`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md CHANGELOG.md THIRD_PARTY_NOTICES.md
git commit -m "docs: rewrite project docs for v9"
```

---

### Task 7: End-to-end smoke check and npm deprecation

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Hook smoke run against this repo**

Run: `echo '{"cwd":"'"$PWD"'","source":"startup"}' | node hooks/session-start.mjs`
Expected: one JSON object; `additionalContext` starts with `# QE — 이해 → 계획 → 실행 → 검증`; exit 0.

- [ ] **Step 2: Plugin load check**

Run: `claude plugin validate .` (if the installed CLI has it; otherwise `claude --plugin-dir . -p "list your available skills whose names start with Q"`).
Expected: validation passes / the five Q skills are listed, and no v8 skill appears.

- [ ] **Step 3: Full tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 4: npm deprecation — ask the user first**

This publishes to the public npm registry. Stop and ask the user for explicit confirmation. Only after a yes, run:
`npm deprecate @inho-team/qe-framework "v9부터 npm 배포를 중단했습니다. Claude Code 플러그인으로 설치하세요: https://github.com/inho-team/qe-framework"`
Expected: command succeeds (requires the user's npm login).
