# Interaction Design

## 8 Essential States

Every interactive element needs these states designed:
1. **Default** — resting state
2. **Hover** — mouse pointer over (mouse users only)
3. **Focus** — keyboard navigation (`:focus-visible`)
4. **Active** — being pressed/clicked
5. **Disabled** — not available (use `aria-disabled` + visual treatment)
6. **Loading** — processing in progress
7. **Error** — something went wrong
8. **Success** — action completed

Hover and focus serve different users — design them separately.

## Focus Management

Never remove focus indicators. Use `:focus-visible` to show them for keyboard only:

```css
button:focus-visible {
  outline: 2px solid var(--brand-500);
  outline-offset: 2px;
}
```

Focus rings: 3:1 minimum contrast against adjacent colors.

## Forms

- **Placeholders aren't labels** — they disappear on input. Always use visible `<label>`.
- Validate on blur, not on every keystroke
- Position errors below fields, connect via `aria-describedby`
- Group related fields with `<fieldset>` and `<legend>`

```html
<label for="email">Email</label>
<input id="email" type="email" aria-describedby="email-error" />
<p id="email-error" role="alert">Email needs an @ symbol</p>
```

## Confirmation vs Undo

Prefer **undo** over confirmation dialogs. Users dismiss confirmations without reading.

Reserve confirmation dialogs for truly irreversible actions (delete account, send payment).

## Modern Browser APIs

Use native solutions over custom implementations:

| Need | Solution |
|------|----------|
| Modal focus trap | `<dialog>` element with `showModal()` |
| Disable background interaction | `inert` attribute |
| Tooltips/dropdowns | Popover API (`popover` attribute) |
| Scroll-driven animation | `animation-timeline: scroll()` |

## Keyboard Navigation

- Roving `tabindex` for component groups (tabs, radio groups, toolbars)
- Skip links for jumping past navigation
- Arrow keys for navigation within components, Tab for between components

## Gestures

Swipes are invisible — users can't discover them. Always provide:
- Visual hints (partial reveal, handle/grip indicator)
- Alternative accessible methods (buttons, menus)
