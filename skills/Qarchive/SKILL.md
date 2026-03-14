---
name: Qarchive
description: 완료된 작업 파일을 자동으로 아카이브합니다. Qrun-task 완료 시 백그라운드에서 자동 실행되며, 수동 호출도 가능합니다.
---

> 공통 원칙: core/PRINCIPLES.md 참조

# Qarchive — 작업 아카이브

## 역할
완료된 작업 파일(TASK_REQUEST, VERIFY_CHECKLIST)과 CLAUDE.md 스냅샷을 버전별로 아카이브하는 스킬.
**백그라운드에서 자동 실행**되며, 사용자에게 제안하거나 안내하지 않습니다.
실제 아카이브 작업은 `Earchive-executor` 서브에이전트에게 위임합니다.

## 동작 방식

### 자동 실행 (기본)
- Qrun-task에서 작업이 ✅ 완료되면 Earchive-executor를 백그라운드에서 자동 호출합니다.
- 사용자에게 알리지 않고 조용히 아카이브합니다.

### 수동 실행
- 사용자가 `/Qarchive`로 직접 호출할 수 있습니다.
- 이 경우 아카이브 결과를 보여줍니다.

## 아카이브 절차

### 1단계: 완료된 작업 감지
- `.qe/tasks/pending/`에서 완료된(모든 체크박스 체크됨) TASK_REQUEST 파일 탐색
- 대응하는 VERIFY_CHECKLIST를 `.qe/checklists/pending/`에서 찾음

### 2단계: 버전 결정
`.qe/.archive/` 디렉토리에서 기존 최신 버전을 확인하고 다음 버전을 결정합니다.
- 버전 형식: `vX.Y.Z`
- 첫 아카이브: `v0.1.0`
- 이후: 마이너 버전 자동 증가 (v0.1.0 → v0.2.0 → v0.3.0)
- 사용자가 수동 호출 시 `--major`, `--minor`, `--patch` 플래그로 버전 지정 가능

### 3단계: 아카이브 실행
```
.qe/.archive/vX.Y.Z/
├── CLAUDE.md                          ← 현재 CLAUDE.md 스냅샷 복사
├── tasks/
│   └── TASK_REQUEST_{UUID}.md         ← pending에서 이동
└── checklists/
    └── VERIFY_CHECKLIST_{UUID}.md     ← pending에서 이동
```

- 완료된 파일을 `pending/`에서 아카이브 폴더로 **이동** (복사가 아닌 이동)
- CLAUDE.md는 **복사** (원본 유지)
- 아카이브 디렉토리가 없으면 자동 생성

### 4단계: CLAUDE.md 갱신
- 아카이브된 작업의 상태를 ✅로 확인
- 완료된 작업이 CLAUDE.md 작업 목록에서 이미 ✅면 그대로 유지

## 아카이브 규칙
- 완료되지 않은 작업(🔲, 🔶)은 아카이브하지 않습니다.
- 이미 아카이브된 작업은 중복 아카이브하지 않습니다.
- 아카이브 폴더는 `.gitignore`에 포함하지 않습니다 (히스토리 보존).
- 백그라운드 실행 시 에러가 발생해도 사용자에게 알리지 않습니다 (로그만 남김).

## 할 것 (Will)
- 완료된 TASK_REQUEST/VERIFY_CHECKLIST 아카이브
- CLAUDE.md 스냅샷 저장
- 버전 자동 결정
- 아카이브 디렉토리 자동 생성

## 안 할 것 (Will Not)
- 미완료 작업 아카이브
- 사용자에게 아카이브 제안/안내 (자동 실행 시)
- 소스 코드 수정
- 아카이브된 파일 삭제
