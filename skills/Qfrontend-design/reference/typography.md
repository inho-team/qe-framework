# Typography

## Font Selection (Critical — The Key to Polish)

Font selection is the single most important factor determining design polish. One wrong font ruins everything.

### Blacklist — Never Use

| Font | Reason |
|------|--------|
| Inter, Roboto, Open Sans | Too common, feels AI-generated |
| Lato, Montserrat, Poppins | Overused, zero personality |
| Arial, Helvetica (web) | System defaults, no intentional choice |
| Comic Sans, Papyrus | Unprofessional |
| NanumGothic (standalone) | Korean default, impossible to differentiate |

### Recommended Fonts by Language

#### English — Sans-serif
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Modern/Clean | **Instrument Sans**, **Outfit**, **Figtree** | Inter alternatives, more personality |
| Geometric | **Plus Jakarta Sans**, **Urbanist**, **Onest** | Roboto alternatives |
| Humanist | **Source Sans 3**, **Nunito Sans**, **DM Sans** | Soft and highly readable |
| Tech/Dev | **Geist Sans**, **IBM Plex Sans** | Pairs well with monospace |

#### English — Serif & Display
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Editorial | **Fraunces**, **Newsreader**, **Lora** | Premium feel |
| Display | **Playfair Display**, **Cormorant**, **Libre Baskerville** | Headlines only |
| Monospace | **JetBrains Mono**, **Fira Code**, **Geist Mono** | Code/data |

#### Korean
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Body (Gothic) | **Pretendard**, **SUIT**, **Wanted Sans** | Modern, excellent readability |
| Body (Myeongjo) | **Noto Serif KR**, **KoPub Batang** | Formal documents |
| Display | **BMJUA**, **Gmarket Sans** | Headlines/emphasis |
| Coding | **D2Coding**, **Hack** | Monospace with Korean support |

#### Japanese
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Body (Gothic) | **Noto Sans JP**, **M PLUS 1p**, **Zen Kaku Gothic New** | Modern, web-optimized |
| Body (Mincho) | **Noto Serif JP**, **Shippori Mincho** | Formal/editorial |
| Display | **Zen Maru Gothic**, **M PLUS Rounded 1c** | Soft/casual |
| Monospace | **M PLUS 1 Code**, **BIZ UDGothic** | Code with Japanese support |

#### Chinese (Simplified/Traditional)
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Simplified body | **Noto Sans SC**, **LXGW WenKai** | General-purpose/literary |
| Traditional body | **Noto Sans TC**, **Noto Sans HK** | Distinguishes Taiwan/Hong Kong |
| Simplified serif | **Noto Serif SC**, **LXGW WenKai** | Documents/publishing |
| Display | **ZCOOL XiaoWei**, **ZCOOL QingKe HuangYou** | Headlines/posters |

#### Arabic
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Body | **Noto Sans Arabic**, **IBM Plex Sans Arabic** | Modern, excellent readability |
| Naskh (traditional) | **Noto Naskh Arabic**, **Amiri** | Formal documents |
| Display | **Reem Kufi**, **Aref Ruqaa** | Headlines/decorative |

**RTL required**: `dir="rtl"` + `text-align: right` + layout mirroring. Use CSS logical properties (`margin-inline-start`, etc.).

#### Thai
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Body | **Noto Sans Thai**, **IBM Plex Sans Thai** | Modern/clean |
| Loopless | **Noto Sans Thai Looped** | Traditional feel |
| Display | **Prompt**, **Kanit** | Google Fonts, web-optimized |

**line-height note**: Thai has upper and lower vowel/tone marks, requiring `line-height: 1.8~2.0`.

#### Devanagari (Hindi, etc.)
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Body | **Noto Sans Devanagari**, **Poppins** (Devanagari support) | General-purpose |
| Display | **Tiro Devanagari Hindi**, **Yatra One** | Headlines/cultural |

**Shaping required**: Verify that Devanagari conjuncts render correctly. `font-feature-settings: "half", "pres", "abvs"`.

#### Cyrillic (Russian, etc.)
| Purpose | Recommended | Characteristics |
|---------|-------------|-----------------|
| Body | **Golos Text**, **Raleway** | Native Cyrillic design |
| Display | **Yeseva One**, **Playfair Display** (Cyrillic support) | Headlines |

#### Multilingual Universal (Safe Choices)
| Purpose | Recommended | Coverage |
|---------|-------------|----------|
| Sans | **Noto Sans** family | 1,000+ languages |
| Serif | **Noto Serif** family | All major scripts |
| Mono | **Noto Sans Mono** | Code + multilingual |
| UI | **IBM Plex** family | Arabic, Devanagari, Thai, CJK, etc. |

**Noto is a safe choice when multilingual support is needed, but for single-language projects, a language-specific font delivers higher polish.**

