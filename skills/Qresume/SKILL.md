---
name: Qresume
description: Use when a session starts (or after /compact or /clear) and the injected context lists unfinished QE tasks or a recent handoff, or when the user asks to continue earlier work.
---

# Qresume — 이어받기

이 스킬의 목적은 **끊긴 작업을 처음부터 다시 묻거나 끝낸 일을 다시 하지 않고 이어가는 것**이다.
넘기는 쪽은 `Qcompact`가 맡는다.

세션 시작 hook이 `~/.qe/tasks/`에서 이 프로젝트의 미완료 목표 목록, 가장 최근 handoff, 이 세션 id를
컨텍스트에 넣어 준다. 그 내용이 보이거나, 사용자가 "이어서 하자"고 할 때 쓴다.

다른 세션이 하던 목표도 이어받을 수 있다. 같은 폴더를 갱신하면 hook이 이 세션을 status.json에
더한다. 따로 등록할 것은 없다.

## 순서

1. **사용자가 먼저 다른 일을 요청했으면** 그 일을 막지 않는다. 답의 끝에 남은 작업이
   있다고 한 줄만 알린다.
2. 그렇지 않으면, 무엇이 남았는지 한두 줄로 알리고 이어갈지 묻는다. 여러 개면 가장 최근
   것을 먼저 말한다.
3. 이어가면 그 폴더의 status.json, intent.md, plan.md, implement-plan.md, handoff.md, (있으면) verify.md를
   읽는다. 사용자가 intent.md 경로를 지정했다면 그 작업을 선택한다.
   **내 기억보다 문서와 `git log`를 믿는다.** compact 직후라면 특히 그렇다.
4. 인터뷰를 거친 작업은 먼저 누가 이어가는지 확인한다. 이 작업을 인터뷰한 창이면 여기서 인계·질의·승인 전달만 맡는다(서브에이전트 인계를 골랐다면 `Qunderstand`의 인계 문단대로 경로 스킬을 불러 조율하되, 문서와 코드는 작업자가 쓴다). 이미 계획이 있거나 실행 승인을 받았어도 아래 단계는 위임받은 작업자가 진행한다. 같은 창의 `/compact`나 `/clear`도 업무 위임이 아니다. 새 세션에서 인계 요청을 받았거나 서브에이전트로 위임받았다면 작업자로 이어간다. 기록이 사라져 구분할 수 없으면 역할만 묻는다. 세션 ID 변화나 handoff의 수정 시각으로 역할을 추정하면 인터뷰 창에서 실행할 수 있다.
5. 선택한 작업의 문서를 읽고 현재 단계에 맞는 스킬로 들어간다. 빈 intent나 작성 중인 양식은 확정 근거가 아니다. 기존 작업은 문서 양식과 관계없이 합의한 이유·완료 기준과 계획 상태로 이어간다.
   - 확정한 intent.md가 있고 계획이 없다 → 인계받은 작업자는 같은 폴더에서 `Qplan`을 시작한다. 버그라면 먼저 `Qdebugging`으로 원인을 조사해 계획에 담는다. 이전 handoff의 질문보다 확정된 이유와 비목표를 우선한다. 인터뷰 창에서는 인계만 한다. `/compact` 이후에도 같은 인터뷰 창이다.
   - handoff.md만 있다 → handoff를 보고 `Qunderstand` 또는 `Qdebugging`
   - plan.md가 없다 → `Qunderstand`(버그면 `Qdebugging`)
   - implement-plan.md가 없다 → `Qplan`
   - 승인 안 된 계획 → `Qplan`의 승인부터
   - 미체크 단계가 있다 → `Qexecute`
   - 모두 체크, 검수 안 함(status가 done이 아님, verify.md 없음) → `Qverify`
   - verify.md 결과가 미충족 → 원인을 알면 `Qexecute`, 모르면 `Qdebugging`
   - status가 done인데 내보내기 전 → `Qfinish`
6. handoff.md의 "다음 할 일"이 선택한 작업의 확정 의도, 승인 상태, 실제 남은 단계와 일치할 때 이어간다. 다른 작업의 인계나 이미 해결된 질문은 건너뛴다. 끝난 handoff는 지우지 않아도 된다.
   다음에 넘길 때 `Qcompact`가 덮어쓴다.

## 그만두는 작업

사용자가 남은 작업을 **그만두기로 하면**, 확인을 받은 뒤 status.json `state`를 `stopped`로 쓴다
(먼저 읽고 나머지 필드는 그대로 둔 채 Write). 그러면 더 안내되지 않고, Stop hook도 묻지 않는다.
폴더는 지우지 않는다. 왜 멈췄는지가 남고 대시보드에 "중단"으로 보인다.

## 이전 위치(docs/qe)의 작업

v11 전에는 작업 폴더가 프로젝트 `docs/qe/` 아래 있었다. 세션 시작 안내의 "이전 위치" 목록에 보이는
작업을 이어가려면, 먼저 그 폴더를 `~/.qe/tasks/<같은 이름>/`으로 옮기고 status.json(`state: active`,
형식은 `Qplan`의 "문서 위치")을 만든 뒤 이어간다. 옮기지 않으면 관문 hook과 대시보드가 이 목표를 모르고,
worktree를 지우면 함께 사라진다. 옮길지는 사용자에게 묻는다.

## 하지 않는 것

- 사용자에게 이전 대화 내용을 다시 설명해 달라고 하지 않는다. 문서에 없을 때만 묻는다.
- 문서와 기억이 다르면 기억을 따르지 않는다. 다르다는 것을 사용자에게 알린다.

사용자가 이어서 하자는데 안내된 작업이 없으면, 목표가 다른 프로젝트로 기록됐을 수 있다.
`~/.qe/tasks/`를 직접 보거나 `Qboard`로 전체를 본다. 예전 작업이면 다른 worktree의 `docs/qe/`(이전 위치)도 본다.
직접 볼 때는 status.json의 `project`가 이 저장소(원본 저장소 루트, worktree에서 만든 목표도 같은 값)인 목표만 이 프로젝트의
남은 작업으로 다룬다. 다른 프로젝트 목표는 이 창에서 이어갈 수 없으니, 사용자가 그 프로젝트나 전체를 물을 때만 말한다.
