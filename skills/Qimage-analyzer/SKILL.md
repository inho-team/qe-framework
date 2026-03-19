---
name: Qimage-analyzer
description: Analyzes images and extracts insights. Analyzes screenshots, diagrams, charts, wireframes, UI screens, and document images to provide descriptions, OCR text extraction, structure identification, and improvement suggestions. Use for requests like "analyze this image", "describe this screenshot", "what is in this picture", "extract text", or "analyze wireframe".
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md


## Purpose
Uses Claude's built-in vision capabilities to analyze images. Performs a wide range of visual analysis including screenshot description, text extraction (OCR), diagram interpretation, chart analysis, UI/UX feedback, and document parsing.

## Supported Analysis Types

| Type | Description | Example Use Cases |
|------|-------------|-------------------|
| **OCR** | Extract text from images | Document scans, screenshot text |
| **UI Analysis** | Evaluate screen structure and UX | App screenshots, web pages |
| **Diagram Interpretation** | Flowcharts, ERDs, architecture | Design documents, whiteboard photos |
| **Chart/Graph Analysis** | Interpret data visualizations | Reports, dashboards |
| **Wireframe Analysis** | Understand UI design structure | Planning documents, Figma screenshots |
| **Document Analysis** | Parse tables, forms, reports | PDF screenshots, spreadsheet captures |
| **Comparison Analysis** | Compare differences between two images | Before/after design changes, A/B tests |

## Workflow

### Step 1: Receive Image
Ways to receive an image from the user:
- **Image in Vault:** Share as `![[image-name.png]]` format
- **Direct attachment:** Drag and drop image into chat
- **Provide path:** Absolute or relative file path

### Step 2: Identify Analysis Purpose
Determine the analysis purpose from the user's request:
- Simple description → Describe overall structure and content
- Text extraction → Extract text only in OCR mode
- UI/UX feedback → Suggest improvement points
- Data analysis → Interpret chart/table figures
- Structure identification → Describe diagram/flow

### Step 3: Read Image
```
Read image file using the Read tool:
- Supports PNG, JPG, JPEG, GIF, WebP
- File path: use relative path within the Vault
```

### Step 4: Perform Analysis and Provide Results

**Description analysis output format:**
```markdown
## Image Analysis Results

### Overview
[Overall description of the image]

### Key Components
1. [Component 1]
2. [Component 2]

### Details
[Detailed analysis]

### Insights / Suggestions
[Improvement points or notable observations]
```

**OCR output format:**
```markdown
## Extracted Text

[Raw extracted text as-is]

---
*Extraction confidence: [High/Medium/Low]*
*Uncertain characters: [noted]*
```

**UI/UX analysis output format:**
```markdown
## UI/UX Analysis

### Screen Structure
- Layout: [description]
- Key components: [list]

### Strengths
- [Strength 1]
- [Strength 2]

### Improvement Suggestions
- [Suggestion 1]
- [Suggestion 2]

### Accessibility Issues
- [Issue 1]
```

## Usage Examples

```
# Basic analysis
User: Describe this screenshot
User: What is in this image?

# OCR
User: Extract text from this document
User: Read the contents of this receipt

# Diagram
User: Explain this architecture diagram
User: How does this flowchart work?

# UI analysis
User: Give me UX feedback on this app screen
User: Identify the structure of this wireframe

# Chart analysis
User: Explain the trend in this graph
User: Summarize the data in this table

# Comparison
User: Find the differences between these two images
```

## Limitations
- OCR accuracy may be low for very small text or blurry images
- Handwriting recognition accuracy may vary
- Complex formulas or special symbols may be inaccurate
- Processing time increases with larger image sizes

## Vault Image Paths
Images in the Obsidian Vault are typically found at:
- `triphos/*/images/`
- `images/` or `attachments/` inside each project folder
