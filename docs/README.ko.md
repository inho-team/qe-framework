[English](../README.md) | **한국어** | [中文](README.zh.md) | [日本語](README.ja.md)

# QE Framework (Query Executor)

Claude Code를 위한 개인용 스킬 및 에이전트 패키지.

QE (Query Executor)는 사용자의 질의를 구조화된 실행 가능한 작업으로 변환하는 프레임워크입니다. 스펙 생성부터 구현, 검증, 커밋까지 전체 라이프사이클을 스킬과 에이전트의 협업 시스템을 통해 처리합니다.

## 철학

> 스펙 없는 작업은 추측이다.
> 검증 없는 스펙은 희망이다.
> 감리 없는 검증은 확증 편향이다.

QE Framework는 **SVS Loop** (Spec -> Verify -> Supervise)를 중심으로 구축되었습니다:

```
/Qgenerate-spec  →  /Qrun-task  →  Supervision  →  Done
                                        ↑                |
                           auto-remediate (max 3x)  ← FAIL
```

1. **`/Qgenerate-spec`** -- TASK_REQUEST + VERIFY_CHECKLIST를 생성합니다. Plan 에이전트가 스펙을 자동으로 리뷰한 후 사용자에게 보여줍니다. 실행 가능성 검증을 통해 모든 항목이 실행 가능한지 확인합니다.
2. **`/Qrun-task`** -- 체크리스트 항목을 하나씩 진행 추적과 함께 실행합니다. 작업 유형 배너(CODE/DOCS/ANALYSIS)를 표시하여 승인 전 어떤 작업이 수행될지 정확히 알 수 있습니다.
3. **Supervision** -- 도메인별 감리 에이전트(코드 품질, 보안, 문서, 분석)가 독립적인 리뷰를 수행합니다. 실패 시 REMEDIATION_REQUEST가 자동 생성되고 루프가 다시 실행됩니다 -- 최대 3회까지 사람의 개입 없이 진행됩니다.
4. **최소 중단** -- 사용자에게 묻는 시점은 5곳뿐입니다: 스펙 확인, 실행 프롬프트, 작업 승인, 완료 보고, 3회 감리 실패 에스컬레이션. 나머지는 모두 자동입니다.

엔지니어링 원칙: SOLID, DRY, KISS, YAGNI, 증거 기반 의사결정, 최소 변경, 다국어 지원(자동 언어 감지).

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

아래 명령어는 **터미널**에서 실행하세요 (Claude Code 세션 내부가 아닌):

### Step 1: Marketplace 등록 (최초 1회)
```bash
claude plugin marketplace add inho-team/qe-framework
```

### Step 2: 플러그인 설치
```bash
claude plugin install qe-framework@inho-team-qe-framework
```

### 최신 버전으로 업데이트
```bash
claude plugin update qe-framework@inho-team-qe-framework
```

### 설치 확인
```bash
claude plugin list
```

### 문제 해결

**설치 시 SSH permission denied 오류가 발생하는 경우**

`git@github.com: Permission denied (publickey)` 오류가 나타나면 아래 명령어로 HTTPS를 강제 사용하세요:
```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```
그런 다음 설치 명령어를 다시 실행하세요.

> **Note**: 플러그인 명령어는 Claude Code 세션 내부가 아닌 터미널에서 실행해야 합니다. 설치 또는 업데이트 후 Claude Code를 재시작하면 변경사항이 적용됩니다.

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

