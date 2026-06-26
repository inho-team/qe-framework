---
name: Qvisual-redesign
description: "Render-and-auto-fix loop — navigates a live URL, screenshots it, diagnoses DESIGN.md violations (spacing, color, typography, layout), then WRITES code fixes back into the repo. Playwright MCP preferred; falls back to claude-in-chrome. Branch points: use THIS when the user wants both diagnosis AND code fixes ('redesign pages', 'fix UI to match design', 'screen looks off'); use Qvisual-qa when you only want a diff report without edits; use Qdesign-audit for a pure source-code scan (no browser rendering); use Qfrontend-design to build a new UI from scratch rather than fix an existing one. Supports `--tune` to expose tunable tokens as markdown sliders for interactive editing."
metadata:
  author: qe-framework
  version: "1.1.0"
argument-hint: "<URL or localhost:port> [--pages /path1,/path2] [--report-only] [--tune <file>]"
invocation_trigger: "When user wants to visually improve UI against the design system. Trigger: 'visual redesign', 'fix UI to match design', 'screen looks off', 'redesign pages', 'visual audit and fix', 'UI doesn't match design'."
recommendedModel: sonnet
---

# Qvisual-redesign — Visual Audit & Auto-Fix

Captures live rendered pages, diagnoses DESIGN.md violations, and auto-fixes the code.

## Role Boundary

| Request | Action |
|---------|--------|
| "Visual redesign", "fix UI to match design" | **This skill** |
| "Compare screenshots" (no fix) | **NOT this** — use `Qvisual-qa` |
| "Audit source code styles" (no rendering) | **NOT this** — use `Qdesign-audit` |
| "Create design system" | **NOT this** — use `Qdesign` |
| "Build new UI from scratch" | **NOT this** — use `Qfrontend-design` |
| "Tune UI tokens interactively" | **This skill** (use --tune flag) |

---

## Tune Mode (--tune flag)

Expose numeric tokens (spacing, font-size, colors, etc.) of a target file as markdown sliders so the user can edit values in their editor, then re-invoke the skill to apply the changes.

### Purpose

Interactive token adjustment without direct code editing. Scan a file for tunable numeric values, render them as sliders in markdown, allow user to adjust, then apply changes back to the source.

### Trigger

```
/Qvisual-redesign --tune <file>
```

Where `<file>` is a CSS, JSX, or TSX file whose numeric tokens should be exposed (e.g., `src/pages/Hero.tsx`, `src/styles/button.css`).

### Flow

#### Invocation 1: Generate Sliders

1. **Scan** the target file for tunable numeric tokens: `Npx`, `Nrem`, `N%`, hex colors (future), font-size values
2. **Collect** each unique token and its context (e.g., `padding: 24px` → token `24`, unit `px`)
3. **For each unique token**, generate a `<!-- slider ... -->` block using `serializeSlider` from `hooks/scripts/lib/slider-parser.mjs`
4. **Write output** to `.qe/tune/<basename>.tune.md` (e.g., `Hero.tsx` → `.qe/tune/Hero.tune.md`)
5. **Output message** to user:
   ```
   Edit `.qe/tune/<basename>.tune.md` and re-run `/Qvisual-redesign --tune <file>` to apply
   ```

#### Invocation 2: Apply Changes

1. **Read** `.qe/tune/<basename>.tune.md` with `parseSliders`
2. **Collect** `{ name: newValue }` map of changed values (by comparing current slider value to original baseline)
3. **Call** `applyValues` to update the original target file in place
4. **After applying**, re-render via canvas-preview (Phase 1 lib) → capture and show before/after screenshot
5. **Confirm** to user that changes were applied and re-rendered

### Edge Cases

- **Target file missing** → error out cleanly: "File not found: `<file>`. Please verify the path."
- **`.tune.md` missing** → treat as first-time invocation, generate sliders
- **No sliders in `.tune.md`** → no changes to apply, just re-render and report "No changes detected"
- **Invalid slider syntax** → skip silently (slider-parser logs warnings), process remaining sliders

### Example

```
/Qvisual-redesign --tune src/pages/Hero.tsx
```

