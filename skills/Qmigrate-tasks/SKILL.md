---
name: Qmigrate-tasks
description: 루트에 흩어진 TASK_REQUEST/VERIFY_CHECKLIST 파일을 .qe/tasks/, .qe/checklists/ 구조로 마이그레이션하고 CLAUDE.md를 최신 컨벤션으로 갱신합니다.
---
> 공통 원칙: core/PRINCIPLES.md 참조


# 작업 파일 마이그레이션 스킬

## 역할
프로젝트 루트에 있는 기존 `TASK_REQUEST_*.md`, `VERIFY_CHECKLIST_*.md` 파일을 `.qe/tasks/`, `.qe/checklists/` 디렉토리 구조로 마이그레이션하고, `CLAUDE.md`를 최신 컨벤션에 맞게 갱신합니다.

## 역할 제한
- 이 스킬은 **파일 마이그레이션과 CLAUDE.md 갱신**에만 집중합니다.
- 작업 내용을 변경하거나, 새 작업을 생성하지 않습니다.

## 목표 디렉토리 구조

```
프로젝트루트/
├── CLAUDE.md
└── .qe/
    ├── tasks/
    │   ├── pending/          ← 🔲 진행 전
    │   ├── in-progress/      ← 🔶 진행 중
    │   ├── completed/        ← ✅ 완료
    │   └── on-hold/          ← ⏸️ 보류
    └── checklists/
        ├── pending/
        ├── in-progress/
        ├── completed/
        └── on-hold/
```

## 실행 절차

### 1단계: 스캔

1. 프로젝트 루트에서 `TASK_REQUEST_*.md`, `VERIFY_CHECKLIST_*.md` 파일을 탐색
2. 이미 `.qe/tasks/` 또는 `.qe/checklists/`에 있는 파일은 **스킵**
3. `CLAUDE.md`를 읽어 각 UUID별 작업 상태를 파악

**마이그레이션 대상이 없는 경우:**
```
프로젝트 루트에 마이그레이션 대상 파일이 없습니다.
모든 파일이 이미 .claude/ 디렉토리 구조에 있거나, TASK_REQUEST/VERIFY_CHECKLIST 파일이 존재하지 않습니다.
```
→ 2단계(CLAUDE.md 갱신 점검)로 바로 이동

### 2단계: 상태 판별

`CLAUDE.md`의 작업 목록 테이블에서 각 UUID의 상태를 읽어 대상 디렉토리를 결정합니다.

| CLAUDE.md 상태 | 대상 디렉토리 |
|----------------|--------------|
| 🔲 (또는 상태 없음) | `pending/` |
| 🔶 | `in-progress/` |
| ✅ | `completed/` |
| ⏸️ | `on-hold/` |

- `CLAUDE.md`가 없거나 해당 UUID의 상태를 찾을 수 없으면 `pending/`으로 기본 배치
- `VERIFY_CHECKLIST`의 모든 항목이 `- [x]`로 체크되어 있으면 상태와 무관하게 `completed/`로 판별

### 3단계: 미리보기 및 승인

마이그레이션 계획을 사용자에게 보여주고 승인을 받습니다.

**미리보기 형식:**
```markdown
## 마이그레이션 계획

**대상 파일: N개**

| 파일 | 현재 위치 | 이동 경로 | 상태 |
|------|-----------|-----------|------|
| TASK_REQUEST_a1b2c3d4.md | 루트 | .qe/tasks/pending/ | 🔲 |
| VERIFY_CHECKLIST_a1b2c3d4.md | 루트 | .qe/checklists/pending/ | 🔲 |
| TASK_REQUEST_e5f6g7h8.md | 루트 | .qe/tasks/completed/ | ✅ |
| VERIFY_CHECKLIST_e5f6g7h8.md | 루트 | .qe/checklists/completed/ | ✅ |

**CLAUDE.md 갱신:** 파일 규칙 섹션을 최신 컨벤션으로 업데이트합니다.

진행할까요?
```

