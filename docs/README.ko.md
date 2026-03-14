[English](../README.md) | **한국어** | [中文](README.zh.md) | [日本語](README.ja.md)

# QE Framework (Query Executor)

Claude Code를 위한 개인용 스킬 및 에이전트 패키지.

QE (Query Executor)는 사용자의 질의를 구조화된 실행 가능한 작업으로 변환하는 프레임워크입니다. 스펙 생성부터 구현, 검증, 커밋까지 전체 라이프사이클을 스킬과 에이전트의 협업 시스템을 통해 처리합니다.

## 철학

QE Framework는 검증된 엔지니어링 원칙을 기반으로 합니다:

- **SOLID** -- 단일 책임, 개방-폐쇄, 리스코프 치환, 인터페이스 분리, 의존성 역전
- **DRY** -- 반복 로직 금지; 공통 로직은 공유 컴포넌트로 추출
- **KISS** -- 단순한 해결책 우선; 불필요한 복잡성 제거
- **YAGNI** -- 지금 필요한 것만 구현; 투기적 설계 금지
- **증거 기반** -- 추측 금지. 불확실할 때는 파일을 읽고 확인
- **최소 변경** -- 요청받은 부분만 수정. 인접 코드를 임의로 리팩터링하지 않음
- **내부 영어 처리** -- 모든 추론과 분석은 높은 정확도를 위해 내부적으로 영어로 수행한 후, 응답 전 사용자의 언어로 번역. 이를 통해 어떤 언어에서든 자연스러운 대화를 유지하면서 더 나은 결과를 도출

## 아키텍처

QE Framework는 3계층 아키텍처를 사용합니다:

```
Skills (Q-prefix)          Agents (E-prefix)          Core
방법론 및 프로세스           실행 및 위임                공유 원칙
/Qgenerate-spec            Etask-executor             PRINCIPLES.md
/Qsystematic-debugging     Ecode-debugger             INTENT_GATE.md
/Qcommit                   Ecommit-executor           AGENT_TIERS.md
```

- **Skills**은 *어떻게* 할 것인지를 정의합니다 (프로세스, 방법론, 워크플로우 오케스트레이션)
- **Agents**는 작업을 *실행*합니다 (코드 작성, 디버깅, 리뷰, 리서치)
- **Core**는 공유 원칙, 인텐트 라우팅, 모델 티어 선택을 제공합니다

## 설치

```bash
claude plugin add github:inho-team/qe-framework
```

### 프로젝트 초기화

```
/Qinit
```

`CLAUDE.md`, `.qe/` 디렉토리 구조를 생성하고 초기 프로젝트 분석을 실행합니다.

## 사용법

### 작업 워크플로우

스펙을 생성한 후 실행합니다:

```
/Qgenerate-spec    -- TASK_REQUEST.md + VERIFY_CHECKLIST.md 생성
/Qrun-task         -- 자동 품질 검증과 함께 작업 실행
```

### 변경사항 커밋

```
/Qcommit           -- AI 흔적 없는 사람이 쓴 스타일의 커밋
```

### 디버깅

```
/Qsystematic-debugging   -- 수정 전 근본 원인 분석
```

### 심층 리서치

기술 비교, 아키텍처 의사결정, 조사 작업에는 `Edeep-researcher` 에이전트를 호출합니다.

### 기타 예시

```
/Qgenerate-spec + /Qrun-task     -- 전체 작업 라이프사이클
/Qfrontend-design                -- 프로덕션 수준의 UI 컴포넌트 생성
/Qtest-driven-development        -- Red-green-refactor TDD 워크플로우
/Qgrad-paper-write               -- 학술 논문 초안 작성
/Qc4-architecture                -- C4 모델 아키텍처 다이어그램
/Qrefresh                        -- 프로젝트 분석 데이터 갱신
```

## Skills (51)

### 개발

| 스킬 | 설명 |
|------|------|
| Qcommit | 사람이 작성한 것처럼 자연스러운 커밋을 생성합니다. AI 흔적을 제거합니다. |
| Qsystematic-debugging | 체계적 디버깅을 통해 근본 원인을 먼저 찾고, 가설을 검증한 후 수정합니다. |
| Qtest-driven-development | TDD: 테스트를 먼저 작성하고, 실패를 확인한 후, 최소 코드로 통과시키고, 리팩터링합니다. |
| Qcode-run-task | 코드 작업 완료 후 테스트, 리뷰, 수정, 재테스트 품질 검증 루프를 수행합니다. |
| Qfrontend-design | 높은 디자인 품질의 독창적인 프로덕션급 프론트엔드 인터페이스를 생성합니다. |
| Qspringboot-security | Java Spring Boot 서비스를 위한 Spring Security 모범 사례 가이드. |
| Qdatabase-schema-designer | 정규화 및 인덱싱 전략을 포함한 견고하고 확장 가능한 SQL/NoSQL 데이터베이스 스키마를 설계합니다. |
| Qdoc-comment | 프로젝트 언어에 적합한 문서화 주석을 자동으로 추가합니다. |
| Qmcp-builder | Python (FastMCP) 또는 TypeScript (MCP SDK)를 사용한 MCP (Model Context Protocol) 서버 생성 가이드. |
| Qagent-browser | 탐색, 폼 입력, 스크린샷, 데이터 추출을 위한 브라우저 자동화 CLI. |

