---
name: Qjira-cli
description: "Lightweight Jira CLI wrapper for quick issue management without MCP server setup. Use when querying issues with JQL, creating/updating tickets, managing sprints, or viewing boards from the terminal. Complements Qatlassian-mcp as a fast alternative for Jira-only tasks."
metadata:
  version: "1.0.0"
  domain: platform
  triggers: jira, jira-cli, issue, ticket, sprint, board, backlog, JQL, jira issue, jira sprint
  role: expert
  scope: implementation
  output-format: code
  related-skills: Qatlassian-mcp
allowed-tools: Bash(jira:*), Bash(jira *)
keywords: jira, cli, issue, ticket, sprint, board, backlog, JQL
---

> Shared principles: see core/PRINCIPLES.md

# Jira CLI — 경량 Jira 터미널 도구

`ankitpokhrel/jira-cli` 기반. MCP 서버 없이 Bash에서 바로 Jira를 조작한다.

> Confluence가 필요하면 `Qatlassian-mcp` 스킬을 사용한다.

## 사전 조건

```bash
# 설치 확인
jira version

# 미설치 시
brew install ankitpokhrel/jira-cli/jira-cli

# 초기 설정 (최초 1회)
jira init
```

`jira init` 실행 시 입력 항목:
- Jira Server URL: `https://your-domain.atlassian.net`
- Login type: `api_token`
- Email: 본인 Atlassian 이메일
- API Token: [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)에서 발급

## 핵심 명령어

### 이슈 조회

```bash
# 나에게 할당된 이슈
jira issue list -a$(jira me)

# JQL로 검색
jira issue list -q "project = PROJ AND status = 'In Progress' ORDER BY priority DESC"

# 특정 프로젝트의 미해결 이슈
jira issue list -p PROJ -s "To Do" -s "In Progress"

# 이슈 상세 보기
jira issue view PROJ-123

# 플레인 텍스트 출력 (파이프/파싱용)
jira issue list -q "project = PROJ" --plain --columns key,summary,status,assignee

# JSON 출력
jira issue list -q "project = PROJ" --plain --no-headers 2>/dev/null
```

### 이슈 생성

```bash
# 대화형 생성
jira issue create

# 원라이너 생성
jira issue create -t Bug -p PROJ -s "로그인 SSO 오류" -b "SSO 활성화 시 로그인 불가" -l bug -l production --priority High

# 하위 이슈 생성
jira issue create -t Sub-task -p PROJ -s "SSO 디버그 로그 추가" --parent PROJ-123
```

### 이슈 수정

```bash
# 상태 변경 (트랜지션)
jira issue move PROJ-123 "In Progress"

# 필드 수정
jira issue edit PROJ-123 -s "수정된 제목" --priority Highest

# 담당자 변경
jira issue assign PROJ-123 "jane.doe"
jira issue assign PROJ-123 $(jira me)  # 나에게 할당

# 코멘트 추가
jira issue comment add PROJ-123 "조사 중. race condition 의심됨."

# 라벨 추가 (edit으로)
jira issue edit PROJ-123 -l urgent -l hotfix
```

### 이슈 링크

```bash
# 이슈 링크 (PROJ-100이 PROJ-101을 block)
jira issue link PROJ-100 PROJ-101 "Blocks"
```

### 스프린트

```bash
# 현재 스프린트 이슈
jira sprint list --current

# 이전/다음 스프린트
jira sprint list --prev
jira sprint list --next

# 특정 보드의 스프린트
jira sprint list --board-id 42 --state active

# 스프린트에 이슈 추가
jira sprint add <sprint-id> PROJ-100 PROJ-101
```

### 보드

```bash
# 보드 목록
jira board list

# 특정 보드 (Kanban/Scrum)
jira board list -t scrum
```

### 에픽

```bash
# 에픽 목록
jira epic list -p PROJ

# 에픽에 이슈 추가
jira epic add PROJ-50 PROJ-123 PROJ-124

# 에픽 이슈 조회
jira epic list -p PROJ --table
```

### 프로젝트

```bash
# 프로젝트 목록
jira project list

# 프로젝트 키로 조회
jira project list --plain --columns key,name,type
```

## JQL 자주 쓰는 패턴

```bash
# 미해결 고우선순위 버그
jira issue list -q "project = PROJ AND issuetype = Bug AND priority IN (Highest, High) AND resolution IS EMPTY"

# 이번 주 생성된 이슈
jira issue list -q "project = PROJ AND created >= startOfWeek()"

# 14일 이상 업데이트 없는 이슈
jira issue list -q "project = PROJ AND updated <= -14d AND resolution IS EMPTY"

# 백로그 (스프린트 미배정)
jira issue list -q "project = PROJ AND sprint IS EMPTY AND resolution IS EMPTY"

# 릴리스 블로커
jira issue list -q "fixVersion = '2.0' AND priority = Blocker AND resolution IS EMPTY"

# 내가 코멘트한 이슈
jira issue list -q "project = PROJ AND comment ~ currentUser()"
```

## 출력 제어

```bash
# 테이블 (기본)
jira issue list -p PROJ

# 플레인 텍스트 (스크립트용)
jira issue list -p PROJ --plain

# 컬럼 선택
jira issue list -p PROJ --plain --columns key,summary,status,priority,assignee

# 헤더 없이
jira issue list -p PROJ --plain --no-headers

# 페이지 크기
jira issue list -p PROJ --paginate 100
```

## 실전 워크플로우

### 데일리 스탠드업 뷰

```bash
echo "=== 내 진행 중 ==="
jira issue list -a$(jira me) -s "In Progress" --plain --columns key,summary

echo "=== 내 리뷰 대기 ==="
jira issue list -a$(jira me) -s "In Review" --plain --columns key,summary

echo "=== 블로커 ==="
jira issue list -q "assignee = currentUser() AND (status = Blocked OR labels = blocked)" --plain --columns key,summary
```

### 빠른 버그 리포트

```bash
jira issue create \
  -t Bug \
  -p PROJ \
  -s "$1" \
  -b "## 재현 방법\n1. \n\n## 기대 결과\n\n## 실제 결과\n" \
  -l bug \
  --priority High \
  -a $(jira me)
```

### 스프린트 완료율 확인

```bash
echo "=== 완료 ==="
jira sprint list --current -s Done --plain --columns key,summary | wc -l

echo "=== 미완료 ==="
jira sprint list --current -s "To Do" -s "In Progress" --plain --columns key,summary | wc -l
```

## Qatlassian-mcp과의 역할 분담

| 작업 | Qjira-cli | Qatlassian-mcp |
|------|-----------|----------------|
| Jira 이슈 CRUD | O | O |
| JQL 검색 | O | O |
| 스프린트 관리 | O | O |
| Confluence 페이지 | X | O |
| CQL 검색 | X | O |
| 릴리스 노트 → Confluence | X | O |
| MCP 서버 불필요 | O | X |
| 스크립트/파이프 조합 | O (Bash 네이티브) | △ |

## 제약사항

### MUST DO
- `jira init` 완료 후 사용
- API Token은 환경변수 또는 `~/.config/.jira/.config.yml`에 저장
- 대량 작업 시 rate limit 주의 (요청 간 간격 두기)
- write 작업 전 사용자 확인

### MUST NOT DO
- API Token을 코드에 하드코딩
- `--plain` 없이 출력 파싱 시도 (ANSI 코드 포함됨)
- Confluence 작업에 이 스킬 사용 (Qatlassian-mcp 사용)
