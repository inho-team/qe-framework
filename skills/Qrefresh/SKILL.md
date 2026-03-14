---
name: Qrefresh
description: 프로젝트 분석 데이터를 수동으로 최신화합니다. .qe/analysis/ 파일을 갱신하고 변경 이력을 확인합니다. "새로고침", "갱신", "refresh", "최신화" 요청 시 사용합니다.
---

> 공통 원칙: core/PRINCIPLES.md 참조

# Qrefresh — 프로젝트 분석 갱신

## 역할
프로젝트 분석 데이터를 수동으로 최신화하고, 변경 이력을 사용자에게 보여주는 스킬.
실제 갱신 작업은 `Erefresh-executor` 서브에이전트에게 위임합니다.

## 실행 절차

### 1단계: Erefresh-executor 호출
`Erefresh-executor` 서브에이전트를 실행하여 분석 갱신을 수행합니다.

### 2단계: 변경 요약 표시
갱신 완료 후 사용자에게 변경 사항을 요약합니다:
- 새로 추가된 파일/디렉토리
- 삭제된 파일/디렉토리
- 의존성 변경
- 기술 스택 변화
- `.qe/changelog.md`에 기록된 최근 이력

### 3단계: CLAUDE.md 갱신 제안
분석 결과 CLAUDE.md의 내용이 현재 프로젝트 상태와 다르면 갱신을 제안합니다.
- 기술 스택 변경 시
- 프로젝트 구조가 크게 달라졌을 시
- 사용자 승인 후 반영

## 할 것 (Will)
- Erefresh-executor 호출
- 변경 요약 표시
- CLAUDE.md 갱신 제안

## 안 할 것 (Will Not)
- 직접 분석 수행 → Erefresh-executor에게 위임
- 소스 코드 수정
- 사용자 승인 없이 CLAUDE.md 수정
