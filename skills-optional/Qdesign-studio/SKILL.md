---
name: Qdesign-studio
description: "Multi-artifact orchestrator — fans one brief out to a coordinated set (UI code + slide deck + one-pager PDF + mockup + prototype) via artifact-dispatcher.mjs, composing Qdesign/Qfrontend-design/Qpptx/Qdocx/Qvisual-qa under one entry point. Branch points: use THIS only when the user wants 2+ artifact formats from a single brief ('pitch deck and landing page', 'full design package'); use Qfrontend-design for a single UI; use Qpptx/Qdocx for a single document format; use Qdesign to write only the DESIGN.md spec. Produces real production code, not just mockups."
metadata:
  author: qe-framework
  version: "1.0.0"
argument-hint: "<brief> [--session-name <name>]"
invocation_trigger: "When user wants to produce multiple design artifacts from one brief. Trigger: 'design studio', 'end-to-end design', 'brief to artifacts', 'pitch deck and landing page', 'full design package'."
recommendedModel: sonnet
---

# Qdesign-studio: Unified Design Orchestrator

## Role Boundary

| Skill | Scope | Output | When to Use |
|-------|-------|--------|-------------|
| **Qdesign-studio** | Orchestrates multi-artifact workflows from one brief | Code + deck + doc + mockup + prototype in one session | User wants complete design package (pitch + landing + prototype) |
| Qfrontend-design | Single UI implementation | React/HTML/CSS code + live preview | User needs only UI code for one page/component |
| Qpptx | Single presentation format | .pptx slide deck | User needs only presentation slides |
| Qdocx | Single document format | .docx or .pdf one-pager | User needs only written documentation |
| Qdesign | Design system specification only | DESIGN.md system definition | User needs design tokens/guidelines before any coding |
| Qvisual-redesign | Audit + fix existing UI | Modified code + screenshot | User has live site to audit and refine |
| Claude Design (external) | Visual preview mockup only | Interactive mockup preview | User needs quick visual mockup, no production code |

## Prerequisite: DESIGN.md Check

When invoked, **immediately check if `DESIGN.md` exists** in the project root.

- **If `DESIGN.md` exists**: Proceed directly to Step 1 (brief reception).
- **If `DESIGN.md` does NOT exist**: 
  ```
  ⚠️ DESIGN.md가 없습니다.
  먼저 /Qdesign --scan을 실행하시겠습니까?
  
  No DESIGN.md found.
  Run /Qdesign --scan first to bootstrap design tokens? (y/n)
  ```
  - If user confirms: invoke `/Qdesign --scan` to auto-detect design system from codebase.
  - If user declines: proceed with studio workflow but warn that artifact quality depends on explicit design guidelines.

## Workflow

### Step 1: Receive Brief

Accept brief in natural language (English or Korean or mixed).

**Example inputs:**
- "Landing page hero for a SaaS analytics product"
- "Series A pitch deck, 10 slides, with one-pager for investors"
- "Full design package: landing page, pitch deck, and prototype"

### Step 2: Dispatch to Artifact Set

Call `dispatch(brief)` from `hooks/scripts/lib/artifact-dispatcher.mjs` to analyze keywords and recommend artifacts.

```javascript
// Pseudo-invocation (lib will be written by another agent)
import { dispatch } from './hooks/scripts/lib/artifact-dispatcher.mjs';
const { artifacts, rationale } = await dispatch(brief);
```

**Expected response:**
```json
{
  "artifacts": ["code", "deck", "doc", "prototype"],
  "rationale": "Brief mentions 'pitch deck' (deck), 'landing page' (code), 'investor one-pager' (doc), and 'rapid prototype' (prototype)."
}
```

### Step 3: Confirm Artifact Selection

Print dispatcher rationale to user:
```
🎯 Recommended Artifacts:
• code        (Landing page UI)
• deck        (Pitch slides)
• doc         (One-pager PDF)
• prototype   (Interactive prototype)

Proceed with this set? Or deselect any? (multiSelect: true)
```

Use `AskUserQuestion` if artifacts list > 1, to allow user to exclude unwanted items.

### Step 4: Create Session Directory

Create timestamp-based session directory:
```
.qe/studio-session/2026-04-24T15-30-00Z/
```

Write `brief.md`:
```markdown
# Studio Brief

**Original Brief:**
{user's input}

**Dispatcher Rationale:**
{rationale from dispatch()}

**Selected Artifacts:**
{list of selected artifacts}
```

### Step 5: Invoke Sub-Skills for Each Artifact

For **each artifact** in the selected set, invoke the appropriate sub-skill and collect output:

| Artifact | Sub-Skill | Command | Output Location |
|----------|-----------|---------|-----------------|
| `'code'` | Qfrontend-design | `/Qfrontend-design --canvas` | `.qe/studio-session/<ISO>/code/` |
| `'prototype'` | Qfrontend-design | `/Qfrontend-design --prototype --canvas` | `.qe/studio-session/<ISO>/prototype/` |
| `'deck'` | Qpptx | `/Qpptx` | `.qe/studio-session/<ISO>/deck.pptx` |
| `'doc'` | Qdocx | `/Qdocx` | `.qe/studio-session/<ISO>/doc.pdf` |
| `'mockup'` | Qstitch-apply | `/Qstitch-apply` (if Stitch project exists) | `.qe/studio-session/<ISO>/mockup/` |

**Sub-skill invocation order:**
1. Start with `code` or `prototype` (longest) in parallel with `doc` (if possible).
2. Then `deck` and `mockup`.
3. Order prioritizes user preference if stated.

**Pass context to each sub-skill:**
- Always pass the original brief as preamble.
- Include link to `brief.md` in session directory.
- For code/prototype: "Use DESIGN.md if available; fall back to brief aesthetic cues."

