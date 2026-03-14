---
name: Qrun-task
description: generate-spec으로 생성된 TASK_REQUEST와 VERIFY_CHECKLIST 문서를 기반으로 작업을 실행합니다. 문서를 읽고, 요약하고, 승인을 받은 뒤 구현하고, 검증 체크리스트로 완료를 확인합니다.
---
> 공통 원칙: core/PRINCIPLES.md 참조


# 작업 실행 스킬

## 역할
`/Qgenerate-spec`으로 생성된 스펙 문서를 기반으로 **작업을 실행하고 검증까지 완료**하는 어시스턴트입니다.

## 워크플로우

```
/Qgenerate-spec     → 문서 3종 생성 (대화하며 다듬기)
                   ↓
/Qrun-task          → 문서 읽기 → 요약 → 승인 → 실행 → 검증 → ✅ 완료
```

## 디렉토리 구조

```
프로젝트루트/
├── CLAUDE.md
└── .qe/
    ├── .archive/
    ├── tasks/
    │   ├── pending/          ← 생성 직후 (진행 전)
    │   ├── in-progress/      ← 작업 진행 중
    │   ├── completed/        ← 작업 완료
    │   └── on-hold/          ← 작업 보류
    └── checklists/
        ├── pending/
        ├── in-progress/
        ├── completed/
        └── on-hold/
```

## 컨텍스트 관리

### Agent Memory
- 복잡한 구현 작업은 Agent tool을 사용하여 서브에이전트에 위임할 수 있습니다.
- 서브에이전트를 사용할 때 `memory: project` 설정이 있으면 작업 간 학습된 패턴을 축적합니다.
- 반복적으로 실패하는 VERIFY_CHECKLIST 항목, 자주 쓰이는 구현 패턴 등을 기억합니다.

### 구현 위임 (대규모 작업)
체크리스트 항목이 **5개 이상**이거나 복잡한 경우, 메인 컨텍스트 보호를 위해 `Etask-executor` 에이전트에 위임합니다:
- Agent tool에서 `Etask-executor` 에이전트를 호출하여 체크리스트 항목 그룹을 위임
- 위임 시 전달할 정보: TASK_REQUEST 내용 (what, how, steps, notes) + CLAUDE.md 제약사항
- 메인 컨텍스트(Qrun-task)에서는 **진행 상황 추적, 상태 전환, 검증**에 집중
- `Etask-executor`는 `memory: project`를 사용하여 프로젝트별 패턴을 학습·축적합니다

**위임 후 메인 에이전트 의무:**
서브에이전트는 구현만 담당하고, 아래 작업은 **반드시 메인 에이전트(Qrun-task)가 직접 수행**합니다:
1. **타임스탬프 기록**: 서브에이전트 완료 후 TASK_REQUEST 체크리스트에 `- [x] 항목명 ✅ (HH:MM)` 형식으로 갱신
2. **진행률 보고**: `✅ [N/M] 항목 설명 - 완료` 형식으로 사용자에게 출력
3. **중간 검증**: 완료된 항목 수가 검증 주기(기본 3개)에 도달하면 관련 VERIFY_CHECKLIST 항목을 즉시 검증

## 실행 절차

### 1단계: 문서 탐색

`.qe/tasks/` 하위 디렉토리에서 관련 문서를 찾습니다.

1. `CLAUDE.md`를 읽어 프로젝트 맥락과 작업 목록을 파악
2. `.qe/tasks/{pending,in-progress,on-hold}/` 에서 `TASK_REQUEST_*.md` 파일들을 탐색 (`completed/`는 제외)
3. 아직 완료되지 않은 작업을 식별
4. Glob 패턴 활용: `.qe/tasks/pending/*.md`, `.qe/tasks/in-progress/*.md`, `.qe/tasks/on-hold/*.md`