### Font Selection Checklist

Always verify before deciding on a font:

1. **Is it on the Blacklist?** → If so, replace immediately
2. **Does it match the purpose?** → Make sure you're not using a body font for headlines
3. **Language coverage** → Confirm it supports **all** languages/scripts in the content. Missing coverage causes tofu (□)
4. **Script-specific requirements** → Check for RTL (Arabic), line-height (Thai), shaping (Devanagari), etc.
5. **Weight variety** → Minimum Regular (400) + Bold (700), ideally 300–800
6. **License** → Google Fonts = OFL, free for commercial use. Otherwise, verify
7. **Rendering test** → Test in an actual browser with real text in the target language at 12px, 16px, 24px, 48px
8. **Fallback chain** → Specify fallback fonts for characters the primary font does not cover

### Font Pairing Rules

**One font is often enough.** Using a single font with varied weights is cleaner than forcing two fonts together.

When a second font is needed — the **contrast axis** must differ:
- Serif + Sans (structural contrast)
- Geometric + Humanist (personality contrast)
- Condensed display + Wide body (proportion contrast)

**Never do this**: Combine two similar Sans-serifs (like Roboto + Open Sans)

#### Proven Pairing Examples
| Display (Headline) | Body | Mood |
|---|---|---|
| **Playfair Display** | **Source Sans 3** | Classic/editorial |
| **Fraunces** | **Instrument Sans** | Warm/premium |
| **Outfit** (Bold) | **Outfit** (Regular) | Modern/minimal |
| **BMJUA** | **Pretendard** | Korean casual |
| **Gmarket Sans** (Bold) | **SUIT** | Korean business |

## Vertical Rhythm

Line-height is the base unit for all vertical spacing. If body `line-height: 1.5` + `16px` = 24px, then spacing should be multiples of 24px.

## Modular Scale & Hierarchy

Fewer sizes, stronger contrast. Five levels are enough:

| Role | Ratio | Use Case |
|------|-------|----------|
| xs | 0.75rem | Captions, legal notices |
| sm | 0.875rem | Secondary UI, metadata |
| base | 1rem | Body text |
| lg | 1.25-1.5rem | Subheadings, lead text |
| xl+ | 2-4rem | Headlines, hero text |

Ratios: 1.25 (major third), 1.333 (perfect fourth), 1.5 (perfect fifth). Pick one and stay consistent.

## Readability

- `max-width: 65ch` optimal line length
- Longer lines need more line-height; shorter lines need less
- Light text on dark backgrounds: line-height +0.05–0.1

### Line-height Guide by Script

| Script | line-height | Reason |
|--------|------------|--------|
| Latin/Cyrillic | 1.5 | Standard |
| Korean/CJK | 1.6~1.8 | Square glyphs, high stroke density |
| Thai | 1.8~2.0 | Space needed for upper/lower vowel and tone marks |
| Devanagari | 1.6~1.8 | Top headline (shirorekha) + lower vowels |
| Arabic | 1.6~1.8 | Connected script, space for dots and diacritics |

For CJK, Arabic, etc., using Latin-based line-height values makes the text feel cramped.

## Web Font Loading

```css
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}

/* Match fallback metrics — prevent layout shift */
@font-face {
  font-family: 'CustomFont-Fallback';
  src: local('Arial');
  size-adjust: 105%;
  ascent-override: 90%;
  descent-override: 20%;
  line-gap-override: 10%;
}

body {
  font-family: 'CustomFont', 'CustomFont-Fallback', sans-serif;
}
```

**CJK/Large Script Font Loading Optimization**:

CJK (Chinese, Japanese, Korean), Arabic, Devanagari, and other glyph-heavy fonts have large file sizes (2–10MB). Optimization is mandatory:

```css
/* Load only the required blocks using unicode-range */
@font-face {
  font-family: 'Pretendard';
  src: url('Pretendard-Regular.subset.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+AC00-D7AF; /* Korean syllables */
}

@font-face {
  font-family: 'Noto Sans JP';
  src: url('NotoSansJP-Regular.subset.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+3040-309F, U+30A0-30FF, U+4E00-9FFF; /* Hiragana + Katakana + CJK Ideographs */
}

@font-face {
  font-family: 'Noto Sans Arabic';
  src: url('NotoSansArabic-Regular.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF; /* Arabic character blocks */
}
```

**Methods**: Generate subset files manually or leverage Google Fonts' dynamic subset feature (automatic splitting).

## Text Overflow & Containment (Essential Defense)

Text breaking out of containers or causing unintended line breaks fatally undermines polish. Apply defensive code to all text elements.

### Basic Defense — Apply to Every Project

