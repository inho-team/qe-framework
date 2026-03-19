---
name: Qagentation
description: "Agentation setup and usage guide — visual UI feedback tool for AI coding agents. Use for 'agentation', 'agentation setup', 'UI annotation tool', 'visual feedback setup', 'UI 피드백 도구'. Distinct from Qweb-design-guidelines (which audits UI code) — this skill sets up a visual annotation layer that feeds structured context to AI agents."
---
> Shared principles: see core/PRINCIPLES.md
> Core philosophy: see core/PHILOSOPHY.md

# Qagentation — Visual UI Feedback for AI Agents

## Role Boundary (Absolute Rule)

This skill is a **setup and usage guide only**. It does NOT execute UI modifications.

| Request | Correct action |
|---------|---------------|
| "agentation 설정해줘", "visual feedback 도구 연결" | **This skill** — guide setup |
| "UI 수정해줘", "CSS 고쳐줘", "디자인 리뷰해줘" | **NOT this skill** — use Qfrontend-design, Qweb-design-guidelines, or standard code implementation |

---

## What is Agentation?

**Agentation** (agentation.com) converts visual UI annotations into structured context that AI coding agents can understand. Instead of describing UI issues in text, you click directly on elements and annotate them.

| Feature | Detail |
|---------|--------|
| Input | Click on UI elements, write feedback annotations |
| Output | Structured markdown with CSS selectors, source paths, component tree |
| Integration | Copy-paste to agent, or MCP for direct access |
| Platform | Desktop only |
| License | Free for personal and internal company use |
| Package | `agentation` on npm (v2.3.3+) |

### What the Agent Receives

When you annotate a UI element, Agentation extracts:
- **CSS selectors** to grep the codebase
- **Source file paths** to jump directly to the right line
- **React component tree** hierarchy
- **Computed styles** of the element
- **User feedback** text you wrote

---

## Setup

### Step 1: Install in Your Frontend Project

```bash
npx agentation
```

This injects the Agentation overlay into your running dev server.

### Step 2: Annotate

1. Click the icon at the bottom-right corner to activate
2. Hover over elements to see their names
3. Click an element to open the annotation panel
4. Write your feedback and add it
5. Copy as markdown and paste into your AI agent

### Step 3 (Optional): MCP Integration

MCP integration skips the copy-paste step. The agent directly accesses your annotations.

#### Add to Claude Code

```bash
claude mcp add agentation -- npx agentation mcp
```

Or edit `~/.claude.json`:
```json
{
  "mcpServers": {
    "agentation": {
      "command": "npx",
      "args": ["agentation", "mcp"]
    }
  }
}
```

#### Verify Connection

```bash
claude mcp list | grep agentation
```

### MCP Usage in Claude Code

With MCP connected, you can talk to the agent naturally:

```
# Resolve all feedback
"내 피드백을 해결해줘"

# Fix a specific annotation
"주석 3번을 수정해줘" / "fix annotation #3"

# List all annotations
"현재 주석 목록 보여줘"
```

The agent can also respond back:
- List all feedback items
- Ask clarification questions
- Mark annotations as resolved
- Clear all annotations

---

## Best Practices for Annotations

| Practice | Example |
|----------|---------|
| Be specific | "Button text is unclear — should say 'Save Draft'" not "fix this" |
| One issue per annotation | Easier for the agent to process individually |
| Include context | "Expected: 16px padding. Actual: 8px padding" |
| Use text selection | Select text for typo or content issues |
| Pause animations | Pause before annotating a specific animation frame |

---

## Verification

```bash
# Check npm package
npm view agentation version

# Check MCP connection (if using MCP)
claude mcp list | grep agentation
```

---

## Will
- Guide Agentation installation and setup
- Explain MCP integration with Claude Code
- Provide annotation best practices
- Troubleshoot connection issues

## Will Not
- Execute UI code modifications directly
- Replace Qfrontend-design (creates UI) or Qweb-design-guidelines (reviews UI)
- Run Agentation commands without user confirmation
