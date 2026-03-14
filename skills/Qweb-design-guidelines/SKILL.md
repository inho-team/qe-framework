---
name: Qweb-design-guidelines
description: UI 코드를 Web Interface Guidelines 기준으로 리뷰합니다. "UI 리뷰해줘", "접근성 체크", "디자인 감사", "UX 리뷰", "사이트 모범사례 검토" 등의 요청 시 사용합니다.
metadata:
  author: vercel
  version: "1.0.0"
  source: https://skills.sh/vercel-labs/agent-skills/web-design-guidelines
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

파일을 Web Interface Guidelines 기준으로 리뷰합니다.

## How It Works

1. 아래 소스 URL에서 최신 가이드라인을 가져옵니다
2. 지정된 파일을 읽습니다 (없으면 사용자에게 파일/패턴을 요청)
3. 가져온 가이드라인의 모든 규칙과 대조하여 검사합니다
4. `file:line` 형식으로 결과를 출력합니다

## Guidelines Source

리뷰 전 항상 최신 가이드라인을 가져옵니다:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

WebFetch 도구로 최신 규칙을 가져옵니다. 가져온 내용에 모든 규칙과 출력 형식 지침이 포함되어 있습니다.

## Usage

사용자가 파일 또는 패턴 인수를 제공한 경우:
1. 위 소스 URL에서 가이드라인을 가져옵니다
2. 지정된 파일을 읽습니다
3. 가져온 가이드라인의 모든 규칙을 적용합니다
4. 가이드라인에 지정된 형식으로 결과를 출력합니다

파일이 지정되지 않은 경우, 사용자에게 리뷰할 파일을 물어봅니다.
