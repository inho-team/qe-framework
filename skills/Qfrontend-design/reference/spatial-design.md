# Spatial Design

## Spacing System: 4pt Base

Use a 4pt base unit for granularity: 4, 8, 12, 16, 24, 32, 48, 64, 96px.

Name tokens semantically:
```css
:root {
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;
}
```

## Responsive Layouts

Intrinsic grids eliminate traditional breakpoints:
```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
}
```

Container queries for component-level responsiveness:
```css
.card-container { container-type: inline-size; }

@container (min-width: 400px) {
  .card { flex-direction: row; }
}
```

## Visual Hierarchy

Use the **squint test** — blur your vision to check if key elements stand out.

Combine multiple dimensions for hierarchy:
- Size ratios of 3:1 or greater
- Font weight contrast (bold vs regular)
- Color contrast and positioning
- Whitespace surrounding important elements

Cards are overused. Consider spacing, typography, and dividers as alternatives for visual grouping.

## Fluid Spacing

```css
.section {
  padding: clamp(1rem, 5vw, 4rem);
}
```

Use `clamp()` for spacing that adapts smoothly without breakpoints.

## Layout Integrity

Container overflow, element escape, and margin collapse critically degrade visual polish. Apply defensive code to all layouts.

### Essential Global Defenses

```css
/* Prevent all elements from exceeding their parent */
*, *::before, *::after {
  box-sizing: border-box;
}

/* Remove min-width trap for flex/grid children */
.flex-child, .grid-child {
  min-width: 0;
  min-height: 0;
}

/* Constrain media elements */
img, video, svg, iframe, canvas {
  max-width: 100%;
  height: auto;
  display: block;
}
```

### Prefer gap Over margin

```css
/* Bad — margin collapse, unpredictable */
.item { margin-bottom: 16px; }
.item:last-child { margin-bottom: 0; }  /* Requires exception handling */

/* Good — gap, no collapse, predictable */
.container {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
```

### Responsive Safeguards

```css
/* Prevent content from exceeding the viewport */
.page {
  max-width: 100vw;
  overflow-x: hidden;         /* Prevent horizontal scroll */
}

/* Fixed-width elements — prevent breakage on small screens */
.fixed-element {
  width: min(600px, 100%);    /* min() for upper bound + responsiveness */
}

/* Tables — handle small screens */
.table-wrapper {
  overflow-x: auto;           /* Allow horizontal scroll */
  -webkit-overflow-scrolling: touch;
}
```

### Common Layout Bugs

| Symptom | Cause | Fix |
|---------|-------|-----|
| Text overflows its container | Long URLs/words, `min-width: auto` | `overflow-wrap: break-word` + `min-width: 0` |
| Horizontal scrollbar appears | Fixed-width elements, `100vw` + scrollbar | `max-width: 100%` or `width: min(X, 100%)` |
| Inconsistent spacing between elements | Margin collapse | `display: flow-root` or flex/grid `gap` |
| Image breaks out of card | `max-width` not set | `img { max-width: 100%; height: auto; }` |
| Flex child does not shrink | `min-width: auto` default | `min-width: 0` |
| Layout breaks on mobile | Fixed `width: Xpx` value | `width: min(Xpx, 100%)` |
| Bottom margin disappears | Last-child margin collapse | Add `padding-bottom` to parent or `display: flow-root` |

## Optical Adjustments

- Negative margins for text alignment (text has built-in whitespace)
- Pseudo-elements to expand touch targets beyond visual button size
- Subtle shadows only — avoid heavy drop shadows
- Semantic z-index ordering: dropdowns (100), modals (200), tooltips (300)
