---
name: Qweb-design-guidelines
description: External-heuristics reviewer — audits existing UI code against the Vercel Web Interface Guidelines (accessibility, UX best practices, interaction heuristics) and returns recommendations only; never edits code. Branch points: use THIS for review against an EXTERNAL heuristics document ('accessibility check', 'UX review', 'WIG review', 'best practices audit'); use Qdesign-audit to scan source for INTERNAL DESIGN.md drift instead; use Qfrontend-design to build new UI from scratch; use Qvisual-redesign to auto-fix rendered pages against DESIGN.md; use Qvisual-qa for screenshot-only diffs.
metadata: 
author: vercel
version: 1.0.0
source: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines"
argument-hint: <file-or-pattern>
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

## Role Boundary (Absolute Rule)

This skill is a **UI review guidelines reference only**. It does NOT auto-modify UI code.

| Request | Correct action |
|---------|---------------|
| "Review UI", "accessibility check", "design audit" | **This skill** — review and provide recommendations |
| "Fix UI code", "Fix CSS" | **NOT this skill** — use Qfrontend-design or standard code implementation |

---

# Web Interface Guidelines

Reviews files against Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (if none provided, ask the user for a file/pattern)
3. Check against every rule in the fetched guidelines
4. Output results in `file:line` format

## Guidelines Source

Always fetch the latest guidelines before reviewing:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use the WebFetch tool to retrieve the latest rules. The fetched content contains all rules and output format instructions.

## Code Patterns

Use design-system-aligned component patterns:

### Basic: Accessible Button
```jsx
/**
 * Button component with ARIA attributes.
 * @param {string} variant - 'primary' | 'secondary' | 'ghost'
 * @param {string} size - 'sm' | 'md' | 'lg'
 * @param {boolean} disabled - Disables interaction and updates aria-disabled
 */
export const Button = ({ variant = 'primary', size = 'md', disabled, ...props }) => (
  <button className={`btn btn--${variant} btn--${size}`} aria-disabled={disabled} {...props} />
);
```

### Error Handling: Error State UI
```jsx
export const Input = ({ error, ...props }) => (
  <div className="input-wrapper">
    <input aria-invalid={!!error} aria-describedby={error ? 'error-msg' : undefined} {...props} />
    {error && <span id="error-msg" className="error" role="alert">{error}</span>}
  </div>
);
```

### Advanced: Responsive Layout with CSS Custom Properties
```css
:root {
  --spacing-unit: clamp(0.5rem, 2vw, 1rem);
  --container-width: clamp(20rem, 90vw, 70rem);
  --text-size: clamp(1rem, 2.5vw, 1.25rem);
}

.container { width: var(--container-width); margin: 0 auto; }
@supports (display: grid) {
  .grid { display: grid; gap: var(--spacing-unit); grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
}
```

## Comment Template

Use JSDoc for design-system components:

```jsx
/**
 * {Component description}
 * @component
 * @param {Object} props
 * @param {'sm'|'md'|'lg'} [props.size='md'] - Component size variant
 * @param {string} [props.variant='primary'] - Design system variant
 * @param {'light'|'dark'} [props.theme] - Color scheme (respects prefers-color-scheme)
 * @param {string} [props.className] - Additional CSS classes
 * @param {boolean} [props.disabled] - Disables and sets aria-disabled
 * @param {string} [props.ariaLabel] - Accessible name (required if no visible label)
 * @returns {JSX.Element}
 * @example
 * <Button variant="primary" size="lg" onClick={handleClick}>Submit</Button>
 */
```

## Lint Rules

Apply these linters in CI/CD:

- **eslint** with `eslint-plugin-react` and `eslint-plugin-react-hooks`
- **eslint-plugin-jsx-a11y**: enforces ARIA attributes, heading hierarchy, img alt text
- **stylelint**: validates CSS custom properties, rem units, color contrast via `stylelint-no-unknown`
- **axe-core**: run automated a11y audits on rendered components
- **prettier**: enforce consistent formatting (2-space indents, trailing commas)

## Security Checklist

Verify these headers and patterns:

1. **Content-Security-Policy (CSP)**: Block `unsafe-inline` styles/scripts; use nonces for dynamic content
2. **Script Injection via CSS**: Never dynamically concatenate class names; use enumerated variants only
3. **Clickjacking Protection**: Set `X-Frame-Options: DENY` (unless intentional iframe usage)
4. **Cookie Security Flags**: Mark session cookies with `Secure`, `HttpOnly`, `SameSite=Strict`
5. **Subresource Integrity**: Add `integrity` attribute to external scripts and stylesheets

## Anti-Patterns (Wrong → Correct)

| Issue | Wrong | Correct |
|-------|-------|---------|
| **Inaccessible Button** | `<div onClick={...}>Click</div>` | `<button onClick={...}>Click</button>` with `aria-label` if needed |
| **Fixed px Sizes** | `font-size: 16px; padding: 16px;` | `font-size: 1rem; padding: 1rem;` (respects user zoom) |
| **z-index Wars** | `z-index: 9999; z-index: 10000;` | Use CSS `@layer` for predictable stacking: `@layer base, theme, utils` |
| **!important Abuse** | `.error { color: red !important; }` | Use specificity or BEM: `.error__text { color: red; }` |
| **Color Contrast Fails** | Light gray text on white | Use `contrast-ratio ≥ 4.5:1` (WCAG AA); test with Axe or WAVE |

## Usage

If the user provided a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply every rule from the fetched guidelines
4. Output results in the format specified by the guidelines

If no file is specified, ask the user which files to review.

## Visual Feedback Workflow

For element-level UI feedback beyond code review (e.g., "this button looks off", "spacing feels wrong"), suggest **Agentation** (`npx agentation`) — a visual annotation tool that converts clicks on UI elements into structured context (CSS selectors, source paths, computed styles) for the agent. See `/Qagentation` for setup.