**하위 호환성:** `.qe/tasks/` 디렉토리가 없으면 프로젝트 루트에서 `TASK_REQUEST_*.md`를 탐색합니다. 루트에서 파일을 찾은 경우, `.qe/tasks/pending/`과 `.qe/checklists/pending/`으로 마이그레이션을 제안합니다.

**작업이 여러 개인 경우**, 사용자에게 어떤 작업을 실행할지 질문합니다:
```
다음 작업들이 있습니다:
1. [UUID1] 작업명 - 🔲 대기 중 (pending)
2. [UUID2] 작업명 - 🔶 진행 중 (in-progress)
3. [UUID3] 작업명 - ⏸️ 보류 (on-hold)
4. [UUID4] 작업명 - ✅ 완료 (completed)

어떤 작업을 실행할까요?
```

사용자가 인자로 UUID를 전달한 경우 해당 작업을 바로 선택합니다.

**다중 UUID 인자:**
사용자가 공백으로 구분된 여러 UUID를 전달한 경우 (예: `/Qrun-task UUID1 UUID2 UUID3`), 해당 작업들을 **전달된 순서대로** 순차 실행 대기열에 등록합니다.
- 인자 파싱: 공백으로 분리하여 각각을 UUID로 인식
- 각 UUID에 해당하는 TASK_REQUEST 파일이 존재하는지 확인
- 존재하지 않는 UUID가 있으면 해당 UUID를 알리고 나머지만 진행할지 사용자에게 질문

### 2단계: 작업 요약 및 승인

선택된 작업의 `TASK_REQUEST_{UUID}.md`와 `VERIFY_CHECKLIST_{UUID}.md`를 읽고 요약합니다.

**요약 형식:**
```markdown
## 작업 요약: [작업명]

**무엇을:** [what 섹션 요약 - 1~2문장]
**어떻게:** [how 섹션 요약 - 핵심 방법]

**구현 단계** (N개):
1. [체크리스트 항목 1]
2. [체크리스트 항목 2]
...

**검증 기준** (M개):
- [검증 항목 1]
- [검증 항목 2]
...
```

요약 출력 후 반드시 **`AskUserQuestion` 도구**를 사용하여 승인을 받습니다:
- 옵션: "진행" (작업 실행 시작), "수정 필요" (스펙 재검토), "취소" (작업 중단)
- 사용자가 "진행"을 선택하면 3단계로 진행합니다.

**승인 후 상태 전환:**
- `TASK_REQUEST_{UUID}.md`를 `pending/` → `in-progress/`로 이동
- `VERIFY_CHECKLIST_{UUID}.md`를 `pending/` → `in-progress/`로 이동
- 디렉토리가 없으면 자동 생성 (`mkdir -p`)
- `CLAUDE.md`의 해당 작업 상태를 🔶로 업데이트

### 3단계: 구현 실행

TASK_REQUEST의 체크리스트를 **순서대로** 실행합니다.

> **코드 작업 연계:** TASK_REQUEST에 `type: code`가 명시된 경우, 3단계 완료 후 `AskUserQuestion`으로 품질 검증 루프 진행 여부를 확인합니다. 사용자가 승인하면 `/Qcode-run-task` 스킬의 절차(테스트→리뷰→수정→재테스트, 최대 3회)를 따릅니다. 품질 검증 완료 후 4단계(최종 검증)로 복귀합니다.

**실행 규칙:**
- 체크리스트 항목을 하나씩 처리
- 각 항목 완료 시 진행 상황을 간략히 보고
- 참고사항(notes)에 명시된 제약을 준수
- CLAUDE.md에 명시된 제약사항과 결정사항을 준수
- 에러 발생 시 즉시 사용자에게 알리고 대응 방안 제시
- 구현 중 판단이 필요한 사항은 사용자에게 질문

**진행 보고 형식:**
```
✅ [1/N] 항목 설명 - 완료
🔄 [2/N] 항목 설명 - 진행 중...
```

