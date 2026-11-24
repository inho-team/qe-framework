---
name: Qcompact
description: Use when a session must be handed over — the context is filling up, the user wants to stop, compact, or clear, or the work will continue in a later session.
---

# Qcompact — 넘기기

대화는 compact나 새 세션에서 사라진다. 문서는 남는다. 이 스킬의 목적은 **다음 세션이
처음부터 다시 묻거나, 끝낸 일을 다시 하지 않게, 지금 머릿속에 있는 것을 문서로 옮기는 것**이다.
이어받는 쪽은 `Qresume`이 맡는다.

## 언제

- 컨텍스트가 차올라 앞 내용을 잃을 것 같을 때
- 사용자가 멈추거나, `/compact`·`/clear` 하려 하거나, 나중에 이어 하겠다고 할 때
- 이해·계획·실행·검증·디버깅 어느 단계든 상관없다

## 순서

1. **현재 작업 폴더를 찾는다** (`docs/qe/YYYY-MM-DD-<주제>/`). 아직 없으면(이해 단계나
   디버깅 조사 중이었다면) 폴더를 만들고 handoff.md만이라도 둔다. 대화에서 나온 것을
   잃지 않는 게 먼저다. 세션 시작 hook은 handoff.md만 있는 폴더도 "이해 중"으로 알려 준다.
2. **implement-plan.md 체크박스를 최신으로** 맞춘다. 끝난 단계가 `- [ ]`로 남아 있으면 다음 세션이
   다시 한다.
3. **handoff.md를 쓴다** ([handoff-template.md](handoff-template.md)). 이미 있으면 덮어쓴다.
   - "다음 할 일"은 새 세션이 바로 손댈 수 있을 만큼 구체적으로.
   - 사용자가 방금 정했지만 plan.md에 아직 없는 결정은 plan.md에도 반영한다.
   - 시도했다가 버린 방법과 이유를 적는다. 디버깅 중이었다면 세운 가설과 확인 결과도.
     다음 세션이 같은 막다른 길로 가지 않게.
4. git이면 문서를 커밋할지 사용자에게 묻는다(작업 중 코드와 섞이지 않게).
5. **사용자에게 `/compact` 실행을 요청한다.** 나는 `/compact`를 직접 실행할 수 없다.
   compact가 끝나면 세션 시작 hook이 미완료 작업과 이 handoff를 다시 넣어 주고,
   `Qresume`으로 이어진다. 사용자가 세션을 닫으려는 것이라면 compact 없이 닫아도 된다고
   알린다. 다음에 열면 같은 방식으로 이어진다.

## 하지 않는 것

- 작업 상태를 따로 저장하는 파일이나 DB를 만들지 않는다. 상태는 implement-plan.md 체크박스와
  verify.md, handoff.md에서 읽힌다.
- 대화 전체를 옮겨 적지 않는다. 다음 세션이 이어가는 데 필요한 것만 쓴다.

worktree에서 진행한 작업이면 그 `docs/qe/`는 그 worktree에만 있다. 원래 checkout에서 연
세션은 이 작업을 안내하지 못하므로, handoff.md에 worktree 경로를 적고 사용자에게도 알린다.
