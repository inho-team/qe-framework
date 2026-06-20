# Project Mistakes

> 반복 실패 패턴에서 식별된 실수. 반복하지 마세요.
> 이 파일은 매 세션 시작 시 로드됩니다.

---

### M001: 작업 완료 처리 누락 (체크리스트 미완 상태로 Stop)
- **Date**: 2026-06-19
- **Wrong**: 작업을 끝냈다고 보고하면서 VERIFY_CHECKLIST 항목을 전부 체크하지 않거나 `.qe/TASK_LOG.md`를 ✅로 갱신하지 않은 채 세션을 Stop. (learn-from-failures가 4개 task에 걸쳐 동일 패턴 포착)
- **Correct**: 완료 보고 직전 ① VERIFY_CHECKLIST 전 항목 `[x]`, ② TASK_REQUEST/CHECKLIST를 completed/로 이동, ③ `.qe/TASK_LOG.md` 해당 행 ✅ 갱신 — 셋을 모두 마친 뒤 종료.
- **Context**: Qrun-task/Qcode-run-task Step 5 (Completion)
- **Severity**: important

---

이 파일은 `/Qmistake` 스킬이 갱신합니다. 직접 편집하지 마세요.