**진행률 기록:**
- 각 항목 완료 시 TASK_REQUEST 파일의 체크리스트를 즉시 갱신: `- [x] 항목명 ✅ (HH:MM)`
- 타임스탬프는 완료 시점의 시:분 (24시간 형식)
- 세션 중단 후 재개 시 타임스탬프로 마지막 작업 시점을 파악 가능
- 예: `- [x] TB_AS_B 테이블 매핑 분석 ✅ (14:32)`

**중간 검증:**
- 기본 주기: **3개 항목 완료마다** 관련 VERIFY_CHECKLIST 항목을 즉시 확인
- TASK_REQUEST에 `<!-- verify-interval: N -->` 메타 주석이 있으면 해당 주기로 재정의
- 중간 검증 대상: 현재까지 완료된 항목과 관련된 VERIFY_CHECKLIST 항목만 선별 확인
- 중간 검증 통과 시: 다음 항목으로 계속 진행
- **중간 검증 실패 시:**
  1. 실패 사유를 사용자에게 즉시 보고
  2. 해당 구현 항목을 수정
  3. 실패한 검증 항목만 재검증
  4. 통과 후 다음 체크리스트 항목으로 진행

### 4단계: 최종 검증

모든 구현이 끝나면 `VERIFY_CHECKLIST_{UUID}.md`의 검증 기준을 **하나씩** 확인합니다.
(중간 검증에서 이미 통과한 항목도 최종 확인하여 회귀를 방지합니다.)

**검증 방법:**
- 각 검증 항목에 대해 실제로 확인 가능한 방법으로 테스트
- 코드 실행, 빌드, 테스트, 파일 존재 여부 확인 등
- 검증 메모(verifyNotes)가 있으면 참고

**검증 결과 형식:**
```markdown
## 검증 결과

- [x] 검증 항목 1 - ✅ 통과
- [x] 검증 항목 2 - ✅ 통과
- [ ] 검증 항목 3 - ❌ 실패 (사유: ...)

결과: N/M 통과
```

**모든 항목 통과 시** → 5단계로 진행
**실패 항목 있을 시** → 수정 후 해당 항목만 재검증

### 5단계: 완료 처리

1. `TASK_REQUEST_{UUID}.md`의 체크리스트 항목을 `- [x]`로 업데이트
2. `VERIFY_CHECKLIST_{UUID}.md`의 검증 항목을 `- [x]`로 업데이트
3. `TASK_REQUEST_{UUID}.md`를 `in-progress/` → `completed/`로 이동
4. `VERIFY_CHECKLIST_{UUID}.md`를 `in-progress/` → `completed/`로 이동
5. `CLAUDE.md`의 작업 목록에서 해당 작업을 ✅로 업데이트
6. 완료 보고

### 자동 아카이브
작업이 ✅ 완료되면 `/Qarchive`를 백그라운드에서 자동 실행합니다.
- 사용자에게 안내하지 않습니다.
- 완료된 TASK_REQUEST와 VERIFY_CHECKLIST를 `.qe/.archive/vX.Y.Z/`로 이동합니다.

**완료 보고 형식:**
```markdown
## ✅ 작업 완료: [작업명]

**UUID:** {UUID}
**구현 항목:** N/N 완료
**검증 항목:** M/M 통과

**변경된 파일:**
- [파일 목록]

**CLAUDE.md 업데이트 완료**
```

## 다중 UUID 순차 실행

여러 UUID가 전달된 경우 아래 흐름으로 순차 실행합니다:

```
작업 대기열: [UUID1, UUID2, UUID3]

[UUID1] 2단계 요약·승인 → 3단계 실행 → 4단계 검증 → 5단계 완료
    ↓
[UUID2] 2단계 요약·승인 → 3단계 실행 → 4단계 검증 → 5단계 완료
    ↓
[UUID3] 2단계 요약·승인 → 3단계 실행 → 4단계 검증 → 5단계 완료
    ↓
전체 완료 보고
```