### 작업 관리

| 스킬 | 설명 |
|------|------|
| Qgenerate-spec | CLAUDE.md, TASK_REQUEST.md, VERIFY_CHECKLIST.md 프로젝트 스펙 문서를 생성합니다. |
| Qrun-task | TASK_REQUEST와 VERIFY_CHECKLIST를 기반으로 자동 검증과 함께 작업을 실행합니다. |
| Qinit | QE 프레임워크 초기 설정: CLAUDE.md, 설정, 디렉토리 구조 생성 및 프로젝트 자동 분석. |
| Qrefresh | 프로젝트 분석 데이터를 수동으로 갱신하고 변경 이력을 표시합니다. |
| Qresume | 컴팩션 후 저장된 컨텍스트를 복원하여 이전 작업을 재개합니다. |
| Qcompact | 컨텍스트 보존 및 세션 인수인계. 컨텍스트를 저장하거나 인수인계 문서를 생성합니다. |
| Qarchive | 완료된 작업 파일을 자동으로 아카이브합니다. |
| Qmigrate-tasks | 산재된 작업 파일을 .qe/tasks/ 및 .qe/checklists/ 디렉토리 구조로 마이그레이션합니다. |
| Qupdate | QE Framework 플러그인을 최신 버전으로 업데이트합니다. |
| Qutopia | Utopia 모드 -- 확인 없이 완전 자율 실행. |

### 문서

| 스킬 | 설명 |
|------|------|
| Qdocx | Word 문서(.docx)를 생성, 읽기, 편집 및 조작합니다. |
| Qpdf | 모든 PDF 관련 작업: 읽기, 병합, 분할, 워터마크, 암호화, OCR 등. |
| Qpptx | 모든 PPTX 작업: 슬라이드 덱 생성, 읽기, 편집, 템플릿 활용. |
| Qxlsx | 모든 스프레드시트 작업(.xlsx, .csv, .tsv): 수식, 서식, 차트, 데이터 정리. |
| Qwriting-clearly | Strunk의 원칙에 기반하여 더 명확하고 강력한 산문을 작성합니다. |
| Qhumanizer | 텍스트에서 AI 생성 글쓰기의 흔적을 제거합니다. |
| Qprofessional-communication | 기술 커뮤니케이션 가이드: 이메일 구조, 팀 메시지, 회의 안건. |
| Qmermaid-diagrams | Mermaid 구문을 사용하여 소프트웨어 다이어그램을 생성합니다 (클래스, 시퀀스, 플로우차트, ERD 등). |
| Qc4-architecture | C4 모델 Mermaid 다이어그램을 사용한 아키텍처 문서를 생성합니다. |
| Qimage-analyzer | 이미지 분석: 스크린샷, 다이어그램, 차트, 와이어프레임, OCR 텍스트 추출. |

### 학술

| 스킬 | 설명 |
|------|------|
| Qgrad-paper-write | 표준 섹션 구조를 따라 체계적으로 학술 논문 초안을 작성합니다. |
| Qgrad-paper-review | 심사위원 코멘트를 분석하고 항목별 응답이 포함된 Response Letter를 작성합니다. |
| Qgrad-research-plan | 갭 분석과 함께 문헌 조사 및 실험 설계를 수행합니다. |
| Qgrad-seminar-prep | 슬라이드 구조, 스크립트, 예상 Q&A가 포함된 학술 발표를 준비합니다. |
| Qgrad-thesis-manage | 논문 진행 관리: 챕터 구조, 진행률 추적, 지도교수 미팅 준비. |

### 기획

| 스킬 | 설명 |
|------|------|
| Qpm-prd | 문제 정의, 페르소나, 성공 지표를 포함한 PRD를 체계적으로 작성합니다. |
| Qpm-user-story | Mike Cohn 형식과 Gherkin 인수 기준을 포함한 사용자 스토리를 작성합니다. |
| Qpm-roadmap | 우선순위 지정 및 릴리스 시퀀싱을 포함한 전략적 제품 로드맵을 계획합니다. |
| Qrequirements-clarity | 구현 전 집중 대화를 통해 모호한 요구사항을 명확히 합니다. |
| Qqa-test-planner | 테스트 계획, 수동 테스트 케이스, 회귀 테스트 스위트, 버그 리포트를 생성합니다. |

