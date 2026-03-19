> Core philosophy: see core/PHILOSOPHY.md
---
name: Qdocx
description: "Comprehensive Word document creation, editing, and analysis. Use for creating new .docx files, 워드 파일, 문서 작성, editing with tracked changes, extracting text/tables, and converting formats. Supports legal, business, and academic documents."
metadata:
  source: https://github.com/tfriedel/claude-office-skills
  author: tfriedel
  version: "2.0.0"
  triggers: docx, word, document, tracked changes, redline, 워드, 문서
  related-skills: Qpdf, Qdoc-converter
keywords: docx, word, document, tracked changes, redlining, OOXML, pandoc
---

# DOCX — Word 문서 생성·편집·분석

## 워크플로우 결정 트리

| 작업 | 방법 |
|------|------|
| **읽기/분석** | `pandoc document.docx -o output.md` |
| **새 문서 생성** | docx-js (JavaScript) |
| **기존 문서 편집 (내가 만든)** | Unpack → XML 편집 → Repack |
| **기존 문서 편집 (남이 만든)** | **Redlining 워크플로우** (권장) |
| **법률/학술/비즈니스 문서** | **Redlining 워크플로우** (필수) |
| **이미지로 변환** | DOCX → PDF(LibreOffice) → JPEG(pdftoppm) |

## 1. 읽기/분석

### 텍스트 추출 (Pandoc)

```bash
# 마크다운으로 변환
pandoc document.docx -o output.md

# 변경 추적 포함
pandoc --track-changes=all document.docx -o output.md
# Options: --track-changes=accept/reject/all
```

### Raw XML 접근

코멘트, 복잡한 서식, 임베디드 미디어, 메타데이터가 필요할 때:

```bash
# 문서 언팩
python ooxml/scripts/unpack.py document.docx unpacked/
```

주요 파일 구조:
- `word/document.xml` — 본문
- `word/comments.xml` — 코멘트
- `word/media/` — 이미지·미디어
- `<w:ins>` / `<w:del>` — 변경 추적 태그

## 2. 새 문서 생성 (docx-js)

```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel,
        Table, TableRow, TableCell, WidthType, AlignmentType } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }  // US Letter (DXA)
      }
    },
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "보고서 제목", bold: true })]
      }),
      new Paragraph({
        children: [new TextRun("본문 내용입니다.")]
      }),
      // 테이블
      new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 5000, type: WidthType.DXA },
                children: [new Paragraph("셀 1")]
              }),
              new TableCell({
                width: { size: 5000, type: WidthType.DXA },
                children: [new Paragraph("셀 2")]
              })
            ]
          })
        ]
      })
    ]
  }]
});

Packer.toBuffer(doc).then(buf => fs.writeFileSync("report.docx", buf));
```

### 필수 규칙

| 규칙 | 설명 |
|------|------|
| 페이지 크기 명시 | US Letter: 12240 x 15840 DXA |
| `\n` 사용 금지 | 별도 Paragraph 객체 사용 |
| 유니코드 불릿 금지 | `LevelFormat.BULLET` 사용 |
| PageBreak | 반드시 Paragraph 안에 |
| ImageRun | `type` (png/jpg) 필수 지정 |
| 테이블 너비 | 항상 `WidthType.DXA` |
| 셀 배경색 | `ShadingType.CLEAR` (SOLID 아님) |

## 3. 기존 문서 편집

### 기본 편집 (Unpack → Edit → Repack)

```bash
# 1. 언팩
python ooxml/scripts/unpack.py document.docx unpacked/

# 2. XML 편집 (word/document.xml)
# Python 스크립트로 DOM 조작

# 3. 리팩
python ooxml/scripts/pack.py unpacked/ output.docx
```

### Redlining 워크플로우 (변경 추적)

법률·비즈니스·학술 문서에서 변경 사항을 추적하며 편집하는 워크플로우.

**원칙: 최소한의 정확한 편집** — 변경된 텍스트만 마킹한다.

```python
# 나쁜 예 — 전체 문장 교체
'<w:del><w:delText>The term is 30 days.</w:delText></w:del>'
'<w:ins><w:t>The term is 60 days.</w:t></w:ins>'

# 좋은 예 — 변경 부분만 마킹
'<w:r><w:t>The term is </w:t></w:r>'
'<w:del><w:delText>30</w:delText></w:del>'
'<w:ins><w:t>60</w:t></w:ins>'
'<w:r><w:t> days.</w:t></w:r>'
```

#### Redlining 프로세스

```
1. 마크다운 변환     pandoc --track-changes=all doc.docx -o current.md
2. 변경 사항 식별     배치로 그룹핑 (3-10개씩)
3. 언팩              python ooxml/scripts/unpack.py doc.docx unpacked/
4. 배치별 스크립트    grep으로 위치 확인 → DOM 편집 → doc.save()
5. 리팩              python ooxml/scripts/pack.py unpacked/ reviewed.docx
6. 검증              pandoc --track-changes=all reviewed.docx -o verify.md
```

#### 배치 그룹핑 전략

| 전략 | 예시 |
|------|------|
| 섹션별 | "Section 3 수정", "정의 조항 수정" |
| 유형별 | "날짜 변경", "당사자명 변경" |
| 위치별 | "1-3페이지 변경", "후반부 변경" |

### 변경 추적 XML 패턴

```xml
<!-- 삽입 -->
<w:ins w:id="1" w:author="Reviewer" w:date="2026-03-15T00:00:00Z">
  <w:r><w:t>삽입된 텍스트</w:t></w:r>
</w:ins>

<!-- 삭제 -->
<w:del w:id="2" w:author="Reviewer" w:date="2026-03-15T00:00:00Z">
  <w:r><w:delText>삭제된 텍스트</w:delText></w:r>
</w:del>
```

## 4. 문서 → 이미지 변환

```bash
# DOCX → PDF
soffice --headless --convert-to pdf document.docx

# PDF → JPEG (페이지별)
pdftoppm -jpeg -r 150 document.pdf page
# 결과: page-1.jpg, page-2.jpg, ...

# 특정 페이지만
pdftoppm -jpeg -r 150 -f 2 -l 5 document.pdf page
```

## 의존성

| 도구 | 설치 | 용도 |
|------|------|------|
| pandoc | `brew install pandoc` | 텍스트 추출, 포맷 변환 |
| docx | `npm install -g docx` | 새 문서 생성 |
| LibreOffice | `brew install --cask libreoffice` | PDF 변환 |
| Poppler | `brew install poppler` | PDF→이미지 (pdftoppm) |
| defusedxml | `pip install defusedxml` | 안전한 XML 파싱 |

## 코드 스타일

- 간결하게 작성한다
- 불필요한 print 문을 넣지 않는다
- 장황한 변수명을 피한다
