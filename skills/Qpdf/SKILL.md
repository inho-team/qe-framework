---
name: Qpdf
description: "Use for all PDF-related tasks: reading/text extraction, merging, splitting, rotating, watermarking, creating, form filling, encryption/decryption, image extraction, OCR, and more."
metadata:
  source: https://skills.sh/anthropics/skills/pdf
  author: anthropic
---
> Shared principles: see core/PRINCIPLES.md


# PDF Processing Guide

## Quick Start
```python
from pypdf import PdfReader, PdfWriter
reader = PdfReader("document.pdf")
for page in reader.pages:
    print(page.extract_text())
```

## Python Libraries

### pypdf - Merge
```python
writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as output:
    writer.write(output)
```

### pypdf - Split
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

### pdfplumber - Text and Table Extraction
```python
import pdfplumber
with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        print(page.extract_text())
        tables = page.extract_tables()
        for table in tables:
            for row in table:
                print(row)
```

### reportlab - Create PDFs
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
c = canvas.Canvas("hello.pdf", pagesize=letter)
c.drawString(100, 700, "Hello World!")
c.save()
```

**IMPORTANT**: Never use Unicode subscript/superscript in ReportLab. Use `<sub>` and `<super>` tags.

## Command-Line Tools
```bash
pdftotext input.pdf output.txt
pdftotext -layout input.pdf output.txt
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
```

## OCR Scanned PDFs
```python
import pytesseract
from pdf2image import convert_from_path
images = convert_from_path('scanned.pdf')
for image in images:
    print(pytesseract.image_to_string(image))
```

## Watermark
```python
from pypdf import PdfReader, PdfWriter
watermark = PdfReader("watermark.pdf").pages[0]
reader = PdfReader("document.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

## Password Protection
```python
writer = PdfWriter()
for page in PdfReader("input.pdf").pages:
    writer.add_page(page)
writer.encrypt("userpassword", "ownerpassword")
with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## Quick Reference
| Task | Best Tool |
|------|-----------|
| Merge/Split | pypdf |
| Extract text | pdfplumber |
| Extract tables | pdfplumber |
| Create PDFs | reportlab |
| CLI merge | qpdf |
| OCR | pytesseract + pdf2image |