## Skills (65 + 72 Coding Experts)

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
| Qautoresearch | Karpathy의 autoresearch에서 영감 받은 자율 실험 루프. 다중 파일 지원, Ecode-reviewer/debugger 통합, 메트릭 기반 keep/discard 판정. |
| Qmcp-setup | 외부 서비스(Google Drive, Slack, GitHub 등) 연결을 위한 MCP 서버 설정 및 구성 가이드. |
| Qstitch-cli | Google Stitch MCP 설정 및 AI 기반 UI 디자인을 위한 CLI 가이드. |
| Qcc-setup | Claude Code 셸 별칭 설정(cc, ccc, ccd) -- 빠른 터미널 실행. |

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
| Qdoc-converter | MD, DOCX, PDF, PPTX, HTML 간 문서 형식 변환. 멀티 도구 오케스트레이션 지원. |
| Qcontent-research-writer | 인용, 반복 개선, 섹션별 피드백을 포함한 리서치 기반 콘텐츠 작성. |

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
| Qhelp | QE Framework 빠른 참조 카드를 터미널에 표시합니다. |
| Qskill-tester | 자동 스킬 라우팅 테스터. 인텐트 분류 정확도를 검증하고 오분류 스킬을 찾습니다. |
| Qjira-cli | MCP 서버 설정 없이 빠른 이슈 관리를 위한 경량 Jira CLI 래퍼. |

### 분석

| 스킬 | 설명 |
|------|------|
| Qdata-analysis | CSV/JSON/Excel 데이터셋의 데이터 탐색, 통계 분석, 시각화. |
| Qfinance-analyst | 재무 분석, 밸류에이션 모델링, DCF, 몬테카를로 시뮬레이션, 포트폴리오 최적화. |
| Qfact-checker | 문서에서 사실 주장을 추출하고 증거 기반 리서치를 통해 검증합니다. |
| Qsource-verifier | SIFT 방법론을 사용하여 출처 신뢰성과 디지털 콘텐츠 진위를 검증합니다. |

## Coding Expert Skills (72)

도메인별 코딩 전문가 스킬. 각 스킬은 해당 기술 스택에 대한 깊은 전문성을 제공하며, 모범 사례, 일반적인 패턴, 프로덕션 수준의 코드 생성을 포함합니다.

### Languages (14)

| 스킬 | 설명 |
|------|------|
| Qcpp-pro | concepts, ranges, 코루틴, SIMD, 템플릿 메타프로그래밍을 활용한 모던 C++20/23. |
| Qcsharp-developer | .NET 8+, ASP.NET Core, Blazor, Entity Framework, CQRS 패턴의 C# 개발. |
| Qembedded-systems | STM32, ESP32, FreeRTOS, 베어메탈, 실시간 시스템용 펌웨어. |
| Qgolang | 엄격한 테스트 주도 개발과 품질 게이트를 갖춘 Go 개발 표준. |
| Qgolang-pro | 동시성 Go 패턴, gRPC/REST 마이크로서비스, 성능 최적화. |
| Qjava-architect | Spring Boot 3.x, WebFlux, JPA 최적화, OAuth2/JWT 보안. |
| Qjavascript-pro | 모던 ES2023+, async/await, ESM 모듈, Node.js API. |
| Qkotlin-specialist | 코루틴, Flow, KMP, Compose UI, Ktor, 타입 안전 DSL. |
| Qphp-pro | Laravel, Symfony, Swoole 비동기, PSR 표준을 활용한 PHP 8.3+. |
| Qpython-pro | 타입 안전성, 비동기 프로그래밍, pytest, mypy strict 모드의 Python 3.11+. |
| Qrust-engineer | 소유권, 라이프타임, 트레이트, tokio 비동기, 제로 코스트 추상화. |
| Qsql-pro | 복잡한 쿼리, 윈도우 함수, CTE, 인덱싱, 크로스 방언 마이그레이션. |
| Qswift-expert | SwiftUI, async/await, 액터, 프로토콜 지향 설계의 iOS/macOS 개발. |
| Qtypescript-pro | 고급 제네릭, 조건부 타입, 브랜드 타입, tRPC 통합. |

### Frontend (12)