**사용자 승인을 반드시 받은 뒤** 다음 단계로 진행합니다.

### 4단계: 파일 이동

1. 필요한 디렉토리 생성 (`mkdir -p .qe/tasks/{pending,in-progress,completed,on-hold}` 등)
2. 각 파일을 대상 디렉토리로 이동 (`mv`)
3. TASK_REQUEST와 VERIFY_CHECKLIST는 동일 UUID 기준으로 같은 상태 디렉토리에 배치

### 5단계: CLAUDE.md 갱신

`CLAUDE.md`의 "파일 규칙" 섹션이 구 형식인지 확인하고, 최신 컨벤션으로 교체합니다.

**구 형식 판별 기준:**
- `### 파일명 규칙` 섹션에 `TASK_REQUEST_{UUID}.md` (경로 없이 파일명만) 표기
- 디렉토리 구조 트리가 없음
- 상태 테이블에 `디렉토리` 컬럼이 없음
- ⏸️ 보류 상태가 없음

**교체 대상:** `## 파일 규칙` ~ 다음 `##` 섹션 시작 전까지

**새 형식:**
```markdown
## 파일 규칙

### 디렉토리 구조
\```
프로젝트루트/
├── CLAUDE.md
└── .qe/
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
\```

### 파일명 규칙
- 작업 요청서: `.qe/tasks/{상태}/TASK_REQUEST_{UUID}.md`
- 검증 체크리스트: `.qe/checklists/{상태}/VERIFY_CHECKLIST_{UUID}.md`
- 하나의 작업은 동일한 UUID를 공유합니다.
- `{상태}`는 `pending`, `in-progress`, `completed`, `on-hold` 중 하나입니다.

### 작업 상태
| 상태 | 디렉토리 | 의미 |
|------|----------|------|
| 🔲 진행 전 | `pending/` | 아직 시작하지 않은 작업 |
| 🔶 진행 중 | `in-progress/` | 현재 작업 중 |
| ⏸️ 보류 | `on-hold/` | 일시적으로 중단된 작업 |
| ✅ 완료 | `completed/` | VERIFY_CHECKLIST의 모든 항목 체크됨. **더 이상 참조 불필요.** |

### 완료 기준
- VERIFY_CHECKLIST의 **모든 체크박스가 체크**되면 ✅ 완료
- 완료된 파일은 `completed/` 디렉토리로 이동
- 완료된 작업 파일은 **참조하지 않아도 됩니다.**
```

**주의:**
- `## 작업 목록` 테이블과 그 외 섹션은 변경하지 않음 (데이터 손실 방지)
- 이미 최신 형식이면 갱신을 스킵하고 사용자에게 알림

### 6단계: 결과 보고

```markdown
## ✅ 마이그레이션 완료

**이동된 파일:** N개
- tasks: A개 (pending: X, in-progress: Y, completed: Z, on-hold: W)
- checklists: B개

**CLAUDE.md 갱신:** 파일 규칙 섹션 업데이트 완료 (또는 "이미 최신")

**참고:** 완료된 작업(✅)의 파일은 .qe/tasks/completed/에 보관되어 있으며, 더 이상 참조하지 않아도 됩니다.
```

## 특수 상황 처리

### CLAUDE.md가 없는 경우
- 모든 파일을 `pending/`으로 이동
- CLAUDE.md 갱신은 스킵
- 사용자에게 `/Qgenerate-spec`으로 CLAUDE.md 생성을 권장

### TASK_REQUEST만 있고 VERIFY_CHECKLIST가 없는 경우 (또는 반대)
- 존재하는 파일만 이동
- 누락된 짝 파일을 사용자에게 알림

### 이미 .claude/ 구조와 루트에 동일 UUID 파일이 공존하는 경우
- .claude/ 내 파일을 우선, 루트 파일은 이동하지 않음
- 사용자에게 충돌 상황을 알리고 수동 처리를 권장
