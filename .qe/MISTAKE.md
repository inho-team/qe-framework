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

### M002: 검증 없는 `--delete` 목적지로 rsync가 `/`(루트)를 동기화
- **Date**: 2026-06-24
- **Wrong**: 캐시 동기화 중 `installed_plugins.json` 구조를 오해(`plugins` 하위 중첩 무시)해 경로 추출이 **빈 문자열**이 됐는데, 가드 없이 `rsync -a --delete ./ "$CACHE/"`를 실행 → 목적지가 `/`가 되어 루트를 `--delete` 동기화 시도. macOS 봉인 볼륨+비루트 권한으로 전부 차단돼 실피해는 0이었으나 매우 위험한 명령이었음.
- **Correct**: `--delete`(또는 덮어쓰기/삭제) 명령의 목적지를 변수에서 받을 때는 실행 전 **3중 검증** 필수 — ① 비어있지 않음(`[ -n "$D" ]`) ② 예상 prefix로 시작(`[[ "$D" == "$PREFIX"* ]]`) ③ 디렉터리 존재(`[ -d "$D" ]`). 하나라도 실패하면 즉시 abort. 경로 추출은 대상 JSON의 실제 구조를 먼저 확인하고(예: `d["plugins"]["..."]`), 명령 치환 실패가 빈 변수로 흘러가지 않게 `set -euo pipefail` + 명시적 가드.
- **Context**: Mrelease Step 6 (플러그인 캐시 rsync). 스킬 문서의 경로 표기(`plugins["qe-framework@..."][0]`)도 실구조와 달라 동일 실수를 유발 → 별도 수정함.
- **Severity**: critical

---

이 파일은 `/Qmistake` 스킬이 갱신합니다. 직접 편집하지 마세요.
