---
name: Qdocx
description: "Comprehensive Word document creation, editing, and analysis. Use for creating new .docx files, editing with tracked changes, extracting text/tables, and converting formats. Supports legal, business, and academic documents."
metadata:
  source: https://github.com/tfriedel/claude-office-skills
  author: tfriedel
  version: "2.0.0"
  triggers: docx, word, document, tracked changes, redline
  related-skills: Qpdf, Qdoc-converter
keywords: docx, word, document, tracked changes, redlining, OOXML, pandoc
---

# DOCX — Word Document Creation/Editing/Analysis

## HTML-First Conversational Workflow (Recommended for New Documents)

Do not produce a finished document in one shot. Communicate with the user at every phase.

```
Phase 1: Agree on Structure  → Present outline/structure → User feedback → Finalize
Phase 2: Write by Section    → Write one section at a time → User confirmation → Next section
Phase 3: Visual Polish       → HTML styling → Fine-tune with Agentation
Phase 4: Conversion          → HTML → DOCX
```

### Phase 1: Agree on Structure
1. User provides the topic/purpose
2. Propose a document structure (table of contents, section layout, estimated length)
3. Ask the user: "Shall we proceed with this structure? Any sections to add or remove?"
4. Incorporate feedback → Finalize structure

### Phase 2: Write by Section
1. Write the first section → User confirmation → After approval, move to the next section
2. **Proactively ask questions when input is needed**:
   - When data/figures are needed → "Do you have specific numbers to include here?"
   - When direction is ambiguous → "Which approach is correct, A or B?"
   - When external information is needed → "Do you have any reference materials?"

### Phase 3: Visual Polish (HTML + Agentation)
1. HTML styling (`/Qfrontend-design` principles — `typography.md`, `color-and-contrast.md`, `spatial-design.md`)
2. Diagrams: `mmdc -i diagram.mmd -o diagram.png -t neutral -b transparent -s 2` → embed with `<img>`
3. **Agentation required** — `npx agentation` → click to specify what to fix

### Phase 4: Conversion
```bash
pandoc output.html -o output.docx
pandoc output.html --reference-doc=template.docx -o output.docx   # Apply style template
```

---

## Workflow Decision Tree

| Task | Method |
|------|--------|
| **Read/Analyze** | `pandoc document.docx -o output.md` |
| **Create new document** | **HTML-First Workflow** (recommended) or docx-js |
| **Edit existing document (your own)** | Unpack → XML edit → Repack |
| **Edit existing document (someone else's)** | **Redlining Workflow** (recommended) |
| **Legal/Academic/Business documents** | **Redlining Workflow** (required) |
| **Convert to image** | DOCX → PDF (LibreOffice) → JPEG (pdftoppm) |

## 1. Read/Analyze

```bash
pandoc document.docx -o output.md                         # Convert to markdown
pandoc --track-changes=all document.docx -o output.md      # Include tracked changes (accept/reject/all)
```

### Raw XML Access
Use when you need comments, complex formatting, embedded media, or metadata:
```bash
python ooxml/scripts/unpack.py document.docx unpacked/
```
Key files: `word/document.xml` (body), `word/comments.xml` (comments), `word/media/` (media), `<w:ins>`/`<w:del>` (tracked changes).

## 2. Create New Document (docx-js)

```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel,
        Table, TableRow, TableCell, WidthType } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 } } },  // US Letter (DXA)
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "제목", bold: true })]
      }),
      new Paragraph({ children: [new TextRun("본문 내용")] }),
      new Table({
        rows: [new TableRow({
          children: [
            new TableCell({ width: { size: 5000, type: WidthType.DXA }, children: [new Paragraph("셀 1")] }),
            new TableCell({ width: { size: 5000, type: WidthType.DXA }, children: [new Paragraph("셀 2")] })
          ]
        })]
      })
    ]
  }]
});
Packer.toBuffer(doc).then(buf => fs.writeFileSync("report.docx", buf));
```

### docx-js Essential Rules

| Rule | Details |
|------|---------|
| Specify page size | US Letter: 12240 x 15840 DXA |
| No `\n` usage | Use separate Paragraph objects |
| No unicode bullets | Use `LevelFormat.BULLET` |
| PageBreak | Must be inside a Paragraph |
| ImageRun | `type` (png/jpg) must be specified |
| Table width | Always use `WidthType.DXA` |
| Cell background | `ShadingType.CLEAR` (not SOLID) |

## 3. Edit Existing Documents

### Basic Editing (Unpack → Edit → Repack)
```bash
python ooxml/scripts/unpack.py document.docx unpacked/   # Unpack
# Edit XML (word/document.xml) — Python DOM manipulation
python ooxml/scripts/pack.py unpacked/ output.docx        # Repack
```

### Redlining Workflow (Tracked Changes)

Edit legal/business/academic documents with change tracking. **Principle: minimal, precise edits** — only mark the changed text.

```python
# Bad example — replace entire sentence
'<w:del><w:delText>The term is 30 days.</w:delText></w:del>'
'<w:ins><w:t>The term is 60 days.</w:t></w:ins>'

# Good example — mark only the changed portion
'<w:r><w:t>The term is </w:t></w:r>'
'<w:del><w:delText>30</w:delText></w:del>'
'<w:ins><w:t>60</w:t></w:ins>'
'<w:r><w:t> days.</w:t></w:r>'
```

#### Redlining Process
```
1. Convert to markdown     pandoc --track-changes=all doc.docx -o current.md
2. Identify changes        Group into batches (3-10 each, by section/type/location)
3. Unpack                  python ooxml/scripts/unpack.py doc.docx unpacked/
4. Script per batch        grep to locate → DOM edit → doc.save()
5. Repack                  python ooxml/scripts/pack.py unpacked/ reviewed.docx
6. Verify                  pandoc --track-changes=all reviewed.docx -o verify.md
```

#### Tracked Changes XML Patterns
```xml
<!-- Insertion -->
<w:ins w:id="1" w:author="Reviewer" w:date="2026-03-15T00:00:00Z">
  <w:r><w:t>삽입된 텍스트</w:t></w:r>
</w:ins>
<!-- Deletion -->
<w:del w:id="2" w:author="Reviewer" w:date="2026-03-15T00:00:00Z">
  <w:r><w:delText>삭제된 텍스트</w:delText></w:r>
</w:del>
```

## 4. Document to Image Conversion

```bash
soffice --headless --convert-to pdf document.docx          # DOCX → PDF
pdftoppm -jpeg -r 150 document.pdf page                    # PDF → JPEG (all pages)
pdftoppm -jpeg -r 150 -f 2 -l 5 document.pdf page         # Specific pages only
```

## Dependencies

| Tool | Installation | Purpose |
|------|-------------|---------|
| pandoc | `brew install pandoc` | Text extraction, format conversion |
| docx | `npm install -g docx` | New document creation |
| LibreOffice | `brew install --cask libreoffice` | PDF conversion |
| Poppler | `brew install poppler` | PDF to image (pdftoppm) |
| defusedxml | `pip install defusedxml` | Safe XML parsing |

## Code Style
- Write concisely, no unnecessary print statements, avoid verbose variable names