| 스킬 | 설명 |
|------|------|
| Qangular-architect | Angular 17+ 독립 컴포넌트, NgRx, RxJS 패턴, 지연 로딩. |
| Qflutter-expert | Riverpod/Bloc, GoRouter, 플랫폼별 구현의 Flutter 3+. |
| Qgame-developer | Unity/Unreal Engine, ECS 아키텍처, 멀티플레이어 네트워킹, 셰이더 프로그래밍. |
| Qnextjs-developer | Next.js 14+ App Router, Server Components, Server Actions, 스트리밍 SSR. |
| Qreact-best-practices | Vercel Engineering의 React/Next.js 성능 최적화 가이드라인. |
| Qreact-expert | 훅, Server Components, Suspense, React 19 기능을 활용한 React 18+. |
| Qreact-native-expert | React Native, Expo, 네이티브 모듈 통합의 크로스 플랫폼 모바일 앱. |
| Qvite | Vite 빌드 도구 설정, 플러그인 API, SSR, Rolldown 마이그레이션. |
| Qvue-best-practices | TypeScript, SSR, Volar를 활용한 Vue 3 Composition API. |
| Qvue-expert | Vue 3 Composition API, Nuxt 3, Pinia, Quasar/Capacitor, PWA 기능. |
| Qvue-expert-js | 바닐라 JavaScript와 JSDoc 기반 타이핑의 Vue 3 (TypeScript 없음). |
| Qweb-design-guidelines-vercel | Web Interface Guidelines 준수를 위한 UI 코드 리뷰. |

### Backend (14)

| 스킬 | 설명 |
|------|------|
| Qapi-designer | REST/GraphQL API 설계, OpenAPI 스펙, 버저닝, 페이지네이션 패턴. |
| Qarchitecture-designer | 시스템 아키텍처, ADR, 기술 트레이드오프, 확장성 계획. |
| Qdjango-expert | Django REST Framework, ORM 최적화, JWT 인증. |
| Qdotnet-core-expert | .NET 8 미니멀 API, 클린 아키텍처, 클라우드 네이티브 마이크로서비스. |
| Qfastapi-expert | Pydantic V2와 SQLAlchemy를 활용한 고성능 비동기 Python API. |
| Qgraphql-architect | GraphQL 스키마, Apollo Federation, DataLoader, 실시간 구독. |
| Qlaravel-specialist | Eloquent, Sanctum, Horizon, Livewire, Pest 테스팅의 Laravel 10+. |
| Qlegacy-modernizer | Strangler fig 패턴, branch by abstraction, 점진적 마이그레이션. |
| Qmcp-developer | TypeScript 또는 Python SDK를 활용한 MCP 서버/클라이언트 개발. |
| Qmicroservices-architect | DDD, 사가 패턴, 이벤트 소싱, CQRS, 서비스 메시, 분산 추적. |
| Qnestjs-expert | NestJS 모듈, 의존성 주입, 가드, 인터셉터, Swagger 문서. |
| Qrails-expert | Hotwire, Turbo Frames/Streams, Action Cable, Sidekiq의 Rails 7+. |
| Qspring-boot-engineer | Spring Boot 3.x REST, Spring Security 6, Spring Data JPA, WebFlux. |
| Qwebsocket-engineer | Redis 스케일링과 프레즌스 추적을 갖춘 실시간 WebSocket/Socket.IO 시스템. |

### Data & AI (6)

| 스킬 | 설명 |
|------|------|
| Qfine-tuning-expert | LoRA/QLoRA, PEFT, 명령어 튜닝, RLHF, DPO, 모델 양자화. |
| Qml-pipeline | MLflow, Kubeflow, Airflow, 피처 스토어, 실험 추적. |
| Qpandas-pro | DataFrame 연산, 집계, 병합, 시계열, 성능 최적화. |
| Qprompt-engineer | 프롬프트 설계, 사고 체인, 퓨샷 러닝, 평가 프레임워크. |
| Qrag-architect | RAG 시스템, 벡터 데이터베이스, 하이브리드 검색, 리랭킹, 임베딩 파이프라인. |
| Qspark-engineer | Spark DataFrame 변환, SQL 최적화, 구조화 스트리밍. |

### Infra & DevOps (14)