### Step 6: Collect Outputs and Organize

As each sub-skill completes:
- Move its primary artifact into the session directory structure.
- Preserve file names or rename for consistency (e.g., `index.html` → `code/index.html`).
- Store any metadata (screenshots, generated previews, feedback) in subdirectories.

### Step 7: Generate Summary Report

After all artifacts are ready, produce `summary.md`:
```markdown
# Studio Session Report

**Session ID:** 2026-04-24T15-30-00Z  
**Brief:** [original brief]

## Artifacts Generated

### Code
- Location: `code/index.html`
- Technology: React + Tailwind CSS
- Canvas Preview: [screenshot or link]

### Deck
- Location: `deck.pptx`
- Slides: 10
- Theme: Modern, investor-grade

### Doc
- Location: `doc.pdf`
- Pages: 2
- Format: One-pager + deep-dive

### Prototype
- Location: `prototype/index.html`
- Canvas Preview: [screenshot]
- Interactivity: [description]

### Mockup
- Location: (not generated / Stitch project not found)
- Suggestion: Use Claude Design externally to create design mockup

## Next Steps

1. **Review Code**: Open `code/index.html` in browser.
2. **Refine with Qvisual-redesign**: `/Qvisual-redesign localhost:3000 --tune`
3. **Iterate**: Use inline `<!-- claude: ... -->` directives to auto-pick-up on re-invocation.
4. **Export**: Use Qstitch-apply if moving designs back to Stitch.

---
Generated by qe-framework Qdesign-studio • [timestamp]
```

## Phase 1/2 Integration

This skill leverages capabilities built in earlier waves:

### Phase 1: Canvas Rendering (via `canvas-preview.mjs`)
Every code and prototype artifact gets live canvas preview:
- Qfrontend-design with `--canvas` flag renders generated HTML/React in browser.
- Screenshot is returned and embedded in summary.md.
- User can verify UI appearance immediately.

### Phase 2: Slider-Based Iteration (via `slider-parser.mjs`)
After initial generation, user can refine via `/Qvisual-redesign --tune`:
- Exposed design tokens as markdown sliders.
- Interactively adjust color, spacing, font sizes.
- Changes reflected live on canvas.

### Phase 2: Inline Directives (via `inline-comment-parser.mjs`)
On re-invocation, inline `<!-- claude: ... -->` or `/* claude: ... */` directives are auto-detected:
- Changes merge into brief without user re-typing.
- Sub-skills automatically pick up feedback.
- Enables rapid iteration without context loss.

## Session Directory Convention

```
.qe/studio-session/
└── 2026-04-24T15-30-00Z/
    ├── brief.md              # Original brief + dispatcher rationale
    ├── code/
    │   ├── index.html
    │   ├── style.css
    │   └── canvas-preview.png
    ├── prototype/
    │   ├── index.html
    │   └── canvas-preview.png
    ├── deck.pptx
    ├── doc.pdf
    ├── mockup/               # (if Stitch or Claude Design used)
    │   └── [mockup files]
    └── summary.md            # Final report with links and next steps
```

## Usage Examples

### Example 1: Code Only

```
/Qdesign-studio "Landing page hero for a SaaS analytics product"

Dispatcher Output:
✓ artifacts: ["code"]
✓ Rationale: "Brief mentions 'landing page' and 'hero'; code artifact selected."

Sub-skill invoked:
→ /Qfrontend-design --canvas "Landing page hero for SaaS analytics..."
```

**Output:** `.qe/studio-session/2026-04-24T10-00-00Z/code/index.html` + screenshot

---

### Example 2: Deck Only

```
/Qdesign-studio "Pitch deck for Series A, 10 slides, investor-grade"

Dispatcher Output:
✓ artifacts: ["deck"]
✓ Rationale: "Brief mentions 'pitch deck' and 'slides'; deck artifact selected."

Sub-skill invoked:
→ /Qpptx "Pitch deck for Series A, 10 slides, investor-grade"
```

**Output:** `.qe/studio-session/2026-04-24T10-15-00Z/deck.pptx`

---

### Example 3: Multi-Artifact (Code + Deck + Doc)

```
/Qdesign-studio "Pitch deck and the landing page for the same product launch. Also a one-pager for investors."

Dispatcher Output:
✓ artifacts: ["code", "deck", "doc"]
✓ Rationale: "Brief mentions 'pitch deck', 'landing page', and 'one-pager'; all three artifacts selected."

User Confirmation:
🎯 Recommended Artifacts:
• code   (Landing page UI)
• deck   (Pitch slides)
• doc    (One-pager PDF)
Proceed? (y/n) → y

Sub-skills invoked in parallel:
→ /Qfrontend-design --canvas "Landing page for product launch..."
→ /Qpptx "Pitch deck for product launch..."
→ /Qdocx "One-pager for investors..."
```

**Output:** All three artifacts in `.qe/studio-session/2026-04-24T10-30-00Z/`

---

## Will / Will Not

### Will
- Dispatch briefs to multiple sub-skills in parallel when feasible.
- Store all artifacts in time-keyed session directories (avoid collision, enable cleanup).
- Generate live canvas previews for code and prototype artifacts.
- Support inline directive feedback on re-invocation.
- Route to Stitch or Claude Design when user indicates design mockup preference.

### Will Not
- Create DESIGN.md without explicit `/Qdesign` invocation (asks user first).
- Merge disparate design systems (each artifact respects same DESIGN.md).
- Override user artifact selection after confirmation.
- Persist sessions beyond project lifetime (user responsible for archiving).
- Support non-brief input (e.g., "modify existing artifact" → use Qvisual-redesign instead).
