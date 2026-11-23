---
name: Qresume
description: Use when a session must be handed over (context is filling up, the user wants to stop or compact, or work will continue later), and at session start when the injected context lists unfinished docs/qe tasks or a handoff.
---

# Qresume — 이어받기

대화는 compact나 새 세션에서 사라진다. 문서는 남는다. 이 스킬의 목적은 **다음 세션이
처음부터 다시 묻거나, 끝낸 일을 다시 하지 않게 하는 것**이다.

이 스킬은 두 방향으로 쓴다.

## 넘길 때

컨텍스트가 차오를 때, 사용자가 멈추거나 compact하려 할 때, 나중에 이어 할 때.

1. **현재 작업 폴더를 찾는다** (`docs/qe/YYYY-MM-DD-<주제>/`). 아직 없으면(이해 단계 중이었다면)
   폴더를 만들고 handoff.md만이라도 둔다. 대화에서 나온 것을 잃지 않는 게 먼저다.
2. **plan.md 체크박스를 최신으로** 맞춘다. 끝난 단계가 `- [ ]`로 남아 있으면 다음 세션이 다시 한다.
3. **handoff.md를 쓴다** ([handoff-template.md](handoff-template.md)). 이미 있으면 덮어쓴다.
   - "다음 할 일"은 새 세션이 바로 손댈 수 있을 만큼 구체적으로.
   - 사용자가 방금 정했지만 spec.md에 아직 없는 결정은 spec.md에도 반영한다.
   - 시도했다가 버린 방법을 적는다. 다음 세션이 같은 막다른 길로 가지 않게.
4. git이면 문서를 커밋할지 사용자에게 묻는다(작업 중 코드와 섞이지 않게).
5. **사용자에게 `/compact` 실행을 요청한다.** 나는 `/compact`를 직접 실행할 수 없다.
   compact가 끝나면 세션 시작 hook이 미완료 작업과 이 handoff를 다시 넣어 준다.
   사용자가 세션을 닫으려는 것이라면 compact 대신 그냥 닫아도 된다고 알린다.
   다음에 열면 같은 방식으로 이어진다.

## 이어받을 때

세션 시작 컨텍스트에 "미완료 작업"이나 "최근 handoff"가 보일 때.

1. **사용자가 먼저 다른 일을 요청했으면** 그 일을 방해하지 않는다. 답의 끝에 남은 작업이
   있다고 한 줄만 알린다.
2. 그렇지 않으면, 무엇이 남았는지 한두 줄로 알리고 이어갈지 묻는다. 여러 개면 가장 최근
   것을 먼저 말한다.
3. 이어가면 그 폴더의 spec.md, plan.md, handoff.md, (있으면) verify.md를 읽는다.
   **내 기억보다 문서와 `git log`를 믿는다.** compact 직후라면 특히 그렇다.
4. 현재 단계에 맞는 스킬로 들어간다.
   - plan.md가 없다 → `Qunderstand` 또는 `Qplan`
   - 승인 안 된 plan.md → `Qplan`의 승인부터
   - 미체크 단계가 있다 → `Qexecute`
   - 모두 체크, verify.md 없음 또는 미충족 → `Qverify`
5. handoff.md의 "다음 할 일"부터 시작한다. 끝난 handoff는 지우지 않아도 된다.
   다음에 넘길 때 덮어쓴다.

## 하지 않는 것

- 작업 상태를 따로 저장하는 파일이나 DB를 만들지 않는다. 상태는 plan.md 체크박스와
  verify.md, handoff.md에서 읽힌다.
- 사용자에게 이전 대화 내용을 다시 설명해 달라고 하지 않는다. 문서에 없으면 그때만 묻는다.