Output:
```
Generated 5 tunable tokens in .qe/tune/Hero.tune.md:
  - hero-padding: 32px
  - hero-gap: 16px
  - font-size-title: 48px
  - accent-color: #ff6b35
  - opacity-overlay: 0.8

Edit the file and re-run: /Qvisual-redesign --tune src/pages/Hero.tsx
```

User edits `.qe/tune/Hero.tune.md`, changes sliders, and re-runs the command. Changes apply to `src/pages/Hero.tsx`, and the updated page is re-rendered for visual verification.

---

## Step 0: Pre-checks

### 0-A: DESIGN.md

```bash
ls DESIGN.md 2>/dev/null
```

- **Found** — load and extract: color tokens, typography scale, spacing scale, component rules, layout grid.
- **Not found** — suggest: "No DESIGN.md found. Run `/Qdesign` first to create the design spec, or provide a reference URL to infer design rules from."

### 0-B: Browser MCP Detection

Try Playwright MCP first, then fall back to claude-in-chrome.

**Detection order:**

1. **Playwright MCP** — check if `mcp__playwright__` tools are available:
   ```
   Look for mcp__playwright__browser_navigate or similar tool availability
   ```
   If available → use Playwright mode (headless, faster, CI-compatible).

2. **claude-in-chrome MCP** — check if `mcp__claude-in-chrome__` tools are available:
   ```
   Look for mcp__claude-in-chrome__navigate or similar tool availability
   ```
   If available → use Chrome mode (requires open browser).

3. **Neither available** — stop and guide:
   ```
   No browser MCP detected.

   Option A (recommended): Install Playwright MCP
     → /Qmcp-setup playwright

   Option B: Install Chrome extension
     → /Qchrome
   ```

Store the detected mode as `BROWSER_MODE: playwright | chrome` for all subsequent steps.

---

## Step 1: Collect Target Pages

**If user provided URLs** — use them directly.

**If user provided base URL only** (e.g., `localhost:3000`) — auto-detect routes:

```bash
# Next.js App Router
find src/app -name "page.tsx" -o -name "page.jsx" 2>/dev/null | sed 's|src/app||; s|/page\.[tj]sx||' | sort

# TanStack Router
grep -r "path:" src --include="*.tsx" -h 2>/dev/null | grep -oP "path:\s*['\"]([^'\"]+)" | sort -u

# React Router
grep -r 'path="' src --include="*.tsx" -h 2>/dev/null | grep -oP 'path="([^"]+)"' | sort -u

# Vue Router
grep -r "path:" src/router --include="*.ts" -h 2>/dev/null | grep -oP "path:\s*'([^']+)'" | sort -u
```

Present the detected page list and ask user to confirm or adjust.

**Auth handling:** If pages require login, ask user for credentials or a pre-authenticated session strategy before proceeding.

---

## Step 2: Capture Screenshots

For each confirmed page, navigate and capture.

### Playwright Mode

```
For each page URL:
  1. mcp__playwright__browser_navigate → URL
  2. Wait for network idle (or 3s timeout)
  3. mcp__playwright__browser_screenshot → save to .qe/visual-redesign/{route-slug}.png
  4. mcp__playwright__browser_screenshot with full_page=true for long pages
```

### Chrome Mode

```
For each page URL:
  1. mcp__claude-in-chrome__navigate → URL
  2. Wait 2-3 seconds for render
  3. mcp__claude-in-chrome__read_page → capture viewport
  4. Read the visual output directly (Chrome mode returns visual data inline)
```

**Viewport:** Capture at 1440x900 (desktop) by default. If `--mobile` flag, also capture at 390x844.

**Output:** Store screenshots in `.qe/visual-redesign/captures/` with naming: `{route-slug}--desktop.png`.

---

## Step 3: Diagnose Against DESIGN.md

For each captured page, analyze against DESIGN.md rules. Check these categories:

### Audit Checklist

