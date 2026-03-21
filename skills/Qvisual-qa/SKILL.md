---
name: Qvisual-qa
description: "Chrome browser-based visual QA. Navigates to URLs, takes screenshots, and compares rendered screens against reference images (Stitch screen.png or prior baseline) to detect layout, color, font, alignment, and spacing regressions. Use for 'visual qa', 'screenshot compare', 'visual test', 'check screen', 'UI compare', '화면 비교', '시각적 QA', '스크린샷 비교'. Distinct from Qweb-design-guidelines (which audits source code) — this skill compares actual rendered screens."
metadata:
  author: anthropic
  version: "1.0.0"
user_invocable: true
---

# Qvisual-qa — Chrome Visual QA

## Role Boundary (Absolute Rule)

This skill compares **rendered screens** against reference images. It does NOT audit source code.

| Request | Action |
|---------|--------|
| "화면 비교해줘", "visual test", "스크린샷 비교" | **This skill** |
| "UI 코드 리뷰해줘", "접근성 체크" | **NOT this skill** — use `Qweb-design-guidelines` |
| "Chrome MCP 설정해줘" | **NOT this skill** — use `Qchrome` |

---

## Pre-check: Chrome MCP Connection

Before starting, verify the MCP is available:

```bash
claude mcp list 2>/dev/null | grep -i chrome
```

**Connected** → proceed with workflow.
**Not connected** → warn user:
```
Claude-in-Chrome MCP가 연결되어 있지 않습니다.
대안:
  1. Qchrome 스킬로 Chrome MCP를 설정하세요.
  2. Qagent-browser 스킬로 스크린샷을 수동 수집하세요.
  3. 직접 스크린샷을 제공하면 Step 4부터 비교를 진행할 수 있습니다.
```
Do NOT attempt browser steps without MCP connection.

---

## Workflow

### Step 1 — Collect URL List

**If user provided URLs**: use them directly.
**If not provided**: auto-detect from project routes.

```bash
# TanStack Router
grep -r "createRoute\|path:" <project>/src --include="*.tsx" -h | grep "path:" | sort -u

# Next.js / file-based routing
find <project>/src/app -name "page.tsx" | sed 's|.*app/||; s|/page.tsx||'

# React Router
grep -r "<Route" <project>/src --include="*.tsx" -h | grep -oP 'path="[^"]+"'
```

Ask user to confirm the detected list before proceeding.

### Step 2 — Resolve Reference Images

For each URL, locate the reference image using this priority:

| Priority | Source | Path pattern |
|----------|--------|--------------|
| 1 | Stitch export | `**/screen.png`, `**/designs/*.png` |
| 2 | Committed baseline | `.visual-baseline/<route-slug>.png` |
| 3 | No reference | Inform user — first run will set baseline |

```bash
find . -name "screen.png" 2>/dev/null | head -20
ls .visual-baseline/ 2>/dev/null
```

### Step 3 — Navigate and Screenshot

For each URL in the list:

```
tabs_context_mcp           → get current tab state
navigate(url)              → load the page
resize_window(1440, 900)   → standard viewport
computer("screenshot")     → capture current state
```

Save each screenshot as: `.visual-baseline/current/<route-slug>.png`

If a page requires auth, ask the user to log in and confirm before continuing.

### Step 4 — Compare Screenshots

For each (current, reference) pair, analyze using the Read tool (image mode):

**Dimensions to check:**

| Category | What to detect |
|----------|---------------|
| Layout | Component position shifts, missing sections, overflow |
| Colors | Background, text, border color changes |
| Typography | Font size, weight, line-height differences |
| Alignment | Horizontal/vertical alignment drift |
| Spacing | Padding/margin changes (gaps between elements) |
| Responsive | Clipping or overflow at the target viewport |

Rate each finding:
- **CRITICAL** — broken layout, missing content, overlapping elements
- **MAJOR** — visible color/font change, alignment drift >4px
- **MINOR** — spacing delta ≤4px, subtle shade difference

### Step 5 — Generate Report

Output a structured report:

```markdown
## Visual QA Report — <date>

### Summary
| Metric | Value |
|--------|-------|
| URLs tested | N |
| Passed | N |
| Failed | N |
| Critical | N |
| Major | N |
| Minor | N |

### Findings

#### [CRITICAL/MAJOR/MINOR] <Route> — <short description>
- **URL**: <url>
- **Finding**: <what changed>
- **Location**: <component or region>
- **Reference**: <reference image path>
- **Current**: <current screenshot path>
```

### Step 6 — Optional Fix Suggestions

For each CRITICAL or MAJOR finding, if the user requests it:

1. Identify the likely CSS/component causing the mismatch
2. Propose a targeted fix (diff format preferred)
3. Do NOT auto-apply — confirm with user first

```
Fix suggestion available for <N> findings. Apply? (y/n/select)
```

---

## Baseline Management

**Set new baseline** (first run or intentional reset):
```bash
mkdir -p .visual-baseline
cp .visual-baseline/current/*.png .visual-baseline/
```

**Update baseline for a single route** (after confirmed fix):
```bash
cp .visual-baseline/current/<route-slug>.png .visual-baseline/<route-slug>.png
```

Add `.visual-baseline/current/` to `.gitignore`. Commit reference baselines.

---

## Quick Reference

| Step | Tool / Command |
|------|---------------|
| MCP check | `claude mcp list \| grep chrome` |
| Route detect | grep for `createRoute`, `<Route`, `page.tsx` |
| Screenshot | `computer("screenshot")` via MCP |
| Compare | Read tool (image mode) — side-by-side analysis |
| Save baseline | `cp current/*.png .visual-baseline/` |

## Will
- Navigate URLs using Claude-in-Chrome MCP
- Take and compare screenshots against reference images
- Detect layout, color, font, alignment, spacing regressions
- Generate structured reports with severity ratings
- Suggest fix code on request

## Will Not
- Audit source code (use `Qweb-design-guidelines`)
- Auto-apply fixes without user confirmation
- Run without Chrome MCP (warns and offers alternatives)
- Store credentials or interact with auth flows autonomously
