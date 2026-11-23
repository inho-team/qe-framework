---
name: Qresume
description: Use when a session starts (or after /compact or /clear) and the injected context lists unfinished docs/qe tasks or a recent handoff, or when the user asks to continue earlier work.
---

# Qresume — 이어받기

이 스킬의 목적은 **끊긴 작업을 처음부터 다시 묻거나 끝낸 일을 다시 하지 않고 이어가는 것**이다.
넘기는 쪽은 `Qcompact`가 맡는다.

세션 시작 hook이 `docs/qe/`의 미완료 작업 목록과 가장 최근 handoff를 컨텍스트에 넣어 준다.
그 내용이 보이거나, 사용자가 "이어서 하자"고 할 때 쓴다.

## 순서

1. **사용자가 먼저 다른 일을 요청했으면** 그 일을 막지 않는다. 답의 끝에 남은 작업이
   있다고 한 줄만 알린다.
2. 그렇지 않으면, 무엇이 남았는지 한두 줄로 알리고 이어갈지 묻는다. 여러 개면 가장 최근
   것을 먼저 말한다.
3. 이어가면 그 폴더의 spec.md, plan.md, handoff.md, (있으면) verify.md를 읽는다.
   **내 기억보다 문서와 `git log`를 믿는다.** compact 직후라면 특히 그렇다.
4. 현재 단계에 맞는 스킬로 들어간다.
   - handoff.md만 있다 → handoff를 보고 `Qunderstand` 또는 `Qdebugging`
   - plan.md가 없다 → `Qunderstand`(버그면 `Qdebugging`) 또는 `Qplan`
   - 승인 안 된 plan.md → `Qplan`의 승인부터
   - 미체크 단계가 있다 → `Qexecute`
   - 모두 체크, verify.md 없음 → `Qverify`
   - verify.md 결과가 미충족 → 원인을 알면 `Qexecute`, 모르면 `Qdebugging`
5. handoff.md의 "다음 할 일"부터 시작한다. 끝난 handoff는 지우지 않아도 된다.
   다음에 넘길 때 `Qcompact`가 덮어쓴다.

## 그만두는 작업

사용자가 남은 작업을 **그만두기로 하면**, 확인을 받은 뒤 그 작업 폴더를 지운다. 남겨 두면
매 세션마다 다시 안내된다. git이면 지운 것도 이력에 남는다.

## 하지 않는 것

- 사용자에게 이전 대화 내용을 다시 설명해 달라고 하지 않는다. 문서에 없을 때만 묻는다.
- 문서와 기억이 다르면 기억을 따르지 않는다. 다르다는 것을 사용자에게 알린다.
