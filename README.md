# QE Framework

**코딩 작업을 위한 길 하나: 이해 → 계획 → 실행 → 검증.**

QE는 Claude Code 플러그인이다. 스킬 7개로 된 길 하나를 정해 두고, 각 단계 안에서는
모델의 판단을 믿는다. 버그 수정, 기능 추가, 리팩터링이 모두 같은 길을 탄다.
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

## v8에서 오는 경우

v9는 전면 재작성이다. 남은 v8 파일을 정리하는 방법은
[CHANGELOG.md](CHANGELOG.md#900---2026-11-23)에 있다. 마지막 v8 상태는 커밋 `098bee2`, 마지막 v8 출시는 태그 `v8.3.0`이다.

## 라이선스

MIT. 워크플로 아이디어와 문장 일부는 [obra/superpowers](https://github.com/obra/superpowers)(MIT)를
바탕으로 했다 — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
