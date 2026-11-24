# QE Framework

**코딩 작업을 위한 길 하나: 이해 → 계획 → 실행 → 검증 → 마무리.**

QE는 Claude Code 플러그인이다. 스킬 몇 개로 된 길 하나를 정해 두고, 각 단계 안에서는
모델의 판단을 믿는다. 버그 수정, 기능 추가, 리팩터링이 모두 같은 길을 탄다.
그리고 작업마다 **무엇을 왜 만드는지(plan)**와 **무엇을 어떻게 확인했는지(verify)**를
평범한 마크다운으로 남긴다. 진행 중에는 홈의 `~/.qe/tasks/`에 모여 여러 세션·worktree가 함께 보고,
독립 검증자(레드팀)의 검수를 통과해야만 "완료"로 기록된 뒤 프로젝트 `docs/qe/`로 내보내진다.
사용자 본인은 나중에 "왜 이렇게 만들었지?"를, 다음 세션의 AI는 "어디까지 했고 다음은 뭐지?"를 이 문서에서 찾는다.

## 설치

```bash
claude plugin marketplace add inho-team/qe-framework
claude plugin install qe-framework@inho-team-qe-framework
```

`Host key verification failed`가 나면 git을 HTTPS로 쓰게 한 뒤 다시 시도한다:

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

`claude plugin update`가 같은 오류로 실패할 때도 이 설정으로 해결된다(설치는 HTTPS로 자동 우회하지만 업데이트는 그렇지 않다).

Windows에서는 Git for Windows(Git Bash)가 필요하다. Git Bash가 없으면 Claude Code가 hook을 PowerShell로 실행해 세션 시작 안내가 빠진다(스킬은 그대로 동작한다).

세션 시작 hook은 PATH에서 node를 못 찾으면 흔한 설치 위치(Volta, scoop, fnm, nvm, Homebrew,
`C:\Program Files\nodejs` 등)를 한 번 더 찾는다. node가 다른 곳에 있다면 환경 변수
`QE_NODE_PROBES`에 node 실행 파일 경로를 콜론(`:`)으로 구분해 적으면 그 목록만 찾는다.
Windows에서는 Git Bash 형식으로 적는다(예: `/c/tools/node/node.exe`). `C:…` 형식은 콜론에서 쪼개진다.

## 길

```
이해        →  계획                 →  실행               →  검증        →  마무리
Qunderstand    Qplan                   Qexecute              Qverify         Qfinish
               (status.json,           (implement-plan.md    (레드팀 검수,   (docs/qe로 내보내기,
                plan.md,                체크 갱신)            verify.md,      merge / PR / 유지,
                implement-plan.md                             → done)         사용자가 고름)
                → 사용자 승인)

Qdebugging: 버그 작업의 시작, 또는 원인 모를 실패 → 근본 원인부터
Qtdd:       실행 안에서 테스트 먼저, 좋은 테스트의 조건
Qreview:    diff·브랜치·PR 독립 리뷰       Qfeedback: 리뷰 지적을 확인하고 반영·반박
Qskill:     스킬을 만들거나 고칠 때
Qcompact:   세션을 넘길 때 handoff.md 작성 → /compact 요청
Qresume:    새 세션이 시작되면 미완료 작업 이어받기
Qboard:     이 PC의 목표·세션·어긋남 경고를 한 화면으로
```

| 스킬 | 하는 일 |
|---|---|
| `Qunderstand` | 만들기 전에 원하는 것과 이유를 대화로 알아낸다. 질문은 한 번에 하나, 접근 방식은 2–3개 비교 후 추천. |
| `Qplan` | plan.md(사용자용)와 implement-plan.md(AI용)를 쓰고 사용자 승인을 받는다. 실행 방식(서브에이전트 / 직접)도 함께 정한다. |
| `Qexecute` | 승인된 계획대로 만들고 implement-plan.md 체크박스를 갱신한다. |
| `Qverify` | "됐다"고 말하기 전에 검증자 서브에이전트(레드팀)가 plan.md 목표 대비 증거로 확인하고 verify.md에 남긴다. 충족이면 status를 done으로. |
| `Qfinish` | 검증이 끝난 작업의 문서를 프로젝트 `docs/qe/`로 내보내고, merge·PR·유지 중 사용자가 고른 방식으로 닫는다. merge 결과에서 테스트를 다시 돌린다. |
| `Qtdd` | 테스트를 먼저 쓰고 실패를 본 뒤 구현한다. 좋은 테스트의 조건. |
| `Qreview` | diff·브랜치·PR을 새 서브에이전트가 독립적으로 리뷰한다. |
| `Qfeedback` | 리뷰 지적이 맞는지 확인하고 반영하거나 근거를 들어 반박한다. |
| `Qskill` | 스킬을 만들거나 고칠 때: 바꾸기 전 상태로 먼저 돌려 실패를 보고, 이유로 쓴다. |
| `Qdebugging` | 버그·실패·예상 밖 동작에서 근본 원인을 찾기 전에는 고치지 않는다. 작은 수정은 바로, 큰 수정은 Qplan으로. |
| `Qcompact` | 세션을 넘길 때 handoff.md를 쓰고 `/compact`를 요청한다. |
| `Qresume` | 새 세션에서 미완료 작업과 handoff를 읽어 이어받는다. 다른 세션이 하던 목표도 이어받는다. |
| `Qboard` | 이 PC의 QE 목표, 살아 있는 세션, 주장과 증거가 어긋난 경고를 로컬 웹 화면 하나로 보여 준다(읽기 전용). |

