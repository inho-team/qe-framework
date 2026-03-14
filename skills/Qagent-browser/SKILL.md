---
name: Qagent-browser
description: "브라우저 자동화 CLI. 웹사이트 탐색, 폼 작성, 클릭, 스크린샷, 데이터 추출, 웹앱 테스트에 사용."
metadata:
  source: https://skills.sh/vercel-labs/agent-browser
  author: vercel
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

## Core Workflow
1. `agent-browser open <url>`
2. `agent-browser snapshot -i` (get @e1, @e2 refs)
3. Interact: click, fill, select using refs
4. Re-snapshot after navigation/DOM changes

## Essential Commands
```bash
agent-browser open <url>
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser select @e1 "option"
agent-browser press Enter
agent-browser scroll down 500
agent-browser get text @e1
agent-browser get url
agent-browser wait @e1
agent-browser wait --load networkidle
agent-browser screenshot
agent-browser screenshot --full
agent-browser screenshot --annotate
agent-browser diff snapshot
agent-browser close
```

## Form Submission
```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
agent-browser fill @e1 "Jane"
agent-browser fill @e2 "jane@example.com"
agent-browser click @e5
agent-browser wait --load networkidle
```

## Important: Refs invalidate on page changes. Always re-snapshot.

## Security
- `--content-boundaries`: Wrap content in markers
- `AGENT_BROWSER_ALLOWED_DOMAINS`: Restrict navigation

## Cleanup
```bash
agent-browser close
```