```css
/* Prevent long words/URLs from breaking out of containers */
body {
  overflow-wrap: break-word;
  word-break: keep-all;       /* CJK: word-level line breaks (no breaking mid-syllable) */
}

/* Headlines — must never be clipped */
h1, h2, h3 {
  overflow-wrap: break-word;
  hyphens: auto;              /* Latin: smooth line breaks with hyphens */
}

/* Single-line text — ellipsis on overflow */
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Multi-line ellipsis (max 3 lines) */
.line-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

### Line-breaking Rules by Script

| Script | `word-break` | `overflow-wrap` | Notes |
|--------|-------------|----------------|-------|
| Latin/Cyrillic | `normal` | `break-word` | `hyphens: auto` + `lang` attribute required |
| CJK (Chinese, Japanese, Korean) | `keep-all` | `break-word` | Without `keep-all`, breaks occur mid-syllable |
| Arabic | `normal` | `break-word` | Connected script — break only between letters |
| Thai | `normal` | `break-word` | No spaces — browser uses dictionary-based line breaking (imperfect) |
| Devanagari | `normal` | `break-word` | Must not break in the middle of conjuncts |

```css
/* Required for CJK projects */
:lang(ko), :lang(ja), :lang(zh) {
  word-break: keep-all;
}

/* Latin — enable hyphenation */
:lang(en), :lang(de), :lang(fr) {
  hyphens: auto;
  -webkit-hyphens: auto;
}

/* Arabic — RTL + line breaking */
:lang(ar) {
  direction: rtl;
  text-align: right;
  word-break: normal;
}
```

### Container Escape Prevention Patterns

```css
/* Images/media — never exceed parent */
img, video, svg, iframe {
  max-width: 100%;
  height: auto;
}

/* Tables — prevent overflow */
table {
  table-layout: fixed;
  width: 100%;
  word-break: break-word;
}

/* Code blocks — horizontal scroll */
pre, code {
  overflow-x: auto;
  white-space: pre-wrap;       /* or pre + overflow-x: auto */
  word-break: break-all;
}

/* flexbox/grid children — disable min-width trap */
.flex-child {
  min-width: 0;               /* flex default min-width: auto causes overflow */
}
.grid-child {
  min-width: 0;               /* same for grid */
}
```

### Margin Collapse Defense

```css
/* Prevent margin collapse — apply to parent */
.no-collapse {
  display: flow-root;          /* Creates BFC, child margins don't escape parent */
}

/* Or block with padding/border */
.container {
  padding-top: 1px;            /* Blocks margin collapse */
}

/* flexbox/grid have no margin collapse — safe */
.safe-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);        /* Use gap instead of margin */
}
```

**Principle**: Prefer `gap` over `margin`. The `gap` property in flexbox/grid has no collapse behavior and is predictable.

### Dynamic Content Defense

For user input, API responses, and other text of unpredictable length:

```css
/* Guarantee min/max size */
.dynamic-text {
  min-height: 1.5em;          /* Maintain layout even when empty */
  max-height: 10em;           /* Prevent runaway expansion */
  overflow-y: auto;           /* Scroll on overflow */
}

/* Buttons/badges — stay intact even with long content */
.btn {
  white-space: nowrap;         /* No line breaks */
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;            /* Set upper bound */
}

/* Card titles — length limit */
.card-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

## Fluid Type

Use `clamp(min, preferred, max)` for smooth viewport-based scaling.

- **Use for**: Marketing/content page headlines
- **Do not use for**: App UI, dashboards, body text → use fixed `rem` instead

## OpenType Features

Details that elevate polish:

```css
/* Data tables — number alignment */
.data-table { font-variant-numeric: tabular-nums; }

/* Fraction notation */
.recipe { font-variant-numeric: diagonal-fractions; }

/* Abbreviations — small caps */
abbr { font-variant-caps: all-small-caps; }

/* Code — disable ligatures */
code { font-variant-ligatures: none; }

/* Enable kerning */
body { font-kerning: normal; }

/* Useful for Korean — punctuation kerning */
:lang(ko) { font-feature-settings: "palt"; }
```

Check per-font feature support: [Wakamai Fondue](https://wakamaifondue.com/)

## Accessibility

- Never use `user-scalable=no`
- Use `rem`/`em` for font sizes; never use `px` for body text
- Ensure text links have 44px+ touch targets via padding/line-height

### Minimum Font Size by Script

| Script | Minimum body size | Reason |
|--------|------------------|--------|
| Latin/Cyrillic | 16px | WCAG standard |
| Korean/CJK | 14px | High stroke density, but square structure maintains readability |
| Arabic | 16px | Connected script, difficult to read at small sizes |
| Thai | 16px | Tone marks must remain distinguishable |
| Devanagari | 16px | Conjuncts must remain distinguishable |

**Principle**: When in doubt, use 16px. Below 12px is prohibited for any script.
