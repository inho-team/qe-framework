---
name: Qfrontend-design
description: "Creates original, production-grade frontend interfaces from scratch. Use when building new web components, pages, dashboards, React components, HTML/CSS layouts, or decorating UI. Distinct from Qweb-design-guidelines which reviews existing UI — this skill creates new UI with high design quality."
---


This skill creates distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. It implements real, working code with exceptional attention to aesthetic detail and creative choices.

## Step 0: Context Gathering (Required)

Before any design work, gather essential context. Code tells you what was built, not who it's for or what it should feel like.

1. Check current instructions for existing Design Context
2. Review `.impeccable.md` from project root (if exists)
3. If neither exists, ask the user:
   - **Target audience** and usage context
   - **Use cases** and user jobs
   - **Brand personality and tone**

## Step 1: Design Foundation

### 1-1. Design Thinking

Commit to a bold aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose an extreme: ultra-minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy, editorial/magazine, brutalist/raw, Art Deco/geometric, soft/pastel, industrial/utilitarian, etc.
- **Constraints**: Technical requirements (framework, performance, accessibility)
- **Differentiation**: What is the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Both bold maximalism and refined minimalism work — the key is intentionality, not intensity.

### 1-2. Tailwind Config Setup (Required)

Set up `tailwind.config` before writing any code. Design tokens must be defined upfront to maintain consistency across components.

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      // 1. Fonts — Blacklisted fonts prohibited, refer to reference/typography.md
      fontFamily: {
        display: ['"Outfit"', 'sans-serif'],
        body: ['"Instrument Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        // Korean project example
        // display: ['"Gmarket Sans"', 'sans-serif'],
        // body: ['"Pretendard"', 'sans-serif'],
      },

      // 2. Colors — OKLCH-based, brand neutral tinting
      colors: {
        brand: {
          50:  'oklch(0.95 0.02 250)',
          100: 'oklch(0.90 0.04 250)',
          500: 'oklch(0.60 0.20 250)',  // primary
          900: 'oklch(0.20 0.05 250)',
        },
        surface: {
          0: 'oklch(0.98 0.005 250)',   // page background
          1: 'oklch(0.95 0.008 250)',   // card
          2: 'oklch(0.92 0.01 250)',    // elevated
        },
      },

      // 3. Spacing — 4pt system
      spacing: {
        '4.5': '1.125rem',  // 18px — 4pt grid extension
      },

      // 4. Type scale — modular scale
      fontSize: {
        'display': ['clamp(2.5rem, 5vw + 1rem, 4.5rem)', { lineHeight: '1.1' }],
        'heading': ['clamp(1.5rem, 3vw + 0.5rem, 2.5rem)', { lineHeight: '1.2' }],
      },

      // 5. Animation — 100/300/500 rule
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-expo': 'cubic-bezier(0.7, 0, 0.84, 0)',
      },
      transitionDuration: {
        'instant': '100ms',
        'state': '300ms',
        'modal': '500ms',
      },

      // 6. Responsive — container queries
      containers: {
        'card': '400px',
        'sidebar': '300px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/container-queries'),
  ],
}
```

**Checklist** (verify after setup):
- [ ] `fontFamily` — No blacklisted fonts used, language-specific fonts designated
- [ ] `colors` — Brand palette + neutral tinting + semantic (success/error/warning)
- [ ] `spacing` — Based on 4pt grid
- [ ] `fontSize` — `clamp()` applied to display/heading
- [ ] `transitionTimingFunction` — Exponential easing defined
- [ ] dark mode — `darkMode: 'class'` or `'media'` configured

**For non-Tailwind projects**: Define the same tokens as CSS custom properties in `:root`. The key principle is **tokens before code**.

### 1-3. Component Breakdown (Required)

Do not build the entire page at once. Break it down into components and complete them one by one.

**Process:**
1. **Decompose** — Break the page into independent components
2. **Prioritize** — Start with core components (typically: layout shell > header/nav > main content > sidebar > footer)
3. **Implement individually** — Implement only one component at a time
4. **Verify individually** — Check the component in the browser + Agentation feedback
5. **Next** — Move to the next component after verification is complete

**Decomposition example:**
```
Landing Page
├── Layout Shell          ← Priority 1: overall structure, global styles
├── Header / Navigation   ← Priority 2
├── Hero Section          ← Priority 3: core content
├── Features Grid         ← Priority 4
├── Testimonials          ← Priority 5
├── CTA Section           ← Priority 6
└── Footer                ← Priority 7
```

**Rules:**
- Do not move to the next component before completing the current one
- Each component must work independently (renderable without other components)
- Proceed to the next step only after the user has reviewed and approved the component
- Define common elements (buttons, cards, inputs, etc.) as reusable at the point of first use

## Step 2: Component Implementation

Repeat the following for each component:

### 2-1. Implementation

Write code using tokens from the Tailwind config. Minimize custom values (`[arbitrary]`) — if a value not in the config is needed, add it to the config.

### 2-2. Validation Gates (Required — Every Component)

Must pass before outputting each component:

#### Gate 1: Font Validation

Fonts are a key factor determining design polish.

1. Blacklisted font usage check — Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Arial = **FAIL**
2. Language coverage — Fonts designated that support all scripts in the content. Not designated = **FAIL**
3. Script-specific requirements — RTL (Arabic), line-height (CJK/Thai/Devanagari), missing shaping = **FAIL**
4. Weight variety — Only Regular with no Bold = **FAIL**
5. Pairing violation — Two similar Sans fonts combined = **FAIL**
6. Fallback chain — No fallback designated for characters the primary font cannot cover = **FAIL**

> `reference/typography.md`

#### Gate 2: Layout Integrity

Text overflow, container breakout, and margin collapse are critical failures.

1. Text overflow defense — `overflow-wrap: break-word` or Tailwind `break-words` not applied = **FAIL**
2. `word-break: keep-all` (`break-keep-all`) not applied to CJK content = **FAIL**
3. `min-w-0` not applied to flex/grid children = **FAIL**
4. `max-w-full` not applied to images/media = **FAIL**
5. Fixed width usage — Responsive alternative (`max-w-*` or `w-full max-w-[Xpx]`) not used = **FAIL**
6. Gap vs margin — Spacing handled with margin in flex/grid instead of gap = **FAIL**
7. `truncate` or `line-clamp-*` not applied to dynamic content = **FAIL**

> `reference/typography.md` (Text Overflow), `reference/spatial-design.md` (Layout Integrity)

### 2-3. User Verification

Verify the component in the browser. If modifications are needed, proceed to **Step 3 (Agentation)**.

Once verified, return to the next component and repeat Step 2.

## Step 3: Visual Feedback Loop (Required for Modifications)

When modifying existing UI — **Agentation is mandatory**.

1. **Start Agentation**: User runs `npx agentation` on the target page
2. **User clicks elements**: Each click captures CSS selector, source file path, computed styles, and component tree
3. **Agent receives structured context**: Exact targets with coordinates, not vague descriptions
4. **Implement changes**: Modify only the identified elements

**Why mandatory**: "Fix the header" is ambiguous. A click on the exact element gives selector, file, line number, and current styles — zero guesswork.

If Agentation is not set up, guide the user through `/Qagentation` before proceeding.

**Exception**: Skip when the user provides exact file paths and CSS selectors themselves, or when creating entirely new UI (Step 1-2 flow).

## Reference Docs

| Reference | When to consult |
|-----------|----------------|
| `reference/typography.md` | Font selection, type scale, overflow defense, multi-script rules |
| `reference/color-and-contrast.md` | Palette design, OKLCH, dark mode, WCAG contrast |
| `reference/spatial-design.md` | Spacing systems, layout integrity, layout grids |
| `reference/motion-design.md` | Timing, easing curves, animation performance |
| `reference/interaction-design.md` | States, focus management, forms, modals |
| `reference/responsive-design.md` | Mobile-first, container queries, input detection |
| `reference/ux-writing.md` | Button labels, error messages, tone, i18n |

## Diagrams: Mermaid → Image Pipeline

When the design includes flowcharts, architecture diagrams, ERDs, or any visual diagram:

1. **Write Mermaid code** — use `/Qmermaid-diagrams` for syntax reference
2. **Render to image**:
   ```bash
   mmdc -i diagram.mmd -o diagram.png -t neutral -b transparent -s 2
   mmdc -i diagram.mmd -o diagram.svg -t neutral -b transparent
   ```
3. **Embed in HTML**: `<img src="diagram.svg" alt="..." />`
4. **Iterate with Agentation** — user clicks the diagram to adjust size, position, caption

## Aesthetic Guidelines (Quick Reference)

- **Typography**: Must refer to `reference/typography.md`. Blacklisted fonts prohibited. Dedicated fonts for all scripts + appropriate line-height + fallback chain required.
- **Color**: OKLCH for perceptual uniformity. Defined in Tailwind config. Dominant color + sharp accent > evenly distributed palette.
- **Motion**: 100/300/500ms rule. Use `transitionTimingFunction` from config. Only animate `transform` and `opacity`.
- **Spatial**: 4pt base unit. Use spacing tokens from config. Prefer gap over margin.
- **Backgrounds**: Gradient meshes, noise textures, geometric patterns — match the aesthetic.

## Never Use

- Overused fonts (Inter, Roboto, Arial, system fonts for design-heavy work)
- Cliched color schemes (purple gradients, cyan-on-dark, neon-on-dark)
- Predictable layouts and cookie-cutter component patterns
- Glassmorphism, generic shadows, sparklines as mere decoration
- Bounce/elastic easing (feels dated)
- Tailwind arbitrary values(`[...]`) when a config token should exist instead

No two designs should look the same. Vary themes, fonts, aesthetics across generations.

## Quality Test

Would someone immediately recognize this as AI-generated? If yes, rethink. Distinctive design makes people ask "how was this made?" not "which AI made this?"

**Match implementation complexity to the aesthetic vision.** Maximalist = sophisticated code with extensive animations. Minimalist = restraint, precision, careful spacing and typography.
