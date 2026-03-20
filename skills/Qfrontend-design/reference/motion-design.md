# Motion Design

## Timing: The 100/300/500 Rule

| Duration | Use Case | Example |
|----------|----------|---------|
| 100-150ms | Instant feedback | Button press, toggle, hover |
| 200-300ms | State changes | Menu open, tab switch, accordion |
| 300-500ms | Larger transitions | Modal, page transition, drawer |
| 500-800ms | Entrance sequences | Staggered reveals, hero animation |

Exit animations should be ~75% of entrance duration.

## Easing Curves

Avoid generic `ease`. Use exponential curves that mimic real physics:

```css
/* Entering elements — fast start, gentle stop */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);

/* Exiting elements — gentle start, fast exit */
--ease-in: cubic-bezier(0.7, 0, 0.84, 0);

/* Reversible toggles — symmetric */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
```

Skip bounce and elastic effects — they feel dated.

## Performance: What to Animate

Only animate `transform` and `opacity` — they skip layout/paint:

```css
/* Good */
.element {
  transition: transform 300ms var(--ease-out), opacity 300ms var(--ease-out);
}

/* Bad — triggers layout recalculation */
.element {
  transition: height 300ms, width 300ms, top 300ms;
}
```

For height animations (accordions), use grid trick:
```css
.accordion-content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms var(--ease-out);
}
.accordion-content.open {
  grid-template-rows: 1fr;
}
```

## Staggered Reveals

High-impact page load with staggered `animation-delay`:
```css
.item { animation: fadeUp 500ms var(--ease-out) both; }
.item:nth-child(1) { animation-delay: 0ms; }
.item:nth-child(2) { animation-delay: 75ms; }
.item:nth-child(3) { animation-delay: 150ms; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```

## Accessibility

~35% of adults over 40 have vestibular disorders. Always support `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Preserve functional animations (progress bars, spinners) while removing spatial movement.

## Perceived Performance

- 80ms threshold: interactions feel instantaneous below this
- Skeleton screens > spinners for content loading
- Optimistic UI updates: show the result before the server confirms
