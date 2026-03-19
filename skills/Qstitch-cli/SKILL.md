---
name: Qstitch-cli
description: "Google Stitch MCP setup and CLI usage guide. Use ONLY for setup, configuration, and troubleshooting — NOT for executing Stitch design operations. Trigger: 'stitch setup', 'stitch mcp', 'connect stitch', 'stitch cli'."
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qstitch-cli — Google Stitch MCP Setup & CLI

## Role Boundary (Absolute Rule)

This skill is a **setup and configuration guide only**. It does NOT execute Stitch operations.

| Request | Correct action |
|---------|---------------|
| "stitch 설정해줘", "stitch mcp 연결" | **This skill** — guide setup |
| "스크린 만들어줘", "디자인 그려줘", "코드 가져와" | **NOT this skill** — use Stitch MCP tools directly (if connected) |

### Pre-check: MCP Connection Status

**Before doing anything, check if Stitch MCP is already connected:**

```bash
claude mcp list 2>/dev/null | grep -i stitch
```

**If connected** (stitch server found):
- Do NOT re-run setup. Tell the user: "Stitch MCP가 이미 연결되어 있습니다. `generate_screen_from_text`, `fetch_screen_code` 등 MCP 도구를 직접 사용하세요."
- If the user asked for a design operation (not setup), exit this skill and use the MCP tools directly.

**If NOT connected** (no stitch server):
- If the user asked for a design operation: "Stitch MCP가 연결되어 있지 않습니다. 먼저 설정이 필요합니다." → proceed with setup guide below.
- If the user asked for setup: proceed with setup guide below.

---

## What is Google Stitch?

**Google Stitch** (stitch.withgoogle.com) is a Google Labs AI UI design tool that converts text prompts or images into responsive HTML/CSS code and visual UI designs, powered by Gemini 2.5.

| Feature | Detail |
|---------|--------|
| Input | Text prompts, wireframe images, screenshots |
| Output | HTML/CSS code + visual preview |
| Export | HTML/CSS download, Figma export |
| Models | Gemini 2.5 Flash (350 gen/mo), Gemini 2.5 Pro (50 gen/mo) |
| Platform | Web-only (stitch.withgoogle.com) |

---

## MCP Package Options

두 가지 MCP 패키지를 상황에 따라 선택한다:

| Package | Author | Auth Method | Best For |
|---------|--------|-------------|----------|
| `@_davideast/stitch-mcp` | Google DevRel (David East) | API Key or gcloud | 일반 개발 환경 |
| `stitch-mcp` | Community (Aakash Kargathara) | gcloud ADC | CI/자동화, 토큰 자동 갱신 필요 시 |

> Official Remote MCP (stitch.withgoogle.com/docs/mcp/setup)는 1시간마다 토큰 수동 갱신이 필요하므로 권장하지 않는다.

---

## Setup: Method A — `@_davideast/stitch-mcp` (Recommended)

### Step 1: Prerequisites

```bash
node --version    # Node.js 18+ required
gcloud --version  # Google Cloud CLI (optional, for gcloud auth)
```

gcloud CLI 없이 API Key로도 사용 가능하다.

### Step 2: One-time Auth Setup

```bash
npx @_davideast/stitch-mcp init
```

대화형 setup이 실행되며 다음 중 하나를 선택:
- **API Key** (가장 간단): `STITCH_API_KEY` 환경변수 설정
- **gcloud**: 기존 `gcloud auth` 사용 (`STITCH_USE_SYSTEM_GCLOUD=1`)
- **Access Token**: `STITCH_ACCESS_TOKEN` 직접 설정

설정 확인:
```bash
npx @_davideast/stitch-mcp doctor
```

### Step 3: Add to Claude Code

```bash
# API Key 방식
claude mcp add stitch -e STITCH_API_KEY=your-key -- npx @_davideast/stitch-mcp proxy

# gcloud 방식
claude mcp add stitch -e STITCH_USE_SYSTEM_GCLOUD=1 -- npx @_davideast/stitch-mcp proxy
```

또는 `~/.claude.json` 직접 편집:
```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["@_davideast/stitch-mcp", "proxy"],
      "env": {
        "STITCH_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Setup: Method B — `stitch-mcp` (gcloud ADC, auto token refresh)

### Step 1: gcloud Auth Setup

```bash
# Google Cloud 프로젝트 설정
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default set-quota-project YOUR_PROJECT_ID

# Stitch API 활성화
gcloud beta services mcp enable stitch.googleapis.com

