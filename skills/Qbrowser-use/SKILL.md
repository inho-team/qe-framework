---
name: Qbrowser-use
description: "Browser automation. Use for web testing, form filling, screenshots, and data extraction."
metadata:
  source: https://skills.sh/browser-use/browser-use
  author: browser-use
allowed-tools: Bash(browser-use:*)
---
> Shared principles: see core/PRINCIPLES.md


# Browser Automation with browser-use CLI

## Prerequisites
```bash
browser-use doctor
```

## Core Workflow
1. `browser-use open <url>`
2. `browser-use state` (get elements with indices)
3. Interact: `browser-use click 5`, `browser-use input 3 "text"`
4. Verify: `browser-use state` or `browser-use screenshot`

## Browser Modes
```bash
browser-use --browser chromium open <url>          # Headless (default)
browser-use --browser chromium --headed open <url>  # Visible
browser-use --browser real --profile "Default" open <url>  # With logins
browser-use --browser remote open <url>             # Cloud
```

## Commands
```bash
browser-use open <url>
browser-use state
browser-use screenshot path.png
browser-use click <index>
browser-use type "text"
browser-use input <index> "text"
browser-use keys "Enter"
browser-use select <index> "option"
browser-use eval "document.title"
browser-use get text <index>
browser-use wait selector "h1"
browser-use wait text "Success"
browser-use close
browser-use close --all
```