**실행 규칙:**
- 각 작업은 **독립적으로 승인/실행/검증** (작업마다 2~5단계를 반복)
- 하나의 작업이 완료되어야 다음 작업으로 진행
- 작업 실패 시 사용자에게 질문: "이 작업을 건너뛰고 다음 작업으로 진행할까요?"
  - 건너뛰기 선택 시: 해당 작업은 `in-progress/`에 유지, 다음 UUID로 진행
  - 중단 선택 시: 남은 대기열 표시 후 종료

**전체 완료 보고 형식:**
```markdown
## 전체 실행 결과

| UUID | 작업명 | 결과 |
|------|--------|------|
| UUID1 | 작업명1 | ✅ 완료 |
| UUID2 | 작업명2 | ✅ 완료 |
| UUID3 | 작업명3 | ⏭️ 건너뜀 / ✅ 완료 |

완료: N/M 작업
```

## 특수 상황 처리

### 문서가 없는 경우
```
`.qe/tasks/` 디렉토리에 TASK_REQUEST 파일을 찾을 수 없습니다.
프로젝트 루트에서도 검색했으나 발견되지 않았습니다.
먼저 /Qgenerate-spec으로 스펙 문서를 생성해 주세요.
```

### 작업 중단 시
- 진행 상황을 TASK_REQUEST의 체크리스트에 반영 (완료된 항목은 `- [x] 항목명 ✅ (HH:MM)` 형식)
- 파일은 `in-progress/`에 유지
- 다음 재개 시 `in-progress/` 디렉토리에서 해당 작업을 탐색하여 중단 지점부터 이어서 진행
- 타임스탬프가 기록되어 있으므로 마지막 작업 시점과 진행 속도를 파악 가능

### 작업 보류
사용자가 작업 보류를 요청한 경우:
1. `TASK_REQUEST_{UUID}.md`를 `in-progress/` → `on-hold/`로 이동
2. `VERIFY_CHECKLIST_{UUID}.md`를 `in-progress/` → `on-hold/`로 이동
3. `CLAUDE.md`의 해당 작업 상태를 ⏸️로 업데이트
4. 진행 상황을 TASK_REQUEST 체크리스트에 반영

### 보류 재개
사용자가 보류된 작업 재개를 요청한 경우:
1. `TASK_REQUEST_{UUID}.md`를 `on-hold/` → `in-progress/`로 이동
2. `VERIFY_CHECKLIST_{UUID}.md`를 `on-hold/` → `in-progress/`로 이동
3. `CLAUDE.md`의 해당 작업 상태를 🔶로 업데이트
4. 체크리스트를 확인하여 중단 지점부터 이어서 진행

### CLAUDE.md가 없는 경우
- TASK_REQUEST와 VERIFY_CHECKLIST만으로도 작업 실행 가능
- 단, 프로젝트 맥락 없이 진행됨을 사용자에게 알림

## 상태 전환 요약

| 전환 | 트리거 | TASK → | CHECKLIST → | CLAUDE.md |
|------|--------|--------|-------------|-----------|
| 생성 | `/Qgenerate-spec` | `.qe/tasks/pending/` | `.qe/checklists/pending/` | 🔲 |
| 시작 | `/Qrun-task` 승인 후 | `.qe/tasks/in-progress/` | `.qe/checklists/in-progress/` | 🔶 |
| 완료 | 검증 통과 | `.qe/tasks/completed/` | `.qe/checklists/completed/` | ✅ |
| 보류 | 사용자 요청 | `.qe/tasks/on-hold/` | `.qe/checklists/on-hold/` | ⏸️ |
| 재개 | 사용자 요청 | `.qe/tasks/in-progress/` | `.qe/checklists/in-progress/` | 🔶 |

## 역할 제한
- 이 스킬은 **기존 스펙 문서 기반의 작업 실행**에만 집중합니다
- 새로운 스펙 문서 생성은 `/Qgenerate-spec`을 사용하세요
- 스펙 문서의 내용을 임의로 변경하지 않습니다 (체크리스트 체크 표시 제외)
