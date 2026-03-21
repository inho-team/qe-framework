---
name: Qstitch-apply
description: "Converts Stitch HTML designs into production-ready React TSX components. Use when applying Stitch output to a React project, converting HTML to React, or adapting Stitch screens into a theme-aware component. Trigger phrases: 'stitch apply', 'stitch to react', 'HTML to React', 'convert stitch', 'stitch 적용', 'stitch 변환', 'stitch 코드 적용', 'stitch 리액트 변환'. Distinct from Qstitch-cli which handles setup/configuration only — this skill performs the actual design-to-code conversion."
user_invocable: true
metadata:
  author: qe-framework
  version: "1.0.0"
---

# Qstitch-apply — Stitch HTML to React TSX Converter

## Role Boundary

| Request | Action |
|---------|--------|
| "stitch 적용", "HTML to React 변환", "stitch 코드 react로" | **This skill** — convert design to components |
| "stitch 설정", "stitch mcp 연결" | **NOT this skill** — use `Qstitch-cli` |
| "새 UI 컴포넌트 만들어줘" (no Stitch source) | **NOT this skill** — use `Qfrontend-design` |

---

## Step 0: Detect Input Source

Determine how Stitch HTML is available:

| Source | Detection | Action |
|--------|-----------|--------|
| MCP connected | `claude mcp list \| grep -i stitch` returns result | Fetch via MCP tools |
| Local files | `code.html` + `screen.png` pairs in project | Read from filesystem |
| Pasted HTML | User provides HTML inline | Use directly |

If MCP is available, prefer it for live fetching. Otherwise proceed in **code-only mode** (no visual verification).

---

## Step 1: Parse HTML Structure

From each Stitch screen HTML:

1. **Identify layout regions** — header, sidebar, main, cards, forms, modals
2. **Extract component boundaries** — repeated structures become reusable components
3. **Catalog all inline styles** — collect every CSS property used
4. **Identify interactive elements** — buttons, inputs, links, toggles

Output a brief component map before writing any code:
```
Screen: Dashboard
Components: AppShell, NavSidebar, MetricCard(x3), DataTable
Theme tokens found: 6 colors, 3 font sizes, 4 spacing values
```

---

## Step 2: Extract Design Tokens

Parse all color, spacing, and typography values from the HTML/CSS:

**Colors** — group by semantic role:
```ts
// From: color: #1a1a2e; background: #16213e; accent: #0f3460;
colors: {
  surface: '#1a1a2e',
  surfaceAlt: '#16213e',
  accent: '#0f3460',
}
```

**Typography** — map to scale roles:
```ts
typography: {
  display: { size: '2rem', weight: 700 },
  body: { size: '0.875rem', weight: 400 },
}
```

**Spacing** — identify base unit (4pt or 8pt grid):
```ts
spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 }
```

If a `design-context.md` already exists in the project root, load it and **merge** — do not overwrite existing tokens.

---

## Step 3: Connect to Theme System

Check for existing theme system before writing styles:

1. Search for `useColors` hook — `grep -r "useColors" src/`
2. Search for theme tokens — `grep -r "design-context\|themeTokens\|colorTokens" src/`
3. If found: **map Stitch colors to existing theme keys** (do not add new keys without asking)
4. If not found: generate a minimal `useColors`-compatible hook:

```ts
// src/shared/hooks/useColors.ts
export const useColors = () => ({
  // light mode
  light: { surface: '#ffffff', text: '#1a1a1a', accent: '#0f3460' },
  // dark mode
  dark:  { surface: '#1a1a2e', text: '#f0f0f0', accent: '#4a8cff' },
});
```

---

## Step 4: Convert HTML to React TSX

Convert each identified component. Rules:

- **No Tailwind** unless the project already uses it — use inline styles or CSS Modules
- **Tailwind → inline style mapping**: `p-4` → `padding: '16px'`, `text-sm` → `fontSize: '0.875rem'`
- **Light/dark mode**: use `useColors()` hook, never hardcode colors
- **No external dependencies** beyond what already exists in `package.json`
- **TypeScript**: all props typed with interfaces, no `any`

Template per component:
```tsx
import { useColors } from '@/shared/hooks/useColors';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
}

export const MetricCard = ({ label, value, trend }: MetricCardProps) => {
  const colors = useColors();
  const isDark = /* your theme context */;
  const c = isDark ? colors.dark : colors.light;

  return (
    <div style={{ background: c.surface, padding: '16px', borderRadius: '8px' }}>
      <span style={{ color: c.textSecondary, fontSize: '0.75rem' }}>{label}</span>
      <p style={{ color: c.text, fontSize: '1.5rem', fontWeight: 700 }}>{value}</p>
    </div>
  );
};
```

---

## Step 5: Visual Verification

### When Chrome MCP is available

```bash
claude mcp list | grep -i chrome
```

If connected, verify each converted component against `screen.png`:

1. Render component in browser (or storybook)
2. Take screenshot via `mcp__claude-in-chrome__screenshot`
3. Compare layout, colors, and spacing visually against `screen.png`
4. Report discrepancies with specific property fixes

### Code-only mode fallback (no Chrome MCP)

When Chrome MCP is unavailable, skip visual verification and apply these static checks instead:

- [ ] All colors from Step 2 are referenced via `useColors()` — none hardcoded
- [ ] All interactive elements have `cursor: 'pointer'` and hover state logic
- [ ] No layout relies on fixed pixel sizes that would break on resize
- [ ] Component receives all needed data via props (no internal fetching unless explicit)

Report code-only mode clearly: "Visual verification skipped — Chrome MCP not connected. Code-only checks applied."

---

## Step 6: Output Summary

After completing all components, report:

```
## Conversion Complete

Screens processed: N
Components created: [list with file paths]
Theme tokens: [new tokens added, or "merged with existing useColors"]
Visual verification: [passed / code-only mode]

Files created:
- src/components/MetricCard.tsx
- src/components/NavSidebar.tsx
- src/shared/hooks/useColors.ts (new / updated)
```

---

## Validation Gates

Before marking conversion complete:

1. No hardcoded hex colors in TSX files (all via `useColors`)
2. Every component has TypeScript prop interface
3. Light and dark mode both covered
4. No runtime `any` types
5. File paths follow project's existing directory convention

---

## Will
- Convert Stitch HTML output to typed React TSX components
- Extract and map design tokens to theme system
- Implement light/dark mode via `useColors` pattern
- Visually verify output when Chrome MCP is available

## Will Not
- Set up or configure Stitch MCP (use `Qstitch-cli`)
- Create UI without a Stitch or HTML source (use `Qfrontend-design`)
- Modify `package.json` to add new styling libraries without asking
- Overwrite existing theme tokens without confirmation
