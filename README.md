# QE Framework

**이해의 병목을 없애고 일을 효율적으로 처리하는 AI 프레임워크: 이해 → 계획 → 실행 → 검증.**

QE는 Claude Code 플러그인이다. 스킬 몇 개로 된 길 하나를 정해 두고, 각 단계 안에서는
모델의 판단을 믿는다. 버그 수정, 기능 추가, 리팩터링, 조사, 기획이 모두 같은 길을 탄다.
단계별 일은 분야별 전문 에이전트(언어별 구현자, 레드팀, QA, 조사, 분석, 기획, 마케팅, 계약자)에
맡길 수 있다.
그리고 작업마다 **무엇을 왜 만들었는지(spec)**와 **무엇을 어떻게 확인했는지(verify)**를
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

## 길

```
이해        →  계획(Spec)        →  실행      →  검증
Qunderstand    Qplan                Qexecute     Qverify
               (spec.md, plan.md    (plan.md     (verify.md)
                → 사용자 승인)        체크 갱신)

Qdebugging: 버그 작업의 시작, 또는 원인 모를 실패 → 근본 원인부터
Qcompact:   세션을 넘길 때 handoff.md 작성 → /compact 요청
Qresume:    새 세션이 시작되면 미완료 작업 이어받기
```

| 스킬 | 하는 일 |
|---|---|
| `Qunderstand` | 만들기 전에 원하는 것과 이유를 대화로 알아낸다. 질문은 한 번에 하나, 접근 방식은 2–3개 비교 후 추천. |
| `Qplan` | spec.md와 plan.md를 쓰고 사용자 승인을 받는다. 실행 방식(서브에이전트 / 직접)도 함께 정한다. |
| `Qexecute` | 승인된 계획대로 만들고 plan.md 체크박스를 갱신한다. |
| `Qverify` | "됐다"고 말하기 전에 spec 대비 증거로 확인하고 verify.md에 남긴다. 메인 또는 서브에이전트가 검증. |
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
  spec.md      의도와 이유, 목표/비목표, 검토한 접근, 결정
  plan.md      단계 목록(체크박스)과 단계별 확인 방법
  verify.md    무엇을 어떻게 확인했는지, 확인 못 한 것, 남은 일
  handoff.md   세션을 넘길 때만: 어디까지, 다음 할 일, 주의할 점
```

DB나 전용 도구 없이 어떤 편집기로도 읽힌다. 진행 상태는 plan.md 체크박스와
verify.md의 `결과:` 줄로 알 수 있다.

## 계약 문서

`docs/contracts/<흐름-이름>.md`에는 **지금 코드가 실제로 돌아가는 방식**이 쌓인다: Mermaid 순서도,
단계별 코드 위치, 특이사항(숨은 규칙, 예외 경로, 순서 의존, 함정), 맞춰 본 커밋. 작업 문서와 달리
작업이 끝나도 유지된다. 원본은 코드이고, 다르면 계약을 고친다.

계약은 필요할 때 생긴다. Qunderstand는 `docs/contracts/` 폴더를 처음 만들 때 동의를 받고,
건드릴 흐름에 계약이 없으면 `qe-framework:contractor`에게 맡긴다. Qverify는 최종 코드가 바꾼
흐름의 계약을 같은 [양식](skills/Qunderstand/contract-template.md)으로 갱신한다.

## v8에서 오는 경우

v9는 전면 재작성이다. 남은 v8 파일을 정리하는 방법은
[CHANGELOG.md](CHANGELOG.md#900---2026-11-23)에 있다. 마지막 v8 상태는 커밋 `098bee2`, 마지막 v8 출시는 태그 `v8.3.0`이다.

## 라이선스

MIT. 워크플로 아이디어와 문장 일부는 [obra/superpowers](https://github.com/obra/superpowers)(MIT)를
바탕으로 했다 — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
