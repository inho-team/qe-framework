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

> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Doc Converter — Document Format Conversion

Converts documents between various formats. Supports Quick Mode (fast) and Heavy Mode (high quality).

## Dual Mode

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

## Quick Mode — Basic Conversion

### MD → DOCX

```bash
# Basic conversion
pandoc input.md -o output.docx

# Apply style template
pandoc input.md --reference-doc=template.docx -o output.docx

# Include table of contents
pandoc input.md --toc -o output.docx
```

### MD → PDF

```bash
# Use LaTeX engine (high quality)
pandoc input.md -o output.pdf --pdf-engine=xelatex

# CJK font support
pandoc input.md -o output.pdf --pdf-engine=xelatex \
  -V mainfont="Noto Sans CJK KR" \
  -V geometry:margin=2.5cm

# Use wkhtmltopdf (HTML-based)
pandoc input.md -t html5 | wkhtmltopdf - output.pdf
```

### MD → HTML

```bash
# Standalone HTML
pandoc input.md -o output.html --standalone

# Apply CSS
pandoc input.md -o output.html --standalone --css=style.css
```

### DOCX → MD

```bash
# Basic conversion
pandoc document.docx -o output.md

# Include image extraction
pandoc document.docx -o output.md --extract-media=./media

# Include tracked changes
pandoc --track-changes=all document.docx -o output.md
```

### PDF → MD

```python
# pymupdf4llm (LLM-optimized, table detection)
import pymupdf4llm

md_text = pymupdf4llm.to_markdown("document.pdf")
with open("output.md", "w") as f:
    f.write(md_text)
```

```bash
# markitdown (Microsoft)
markitdown document.pdf > output.md
```

### DOCX → PDF

```bash
# LibreOffice (most stable)
soffice --headless --convert-to pdf document.docx

# Specify output directory
soffice --headless --convert-to pdf --outdir ./output document.docx
```

### PPTX → MD

```bash
markitdown presentation.pptx > output.md
```

## Heavy Mode — High-Quality Conversion

Runs multiple tools in parallel and selects the best result.

### Process

```
1. Parallel execution  → Run all tools for the format simultaneously
2. Segment analysis    → Classify each output by tables/headings/images/paragraphs
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

### Heavy Mode Example: PDF → MD

```python
import pymupdf4llm
import subprocess

# Tool 1: pymupdf4llm
md1 = pymupdf4llm.to_markdown("document.pdf")

# Tool 2: markitdown
result = subprocess.run(["markitdown", "document.pdf"], capture_output=True, text=True)
md2 = result.stdout

# Compare both results and select best version per segment
# (manual or automated comparison)
```

## Image Extraction

### Extract Images from PDF

```python
import pymupdf

doc = pymupdf.open("document.pdf")
for page_num, page in enumerate(doc):
    for img_idx, img in enumerate(page.get_images(full=True)):
        xref = img[0]
        base_image = doc.extract_image(xref)
        image_bytes = base_image["image"]
        ext = base_image["ext"]
        with open(f"image_p{page_num}_{img_idx}.{ext}", "wb") as f:
            f.write(image_bytes)
```

```bash
# CLI
pdfimages -j document.pdf ./assets/img
```

## Style Templates

### Creating a DOCX Reference Document

```bash
# 1. Generate default reference document
pandoc --print-default-data-file reference.docx > template.docx

# 2. Open template.docx in Word and modify styles
#    (Heading 1, Normal, Table, etc.)

# 3. Apply during conversion
pandoc input.md --reference-doc=template.docx -o styled.docx
```

### PDF Style (LaTeX)

```bash
# Set basic variables
pandoc input.md -o output.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=2.5cm \
  -V fontsize=11pt \
  -V mainfont="Noto Sans CJK KR" \
  -V colorlinks=true
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

### MUST DO
- Verify input file exists before conversion
- Set `mainfont` for CJK documents (Noto Sans CJK KR, etc.)
- Use Heavy Mode only for final deliverables
- Verify conversion result (page count, images, etc.)

### MUST NOT DO
- Do not unnecessarily chain formats (MD→PDF directly instead of MD→HTML→PDF)
- Do not process large PDFs with Heavy Mode unnecessarily
- Do not overwrite the original file
