# Responsive Design

## Mobile-First

Start with base styles for mobile, add complexity with `min-width` queries. This prevents mobile users from downloading unnecessary desktop CSS.

```css
/* Base: mobile */
.layout { padding: var(--space-md); }

/* Tablet+ */
@media (min-width: 768px) {
  .layout { padding: var(--space-xl); }
}

/* Desktop+ */
@media (min-width: 1024px) {
  .layout { max-width: 1200px; margin: 0 auto; }
}
```

## Content-Driven Breakpoints

Let content guide breakpoint decisions. Start narrow, expand until the layout breaks, insert a breakpoint. Most projects need ~3: around 640px, 768px, 1024px.

Use `clamp()` for fluid values without explicit breakpoints:
```css
.container {
  padding: clamp(1rem, 3vw + 0.5rem, 3rem);
}
```

## Input Method Detection

Screen size doesn't indicate input method. Use capability queries:

```css
/* Mouse/trackpad users — fine pointer, can hover */
@media (pointer: fine) and (hover: hover) {
  .btn { padding: 8px 16px; }
  .btn:hover { background: var(--brand-100); }
}

/* Touch users — coarse pointer, no hover */
@media (pointer: coarse) {
  .btn { padding: 12px 20px; min-height: 44px; }
}
```

Never use hover for critical functionality — it excludes touch users.

## Safe Area Insets

For devices with notches and rounded corners:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
.bottom-bar {
  padding-bottom: calc(var(--space-md) + env(safe-area-inset-bottom));
}
```

## Responsive Images

```html
<img
  srcset="photo-400.jpg 400w, photo-800.jpg 800w, photo-1200.jpg 1200w"
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
  src="photo-800.jpg"
  alt="Description"
  loading="lazy"
/>
```

Use `<picture>` for art direction (different crops per viewport).

## Testing

DevTools emulation misses real-world factors:
- Actual touch interaction quality
- True performance constraints
- Network conditions
- Native browser rendering

Test on real devices, especially budget Android phones.