| 스킬 | 설명 |
|------|------|
| Qatlassian-mcp | MCP를 통한 Jira/Confluence 통합, 이슈 추적 및 문서화. |
| Qchaos-engineer | 카오스 실험, 장애 주입, 게임 데이, 복원력 테스트. |
| Qcli-developer | 인수 파싱, 자동 완성, 대화형 프롬프트를 갖춘 CLI 도구. |
| Qcloud-architect | 멀티 클라우드 아키텍처, Well-Architected Framework, 비용 최적화. |
| Qdatabase-optimizer | 쿼리 최적화, EXPLAIN 분석, 인덱스 설계, 파티셔닝 전략. |
| Qdevops-engineer | Docker, CI/CD, Kubernetes, Terraform, GitHub Actions, GitOps. |
| Qkubernetes-specialist | K8s 매니페스트, Helm 차트, RBAC, NetworkPolicies, 멀티 클러스터 관리. |
| Qmonitoring-expert | Prometheus/Grafana, 구조화 로깅, 알림, 분산 추적, 부하 테스트. |
| Qpostgres-pro | PostgreSQL EXPLAIN, JSONB, 확장, VACUUM 튜닝, 레플리케이션. |
| Qsalesforce-developer | Apex, Lightning Web Components, SOQL, 트리거, 플랫폼 이벤트. |
| Qshopify-expert | Liquid 테마, Hydrogen 스토어프론트, Shopify 앱, 체크아웃 확장. |
| Qsre-engineer | SLI/SLO, 에러 버짓, 인시던트 대응, 카오스 엔지니어링, 용량 계획. |
| Qterraform-engineer | Terraform 모듈, 상태 관리, 다중 환경 워크플로우, 테스트. |
| Qwordpress-pro | WordPress 테마, Gutenberg 블록, WooCommerce, REST API, 보안 강화. |

### Quality & Security (12)

| 스킬 | 설명 |
|------|------|
| Qcode-documenter | 독스트링, OpenAPI/Swagger 스펙, JSDoc, 문서 포털. |
| Qcode-reviewer | 코드 품질 감사: 버그, 보안, 성능, 네이밍, 아키텍처. |
| Qdebugging-wizard | 오류 파싱, 스택 트레이스 분석, 가설 기반 근본 원인 격리. |
| Qfeature-forge | 요구사항 워크숍, 사용자 스토리, EARS 형식 스펙, 인수 기준. |
| Qfullstack-guardian | 계층화된 인증과 검증을 갖춘 보안 중심 풀스택 개발. |
| Qplaywright-expert | Playwright E2E 테스트, 페이지 객체, 픽스처, 비주얼 리그레션. |
| Qsecure-code-guardian | 인증, 입력 검증, OWASP Top 10 방지, 암호화. |
| Qsecurity-reviewer | 보안 감사, SAST, 침투 테스트, 컴플라이언스 체크. |
| Qspec-miner | 레거시/미문서화 코드베이스에서의 역공학 스펙 추출. |
| Qtest-master | 테스트 전략, 커버리지 분석, 성능 테스트, 테스트 아키텍처. |
| Qthe-fool | 악마의 변호인, 프리모템, 레드 팀, 가정 감사. |
| Qvitest | Jest 호환 API, 모킹, 커버리지를 갖춘 Vitest 단위 테스트. |

## Background Processing

QE Framework는 주요 라이프사이클 시점에 여러 에이전트를 백그라운드에서 자동 실행합니다. 이 에이전트들은 수동 호출이 필요 없으며, 훅과 다른 에이전트에 의해 자동으로 트리거됩니다.

### 작동 방식

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        QE Framework Lifecycle                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Session Start                                                        │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ SessionStart │───▶│ Erefresh-executor   │  Update .qe/analysis/    │
│  │    Hook      │    │ (if analysis stale) │  before any work begins  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  User Interaction                                                     │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreToolUse   │───▶│   Intent Gate       │  Route user intent to    │
│  │    Hook      │    │   Classification    │  the correct skill/agent │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PostToolUse  │───▶│ Eprofile-collector  │  Learn user patterns     │
│  │    Hook      │    │ (command, style)    │  and correction history  │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Context Pressure (75%+)                                              │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ PreCompact   │───▶│ Ecompact-executor   │  Save snapshot before    │
│  │    Hook      │    │ (auto-save context) │  context is lost         │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  Task Completion                                                      │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │  Qrun-task   │───▶│ Earchive-executor   │  Archive completed tasks │
│  │  completes   │    │ Ecommit-executor    │  Auto-commit changes     │
│  └──────────────┘    └─────────────────────┘                          │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────┐    ┌─────────────────────┐                          │
│  │ Notification │───▶│  Chain follow-up    │  Trigger next actions    │
│  │    Hook      │    │  actions            │  when agents complete    │
│  └──────────────┘    └─────────────────────┘                          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Lifecycle Hooks

