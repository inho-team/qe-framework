# Agent Tiers — 모델 자동 선택

## 개요
작업 복잡도에 따라 적절한 모델을 자동 선택하는 티어 시스템.
비용을 최적화하면서 품질을 유지합니다.

## 티어 정의

| 티어 | 모델 | 용도 | 예시 |
|------|------|------|------|
| **LOW** | haiku | 단순 조회, 파일 복사, 포맷 변환 | Eprofile-collector, Earchive-executor, Ecommit-executor |
| **MEDIUM** | sonnet | 표준 구현, 코드 작성, 리뷰 | Etask-executor, Ecode-reviewer, Ecode-test-engineer, Edoc-generator |
| **HIGH** | opus | 복잡한 분석, 아키텍처 설계, 딥 리서치 | Edeep-researcher, Eqa-orchestrator (판정 단계) |

## 자동 선택 기준

### LOW 티어 (haiku)
- 파일 이동/복사/삭제
- 단순 텍스트 변환
- 상태 파일 읽기/쓰기
- 패턴 수집 (프로파일링)
- 예상 실행 시간: 10초 이내

### MEDIUM 티어 (sonnet)
- 코드 작성/수정
- 테스트 작성
- 코드 리뷰
- 문서 생성
- 일반적인 디버깅
- 예상 실행 시간: 1-5분

### HIGH 티어 (opus)
- 아키텍처 설계 판단
- 기술 비교 분석 (딥 리서치)
- 복잡한 리팩토링 전략
- 품질 루프 최종 판정
- 예상 실행 시간: 5분+

## 에이전트별 티어 매핑

| 에이전트 | 기본 티어 | 에스컬레이션 |
|---------|----------|------------|
| Eprofile-collector | LOW | — |
| Earchive-executor | LOW | — |
| Ecommit-executor | LOW | — |
| Etask-executor | MEDIUM | HIGH (복잡한 체크리스트) |
| Ecode-debugger | MEDIUM | HIGH (근본 원인 불명) |
| Ecode-reviewer | MEDIUM | — |
| Ecode-test-engineer | MEDIUM | — |
| Ecode-doc-writer | MEDIUM | — |
| Edoc-generator | MEDIUM | — |
| Egrad-writer | MEDIUM | HIGH (Discussion 섹션) |
| Epm-planner | MEDIUM | HIGH (복잡한 PRD) |
| Edeep-researcher | HIGH | — |
| Eqa-orchestrator | MEDIUM | HIGH (3회 실패 시) |
| Erefresh-executor | MEDIUM | — |
| Ecompact-executor | MEDIUM | — |
| Ehandoff-executor | MEDIUM | — |

## 에스컬레이션 규칙
- MEDIUM에서 2회 실패 → HIGH로 자동 에스컬레이션
- HIGH에서도 실패 → 사용자에게 보고
- 에스컬레이션 시 `.qe/changelog.md`에 기록

## 비용 최적화
- 전체 작업의 60%는 LOW/MEDIUM으로 처리
- HIGH는 판단/분석 단계에서만 사용
- 단순 반복 작업에 HIGH 사용 금지
