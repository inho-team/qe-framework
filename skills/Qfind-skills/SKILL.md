---
name: Qfind-skills
description: skills.sh에서 스킬을 검색하고, 내용을 분석한 뒤 SKILL.md 파일로 직접 생성하여 설치합니다. npx skills add 대신 WebFetch로 원본을 읽고 전역/로컬 스킬로 변환합니다.
---
> 공통 원칙: core/PRINCIPLES.md 참조


# Qfind-skills: 스킬 검색 및 설치

skills.sh 생태계에서 스킬을 검색하고, 원본 SKILL.md를 분석하여 Claude Code 스킬로 직접 생성합니다.

## 트리거 조건

- "스킬 찾아줘", "find a skill for X", "X를 위한 스킬 있어?"
- "skills.sh에서 검색해줘"
- 특정 도메인(디자인, 테스트, 배포 등)의 스킬을 원할 때

## 워크플로우

### 1단계: 스킬 검색

사용자 요청을 분석하여 skills.sh에서 검색합니다.

```bash
# 방법 1: WebFetch로 skills.sh 검색
WebFetch https://skills.sh/ "검색어와 관련된 스킬 목록을 찾아줘"

# 방법 2: npx skills find (CLI 사용 가능 시)
npx skills find [query]
```

### 2단계: 스킬 원본 분석

검색된 스킬의 GitHub 원본 SKILL.md를 가져옵니다.

```bash
# GitHub raw URL로 SKILL.md 내용 가져오기
curl -s https://raw.githubusercontent.com/<owner>/<repo>/main/skills/<skill-name>/SKILL.md
```

또는 WebFetch로:
```
WebFetch https://github.com/<owner>/<repo>/blob/main/skills/<skill-name>/SKILL.md
```

### 3단계: 설치 위치 확인

AskUserQuestion 도구로 사용자에게 물어봅니다:

- **전역 (Global)**: `~/.claude/skills/<skill-name>/SKILL.md` — 모든 프로젝트에서 사용
- **로컬 (Local)**: `.claude/skills/<skill-name>/SKILL.md` — 현재 프로젝트에서만 사용

### 4단계: SKILL.md 생성

원본 내용을 분석하여 Claude Code 호환 SKILL.md 파일로 변환합니다.

**변환 규칙:**
1. frontmatter(`---`)의 name, description 유지
2. 스킬 이름 앞에 `Q` 접두사 추가 (사용자 커스텀 스킬 구분)
3. `npx skills add` 명령어 → 직접 파일 생성 방식으로 대체
4. 원본의 핵심 지침과 워크플로우는 그대로 보존
5. 불필요한 CLI 설치 안내 제거

```bash
# 전역 설치
mkdir -p ~/.claude/skills/Q<skill-name>
# Write 도구로 SKILL.md 생성

# 로컬 설치
mkdir -p .claude/skills/Q<skill-name>
# Write 도구로 SKILL.md 생성
```

### 5단계: 설치 확인

```bash
# 파일 존재 확인
ls -la ~/.claude/skills/Q<skill-name>/SKILL.md   # 전역
ls -la .claude/skills/Q<skill-name>/SKILL.md      # 로컬
```

설치 완료 후 사용자에게 안내:
- 스킬 이름과 용도
- 설치 경로
- 다음 세션부터 `/Q<skill-name>` 으로 사용 가능

## 스킬 카테고리 참고

| 카테고리 | 검색 키워드 |
|---------|------------|
| 웹 개발 | react, nextjs, typescript, css, tailwind |
| 테스팅 | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| 문서화 | docs, readme, changelog, api-docs |
| 코드 품질 | review, lint, refactor, best-practices |
| 디자인 | ui, ux, design-system, accessibility |
| 생산성 | workflow, automation, git |

## 검색 팁

- 구체적 키워드 사용: "react testing" > "testing"
- 다양한 용어 시도: "deploy" 외에 "deployment", "ci-cd"
- 주요 소스: `vercel-labs/skills`, `ComposioHQ/awesome-claude-skills`
- skills.sh 브라우징: https://skills.sh/

## 스킬 미발견 시

1. 검색 결과가 없음을 안내
2. 직접 도움을 제안
3. 필요시 커스텀 스킬 생성 제안 (`/Qcommand-creator` 활용)