프레임워크는 특정 이벤트에서 실행되는 9개의 라이프사이클 훅을 사용합니다:

| Hook | 트리거 | 동작 |
|------|--------|------|
| `SessionStart` | 대화 시작 | 프레임워크 규칙을 주입하고, 분석이 오래된 경우 `Erefresh-executor`를 트리거 |
| `UserPromptSubmit` | 사용자 메시지 전송 | CJK/bigram 매칭 기반 **인텐트 자동 분류** + **언어 감지** (`.qe/profile/language.md`에 저장) |
| `PreToolUse` | 모든 도구 호출 전 | Intent Gate 라우팅 표시, 시크릿 스캔, 컨텍스트 압력 경고 |
| `PostToolUse` | 모든 도구 호출 후 | 에러 추적/에스컬레이션, 도구 호출 카운팅, `Eprofile-collector` 트리거 |
| `PreCompact` | 컨텍스트 컴팩션 전 | `Ecompact-executor`를 트리거하여 컨텍스트가 손실되기 전에 저장 |
| `Stop` | 대화 종료 | 세션 로그 기록, 활성 작업 모드 차단 |
| `Notification` | 백그라운드 에이전트 완료 | 백그라운드 에이전트 완료 시 후속 작업을 체이닝 |
| `TaskCompleted` | 작업 완료 | 작업 종료 전 검증 체크리스트 완료 여부 확인 |
| `TeammateIdle` | 에이전트 팀원 유휴 | 유휴 팀원에게 대기 중인 작업 인계 안내 |

### 백그라운드 에이전트

이 에이전트들은 사용자 상호작용 없이 자동으로 실행됩니다. 결과를 `.qe/` 파일에 기록하며 사용자에게 직접 응답하지 않습니다.

#### Erefresh-executor -- 프로젝트 분석 동기화

> 다른 에이전트가 비용이 큰 프로젝트 스캔을 건너뛸 수 있도록 `.qe/analysis/`를 최신 상태로 유지합니다.

| | 상세 |
|---|---|
| **실행 시점** | 세션 시작 시 (오래된 경우), Qrun-task 전, 또는 `/Qrefresh`로 수동 실행 |
| **기록 위치** | `.qe/analysis/*.md`, `.qe/changelog.md` |
| **토큰 절약** | ~50% 감소 -- 에이전트가 수십 개 파일을 스캔하는 대신 4개 분석 파일을 읽음 |

**절차:**
1. `git diff`와 파일 시스템 스캔을 통해 변경 감지
2. 4개 분석 파일 업데이트: `project-structure`, `tech-stack`, `entry-points`, `architecture`
3. `.qe/changelog.md`에 변경 이력을 `[External Change]` 또는 `[QE]`로 태깅하여 기록

#### Ecompact-executor -- 컨텍스트 보존

> 컨텍스트 컴팩션 전에 경량 스냅샷을 저장하여 세션을 재개할 수 있도록 합니다.

| | 상세 |
|---|---|
| **실행 시점** | 컨텍스트 윈도우가 75% 이상 (Yellow zone)에 도달하거나, `/Qcompact`로 수동 실행 |
| **기록 위치** | `.qe/context/snapshot.md`, `.qe/context/decisions.md` |
| **토큰 절약** | ~70% 감소 -- 프로젝트를 다시 탐색하는 대신 몇 개 파일에서 컨텍스트를 복원 |

