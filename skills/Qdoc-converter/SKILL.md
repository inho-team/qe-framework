---
name: Qdoc-converter
description: "Document format converter with multi-tool orchestration. Use when converting between MD, DOCX, PDF, PPTX, HTML formats. Supports Quick Mode (fast, single tool) and Heavy Mode (best quality, multi-tool merge)."
metadata:
  source: https://github.com/daymade/claude-code-skills
  author: daymade
  version: "1.0.0"
  triggers: convert document, md to docx, md to pdf, docx to md, pdf to md, format conversion, convert, format convert
  related-skills: Qdocx, Qpdf, Qpptx
keywords: conversion, pandoc, markitdown, pymupdf4llm, markdown, docx, pdf, pptx
---

# Doc Converter — Document Format Conversion

## HTML-First Collaborative Workflow (Recommended for New Documents)

When creating new documents, use the **HTML-first + interactive collaboration** approach. Instead of producing a finished document in one go, communicate with the user at each stage.

```
Phase 1: Structure Agreement  → Present outline/structure → User feedback → Finalize
Phase 2: Section-by-Section   → Write one section at a time → User confirmation → Next section
Phase 3: Visual Completion    → HTML styling → Fine-tune with Agentation
Phase 4: Conversion           → HTML → Final format (DOCX, PDF, PPTX)
```

### Phase 1: Structure Agreement
1. User provides the topic/purpose
2. Propose a document structure (table of contents, section layout, estimated length)
3. Ask the user:
   - "Shall we proceed with this structure? Are there any sections to add or remove?"
   - "Is there anything you want to emphasize in each section?"
   - "Should the tone be formal or casual?"
4. Incorporate user feedback → Finalize structure

### Phase 2: Section-by-Section Writing
1. Start writing from the **first section** of the finalized structure
2. Show the user what was written and confirm:
   - "Does this direction look right?"
   - "Is there anything to add or remove?"
3. After user approval, move to the next section
4. **Proactively ask questions when input is needed**:
   - When data/figures are needed → "Do you have specific numbers for this part?"
   - When the direction diverges → "Which approach works better, A or B?"
   - When external information is needed → "Do you have any reference materials for this part?"

### Phase 3: Visual Completion (HTML + Agentation)
After all sections are written:
1. Style with HTML (apply `/Qfrontend-design` principles)
2. Browser preview
3. **Agentation required** — run `npx agentation`, click elements to adjust
4. If diagrams are needed: Mermaid → `mmdc` → insert as `<img>`

Design reference: `/Qfrontend-design` reference docs (`typography.md`, `color-and-contrast.md`, `spatial-design.md`).

### Phase 4: Conversion
```bash
wkhtmltopdf --enable-local-file-access output.html output.pdf    # HTML → PDF
pandoc output.html -o output.docx                                 # HTML → DOCX
google-chrome --headless --print-to-pdf=output.pdf output.html    # CSS-perfect PDF
```

---

## Dual Mode (for Format-to-Format Conversion)

| Mode | Speed | Quality | Use Case |
|------|-------|---------|----------|
| **Quick** (default) | Fast | Good | Drafts, simple documents |
| **Heavy** | Slow | Best | Final deliverables, complex layouts |

## Tool Selection Matrix

| Input → Output | Quick Mode Tool | Heavy Mode Tool |
|----------------|----------------|-----------------|
| PDF → MD | pymupdf4llm | pymupdf4llm + markitdown |
| DOCX → MD | pandoc | pandoc + markitdown |
| PPTX → MD | markitdown | markitdown + pandoc |
| MD → DOCX | pandoc | pandoc (--reference-doc) |
| MD → PDF | pandoc | pandoc (via LaTeX or wkhtmltopdf) |
| MD → HTML | pandoc | pandoc (--standalone) |
| DOCX → PDF | LibreOffice | LibreOffice |
| HTML → PDF | wkhtmltopdf | wkhtmltopdf |

## Quick Mode Commands

```bash
# MD → DOCX
pandoc input.md -o output.docx
pandoc input.md --reference-doc=template.docx -o output.docx      # with template
pandoc input.md --toc -o output.docx                               # with TOC

# MD → PDF
pandoc input.md -o output.pdf --pdf-engine=xelatex
pandoc input.md -o output.pdf --pdf-engine=xelatex \
  -V mainfont="Noto Sans CJK KR" -V geometry:margin=2.5cm         # CJK support

# MD → HTML
pandoc input.md -o output.html --standalone --css=style.css

# DOCX → MD
pandoc document.docx -o output.md --extract-media=./media
pandoc --track-changes=all document.docx -o output.md              # with tracked changes

# PDF → MD (pymupdf4llm)
python3 -c "import pymupdf4llm; open('output.md','w').write(pymupdf4llm.to_markdown('document.pdf'))"
# PDF → MD (markitdown)
markitdown document.pdf > output.md

# DOCX → PDF
soffice --headless --convert-to pdf document.docx

# PPTX → MD
markitdown presentation.pptx > output.md
```

## Heavy Mode — High-Quality Conversion

Runs multiple tools in parallel and selects the best result per segment.

```
1. Parallel execution  → Run all tools for the format simultaneously
2. Segment analysis    → Classify output by tables/headings/images/paragraphs
3. Quality scoring     → Score based on completeness and structure
4. Intelligent merge   → Select best version per segment
```

### Segment Selection Criteria

| Segment | Criteria |
|---------|---------|
| Tables | More rows/columns, header separator present |
| Images | Has alt text, prefers local paths |
| Headings | Correct hierarchy, appropriate length |
| Lists | More items, nested structure preserved |
| Paragraphs | Content completeness |

## Image Extraction from PDF

```python
import pymupdf
doc = pymupdf.open("document.pdf")
for page_num, page in enumerate(doc):
    for img_idx, img in enumerate(page.get_images(full=True)):
        xref = img[0]
        base_image = doc.extract_image(xref)
        with open(f"image_p{page_num}_{img_idx}.{base_image['ext']}", "wb") as f:
            f.write(base_image["image"])
```

```bash
pdfimages -j document.pdf ./assets/img    # CLI alternative
```

## Style Templates

```bash
# Create DOCX reference template
pandoc --print-default-data-file reference.docx > template.docx
# Edit styles in Word, then apply:
pandoc input.md --reference-doc=template.docx -o styled.docx

# PDF style via LaTeX
pandoc input.md -o output.pdf --pdf-engine=xelatex \
  -V geometry:margin=2.5cm -V fontsize=11pt \
  -V mainfont="Noto Sans CJK KR" -V colorlinks=true
```

## Dependencies

| Tool | Install | Purpose |
|------|---------|---------|
| pandoc | `brew install pandoc` | General-purpose conversion engine |
| pymupdf4llm | `pip install pymupdf4llm` | PDF→MD (LLM-optimized) |
| markitdown | `pip install markitdown` | Office→MD (Microsoft) |
| LibreOffice | `brew install --cask libreoffice` | DOCX→PDF |
| wkhtmltopdf | `brew install wkhtmltopdf` | HTML→PDF |
| XeLaTeX | `brew install --cask mactex` | MD→PDF (high quality) |

## Execution Rules

- **MUST**: Verify input file exists before conversion
- **MUST**: Set `mainfont` for CJK documents
- **MUST**: Use Heavy Mode only for final deliverables
- **MUST**: Verify conversion result (page count, images, etc.)
- **MUST NOT**: Chain formats unnecessarily (MD→PDF directly, not MD→HTML→PDF)
- **MUST NOT**: Process large PDFs with Heavy Mode unnecessarily
- **MUST NOT**: Overwrite the original file
