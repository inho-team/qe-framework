---
name: Qdesign-audit
description: "Audits design consistency across a project by scanning source files for style property outliers. Use for 'design audit', 'style consistency', 'design check', 'font size check', '디자인 감사', '스타일 일관성', '디자인 통일', 'UI consistency'. Distinct from Qweb-design-guidelines (which validates against Vercel's external guidelines) — this skill scans the project's own design system for internal inconsistencies."
metadata:
  author: anthropic
  version: "1.0.0"
  argument-hint: "[--scan | --fix | --visual] [file-or-pattern]"
---

# Qdesign-audit — Design Consistency Auditor

## Role Boundary

| Request | Action |
|---------|--------|
| "디자인 일관성 체크해줘", "font size 통일", "design audit" | **This skill** — scan and report inconsistencies |
| "UI 코드 수정해줘", "새 컴포넌트 만들어줘" | **NOT this skill** — use `Qfrontend-design` |
| "Vercel 가이드라인 기준으로 리뷰해줘" | **NOT this skill** — use `Qweb-design-guidelines` |

---

## Modes

| Flag | Behavior |
|------|----------|
| `--scan` | Report inconsistencies only (default) |
| `--fix` | Auto-normalize outliers to design token values |
| `--visual` | Screenshot comparison via Chrome MCP (requires connection) |

If no mode flag is given, default to `--scan`.

---

## Workflow

### Step 1 — Locate Design Tokens

Search for the project's design system source of truth in priority order:

1. Theme file: `**/theme.ts`, `**/tokens.ts`, `**/design-tokens.*`, `**/variables.css`
2. Tailwind config: `tailwind.config.*`
3. CSS custom properties: `:root { --* }` blocks in any `.css` file
4. Infer from the most-used values if no explicit token file exists

Record the canonical set: `{ property → [expected values] }`.

### Step 2 — Scan Source Files

Grep `.tsx`, `.ts`, `.css`, `.scss` files for these properties:

| Property | Patterns to match |
|----------|------------------|
| `fontSize` | `fontSize:`, `font-size:`, `text-{size}` (Tailwind) |
| `fontFamily` | `fontFamily:`, `font-family:` |
| `padding` | `padding:`, `p-{n}`, `px-`, `py-`, `pt-`, `pb-` |
| `margin` | `margin:`, `m-{n}`, `mx-`, `my-`, `mt-`, `mb-` |
| `maxWidth` | `maxWidth:`, `max-width:`, `max-w-` |
| `borderRadius` | `borderRadius:`, `border-radius:`, `rounded-` |
| `color` | hex `#[0-9a-fA-F]{3,8}`, `rgb(`, `hsl(`, named colors |
| `gap` | `gap:`, `gap-` |

Collect every (value, file, line) tuple per property.

### Step 3 — Build Frequency Table

For each property, count how many times each value appears:

```
fontSize:
  14px  → 42 occurrences
  16px  → 38 occurrences
  13px  → 2 occurrences   ← candidate outlier
  11px  → 1 occurrence    ← candidate outlier
```

### Step 4 — Detect Outliers

Mark a value as an outlier if **both** conditions hold:
- It appears fewer than `N` times (default `N = 3`)
- It is not present in the design token set from Step 1

If a design token file exists, any value absent from it is an outlier regardless of frequency.

### Step 5 — Generate Report

Output the inconsistency report in this format:

```
## Design Audit Report

**Scanned:** 84 files  |  **Outliers found:** 7

### fontSize
| Outlier | Expected | File:Line |
|---------|----------|-----------|
| 13px    | 14px, 16px | src/components/Card.tsx:42 |
| 11px    | 14px, 16px | src/pages/Login.tsx:18 |

### color
| Outlier | Expected | File:Line |
|---------|----------|-----------|
| #e0e0e0 | token: --color-gray-200 (#ebebeb) | src/ui/Divider.tsx:9 |
```

If no outliers are found, report: "No inconsistencies detected."

### Step 6 — Mode: `--fix`

For each outlier:
1. Determine the nearest canonical value (closest token or most-frequent value)
2. Show a diff preview per file
3. Ask for user confirmation before writing
4. Apply edits with the Edit tool

Never auto-apply without confirmation.

### Step 7 — Mode: `--visual` (Chrome MCP)

Check MCP connection first:

```bash
claude mcp list 2>/dev/null | grep -i chrome
```

**Connected:** For each page/component with outliers, take a screenshot using `mcp__claude-in-chrome__*`, then compare visually against a reference screenshot if available.

**Not connected:** Skip visual mode, proceed with code-only scan, and note at the top of the report:

```
[Visual mode skipped — Chrome MCP not connected. Run /Qchrome to set up.]
```

---

## Validation

Before delivering the report:
1. Token file was checked — **FAIL** if skipped when one exists
2. All 8 property categories were scanned — **FAIL** if any omitted
3. Every outlier entry has `file:line` — **FAIL** if location is missing
4. `--fix` mode showed diff before applying — **FAIL** if edits were made without confirmation

---

## Quick Reference

```
/Qdesign-audit                    → scan entire project
/Qdesign-audit --fix              → scan + auto-normalize (with confirmation)
/Qdesign-audit --visual           → scan + screenshot comparison
/Qdesign-audit src/components/    → scan specific directory
```

## Will Not
- Modify files without user confirmation (`--fix` always previews first)
- Apply Vercel or external design standards (use `Qweb-design-guidelines`)
- Create new design tokens or redesign the system
