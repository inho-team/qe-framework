# CLAUDE.md Import System & Pointer Pattern

> How to structure CLAUDE.md as a navigation document, not a knowledge base.

---

## The Pointer Document Pattern

CLAUDE.md should act as a **router** — telling Claude where to look, not what to know.

### Budget
- **Target: 150-200 lines** (current: ~65 lines)
- Beyond 200 lines, instruction compliance drops significantly
- If content exceeds budget, extract to linked documents

### Principle
- "Where to look" > "What to know"
- Navigation first, knowledge second
- Each line should earn its place: "Would Claude make a mistake without this line?"

## Hierarchical Loading

Claude Code loads CLAUDE.md files from bottom to top:

```
~/.claude/CLAUDE.md                    # Global: personal habits, language preference
project/CLAUDE.md                       # Project root: team-shared conventions (git-tracked)
project/src/CLAUDE.md                   # Subdirectory: module-specific rules
project/src/components/CLAUDE.md        # Deep: component-level overrides
```

- Closest CLAUDE.md has highest priority
- All levels are merged into the context
- Global CLAUDE.md applies to every project

## Import Pattern (@docs/)

While Claude Code does not natively support `@docs/` import syntax, the **pointer pattern** achieves the same effect:

### Instead of embedding knowledge:
```markdown
## API Guidelines
All REST endpoints must use JSON:API format with...
(50 lines of details)
```

### Point to the source:
```markdown
## API Guidelines
→ See `docs/API_GUIDELINES.md` for JSON:API format rules
```

Claude will read the referenced file when working in that area.

## What Belongs in CLAUDE.md

| Include | Exclude |
|---------|---------|
| Project name, tech stack, build commands | Detailed API documentation |
| Constraints (security, performance) | Full coding standards |
| Pointers to key documents | Task lists (use .qe/TASK_LOG.md) |
| QE toolkit shortcuts | Implementation details |
| Architecture overview (3-5 lines) | Historical decisions |

## Negative Instructions

Equally important as positive instructions:
- "Do NOT use class components" (React)
- "Never commit .env files"
- "Do not modify files outside project scope"

These prevent common AI mistakes more effectively than positive instructions alone.

## Maintenance

- Review CLAUDE.md quarterly — prune unused instructions
- Track in git — team members can contribute
- Run `/init` to generate a baseline CLAUDE.md
- Each line that doesn't prevent a mistake is noise