### 미디어

| 스킬 | 설명 |
|------|------|
| Qaudio-transcriber | 오디오 녹음(MP3, WAV, M4A 등)을 전문적인 Markdown 문서로 변환합니다. |
| Qyoutube-transcript-api | YouTube 동영상의 자막/캡션을 추출, 전사 및 번역합니다. |
| Qtranslate | 문법 교정을 지원하는 다국어 번역. |

### 메타

| 스킬 | 설명 |
|------|------|
| Qskill-creator | 새로운 스킬 생성, 기존 스킬 수정, 스킬 성능 측정. |
| Qcommand-creator | 반복적인 워크플로우에서 Claude Code 슬래시 명령어를 생성합니다. |
| Qfind-skills | skills.sh에서 스킬을 검색하고 SKILL.md 파일로 설치합니다. |
| Qalias | 폴더, 경로, 명령어에 대한 짧은 이름의 별칭을 정의합니다. |
| Qprofile | 사용자 명령 패턴, 작문 스타일, 자주 사용하는 표현을 분석합니다. |
| Qagent-md-refactor | 비대해진 에이전트 지침 파일을 점진적 공개 원칙에 따라 리팩터링합니다. |
| Qweb-design-guidelines | 접근성과 UX를 위한 Web Interface Guidelines에 따라 UI 코드를 검토합니다. |
| Qlesson-learned | git 히스토리를 통해 최근 코드 변경을 분석하고 엔지니어링 교훈을 추출합니다. |

## Agents (16)

에이전트는 작업 복잡도에 따라 자동으로 모델 티어가 할당됩니다. 자세한 내용은 [AGENT_TIERS.md](../core/AGENT_TIERS.md)를 참조하세요.

### HIGH 티어 (opus)

| 에이전트 | 설명 |
|----------|------|
| Edeep-researcher | 기술 비교 및 의사결정 지원을 위한 체계적 다단계 리서치 에이전트. |
| Eqa-orchestrator | 전체 테스트, 리뷰, 수정 품질 루프를 실행합니다. 메인 컨텍스트를 보호합니다. |

### MEDIUM 티어 (sonnet)

| 에이전트 | 설명 |
|----------|------|
| Etask-executor | 체크리스트 항목을 순서대로 구현합니다. 반복 작업을 위한 작업 패턴을 학습합니다. |
| Ecode-debugger | 디버깅 전문가. 버그 근본 원인을 분석하고, 오류를 추적하고, 문제를 해결합니다. |
| Ecode-reviewer | 코드 리뷰 전문가. 품질, 보안, 성능, 패턴 준수를 검토합니다. |
| Ecode-test-engineer | 테스트 엔지니어. 테스트 작성, 커버리지 분석, 테스트 전략을 담당합니다. |
| Ecode-doc-writer | 기술 문서 전문가. 코드 설명, API 문서, README를 작성합니다. |
| Edoc-generator | 배치 문서 생성(docx/pdf/pptx/xlsx)을 위한 백그라운드 서브 에이전트. |
| Egrad-writer | 학술적 글쓰기 스타일과 인용 규칙에 따라 학술 논문 챕터를 작성합니다. |
| Epm-planner | 기획 전문가. PRD, 사용자 스토리, 로드맵, 문서 생성을 담당합니다. |
| Erefresh-executor | 프로젝트 변경을 감지하고, .qe/ 분석 데이터를 갱신하고, 변경 이력을 기록합니다. |
| Ecompact-executor | 컨텍스트 윈도우 압박을 감지하고, 컨텍스트를 저장하고, 컴팩션 후 복원을 지원합니다. |
| Ehandoff-executor | 세션 인수인계 문서를 생성하고 검증합니다. |

### LOW 티어 (haiku)

| 에이전트 | 설명 |
|----------|------|
| Earchive-executor | 완료된 작업 파일을 버전별로 .qe/.archive/에 아카이브합니다. |
| Ecommit-executor | diff를 분석하고, 커밋 메시지를 생성하고, AI 흔적 없이 파일을 스테이징합니다. |
| Eprofile-collector | 사용자 명령 패턴, 작문 스타일, 교정 이력을 수집합니다. |

## 프로젝트 구조

```
qe-framework/
├── .claude-plugin/    # 플러그인 설정
├── agents/            # 16개 에이전트 (E-prefix)
├── skills/            # 51개 스킬 (Q-prefix)
├── core/              # 공유 원칙 및 설정
├── hooks/             # 라이프사이클 훅
├── install.js         # 설치 스크립트
└── package.json
```

## 라이선스

UNLICENSED