**절차:**
1. 진행 중인 작업, 체크리스트 상태, 최근 파일 변경, 주요 결정사항을 수집
2. `.qe/context/snapshot.md`에 스냅샷 저장 (경로와 요약만, 코드 없음)
3. `.qe/context/decisions.md`에 결정사항을 역시간순으로 누적

#### Earchive-executor -- 작업 아카이브

> 완료된 작업을 버전별 아카이브로 이동하여 작업 공간을 깨끗하게 유지합니다.

| | 상세 |
|---|---|
| **실행 시점** | Qrun-task가 작업을 완료로 표시하거나, `/Qarchive`로 수동 실행 |
| **기록 위치** | `.qe/.archive/vX.Y.Z/tasks/`, `.qe/.archive/vX.Y.Z/checklists/` |

**절차:**
1. `.qe/tasks/pending/`에서 완전히 완료된 작업을 스캔
2. 완료된 TASK_REQUEST와 VERIFY_CHECKLIST를 `.qe/.archive/vX.Y.Z/`로 이동
3. 아카이브된 파일과 함께 CLAUDE.md 스냅샷을 저장

#### Ecommit-executor -- 자동 커밋

> AI 흔적이 전혀 없는 사람 스타일의 커밋을 생성합니다.

| | 상세 |
|---|---|
| **실행 시점** | `/Qcommit`에 의해 위임되거나, Qrun-task 완료 후 자동 커밋 |
| **금지 사항** | `Co-Authored-By` 라인, AI 관련 문구, 이모지 |

**절차:**
1. `git diff`를 분석하고 프로젝트의 기존 커밋 메시지 스타일에 맞춤
2. 관련 파일을 선택적으로 스테이징 (`.env`, 자격 증명 제외)
3. 사람이 작성한 것과 구분할 수 없는 커밋을 생성

#### Eprofile-collector -- 사용자 패턴 학습

> 시간이 지남에 따라 사용자 선호도를 학습하여 인텐트 인식 정확도를 향상시킵니다.

| | 상세 |
|---|---|
| **실행 시점** | 스킬 또는 에이전트 완료 후 |
| **기록 위치** | `.qe/profile/command-patterns.md`, `writing-style.md`, `corrections.md`, `preferences.md` |

**수집 내용:**

| 파일 | 내용 |
|------|------|
| `command-patterns.md` | 스킬/에이전트 호출 빈도 및 최근성 |
| `writing-style.md` | 격식/비격식 패턴, 약어 사전 |
| `corrections.md` | 반복되는 오해를 방지하기 위한 사용자 교정 이력 |
| `preferences.md` | 응답 길이, 코드 스타일, 언어 선호도 |

#### Ehandoff-executor -- 세션 인수인계

> 원활한 세션 간 연속 작업을 위해 검증된 인수인계 문서를 생성합니다.

| | 상세 |
|---|---|
| **실행 시점** | `/Qcompact` (handoff 모드)로 수동 실행 |
| **기록 위치** | `.qe/handoffs/HANDOFF_{date}_{time}.md` |

**절차:**
1. 작업 상태, 체크리스트 진행률, 최근 git 변경, 결정사항을 수집
2. 구체적인 다음 단계가 포함된 구조화된 인수인계 문서를 생성
3. 참조된 모든 파일과 작업 UUID가 실제로 존재하는지 검증

#### Edoc-generator -- 배치 문서 생성

> 메인 컨텍스트 윈도우에서 무거운 문서 생성을 분리합니다.

| | 상세 |
|---|---|
| **실행 시점** | Epm-planner, Qrun-task (`type: docs`), 또는 다중 문서 요청에 의해 위임 |
| **지원 형식** | `.docx`, `.pdf`, `.pptx`, `.xlsx` |

템플릿이 있는 경우 이를 활용하여 여러 문서를 병렬로 처리합니다.

---

## Agents (22)

에이전트는 작업 복잡도에 따라 자동으로 모델 티어가 할당됩니다. 자세한 내용은 [AGENT_TIERS.md](../core/AGENT_TIERS.md)를 참조하세요.

