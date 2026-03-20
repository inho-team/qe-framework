# Color & Contrast

## Color Space: Use OKLCH

Replace HSL with OKLCH for perceptually uniform colors. Equal steps in lightness *look* equal.

```css
:root {
  --brand-500: oklch(0.6 0.2 250);      /* Base */
  --brand-400: oklch(0.7 0.18 250);     /* Lighter */
  --brand-600: oklch(0.5 0.22 250);     /* Darker */
}
```

## Palette Structure

- **Primary**: 1 color in 3-5 shades
- **Neutral**: 9-11 shade scale (tinted toward brand hue, not pure gray)
- **Semantic**: Success, error, warning, info
- **Surface**: Elevation levels for cards/modals

Most apps work fine with one accent color. Adding more creates decision fatigue.

## Neutral Tinting

Add a subtle hint of brand hue to all neutrals. Creates cohesion without obvious tinting.

```css
/* Instead of pure gray */
--gray-100: oklch(0.95 0.01 250);  /* Barely tinted */
--gray-500: oklch(0.55 0.02 250);
--gray-900: oklch(0.15 0.01 250);
```

Avoid pure black (`#000`) and pure white (`#fff`) in UI — they create harsh contrast.

## WCAG Contrast Requirements

| Element | Minimum Ratio |
|---------|--------------|
| Body text | 4.5:1 (AA) |
| Large text (18px+ bold, 24px+) | 3:1 |
| UI components & icons | 3:1 |

Common failures: light gray on white, gray text on colored surfaces.

## Dark Mode

Dark mode requires different design decisions, not color inversion:
- Use lighter surface layers for depth (instead of shadows)
- Reduce font weight slightly (light on dark appears heavier)
- Desaturate colors slightly (saturated colors vibrate on dark backgrounds)
- Test contrast ratios separately for dark mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --surface-0: oklch(0.15 0.01 250);
    --surface-1: oklch(0.20 0.01 250);  /* Elevated */
    --surface-2: oklch(0.25 0.01 250);  /* More elevated */
  }
}
```

## What to Avoid

- Pure grayscale palettes (looks lifeless)
- Heavy use of transparency (usually means incomplete palette)
- "AI color palettes": cyan-on-dark, neon-on-dark, purple gradients on white
- Judging contrast by eye — always use tools