# ADC 로그인
gcloud auth application-default login
```

### Step 2: Add to Claude Code

```bash
claude mcp add stitch -e GOOGLE_CLOUD_PROJECT=your-project-id -- npx -y stitch-mcp
```

또는 JSON 설정:
```json
{
  "mcpServers": {
    "stitch": {
      "command": "npx",
      "args": ["-y", "stitch-mcp"],
      "env": {
        "GOOGLE_CLOUD_PROJECT": "your-project-id"
      }
    }
  }
}
```

---

## Setup: Automated (Fastest Onboarding)

Claude Code + Gemini CLI + Codex CLI 동시 설정:

```bash
npx -p stitch-mcp-auto stitch-mcp-auto-setup
```

---

## Available MCP Tools (After Connection)

### `@_davideast/stitch-mcp` tools

| Tool | Description |
|------|-------------|
| `build_site` | 스크린들을 라우트에 매핑해 전체 사이트 HTML 생성 |
| `get_screen_code` | 특정 스크린의 HTML/CSS 코드 반환 |
| `get_screen_image` | 스크린 스크린샷을 base64로 반환 |

### `stitch-mcp` tools (9개)

| Tool | Description |
|------|-------------|
| `list_projects` | 모든 Stitch 프로젝트 목록 |
| `get_project` | 프로젝트 메타데이터 조회 |
| `create_project` | 새 프로젝트 생성 |
| `list_screens` | 프로젝트 내 스크린 목록 |
| `get_screen` | 스크린 메타데이터 조회 |
| `fetch_screen_code` | 스크린 HTML/CSS 코드 가져오기 |
| `fetch_screen_image` | 고해상도 스크린샷 다운로드 |
| `generate_screen_from_text` | 텍스트 프롬프트로 새 스크린 생성 |
| `extract_design_context` | 폰트, 색상, 레이아웃 등 디자인 컨텍스트 추출 |

---

## CLI Commands (`@_davideast/stitch-mcp`)

```bash
# 설정 및 인증
npx @_davideast/stitch-mcp init          # 최초 인증 설정
npx @_davideast/stitch-mcp doctor        # 설정 상태 확인
npx @_davideast/stitch-mcp logout        # 인증 취소

# 프로젝트 탐색
npx @_davideast/stitch-mcp screens -p <project-id>   # 프로젝트 스크린 목록
npx @_davideast/stitch-mcp view                       # 인터랙티브 리소스 브라우저

# 개발 서버
npx @_davideast/stitch-mcp serve -p <project-id>     # Vite 로컬 프리뷰 서버

# 빌드
npx @_davideast/stitch-mcp site -p <project-id>      # 전체 Astro 프로젝트 생성
npx @_davideast/stitch-mcp snapshot                   # 스크린 상태 저장

# MCP
npx @_davideast/stitch-mcp proxy         # MCP 프록시 실행 (Claude Code 연동)
npx @_davideast/stitch-mcp tool <name>   # MCP 툴 CLI에서 직접 호출
```

---

## Usage Examples in Claude Code

MCP 연결 후 Claude Code에서 다음과 같이 사용:

```
# 프로젝트 목록 조회
list_projects 툴 사용해서 내 Stitch 프로젝트 보여줘

# 스크린 코드 가져오기
project-123의 home 스크린 HTML 코드 가져와줘

# UI 생성
"다크 테마의 대시보드 로그인 페이지" 프롬프트로 Stitch 스크린 만들어줘

# 디자인 컨텍스트 추출
이 프로젝트에서 사용된 색상 팔레트와 폰트 추출해줘
```

---

## Verification

```bash
claude mcp list              # stitch 서버가 목록에 있는지 확인
claude mcp get stitch        # 설정 상세 확인
```

새 Claude Code 세션을 시작하면 MCP 도구가 활성화된다.

---

## Supported MCP Clients

| Client | Config Method |
|--------|---------------|
| Claude Code | `claude mcp add` |
| Claude Desktop | `claude_desktop_config.json` |
| Cursor | Settings > MCP |
| VS Code Copilot | `.vscode/mcp.json` |
| Gemini CLI | `gemini mcp add` |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `doctor` 실패 | `init` 재실행 또는 API Key 확인 |
| 토큰 만료 (Method A) | `init` 재실행 |
| 토큰 만료 (Method B) | `gcloud auth application-default login` 재실행 |
| 툴이 안 보임 | Claude Code 세션 재시작 |
| `stitch.googleapis.com` 오류 | `gcloud beta services mcp enable stitch.googleapis.com` 실행 |
| Node.js 버전 오류 | Node.js 18+ 설치 |

---

## Will
- Google Stitch MCP 서버 설정 안내
- 인증 방식 선택 (API Key / gcloud ADC)
- CLI 명령어 실행 지원
- Claude Code에서 Stitch MCP 도구 활용

## Will Not
- API Key나 gcloud 자격증명을 코드나 git에 저장
- 사용자 확인 없이 gcloud 설정 변경
- Stitch 프로젝트 자산 임의 삭제
