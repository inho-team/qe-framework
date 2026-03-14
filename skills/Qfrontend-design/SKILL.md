---
name: Qfrontend-design
description: Creates original, production-grade frontend interfaces with high design quality. Use when creating web components, pages, dashboards, React components, HTML/CSS layouts, or styling/decorating UI. Avoids generic AI aesthetics and produces creative, refined code and UI design.
metadata:
  author: anthropic
  version: "1.0.0"
  source: https://skills.sh/anthropics/skills/frontend-design
  license: Complete terms in LICENSE.txt
---
> Shared principles: see core/PRINCIPLES.md


This skill guides the creation of original, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. It implements real, working code with exceptional attention to aesthetic detail and creative choices.

The user provides frontend requirements: a component, page, application, or interface. They may include context about the purpose, target audience, and technical constraints.

## Design Thinking

Before writing code, understand the context and commit to a bold aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose an extreme: ultra-minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy, editorial/magazine, brutalist/raw, Art Deco/geometric, soft/pastel, industrial/utilitarian, etc. Use these as inspiration, but create a design that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility)
- **Differentiation**: What makes this unforgettable? What is the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Both bold maximalism and refined minimalism work — the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.):
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point of view
- Meticulously polished at every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose beautiful, distinctive, interesting fonts. Avoid generic families like Arial and Inter. Make choices that elevate the frontend's aesthetic. Pair distinctive display fonts with refined body fonts.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. A dominant color with a sharp accent is more effective than a timid, evenly distributed palette.
- **Motion**: Use animation for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library in React when available. Focus on high-impact moments: a well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll triggers and surprising hover states.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flows. Grid-breaking elements. Generous negative space or controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth instead of solid-color defaults. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparency, dramatic shadows, decorative borders, custom cursors, and grain overlays.

## Never Use

Never use generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Cliched color schemes (especially purple gradients on white)
- Predictable layouts and component patterns
- Cookie-cutter designs with no context-specific character

Interpret creatively and make unexpected choices that are genuinely designed for the context. No two designs should look the same. Vary between light/dark themes, different fonts, different aesthetics. Do not converge on common choices across generations (e.g., Space Grotesk).

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs require sophisticated code with extensive animations and effects. Minimalist or refined designs require restraint, precision, and careful attention to spacing, typography, and subtle detail. Elegance comes from executing your vision well.

Claude is capable of extraordinary creative work. Show what you can truly create when you think outside the box and fully commit to a unique vision.
