---
name: Qpptx
description: "PPTX 파일 관련 모든 작업. 슬라이드 덱 생성, 읽기/파싱, 편집, 템플릿 작업. 'deck', 'slides', 'presentation', '.pptx' 언급 시 사용."
metadata:
  source: https://skills.sh/anthropics/skills/pptx
  author: anthropic
---
> 공통 원칙: core/PRINCIPLES.md 참조


# PPTX Skill

## Quick Reference
| Task | Guide |
|------|-------|
| Read/analyze | `python -m markitdown presentation.pptx` |
| Edit/create from template | Unpack -> edit XML -> repack |
| Create from scratch | `npm install -g pptxgenjs` |

## Design Ideas

**Don't create boring slides.**

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