| Category | What to Check | DESIGN.md Section |
|----------|--------------|-------------------|
| **Color** | Background, text, border colors match tokens | Color Palette |
| **Typography** | Font family, size, weight, line-height match scale | Typography Scale |
| **Spacing** | Margins, padding, gaps follow spacing scale | Spacing System |
| **Layout** | Grid columns, max-width, alignment follow grid | Layout Grid |
| **Component** | Buttons, cards, inputs match component specs | Component Guidelines |
| **Visual Hierarchy** | Heading sizes decrease, CTA prominence correct | Typography + Color |
| **Consistency** | Same component looks the same across pages | All sections |

### Diagnosis Output Format

For each page, produce a structured finding:

```markdown
## {Page Name} — {URL}

### Findings

| # | Category | Element | Issue | DESIGN.md Rule | Severity |
|---|----------|---------|-------|----------------|----------|
| 1 | Color | Hero background | #1a1a2e used, should be --color-bg-primary (#0f0f23) | Color Palette > Backgrounds | high |
| 2 | Spacing | Card grid gap | 16px used, should be --space-6 (24px) | Spacing > Component Gaps | medium |
| 3 | Typography | Body text | 14px/1.4, should be 16px/1.6 (--text-body) | Typography > Body | high |

### Summary
- Critical: {N} (blocks design consistency)
- Medium: {N} (noticeable deviation)
- Low: {N} (minor polish)
```

Save the full report to `.qe/visual-redesign/DIAGNOSIS.md`.

---

## Step 4: Decision Gate

Present the diagnosis summary to the user:

```
Visual Redesign Diagnosis — {N} pages audited

| Page | Critical | Medium | Low |
|------|----------|--------|-----|
| /    | 3        | 2      | 1   |
| /app | 1        | 4      | 0   |

Total: {X} critical, {Y} medium, {Z} low

Options:
  1. Fix all — generate specs and auto-fix everything
  2. Fix critical only — address high-severity issues
  3. Report only — keep DIAGNOSIS.md, no code changes
```

- If `--report-only` flag was passed, stop here after saving the report.
- Otherwise, wait for user choice before proceeding.

---

## Step 5: Generate Fix Specs

Based on the user's choice, group fixes by file/component and generate a TASK_REQUEST via `/Qgs`:

```
/Qgs Visual Redesign: Fix {N} design violations across {M} pages

Fixes grouped by component:
- Hero section: color, typography (3 findings)
- Card grid: spacing, layout (2 findings)
- Navigation: color consistency (1 finding)

Reference: .qe/visual-redesign/DIAGNOSIS.md
```

The spec should reference specific DESIGN.md tokens for each fix (e.g., "change `#1a1a2e` to `var(--color-bg-primary)`").

---

## Step 6: Execute Fixes

Hand off to `/Qatomic-run` for parallel execution of the generated spec.

After fixes are applied, re-capture the affected pages (repeat Step 2 for changed pages only) and do a quick before/after comparison to confirm fixes landed correctly.

---

## Step 7: Handoff

Use standard handoff format from `QE_CONVENTIONS.md`.

```
Visual Redesign — {N}/{Total} issues fixed

Pages audited: {M}
Fixes applied: {N} critical, {Y} medium
Report: .qe/visual-redesign/DIAGNOSIS.md

{Next step description}
Next: {appropriate next command}
```

If all fixes are applied and verified, suggest `/Qcommit`.
If quality verification is needed, hand off to `/Qcode-run-task`.

---

## Flags

| Flag | Behavior |
|------|----------|
| `--report-only` | Diagnose and save report, no code changes |
| `--pages /a,/b` | Only audit specific pages (skip route detection) |
| `--mobile` | Also capture at mobile viewport (390x844) |
| `--fix-critical` | Skip the decision gate, auto-fix critical only |

---

## Will

- Capture live rendered pages via browser MCP
- Compare visual output against DESIGN.md tokens and rules
- Generate structured diagnosis with severity levels
- Auto-generate fix specs and execute code changes
- Re-verify fixes with before/after screenshots

## Will Not

- Create DESIGN.md (use `/Qdesign`)
- Build new UI from scratch (use `/Qfrontend-design`)
- Compare against reference images without fixing (use `/Qvisual-qa`)
- Audit source code without rendering (use `/Qdesign-audit`)
- Proceed without user confirmation at the decision gate (Step 4)
