# QE Framework

**이해의 병목을 없애고 일을 효율적으로 처리하는 AI 프레임워크.**

QE는 Claude Code 플러그인이다. 스킬 몇 개로 된 길 하나를 정해 두고, 각 단계 안에서는
모델의 판단을 믿는다. 버그 수정, 기능 추가, 리팩터링, 조사, 기획이 모두 같은 길을 탄다.
단계별 일은 분야별 전문 에이전트(언어별 구현자, 레드팀, QA, 조사, 분석, 기획, 마케팅, 계약자)에
맡길 수 있다.
그리고 작업마다 **무엇을 왜 만드는지(plan)**와 **무엇을 어떻게 확인했는지(verify)**를
평범한 마크다운으로 남긴다. 진행 중에는 홈의 `~/.qe/tasks/`에 모여 여러 세션·worktree가 함께 보고,
독립 검증자(QA·레드팀)의 검수를 통과해야만 "완료"로 기록된 뒤 프로젝트 `docs/qe/`로 내보내진다.
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

### 코드 그래프

QE를 활성화하면 Claude Code에 `codebase-memory-mcp`가 등록된다. [Codebase Memory 릴리스](https://github.com/DeusData/codebase-memory-mcp/releases/latest)에서 플랫폼에 맞는 실행 파일을 받아 PATH에 추가한다. `codebase-memory-mcp --version`으로 설치를 확인하고 Claude Code를 다시 시작한다. Windows에서는 `codebase-memory-mcp.exe`가 들어 있는 폴더를 PATH에 추가하고 `codebase-memory-mcp.exe --version`으로 확인한다. `/mcp`에서 `plugin:qe-framework:codebase-memory-mcp`의 연결 상태를 볼 수 있다.

설치본이 여러 개라면 Claude Code가 쓰는 PATH에서 점검 대상 실행 파일의 폴더를 앞에 둔다.

Qunderstand는 심볼을 찾고, Qplan과 Qdebugging은 호출 경로를 조사하며, Qreview는 변경이 영향을 주는 심볼을 찾는다. 스킬은 현재 작업 트리의 인덱스를 쓰고, 그래프를 읽을 수 없으면 파일 검색으로 이어간다. 인덱스는 Codebase Memory가 관리하는 로컬 캐시다.

## 프로젝트 지침에 등록하기

아래 문단을 QE를 사용하는 프로젝트의 `CLAUDE.md`와 `AGENTS.md`에 추가한다. Claude Code에서는 플러그인을 설치하고, 스킬 도구가 없는 환경에서는 QE 저장소를 받아 아래 경로를 그 복사본의 실제 위치로 바꾼다. 이 저장소 자체에는 두 파일 모두 설정되어 있다.

```markdown
새 코딩 요청에 작업 이유(Why) 또는 관찰 가능한 완료 기준 중 하나라도 빠졌으면 계획·수정·디버깅 전에 반드시 Qunderstand를 먼저 호출한다. Claude Code에서는 Skill 도구로 qe-framework:Qunderstand를 호출한다. 스킬 도구가 없으면 <QE 저장소 경로>/skills/Qunderstand/SKILL.md를 읽고 따른다. 대화와 저장소에서 이미 확인할 수 있는 내용은 다시 묻지 않는다.
인터뷰를 진행한 창에서는 구현하지 않는다. 사용자가 의도를 확정하면 작업 폴더에 `intent.md`를 저장한다. 새 세션이 이 파일을 읽고 계획을 세운 뒤 승인을 받아 실행한다. 사용자가 서브에이전트를 고르면 인터뷰 창이 계획·실행·검증 단계를 조율하고, 계획 문서와 코드는 서브에이전트가 쓴다.
```

`Qunderstand`는 근거가 있는 추측을 드러내고, 정정된 의도로 범위와 접근 방식을 정한다. `Qplan`은 그 의도를 관찰 가능한 완료 기준과 실행 순서로 옮기고, 외부 기술의 버전별 근거와 계획을 뒤집을 반례를 확인한다. 이 흐름에 반영한 원본 스킬은 [출처 안내](THIRD_PARTY_NOTICES.md)에 있다.

## 길

```
이해        →  계획                 →  실행               →  검증        →  마무리
Qunderstand    Qplan                   Qexecute              Qverify         Qfinish
               (status.json,           (implement-plan.md    (독립 검수,     (docs/qe로 내보내기,
                plan.md,                체크 갱신)            verify.md,      merge / PR / 유지,
                implement-plan.md                             → done)         사용자가 고름)
                → 사용자 승인)

Qdebugging: 버그 작업의 시작, 또는 원인 모를 실패 → 근본 원인부터
Qtdd:       실행 안에서 테스트 먼저, 좋은 테스트의 조건
Qreview:    diff·브랜치·PR 독립 리뷰       Qfeedback: 리뷰 지적을 확인하고 반영·반박
Qreport:    분석을 HTML·아티팩트로 달라고 할 때 → 늘 같은 틀
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
| `Qverify` | "됐다"고 말하기 전에 검증자 서브에이전트(`qa`, 리뷰는 `redteam`)가 plan.md 목표 대비 증거로 확인하고 verify.md에 남긴다. 충족이면 status를 done으로. |
| `Qfinish` | 검증이 끝난 작업의 문서를 프로젝트 `docs/qe/`로 내보내고, merge·PR·유지 중 사용자가 고른 방식으로 닫는다. merge 결과에서 테스트를 다시 돌린다. |
| `Qtdd` | 테스트를 먼저 쓰고 실패를 본 뒤 구현한다. 좋은 테스트의 조건. |
| `Qreview` | diff·브랜치·PR을 새 서브에이전트가 독립적으로 리뷰한다. |
| `Qfeedback` | 리뷰 지적이 맞는지 확인하고 반영하거나 근거를 들어 반박한다. |
| `Qreport` | 분석·조사·디버깅 결과를 HTML·아티팩트로 달라고 할 때, 고정 틀(`report-frame.html`)에 내용만 채워 늘 같은 모양으로 보여 준다. |
| `Qskill` | 스킬을 만들거나 고칠 때: 바꾸기 전 상태로 먼저 돌려 실패를 보고, 이유로 쓴다. |
| `Qdebugging` | 버그·실패·예상 밖 동작에서 근본 원인을 찾기 전에는 고치지 않는다. 인터뷰를 거친 버그는 새 작업자가 조사하고 Qplan에서 승인을 받는다. |
| `Qcompact` | 세션을 넘길 때 handoff.md를 쓰고 `/compact`를 요청한다. |
| `Qresume` | 새 세션에서 미완료 작업과 handoff를 읽어 이어받는다. 다른 세션이 하던 목표도 이어받는다. |
| `Qboard` | 이 PC의 QE 목표, 살아 있는 세션, 주장과 증거가 어긋난 경고를 로컬 웹 화면 하나로 보여 준다(읽기 전용). |

인터뷰를 진행한 창에서는 구현하지 않는다. 사용자가 의도를 확정하면 작업 폴더에 `intent.md`를 저장한다. 새 세션이 이 파일을 읽고 계획을 세운 뒤 승인을 받아 실행한다. 사용자가 서브에이전트를 고르면 인터뷰 창이 계획·실행·검증 단계를 조율하고, 계획 문서와 코드는 서브에이전트가 쓴다.

새 세션에서 예를 들어 `~/.qe/tasks/2026-11-23-export/intent.md를 읽고 Qplan부터 이어가 줘`라고 요청한다. SessionStart 훅은 의도 문서 경로를 안내하며 빈 파일은 미확정으로 표시한다. 같은 인터뷰 창을 초기화해도 인계 역할을 유지한다. 재개한 창의 역할이 불분명하면 역할만 확인한다. 인터뷰가 필요 없는 작은 수정은 바로 처리한다.

인터뷰에서 의도를 약 95% 이해했다고 판단하면, 현재 해석이 틀릴 수 있는 구체적인 상황을 하나 들어 사용자에게 역질문한다. 답을 반영해 이유·완료 기준·제외 범위를 되짚고, 사용자가 확정하면 `intent.md`를 저장한다.

공통 규칙 스킬:

| 스킬 | 하는 일 |
|---|---|
| `code-craft` | 코드를 쓸 때(메인 세션과 코드 에이전트 모두) 문서 주석을 계약으로 쓰고, 사설 주석은 쓰지 않는다. |
| `agent-conduct` | 전문 에이전트가 미리 싣는 규칙: 맡은 범위만, 다른 에이전트·Q 스킬 호출 금지, 짧은 요약 + 근거로 보고. |

## 전문 에이전트

`agents/`에 있다. Claude Code에서 `@`를 입력해 `qe-framework:code-go` 같은 에이전트를
선택하거나 "레드팀으로 이 diff 봐줘"처럼 요청할 수 있다. Q 스킬도 단계에 맞게 골라 쓴다.

| 에이전트 | 하는 일 | Q 스킬에서 쓰는 곳 |
|---|---|---|
| `code-java` `code-kotlin` `code-go` `code-dart` `code-javascript` `code-typescript` `code-csharp` `code-cpp` `code-python` | 그 언어의 구현. 프로젝트 관례를 먼저 읽고, 언어 표준 문서 주석으로 계약을 단다 | Qexecute 구현자, Qplan 승인 직전 점검 |
| `code` | 전용 에이전트가 없는 언어, 셸 스크립트, 설정 파일 | Qexecute 구현자 |
| `planner` | 목표·대상·범위·수용 기준 문서. 코드는 쓰지 않는다 | Qplan 초안(기획 작업) |
| `researcher` | 출처를 단 사실 수집(웹·문서·코드베이스) | Qunderstand |
| `analyst` | 코드·요구사항·원인: 구조, 영향, 트레이드오프. 읽기 전용 | Qunderstand, Qdebugging |
| `data-analyst` | 로그·지표·데이터 분석. 원본 데이터는 바꾸지 않는다 | Qdebugging |
| `redteam` | 깨질 방법, 계약 위반, 보안 구멍을 찾는다. 고치지 않는다 | Qexecute 단계 리뷰어, Qverify 최종 리뷰 |
| `qa` | 직접 돌린 결과로 기준별 충족 판정 | Qverify 검증자 |
| `marketer` | 카피, 릴리스 노트, 사용자 대상 문서 | 주로 직접 호출 |
| `contractor` | `docs/contracts/`의 흐름 계약을 쓰고 고친다 | Qunderstand, Qverify |

쓰는 에이전트는 같은 작업 트리에 한 번에 하나만 돈다. 판단하는 에이전트(redteam, qa, analyst)는
고치지 않는다 — 판단하는 쪽이 고치기 시작하면 독립성이 사라진다.

### 디자인 패턴

서브에이전트 방식의 `Qexecute`는 단계의 주 언어에 맞춰 `qe-framework:code-<언어>`에 구현을
맡긴다. 전용 에이전트가 없는 언어는 `qe-framework:code`가 맡는다. 코드 에이전트는
`code-craft`와 `agent-conduct`를 공통으로 읽는다.

Java, Kotlin, Go, Dart, JavaScript, TypeScript, C#, C++, Python 에이전트는 설계 선택지가
생겼을 때 자기 언어의 `README.md`에서 관련 디자인 패턴 문서를 찾는다.
메인 세션은 `Qunderstand`에서 접근을 비교하거나 `Qexecute`에서 직접 구현할 때 같은 목차를
참고한다. 코드를 작성할 때 `code-craft`에서도 목차를 열 수 있다. 일반 구현자에게 지원
언어의 설계 판단을 맡길 때는 해당 언어 목차의 절대 경로를 함께 전달한다.
패턴마다 목적, 사용처, 장단점, 구현 방식과 서로 다른 코드 예시 세 가지를 담았다.
[언어별 디자인 패턴 목차](references/design-patterns/README.md)

## 작업 문서

작업(목표) 하나마다 홈 디렉터리의 `~/.qe/tasks/`에 폴더 하나가 생긴다(Windows `%USERPROFILE%\.qe\tasks\`).
`~/.qe`는 그 자체로 git 저장소라 hook이 상태가 바뀔 때마다 커밋해 이력을 남긴다.

```
~/.qe/tasks/2026-11-23-<주제>/
  status.json          목표, 프로젝트, 관여한 worktree·세션(hook이 기록), 상태(active / verifying / done / stopped)
  intent.md            인터뷰에서 확정한 이유, 완료 기준, 이번에 하지 않을 일
  plan.md              사용자가 읽고 승인하는 계획: 의도와 이유, 목표/비목표, 진행 순서, 검토한 접근, 결정
  implement-plan.md    AI가 실행하는 상세 계획: 바뀌는 파일, 단계(체크박스), 단계별 확인 방법
  verify.md            무엇을 어떻게 확인했는지, 확인 못 한 것, 남은 일
  handoff.md           세션을 넘길 때만: 어디까지, 다음 할 일, 주의할 점
  verdicts/            검증자의 검수 기록(hook만 쓴다)
  report.html          분석을 HTML·아티팩트로 달라고 할 때만 (Qreport). 새 보고서는 report-2.html, …
```

작업 없이 보고서만 달라고 하면 `report.html`만 있고 `status.json`이 없는 폴더가 생긴다. 이런 폴더는 세션 시작 때
미완료 작업으로 안내되지 않는다.

흐름은 이렇다.

1. **시작** — Qplan(또는 Qcompact)이 폴더를 만들며 `status.json`을 `active`로 쓴다.
2. **진행** — 어느 세션이든 같은 폴더를 갱신한다. 이 폴더에 쓸 때마다 PostToolUse hook이 그 세션과 worktree를 기록한다.
3. **검수** — 체크박스가 다 차면 Qverify가 검증자 서브에이전트(`qe-framework:qa`)와 리뷰어(`qe-framework:redteam`)를 띄운다. 검증자 보고의 마지막 줄
   `QE-VERDICT: <목표> | <충족|일부 미충족|미충족> | <브랜치> | <커밋>`을 SubagentStop hook이 `verdicts/`에 기록한다.
   검수 없이 응답을 끝내려 하면 Stop hook이 한 번 막고 검수를 요청한다.
4. **done** — 그 커밋에 대한 충족 기록이 있을 때만 `state: done`을 쓸 수 있다. 없으면 PreToolUse hook이 거부한다.
   done이 된 뒤 `done.commit`을 다른 커밋으로 옮길 때도 그 커밋의 충족 기록이 있어야 한다.
5. **내보내기** — Qfinish가 고른 마무리를 status.json `done.finish`(`merge` | `pr` | `keep`)에 쓰고, `*.md`와 보고서(`report*.html`)를 검증한
   브랜치의 `docs/qe/<목표>/`로 복사하고, 커밋은 사용자에게 묻는다.
   `~/.qe`의 폴더는 이후 고치지 않는 보관본으로 남는다.

DB나 전용 도구 없이 어떤 편집기로도 읽힌다. 전체 상황은 `Qboard`로 한 화면에서 본다.

관문 hook은 "검수를 빼먹거나 잊는" 경우를 막는다. Bash로 `status.json`을 직접 고치는 식의 의도적인 우회는
막지 않는다. 그런 흔적은 `~/.qe` git 이력과 Qboard 경고로 드러난다.

## 계약 문서

`docs/contracts/<흐름-이름>.md`에는 **지금 코드가 실제로 돌아가는 방식**이 쌓인다: Mermaid 순서도,
단계별 코드 위치, 특이사항(숨은 규칙, 예외 경로, 순서 의존, 함정), 맞춰 본 커밋. 작업 문서와 달리
작업이 끝나도 유지된다. 원본은 코드이고, 다르면 계약을 고친다.

계약은 필요할 때 생긴다. Qunderstand는 `docs/contracts/` 폴더를 처음 만들 때 동의를 받고,
건드릴 흐름에 계약이 없으면 `qe-framework:contractor`에게 맡긴다. Qverify는 최종 코드가 바꾼
흐름의 계약을 같은 [양식](skills/Qunderstand/contract-template.md)으로 갱신한다.

## 행동 확인 (eval)

`evals/`에 Claude Code의 `claude plugin eval`로 도는 케이스가 있다. 실제 세션을 돌리므로 시간과 사용량이 든다.

- `npm run eval:trigger` — 상황에 맞는 스킬이 불리는지
- `npm run eval:gate` — 길을 지키는지(기능 요청에 바로 코드부터 쓰지 않기, 원인 먼저, 근거 없는 완료를 믿지 않기, 작은 일은 바로). 플러그인 없이 돌린 결과와 함께 보여 준다. 인터뷰 사례와 인계·리뷰 동의·접근 비교 사례는 같은 실행에서 모든 기준을 충족한 횟수로 판정한다(3회 중 2회 이상). 사례의 fixture를 만들고(`--scaffold`) 작업자가 `~/.qe` 목표 폴더에 쓸 수 있게 허용한다.

### QE 업데이트 점검 순서

1. 설치한 실행 파일의 버전을 [업스트림 릴리스](https://github.com/DeusData/codebase-memory-mcp/releases)와 비교한다. 새 버전이 있으면 릴리스 노트를 읽고 해당 버전으로 아래 연동을 확인한다. 아래 도구 입력은 `0.12.1`의 MCP 응답에서 확인했다.
2. `claude --plugin-dir .`로 열고 `/mcp`에서 QE 서버의 연결과 도구 입력을 확인한다. 스킬에서 쓰는 도구는 `list_projects`, `index_repository`(`repo_path`), `search_graph`(`project`, `name_pattern`), `trace_path`(`project`, `function_name`, `direction`), `detect_changes`(`project`, `scope`)다. 이름, 필수 인자, 사용 중인 값이 달라졌으면 해당 호출 안내와 eval을 맞춘다.
3. `npm test`, `npm run eval:trigger`, `npm run eval:gate`, `npm run eval:codebase-memory`를 실행한다. 마지막 명령은 임시 저장소를 만들고 실제 MCP 서버로 호출 경로를 확인한다. 그래프 eval이 실패하면 연결 상태, 인덱스 경로와 MCP 오류를 확인해 수정한 뒤 다시 실행한다. 통과한 케이스 수를 CHANGELOG에 기록하고 모두 통과한 뒤 릴리스한다.

Windows에서 그래프 eval의 `scaffold failed`에 WSL 오류가 나타나면 Git Bash에서 다시 실행하거나, PowerShell의 PATH 앞에 Git for Windows의 `bin` 폴더를 추가한다. 기본 설치 경로는 `C:\Program Files\Git\bin`이다.

그래프 eval은 실행한 셸의 `CBM_CACHE_DIR`과 `CBM_RUNTIME_DIR` 설정을 MCP 서버에 전달한다. 사용자 지정 경로로 설치한 경우 평소에 Codebase Memory를 실행하는 셸에서 점검한다.

## 저장소 개발 검사

`npm ci`로 개발 의존성을 설치한 뒤 `npm test`를 실행하면 훅의 린트와 테스트를 함께 확인합니다.
`npm run lint`는 훅의 `.mjs` 파일에서 `Error("Not implemented")`를 던지는 경로를 찾아 수정 방향을 안내합니다.
주석 작성 원칙과 호출 경로를 추적하는 방법은 [AGENTS.md](AGENTS.md)에 있습니다.

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
