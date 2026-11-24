# QE Framework

**이해의 병목을 없애고 일을 효율적으로 처리하는 AI 프레임워크.**

QE는 Claude Code 플러그인이다. 스킬 몇 개로 된 길 하나를 정해 두고, 각 단계 안에서는
모델의 판단을 믿는다. 버그 수정, 기능 추가, 리팩터링, 조사, 기획이 모두 같은 길을 탄다.
단계별 일은 분야별 전문 에이전트(언어별 구현자, 레드팀, QA, 조사, 분석, 기획, 마케팅, 계약자)에
맡길 수 있다.
그리고 작업마다 **무엇을 왜 만드는지(plan)**와 **무엇을 어떻게 확인했는지(verify)**를
저장소 안의 평범한 마크다운으로 남긴다. 사용자 본인은 나중에 "왜 이렇게 만들었지?"를,
다음 세션의 AI는 "어디까지 했고 다음은 뭐지?"를 이 문서에서 찾는다.

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

## 길

```
이해        →  계획                 →  실행               →  검증        →  마무리
Qunderstand    Qplan                   Qexecute              Qverify         Qfinish
               (plan.md,               (implement-plan.md    (verify.md)     (merge / PR / 유지,
                implement-plan.md       체크 갱신)                            사용자가 고름)
                → 사용자 승인)

Qdebugging: 버그 작업의 시작, 또는 원인 모를 실패 → 근본 원인부터
Qtdd:       실행 안에서 테스트 먼저, 좋은 테스트의 조건
Qreview:    diff·브랜치·PR 독립 리뷰       Qfeedback: 리뷰 지적을 확인하고 반영·반박
Qskill:     스킬을 만들거나 고칠 때
Qcompact:   세션을 넘길 때 handoff.md 작성 → /compact 요청
Qresume:    새 세션이 시작되면 미완료 작업 이어받기
```

| 스킬 | 하는 일 |
|---|---|
| `Qunderstand` | 만들기 전에 원하는 것과 이유를 대화로 알아낸다. 질문은 한 번에 하나, 접근 방식은 2–3개 비교 후 추천. |
| `Qplan` | plan.md(사용자용)와 implement-plan.md(AI용)를 쓰고 사용자 승인을 받는다. 실행 방식(서브에이전트 / 직접)도 함께 정한다. |
| `Qexecute` | 승인된 계획대로 만들고 implement-plan.md 체크박스를 갱신한다. |
| `Qverify` | "됐다"고 말하기 전에 plan.md 목표 대비 증거로 확인하고 verify.md에 남긴다. 메인 또는 서브에이전트가 검증. |
| `Qfinish` | 검증이 끝난 작업을 merge·PR·유지 중 사용자가 고른 방식으로 닫는다. merge 결과에서 테스트를 다시 돌린다. |
| `Qtdd` | 테스트를 먼저 쓰고 실패를 본 뒤 구현한다. 좋은 테스트의 조건. |
| `Qreview` | diff·브랜치·PR을 새 서브에이전트가 독립적으로 리뷰한다. |
| `Qfeedback` | 리뷰 지적이 맞는지 확인하고 반영하거나 근거를 들어 반박한다. |
| `Qskill` | 스킬을 만들거나 고칠 때: 바꾸기 전 상태로 먼저 돌려 실패를 보고, 이유로 쓴다. |
| `Qdebugging` | 버그·실패·예상 밖 동작에서 근본 원인을 찾기 전에는 고치지 않는다. 작은 수정은 바로, 큰 수정은 Qplan으로. |
| `Qcompact` | 세션을 넘길 때 handoff.md를 쓰고 `/compact`를 요청한다. |
| `Qresume` | 새 세션에서 미완료 작업과 handoff를 읽어 이어받는다. |

아주 작은 일(오타, 한 줄 수정)은 문서 없이 바로 한다.

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

## 작업 문서

작업 하나마다 사용자 프로젝트에 폴더 하나가 생긴다.

```
docs/qe/2026-11-23-<주제>/
  plan.md              사용자가 읽고 승인하는 계획: 의도와 이유, 목표/비목표, 진행 순서, 검토한 접근, 결정
  implement-plan.md    AI가 실행하는 상세 계획: 바뀌는 파일, 단계(체크박스), 단계별 확인 방법
  verify.md            무엇을 어떻게 확인했는지, 확인 못 한 것, 남은 일
  handoff.md           세션을 넘길 때만: 어디까지, 다음 할 일, 주의할 점
```

DB나 전용 도구 없이 어떤 편집기로도 읽힌다. 진행 상태는 implement-plan.md 체크박스와
verify.md의 `결과:` 줄로 알 수 있다.

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
- `npm run eval:gate` — 길을 지키는지(기능 요청에 바로 코드부터 쓰지 않기, 원인 먼저, 근거 없는 완료를 믿지 않기, 작은 일은 바로). 플러그인 없이 돌린 결과와 함께 보여 준다.

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

## v9에서 오는 경우

v10부터 `spec.md`는 `plan.md`로, 예전 `plan.md`는 `implement-plan.md`로 바뀌었다. 예전 이름의 작업 폴더는
세션 시작 안내가 제대로 알아보지 못한다(`spec.md`만 있으면 목록에서 빠지고, 예전 `plan.md`는 "계획 중"으로 보인다). 옮기는 방법은 [CHANGELOG.md](CHANGELOG.md#1000---2026-11-23)에 있다.

## v8에서 오는 경우

v9는 전면 재작성이다. 남은 v8 파일을 정리하는 방법은
[CHANGELOG.md](CHANGELOG.md#900---2026-11-23)에 있다. 마지막 v8 상태는 커밋 `098bee2`, 마지막 v8 출시는 태그 `v8.3.0`이다.

## 라이선스

MIT. 워크플로 아이디어와 문장 일부는 [obra/superpowers](https://github.com/obra/superpowers)(MIT)를
바탕으로 했다 — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
