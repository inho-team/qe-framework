---
name: Qinit
description: Q-프레임워크 초기 세팅. 새 프로젝트에서 CLAUDE.md, settings.json, 디렉토리 구조, .gitignore를 생성하고 프로젝트를 자동 분석합니다. "초기화", "프로젝트 세팅", "init" 요청 시 사용합니다.
---

# Qinit — Q-프레임워크 초기화

## 역할
새 프로젝트에 Q-프레임워크 기본 구조를 세팅하고, 프로젝트를 자동 분석하는 스킬.
한 번만 실행하면 되며, 이미 세팅된 프로젝트에서는 실행하지 않습니다.

## 사전 확인
실행 전 프로젝트 루트에 `CLAUDE.md`가 있는지 확인합니다.
- **있으면**: "이미 Q-프레임워크가 세팅되어 있습니다. `/Qgenerate-spec`으로 작업을 생성하세요." 안내 후 종료.
- **없으면**: 초기화 진행.

## 초기화 절차

### 1단계: 프로젝트 정보 수집
사용자에게 최소한의 정보를 질문합니다:
- **프로젝트 이름**: 필수
- **프로젝트 설명**: 한 줄 요약
- **기술 스택**: 주요 언어/프레임워크 (선택)

### 2단계: 프로젝트 자동 분석
프로젝트 소스를 스캔하여 `.claude/analysis/`에 분석 결과를 저장합니다.

#### 분석 대상 및 출력 파일

| 출력 파일 | 분석 내용 | 스캔 방법 |
|-----------|-----------|-----------|
| `project-structure.md` | 디렉토리 트리, 주요 파일 목록, 파일 수/언어 비율 | `ls`, `Glob`으로 구조 파악 |
| `tech-stack.md` | 언어, 프레임워크, 의존성, 버전 정보 | `package.json`, `pom.xml`, `build.gradle`, `requirements.txt`, `go.mod`, `Cargo.toml` 등 파싱 |
| `entry-points.md` | 메인 진입점, API 엔드포인트, 라우트, CLI 명령어 | `main`, `app`, `index`, `server` 파일 탐색 + `@Controller`, `@Route`, `router` 등 패턴 검색 |
| `architecture.md` | 레이어 구조, 모듈 간 관계, 디자인 패턴 | 디렉토리 명명 규칙 분석 (`controller/`, `service/`, `repository/` 등) + import/require 관계 추적 |

#### 분석 규칙
- 분석은 **읽기 전용** — 소스 코드를 수정하지 않습니다.
- 파일이 너무 많으면 상위 구조 위주로 요약합니다 (파일 1000개 이상 시).
- 빈 프로젝트(소스 파일 없음)면 분석 단계를 건너뛰고 빈 분석 파일만 생성합니다.
- 각 분석 파일 상단에 생성 일시를 기록합니다.

### 3단계: 파일 생성
아래 파일과 디렉토리를 생성합니다:

#### CLAUDE.md
`Qgenerate-spec`의 `templates/CLAUDE_MD_TEMPLATE.md`를 참조하여 생성.
- 프로젝트 이름, 설명 채움
- 기술 스택은 2단계 분석 결과 반영
- 목표, 제약사항, 결정사항은 빈 상태로 둠
- 작업 목록은 비어 있는 테이블로 생성

#### .claude/settings.json
```json
{
}
```
빈 설정 파일. 필요 시 사용자가 훅 등을 추가.

#### 디렉토리 구조
```
.claude/
├── settings.json
├── analysis/
│   ├── project-structure.md
│   ├── tech-stack.md
│   ├── entry-points.md
│   └── architecture.md
├── .archive/
├── tasks/
│   └── pending/
└── checklists/
    └── pending/
```
`mkdir -p`로 생성.

#### .gitignore 추가
`.gitignore`가 없으면 새로 생성, 있으면 아래 항목 중 누락된 것만 추가:
```gitignore
# Claude Code
.claude/settings-local.json
.claude/tasks/
.claude/checklists/
.claude/analysis/
TASK_REQUEST_*.md
VERIFY_CHECKLIST_*.md
ANALYSIS_*.md

# Oh My ClaudeCode
.omc/
```

### 4단계: 완료 안내
생성된 파일 목록을 보여주고, 다음 단계를 안내합니다:
- "초기화 완료. `/Qgenerate-spec`으로 첫 번째 작업을 생성하세요."
- 분석 결과 요약을 간략히 보여줍니다 (기술 스택, 파일 수, 주요 진입점).

## 생성 규칙
- 이미 존재하는 파일은 덮어쓰지 않습니다.
- `.gitignore`는 기존 내용을 유지하고 누락된 항목만 추가합니다.
- 사용자 확인 없이 파일을 생성하지 않습니다. 생성 전 목록을 보여주고 `AskUserQuestion`으로 확인합니다.

## 할 것 (Will)
- CLAUDE.md 템플릿 생성
- .claude/ 디렉토리 구조 생성 (analysis/ 포함)
- 프로젝트 자동 분석 및 결과 저장
- .gitignore 설정
- .claude/settings.json 생성

## 안 할 것 (Will Not)
- 작업 스펙 생성 → `/Qgenerate-spec` 사용
- 코드 작성/수정
- 기존 파일 덮어쓰기
- 소스 코드 변경 (분석은 읽기 전용)
