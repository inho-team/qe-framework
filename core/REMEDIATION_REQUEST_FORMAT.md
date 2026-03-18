# REMEDIATION_REQUEST Format

> 재작업 지시서 표준 포맷. Esupervision-orchestrator가 감리 결과 FAIL 판정 시 생성한다.

## Storage Path

```
.qe/tasks/remediation/REMEDIATION_REQUEST_{UUID}_{N}.md
```

- `{UUID}`: 원본 TASK_REQUEST UUID
- `{N}`: 감리 회차 (1, 2, 3)

---

## Document Format

```markdown
# REMEDIATION_REQUEST

## Header

| Field | Value |
|-------|-------|
| **Original UUID** | {UUID} |
| **Task Name** | {원본 TASK_REQUEST 태스크명} |
| **Supervision Round** | {N}/3 |
| **Created** | {YYYY-MM-DD HH:MM:SS} |

---

## Supervision Result

| Field | Value |
|-------|-------|
| **Overall Grade** | FAIL |
| **Supervision Agent(s)** | {감리 수행 에이전트명 목록, 쉼표 구분} |
| **Supervision Date** | {YYYY-MM-DD HH:MM:SS} |

### Domain Results

| Domain | Agent | Grade | Findings |
|--------|-------|-------|----------|
| {domain} | {agent name} | FAIL/PARTIAL/PASS | {N}건 |
| ... | ... | ... | ... |

---

## Deficient Items

### Item 1: {항목 제목}

- **Domain:** {감리 도메인}
- **Grade:** FAIL
- **Problem:** {구체적 문제점 — 무엇이 미달인지}
- **Remediation Directive:** {재작업 지시 — 어떻게 수정해야 하는지}
- **Fix Direction:** {구체적 수정 방향 — 코드/문서의 어디를 어떻게 변경할지}
- **Affected Files:** {관련 파일 경로 목록}

### Item 2: {항목 제목}

- **Domain:** {감리 도메인}
- **Grade:** FAIL
- **Problem:** {구체적 문제점}
- **Remediation Directive:** {재작업 지시}
- **Fix Direction:** {구체적 수정 방향}
- **Affected Files:** {관련 파일 경로 목록}

(FAIL 항목 수만큼 반복)

---

## Remediation Checklist

> 미달 항목만 골라 구체적 지시서 형태로 작성. Etask-executor가 이 체크리스트를 순서대로 실행한다.

- [ ] {Item 1에 대한 구체적 수정 지시}
- [ ] {Item 2에 대한 구체적 수정 지시}
- [ ] {수정 후 영향받는 항목 재검증 지시}

---

## Round Information

| Field | Value |
|-------|-------|
| **Current Round** | {N}/3 |
| **Previous Rounds** | {이전 회차 REMEDIATION_REQUEST 파일 경로, 없으면 "N/A"} |
| **Remaining Rounds** | {3 - N} |
| **Escalation** | {N == 3이면 "Next failure triggers user escalation", 아니면 "N/A"} |
```

---

## Field Descriptions

| Field | Description |
|-------|-------------|
| **Original UUID** | TASK_REQUEST와 VERIFY_CHECKLIST에서 공유하는 UUID |
| **Supervision Round** | 현재 감리-재작업 루프 회차. 최대 3회 |
| **Overall Grade** | REMEDIATION_REQUEST는 FAIL일 때만 생성됨 |
| **Problem** | 감리 에이전트가 발견한 구체적 문제. "무엇이 부족한가" |
| **Remediation Directive** | 재작업 수행자에게 전달하는 지시. "무엇을 해야 하는가" |
| **Fix Direction** | 수정의 구체적 방향. "어디를 어떻게 바꾸는가" |
| **Remediation Checklist** | Etask-executor가 실행할 체크리스트 형태의 지시서 |

## Rules

- REMEDIATION_REQUEST는 감리 등급이 **FAIL**일 때만 생성한다
- PARTIAL 등급은 조건부 통과이므로 REMEDIATION_REQUEST를 생성하지 않는다
- 각 회차의 REMEDIATION_REQUEST는 독립 파일로 저장하며 이전 회차를 덮어쓰지 않는다
- Remediation Checklist에는 FAIL 항목만 포함한다 (PASS/PARTIAL 항목은 제외)
- 3회차 재작업 후에도 FAIL이면 Esupervision-orchestrator가 사용자에게 에스컬레이션한다
