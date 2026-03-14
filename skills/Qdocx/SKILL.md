---
name: Qdocx
description: "Word 문서(.docx) 생성, 읽기, 편집, 조작. 보고서, 메모, 편지, 템플릿, 목차, 추적 변경, 댓글 작업 포함."
metadata:
  source: https://skills.sh/anthropics/skills/docx
  author: anthropic
---
> 공통 원칙: core/PRINCIPLES.md 참조


# DOCX Creation, Editing, and Analysis

## Quick Reference
| Task | Approach |
|------|----------|
| Read/analyze | `pandoc document.docx -o output.md` |
| Create new | Use `docx-js` (`npm install -g docx`) |
| Edit existing | Unpack -> edit XML -> repack |

## Creating (docx-js)
```javascript
const { Document, Packer, Paragraph, TextRun } = require('docx');
const doc = new Document({ sections: [{ children: [
  new Paragraph({ children: [new TextRun("Hello")] })
]}]});
Packer.toBuffer(doc).then(buf => fs.writeFileSync("doc.docx", buf));
```

### Critical Rules
- Set page size explicitly (US Letter: 12240 x 15840 DXA)
- Never use `\n` - use separate Paragraphs
- Never use unicode bullets - use LevelFormat.BULLET
- PageBreak must be in Paragraph
- ImageRun requires `type` (png/jpg)
- Always use WidthType.DXA for tables
- Use ShadingType.CLEAR not SOLID

## Editing Existing
```bash
python scripts/office/unpack.py document.docx unpacked/
# Edit XML files in unpacked/word/
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```

## Tracked Changes
```xml
<w:ins w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>inserted text</w:t></w:r>
</w:ins>
<w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>deleted text</w:delText></w:r>
</w:del>
```

## Dependencies
- pandoc, docx (`npm install -g docx`), LibreOffice, Poppler
