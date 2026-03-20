---
name: Qpdf
description: "Comprehensive PDF processing toolkit. Use when extracting text/tables, creating new PDFs, merging/splitting, rotating, watermarking, form filling, encrypting, running OCR, or extracting images from PDFs. Korean: 'PDF 처리', 'PDF 변환', 'PDF 추출'. Chinese: 'PDF处理', 'PDF转换'. Japanese: 'PDF処理', 'PDF変換'. Arabic: 'معالجة PDF'. Hindi: 'PDF प्रोसेसिंग'. Spanish: 'procesamiento PDF'. Portuguese: 'processamento PDF'. French: 'traitement PDF'. German: 'PDF-Verarbeitung'. Russian: 'обработка PDF'. Indonesian: 'pemrosesan PDF'."
metadata:
  source: https://github.com/tfriedel/claude-office-skills
  author: tfriedel
  version: "2.0.0"
  triggers: pdf, PDF, merge pdf, split pdf, extract text, OCR, watermark, form fill
  related-skills: Qdocx, Qdoc-converter
keywords: pdf, pypdf, pdfplumber, reportlab, OCR, merge, split, watermark, form
---

# PDF — 종합 PDF 처리 가이드

## Quick Reference

| 작업 | 도구 | 명령/코드 |
|------|------|-----------|
| 텍스트 추출 | pdfplumber | `page.extract_text()` |
| 테이블 추출 | pdfplumber | `page.extract_tables()` |
| 병합 | pypdf | `writer.add_page(page)` |
| 분할 | pypdf | 페이지별 파일 생성 |
| 생성 | reportlab | Canvas 또는 Platypus |
| CLI 병합 | qpdf | `qpdf --empty --pages ...` |
| OCR | pytesseract | PDF→이미지→OCR |
| 폼 채우기 | pypdf / pdf-lib | FORMS.md 참조 |

## 텍스트·테이블 추출

### pdfplumber (권장)

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        # 텍스트
        print(page.extract_text())

        # 테이블
        for table in page.extract_tables():
            for row in table:
                print(row)
```

### 테이블 → Excel 변환

```python
import pdfplumber
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        for table in page.extract_tables():
            if table:
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

    if all_tables:
        combined = pd.concat(all_tables, ignore_index=True)
        combined.to_excel("extracted.xlsx", index=False)
```

### 메타데이터

```python
from pypdf import PdfReader
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}, Author: {meta.author}")
```

## 병합·분할

### 병합

```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    for page in PdfReader(pdf_file).pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as f:
    writer.write(f)
```

### 분할

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as f:
        writer.write(f)
```

### 페이지 회전

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()
page = reader.pages[0]
page.rotate(90)  # 시계방향 90도
writer.add_page(page)
with open("rotated.pdf", "wb") as f:
    writer.write(f)
```

## PDF 생성

### 기본 생성 (reportlab)

```python
from reportlab.lib.pagesizes import letter, A4
from reportlab.pdfgen import canvas

c = canvas.Canvas("output.pdf", pagesize=A4)
width, height = A4
c.drawString(100, height - 100, "Hello World!")
c.save()
```

### 보고서 생성 (Platypus)

```python
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=A4)
styles = getSampleStyleSheet()
story = []

story.append(Paragraph("보고서 제목", styles['Title']))
story.append(Spacer(1, 12))
story.append(Paragraph("본문 내용입니다. " * 20, styles['Normal']))
story.append(PageBreak())
story.append(Paragraph("2페이지", styles['Heading1']))

doc.build(story)
```

**주의**: ReportLab에서 유니코드 첨자/윗첨자 사용 금지. `<sub>`, `<super>` 태그 사용.

## 워터마크

```python
from pypdf import PdfReader, PdfWriter

watermark = PdfReader("watermark.pdf").pages[0]
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as f:
    writer.write(f)
```

## 암호화·복호화

```python
from pypdf import PdfReader, PdfWriter

# 암호화
writer = PdfWriter()
for page in PdfReader("input.pdf").pages:
    writer.add_page(page)
writer.encrypt("userpassword", "ownerpassword")
with open("encrypted.pdf", "wb") as f:
    writer.write(f)
```

```bash
# CLI 복호화
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

## OCR (스캔 문서)

```python
import pytesseract
from pdf2image import convert_from_path

images = convert_from_path('scanned.pdf')
for i, image in enumerate(images):
    text = pytesseract.image_to_string(image, lang='kor+eng')
    print(f"Page {i+1}:\n{text}\n")
```

## 이미지 추출

```bash
# Poppler 도구
pdfimages -j input.pdf output_prefix
# 결과: output_prefix-000.jpg, output_prefix-001.jpg, ...
```

## CLI 도구

```bash
# pdftotext — 텍스트 추출
pdftotext input.pdf output.txt
pdftotext -layout input.pdf output.txt    # 레이아웃 보존
pdftotext -f 1 -l 5 input.pdf output.txt  # 1-5페이지만

# qpdf — 병합/분할
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf
qpdf input.pdf --pages . 1-5 -- first5.pdf
qpdf input.pdf output.pdf --rotate=+90:1  # 1페이지 회전
```

## 의존성

| 도구 | 설치 | 용도 |
|------|------|------|
| pypdf | `pip install pypdf` | 병합, 분할, 암호화 |
| pdfplumber | `pip install pdfplumber` | 텍스트·테이블 추출 |
| reportlab | `pip install reportlab` | PDF 생성 |
| pytesseract | `pip install pytesseract pdf2image` | OCR |
| poppler | `brew install poppler` | pdftotext, pdfimages |
| qpdf | `brew install qpdf` | CLI 병합/분할 |
