---
name: Qdoc-converter
description: "Document format converter with multi-tool orchestration. Use when converting between MD, DOCX, PDF, PPTX, HTML formats. Supports Quick Mode (fast, single tool) and Heavy Mode (best quality, multi-tool merge)."
metadata:
  source: https://github.com/daymade/claude-code-skills
  author: daymade
  version: "1.0.0"
  triggers: convert document, md to docx, md to pdf, docx to md, pdf to md, format conversion, 변환, 포맷 변환
  related-skills: Qdocx, Qpdf, Qpptx
keywords: conversion, pandoc, markitdown, pymupdf4llm, markdown, docx, pdf, pptx
---

# Doc Converter — 문서 포맷 변환

문서를 다양한 포맷 간 변환한다. Quick Mode(빠름)와 Heavy Mode(고품질)를 지원.

## 듀얼 모드

| 모드 | 속도 | 품질 | 용도 |
|------|------|------|------|
| **Quick** (기본) | 빠름 | 좋음 | 초안, 단순 문서 |
| **Heavy** | 느림 | 최고 | 최종 문서, 복잡한 레이아웃 |

## 도구 선택 매트릭스

| 입력 → 출력 | Quick Mode 도구 | Heavy Mode 도구 |
|-------------|----------------|-----------------|
| PDF → MD | pymupdf4llm | pymupdf4llm + markitdown |
| DOCX → MD | pandoc | pandoc + markitdown |
| PPTX → MD | markitdown | markitdown + pandoc |
| MD → DOCX | pandoc | pandoc (--reference-doc) |
| MD → PDF | pandoc | pandoc (via LaTeX 또는 wkhtmltopdf) |
| MD → HTML | pandoc | pandoc (--standalone) |
| DOCX → PDF | LibreOffice | LibreOffice |
| HTML → PDF | wkhtmltopdf | wkhtmltopdf |

## Quick Mode — 기본 변환

### MD → DOCX

```bash
# 기본 변환
pandoc input.md -o output.docx

# 스타일 템플릿 적용
pandoc input.md --reference-doc=template.docx -o output.docx

# 목차 포함
pandoc input.md --toc -o output.docx
```

### MD → PDF

```bash
# LaTeX 엔진 사용 (고품질)
pandoc input.md -o output.pdf --pdf-engine=xelatex

# 한글 지원
pandoc input.md -o output.pdf --pdf-engine=xelatex \
  -V mainfont="Noto Sans CJK KR" \
  -V geometry:margin=2.5cm

# wkhtmltopdf 사용 (HTML 기반)
pandoc input.md -t html5 | wkhtmltopdf - output.pdf
```

### MD → HTML

```bash
# 독립 HTML
pandoc input.md -o output.html --standalone

# CSS 적용
pandoc input.md -o output.html --standalone --css=style.css
```

### DOCX → MD

```bash
# 기본 변환
pandoc document.docx -o output.md

# 이미지 추출 포함
pandoc document.docx -o output.md --extract-media=./media

# 변경 추적 포함
pandoc --track-changes=all document.docx -o output.md
```

### PDF → MD

```python
# pymupdf4llm (LLM 최적화, 테이블 감지)
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
# LibreOffice (가장 안정적)
soffice --headless --convert-to pdf document.docx

# 출력 디렉토리 지정
soffice --headless --convert-to pdf --outdir ./output document.docx
```

### PPTX → MD

```bash
markitdown presentation.pptx > output.md
```

## Heavy Mode — 고품질 변환

다중 도구를 병렬 실행하고 최적 결과를 선택한다.

### 프로세스

```
1. 병렬 실행    → 해당 포맷의 모든 도구를 동시 실행
2. 세그먼트 분석  → 각 출력을 테이블/헤딩/이미지/단락으로 분류
3. 품질 채점    → 완전성·구조 기반으로 점수 매기기
4. 지능형 병합   → 세그먼트별 최고 버전 선택
```

### 세그먼트별 선택 기준

| 세그먼트 | 기준 |
|----------|------|
| 테이블 | 행/열 수가 많고 헤더 구분자 있음 |
| 이미지 | alt 텍스트 있고 로컬 경로 선호 |
| 헤딩 | 올바른 계층 구조, 적절한 길이 |
| 리스트 | 항목 수 많고 중첩 구조 보존 |
| 단락 | 내용 완전성 |

### Heavy Mode 예시: PDF → MD

```python
import pymupdf4llm
import subprocess

# 도구 1: pymupdf4llm
md1 = pymupdf4llm.to_markdown("document.pdf")

# 도구 2: markitdown
result = subprocess.run(["markitdown", "document.pdf"], capture_output=True, text=True)
md2 = result.stdout

# 두 결과를 비교하고 세그먼트별 최고 버전 선택
# (수동 또는 자동 비교)
```

## 이미지 추출

### PDF에서 이미지 추출

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

## 스타일 템플릿

### DOCX 참조 문서 만들기

```bash
# 1. 기본 참조 문서 생성
pandoc --print-default-data-file reference.docx > template.docx

# 2. Word에서 template.docx를 열고 스타일 수정
#    (Heading 1, Normal, Table 등의 스타일)

# 3. 변환 시 적용
pandoc input.md --reference-doc=template.docx -o styled.docx
```

### PDF 스타일 (LaTeX)

```bash
# 기본 변수 설정
pandoc input.md -o output.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=2.5cm \
  -V fontsize=11pt \
  -V mainfont="Noto Sans CJK KR" \
  -V colorlinks=true
```

## 의존성

| 도구 | 설치 | 용도 |
|------|------|------|
| pandoc | `brew install pandoc` | 범용 변환 엔진 |
| pymupdf4llm | `pip install pymupdf4llm` | PDF→MD (LLM 최적화) |
| markitdown | `pip install markitdown` | Office→MD (Microsoft) |
| LibreOffice | `brew install --cask libreoffice` | DOCX→PDF |
| wkhtmltopdf | `brew install wkhtmltopdf` | HTML→PDF |
| XeLaTeX | `brew install --cask mactex` | MD→PDF (고품질) |

## 실행 규칙

### MUST DO
- 변환 전 입력 파일 존재 확인
- 한글 문서는 `mainfont` 설정 필수 (Noto Sans CJK KR 등)
- Heavy Mode는 최종 산출물에만 사용
- 변환 결과를 검증 (페이지 수, 이미지 유무 등)

### MUST NOT DO
- 포맷 체인을 불필요하게 늘리지 않음 (MD→HTML→PDF 대신 MD→PDF 직접)
- 대용량 PDF를 Heavy Mode로 불필요하게 처리하지 않음
- 원본 파일을 덮어쓰지 않음
