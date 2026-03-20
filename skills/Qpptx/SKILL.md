---
name: Qpptx
description: "All tasks related to PPTX files: creating slide decks, reading/parsing, editing, and working with templates. Use when deck, slides, presentation, .pptx is mentioned."
metadata:
  source: https://skills.sh/anthropics/skills/pptx
  author: anthropic
---


# PPTX Skill

## HTML-First Collaborative Workflow (Recommended)

When creating a new presentation, use the **HTML-first + collaborative** approach. Instead of building all slides at once, communicate with the user at each phase.

```
Phase 1: Structure Agreement → Propose slide outline → User feedback → Finalize
Phase 2: Per-Slide Authoring → One slide (or section) at a time → User confirmation → Next
Phase 3: Visual Polish        → HTML styling → Fine-tune with Agentation
Phase 4: Conversion           → HTML → PPTX (or PDF)
```

### Phase 1: Structure Agreement
1. User provides topic/purpose/audience
2. Propose a slide outline:
   - Total slide count, section breakdown
   - One-line key message per slide
   - "How long is the presentation? Shall we proceed with this structure?"
3. Incorporate feedback → Finalize structure

### Phase 2: Per-Slide Authoring
1. Start with the title slide → User confirmation → Next slide
2. **Proactively ask questions when input is needed**:
   - "Do you have data/charts to include in this slide?"
   - "Should this content be presented as text or a diagram?"
   - "What is the key message to emphasize here?"
   - "Does the transition from this slide to the next flow naturally?"

### Phase 3: Visual Polish (HTML + Agentation)
1. HTML styling (`/Qfrontend-design` principles — typography, color, spatial design)
2. Diagrams: `mmdc -i diagram.mmd -o diagram.png -t neutral -b transparent -s 2` → embed as `<img>`
3. **Agentation required** — `npx agentation` → click to specify edit targets

**Exception**: Skip if the user directly specifies selectors/file paths, or if only text changes are needed.

### HTML Slide Structure
```html
<!-- Each .slide = one PPTX slide -->
<div class="slide" style="width:960px; height:540px;">
  <h1>Title</h1>
  <p>Content</p>
</div>
```

### HTML → PPTX Conversion
```bash
# Option 1: Chrome headless → PDF → PPTX
google-chrome --headless --print-to-pdf=slides.pdf slides.html

# Option 2: pptxgenjs (programmatic, preserves structure)
node generate-pptx.js

# Option 3: LibreOffice (HTML → ODP → PPTX)
soffice --headless --convert-to pptx slides.html
```

---

## Quick Reference (Existing Files)
| Task | Guide |
|------|-------|
| Read/analyze | `python -m markitdown presentation.pptx` |
| Edit/create from template | Unpack -> edit XML -> repack |
| Create from scratch | `npm install -g pptxgenjs` |

## Design Ideas

**Don't create boring slides.** Apply `/Qfrontend-design` reference docs for professional quality.

### Before Starting
- Pick a bold, content-informed color palette specific to THIS topic
- One color dominates (60-70%), 1-2 supporting, one sharp accent
- Dark backgrounds for title + conclusion, light for content
- Commit to ONE visual motif and repeat it

### Color Palettes
| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| Midnight Executive | `1E2761` | `CADCFC` | `FFFFFF` |
| Forest & Moss | `2C5F2D` | `97BC62` | `F5F5F5` |
| Coral Energy | `F96167` | `F9E795` | `2F3C7E` |
| Warm Terracotta | `B85042` | `E7E8D1` | `A7BEAE` |
| Ocean Gradient | `065A82` | `1C7293` | `21295C` |
| Charcoal Minimal | `36454F` | `F2F2F2` | `212121` |

### Typography
| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

### Avoid
- Don't repeat same layout across slides
- Don't center body text
- Don't default to blue
- Don't create text-only slides
- NEVER use accent lines under titles (AI hallmark)

## QA (Required)
```bash
python -m markitdown output.pptx
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 150 output.pdf slide
```

## Dependencies
- `pip install "markitdown[pptx]"`, `pip install Pillow`
- `npm install -g pptxgenjs`
- LibreOffice, Poppler
