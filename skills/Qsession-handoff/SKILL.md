---
name: Qsession-handoff
description: "AI 에이전트 세션 간 원활한 인수인계를 위한 handoff 문서를 생성합니다. 사용자가 handoff/메모리/컨텍스트 저장을 요청하거나, 컨텍스트 윈도우가 한계에 근접하거나, 주요 마일스톤 완료 시, 세션 종료 시 실행됩니다. '상태 저장', 'handoff 만들기', '잠깐 멈춰야 해', '컨텍스트가 꽉 차가고 있어', 'handoff 불러오기', '이어서 작업', '이전 작업 계속' 등의 표현에 반응합니다."
---
> 공통 원칙: core/PRINCIPLES.md 참조

> 참고: Qcompact/Qresume은 compaction 시 자동 맥락 보존용이며, Qsession-handoff는 사용자가 명시적으로 세션을 종료할 때 사용하는 수동 핸드오프입니다.


# Handoff

새로운 AI 에이전트가 모호함 없이 작업을 원활하게 이어받을 수 있도록 포괄적인 handoff 문서를 생성합니다. 장시간 에이전트 실행 시 컨텍스트 소진 문제를 해결합니다.

실제 핸드오프 문서 생성은 Ehandoff-executor 서브에이전트에게 위임합니다.

## 모드 선택

어떤 모드에 해당하는지 판단합니다:

**Handoff 생성?** 사용자가 현재 상태를 저장하거나, 작업을 멈추거나, 컨텍스트가 가득 차가는 상황.
- 아래 CREATE 워크플로를 따릅니다

**Handoff에서 재개?** 사용자가 이전 작업을 계속하거나, 컨텍스트를 불러오거나, 기존 handoff를 언급하는 상황.
- 아래 RESUME 워크플로를 따릅니다

**능동적 제안?** 상당한 작업 후(파일 5개 이상 수정, 복잡한 디버깅, 주요 결정), 다음과 같이 제안합니다:
> "상당한 진전을 이뤘습니다. 이 컨텍스트를 다음 세션을 위해 보존하기 위해 handoff 문서 생성을 고려해 보세요. 준비가 되면 'handoff 만들기'라고 말씀해 주세요."

## CREATE 워크플로

### 1단계: Ehandoff-executor에 위임

Ehandoff-executor 서브에이전트를 호출하여 핸드오프 문서를 생성합니다.

에이전트가 수행하는 작업:
- 필요 시 `.qe/handoffs/` 디렉토리 생성
- 타임스탬프가 포함된 파일명 생성 (`HANDOFF_{날짜}_{시각}.md`)
- 현재 작업 상태, git 변경사항, 결정사항 자동 수집
- 이전 handoff에서 이어지는 경우 연결 링크 추가
- 생성된 파일 경로 출력

### 2단계: Handoff 문서 작성

생성된 파일을 열고 모든 `[TODO: ...]` 항목을 채웁니다. 다음 섹션을 우선적으로 작성합니다:

1. **현재 상태 요약** - 지금 어떤 상황인지
2. **중요한 컨텍스트** - 다음 에이전트가 반드시 알아야 할 핵심 정보
3. **즉각적인 다음 단계** - 명확하고 실행 가능한 첫 번째 단계
4. **결정 사항** - 결과뿐만 아니라 이유가 포함된 선택들

가이드라인은 [references/handoff-template.md](references/handoff-template.md)의 템플릿 구조를 참고합니다.

### 3단계: Handoff 검증

Ehandoff-executor가 검증을 수행합니다:

검증 항목:
- [ ] `[TODO: ...]` 자리 표시자가 남아 있지 않음
- [ ] 필수 섹션이 존재하고 내용이 채워져 있음
- [ ] 잠재적 기밀 정보 없음 (API 키, 비밀번호, 토큰)
- [ ] 참조된 파일이 존재함
- [ ] 오래된 핸드오프(24h+) 경고 표시

**기밀 정보가 감지되면 handoff를 확정하지 마십시오.**

### 4단계: Handoff 확인

사용자에게 다음을 보고합니다:
- Handoff 파일 위치
- 검증 결과 및 경고 사항
- 캡처된 컨텍스트 요약
- 다음 세션의 첫 번째 실행 항목

## RESUME 워크플로

### 1단계: 사용 가능한 Handoff 조회

`.qe/handoffs/` 디렉토리를 스캔하여 현재 프로젝트의 handoff 목록을 조회합니다.

날짜, 제목, 완료 상태와 함께 모든 handoff를 표시합니다.

### 2단계: 최신성 확인

불러오기 전에 handoff가 얼마나 최신인지 확인합니다.

최신성 수준:
- **FRESH**: 재개 안전 - handoff 이후 변경 사항 최소
- **SLIGHTLY_STALE**: 변경 사항 검토 후 재개
- **STALE**: 재개 전 컨텍스트를 신중하게 확인
- **VERY_STALE**: 새로운 handoff 생성 고려

확인 항목:
- Handoff 생성 이후 경과 시간
- Handoff 이후 git 커밋 수
- Handoff 이후 변경된 파일
- 브랜치 분기 여부
- 누락된 참조 파일

### 3단계: Handoff 불러오기

어떤 작업도 시작하기 전에 관련 handoff 문서를 완전히 읽습니다.

Handoff가 체인의 일부인 경우("이전 작업 계속" 링크가 있는 경우), 전체 컨텍스트를 위해 이전 handoff도 함께 읽습니다.

### 4단계: 컨텍스트 검증

[references/resume-checklist.md](references/resume-checklist.md)의 체크리스트를 따릅니다:

1. 프로젝트 디렉토리와 git 브랜치가 일치하는지 확인
2. 차단 요소가 해결되었는지 확인
3. 가정 사항이 여전히 유효한지 검토
4. 수정된 파일의 충돌 검토
5. 환경 상태 확인

### 5단계: 작업 시작

Handoff 문서의 "즉각적인 다음 단계" 항목 #1부터 시작합니다.

작업 중 다음 섹션을 참고합니다:
- "핵심 파일" - 중요한 위치 파악
- "발견한 주요 패턴" - 따라야 할 관례
- "잠재적 주의 사항" - 알려진 문제 회피

### 6단계: Handoff 업데이트 또는 체인 연결

작업하면서:
- "대기 중인 작업"에서 완료된 항목 표시
- 새로운 발견 사항을 관련 섹션에 추가
- 긴 세션의 경우: 새 handoff를 생성하여 체인 연결

## Handoff 체이닝

장기 프로젝트의 경우, handoff를 서로 연결하여 컨텍스트 계보를 유지합니다:

```
handoff-1.md (초기 작업)
    ↓
handoff-2.md --continues-from handoff-1.md
    ↓
handoff-3.md --continues-from handoff-2.md
```

체인의 각 handoff:
- 이전 handoff에 링크
- 오래된 handoff를 대체됨으로 표시 가능
- 새로운 에이전트를 위한 컨텍스트 흔적 제공

체인에서 재개 시, 가장 최근 handoff를 먼저 읽고 필요에 따라 이전 것을 참조합니다.

## 저장 위치

Handoff는 `.qe/handoffs/`에 저장됩니다.

명명 규칙: `HANDOFF_{YYYY-MM-DD}_{HHMMSS}.md`

예시: `HANDOFF_2026-03-14_143022.md`

## 리소스

### references/

- [handoff-template.md](references/handoff-template.md) - 가이드라인이 포함된 완전한 템플릿 구조
- [resume-checklist.md](references/resume-checklist.md) - 작업 재개 에이전트를 위한 검증 체크리스트