아주 작은 일(오타, 한 줄 수정)은 문서 없이 바로 한다.

## 작업 문서

작업(목표) 하나마다 홈 디렉터리의 `~/.qe/tasks/`에 폴더 하나가 생긴다(Windows `%USERPROFILE%\.qe\tasks\`).
`~/.qe`는 그 자체로 git 저장소라 hook이 상태가 바뀔 때마다 커밋해 이력을 남긴다.

```
~/.qe/tasks/2026-11-23-<주제>/
  status.json          목표, 프로젝트, 관여한 worktree·세션(hook이 기록), 상태(active / verifying / done / stopped)
  plan.md              사용자가 읽고 승인하는 계획: 의도와 이유, 목표/비목표, 진행 순서, 검토한 접근, 결정
  implement-plan.md    AI가 실행하는 상세 계획: 바뀌는 파일, 단계(체크박스), 단계별 확인 방법
  verify.md            무엇을 어떻게 확인했는지, 확인 못 한 것, 남은 일
  handoff.md           세션을 넘길 때만: 어디까지, 다음 할 일, 주의할 점
  verdicts/            검증자의 검수 기록(hook만 쓴다)
```

흐름은 이렇다.

1. **시작** — Qplan(또는 Qcompact)이 폴더를 만들며 `status.json`을 `active`로 쓴다.
2. **진행** — 어느 세션이든 같은 폴더를 갱신한다. 이 폴더에 쓸 때마다 PostToolUse hook이 그 세션과 worktree를 기록한다.
3. **레드팀** — 체크박스가 다 차면 Qverify가 검증자 서브에이전트를 띄운다. 검증자 보고의 마지막 줄
   `QE-VERDICT: <목표> | <충족|일부 미충족|미충족> | <브랜치> | <커밋>`을 SubagentStop hook이 `verdicts/`에 기록한다.
   검수 없이 응답을 끝내려 하면 Stop hook이 한 번 막고 검수를 요청한다.
4. **done** — 그 커밋에 대한 충족 기록이 있을 때만 `state: done`을 쓸 수 있다. 없으면 PreToolUse hook이 거부한다.
5. **내보내기** — Qfinish가 고른 마무리를 status.json `done.finish`(`merge` | `pr` | `keep`)에 쓰고, `*.md`를 검증한
   브랜치의 `docs/qe/<목표>/`로 복사하고, 커밋은 사용자에게 묻는다.
   `~/.qe`의 폴더는 이후 고치지 않는 보관본으로 남는다.

DB나 전용 도구 없이 어떤 편집기로도 읽힌다. 전체 상황은 `Qboard`로 한 화면에서 본다.

관문 hook은 "검수를 빼먹거나 잊는" 경우를 막는다. Bash로 `status.json`을 직접 고치는 식의 의도적인 우회는
막지 않는다. 그런 흔적은 `~/.qe` git 이력과 Qboard 경고로 드러난다.

## 행동 확인 (eval)

`evals/`에 Claude Code의 `claude plugin eval`로 도는 케이스가 있다. 실제 세션을 돌리므로 시간과 사용량이 든다.

- `npm run eval:trigger` — 상황에 맞는 스킬이 불리는지
- `npm run eval:gate` — 길을 지키는지(기능 요청에 바로 코드부터 쓰지 않기, 원인 먼저, 근거 없는 완료를 믿지 않기, 작은 일은 바로). 플러그인 없이 돌린 결과와 함께 보여 준다.

릴리스 전에 돌려, 통과 못 한 케이스가 있으면 아직 내보낼 때가 아니다.

## v10에서 오는 경우

v11부터 작업 폴더는 프로젝트 `docs/qe/`가 아니라 `~/.qe/tasks/`에 있다. 예전 위치의 미완료 작업은 세션 시작 안내에
"이전 위치"로 계속 보인다. 이어가려면 그 폴더를 `~/.qe/tasks/`로 옮기고 `status.json`을 만든다
([CHANGELOG.md](CHANGELOG.md#1100---2026-11-24)).

## v9에서 오는 경우

v10부터 `spec.md`는 `plan.md`로, 예전 `plan.md`는 `implement-plan.md`로 바뀌었다. 예전 이름의 작업 폴더는
세션 시작 안내가 제대로 알아보지 못한다(`spec.md`만 있으면 목록에서 빠지고, 예전 `plan.md`는 "계획 중"으로 보인다). 옮기는 방법은 [CHANGELOG.md](CHANGELOG.md#1000---2026-11-23)에 있다.

## v8에서 오는 경우

v9는 전면 재작성이다. 남은 v8 파일을 정리하는 방법은
[CHANGELOG.md](CHANGELOG.md#900---2026-11-23)에 있다. 마지막 v8 상태는 커밋 `098bee2`, 마지막 v8 출시는 태그 `v8.3.0`이다.

## 라이선스

MIT. 워크플로 아이디어와 문장 일부는 [obra/superpowers](https://github.com/obra/superpowers)(MIT)를
바탕으로 했다 — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