### HIGH 티어 (opus)

| 에이전트 | 설명 |
|----------|------|
| Edeep-researcher | 기술 비교 및 의사결정 지원을 위한 체계적 다단계 리서치 에이전트. |
| Eqa-orchestrator | 전체 테스트, 리뷰, 수정 품질 루프를 실행합니다. 메인 컨텍스트를 보호합니다. |
| Esupervision-orchestrator | 감리 오케스트레이터. 도메인 감리 에이전트에 라우팅하고, PASS/PARTIAL/FAIL 등급을 집계하며, FAIL 시 REMEDIATION_REQUEST를 자동 생성합니다. |

### MEDIUM 티어 (sonnet)

| 에이전트 | 설명 |
|----------|------|
| Etask-executor | 체크리스트 항목을 순서대로 구현합니다. 독립 항목의 wave 기반 병렬 실행을 지원합니다. |
| Ecode-debugger | 디버깅 전문가. 버그 근본 원인을 분석하고, 오류를 추적하고, 문제를 해결합니다. |
| Ecode-reviewer | 코드 리뷰 전문가. 품질, 보안, 성능, 패턴 준수를 검토합니다. |
| Ecode-test-engineer | 테스트 엔지니어. 테스트 작성, 커버리지 분석, 테스트 전략을 담당합니다. |
| Ecode-doc-writer | 기술 문서 전문가. 코드 설명, API 문서, README를 작성합니다. |
| Ecode-quality-supervisor | 코드 품질 감사 감리 에이전트. 코드 품질, 테스트 커버리지, 아키텍처 일관성을 검토합니다. PASS/PARTIAL/FAIL을 반환합니다. |
| Edocs-supervisor | 문서 감사 감리 에이전트. 완전성, 정확성, 구조적 일관성, 링크 유효성을 검토합니다. PASS/PARTIAL/FAIL을 반환합니다. |
| Eanalysis-supervisor | 분석 감사 감리 에이전트. 증거 충분성, 논리적 타당성, 범위 적절성, 실행 가능성을 검토합니다. PASS/PARTIAL/FAIL을 반환합니다. |
| Esecurity-officer | 보안 감사 전문가. git diff 변경 사항에서 취약점을 스캔하고, PASS/WARN/FAIL로 분류합니다. |
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

## Agent Teams (실험적)

QE Framework는 병렬 협업이 필요한 복잡한 작업을 위해 [Claude Agent Teams](https://code.claude.com/docs/en/agent-teams)를 지원합니다. Agent Teams는 여러 Claude 인스턴스를 생성하여 직접 소통하고 작업 목록을 공유합니다.

### Teams 활성화 조건

기능이 활성화되고 작업이 복잡도 임계값을 충족하면 자동으로 Teams가 활성화됩니다:

| 에이전트 | Team 트리거 | Team 구성 |
|----------|------------|-----------|
| Eqa-orchestrator | 3개 이상의 테스트/소스 그룹 | Test Engineer + Code Reviewer 병렬 |
| Etask-executor | 5개 이상의 독립 체크리스트 항목 | 파일 그룹별 팀원 1명 |
| Edeep-researcher | 3개 이상의 연구 소스/관점 | Researchers + Devil's Advocate |

### Agent Teams 활성화

`.claude/settings.json`에 추가:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Agent Teams가 활성화되지 않은 경우 모든 에이전트는 기존 Subagent 동작으로 폴백합니다.

자세한 설정과 팀 패턴은 [AGENT_TEAMS.md](../core/AGENT_TEAMS.md)를 참조하세요.

## 프로젝트 구조

```
qe-framework/
├── .claude-plugin/    # 플러그인 설정
├── agents/            # 22개 에이전트 (E-prefix)
├── skills/            # 65개 core + 72개 coding expert 스킬 (Q-prefix)
├── core/              # 공유 원칙 및 설정
├── hooks/             # 라이프사이클 훅
├── install.js         # 설치 스크립트
└── package.json
```

## 라이선스

UNLICENSED
