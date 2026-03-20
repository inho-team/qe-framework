---
name: Mrefactor-agent-md
description: "Refactors bloated AGENTS.md, CLAUDE.md, or similar agent instruction files following the progressive disclosure principle. Use when a single instruction file has grown too large or is hard to navigate. Splits it into systematically organized, linked documents."
license: MIT
---


# Agent MD Refactor

Refactors agent instruction files (AGENTS.md, CLAUDE.md, COPILOT.md, etc.) that have grown too large, following the **progressive disclosure principle**. Keeps core content at the root and organizes the rest into linked, categorized files.

---

## Triggers

- "Refactor AGENTS.md" / "Refactor CLAUDE.md"
- "Split the agent instruction file"
- "Clean up CLAUDE.md"
- "AGENTS.md is too long"

---

## Quick Reference

| Phase | Task | Output |
|-------|------|--------|
| 1. Analyze | Find contradictions | List of conflicts to resolve |
| 2. Extract | Identify core content | Core directives for root file |
| 3. Categorize | Group remaining directives | Logical categories |
| 4. Structure | Build file hierarchy | Root + linked files |
| 5. Prune | Mark items for deletion | Duplicate / ambiguous directives |

---

## Process

### Phase 1: Find Contradictions

Identify directives that conflict with each other.

**Check for:**
- Conflicting style guidelines (e.g., "use semicolons" vs. "no semicolons")
- Conflicting workflow directives
- Incompatible tool preferences
- Mutually exclusive patterns

**When a contradiction is found:**
```markdown
## Contradiction Found

**Directive A:** [quote]
**Directive B:** [quote]

**Question:** Which should take priority, or should both apply conditionally?
```

Ask the user to resolve it before proceeding.

---

### Phase 2: Identify Core Content

Extract only what belongs in the root file. Include only information that **applies universally to all tasks**.

**Core content (keep at root):**
| Category | Examples |
|----------|---------|
| Project description | One sentence: "A React dashboard for analytics" |
| Package manager | Only if non-default (e.g., "use pnpm") |
| Non-standard commands | Custom build/test/typecheck commands |
| Critical overrides | Items that must override defaults |
| Global rules | Rules that apply to 100% of all tasks |

**Non-core content (move to linked files):**
- Language-specific conventions, testing guidelines, code style, framework patterns, Git workflow

---

### Phase 3: Categorize Remaining Content

**Common categories:**
| Category | Content |
|----------|---------|
| `typescript.md` | TS conventions, type patterns, strict mode |
| `testing.md` | Test framework, coverage, mocking |
| `code-style.md` | Formatting, naming, comments, structure |
| `git-workflow.md` | Commits, branches, PRs, reviews |
| `architecture.md` | Patterns, folder structure, dependencies |
| `api-design.md` | REST/GraphQL conventions, error handling |
| `security.md` | Auth, input validation, secrets |
| `performance.md` | Optimization, caching, lazy loading |

**Categorization rules:**
1. Each file must be self-contained
2. Target 3–8 files total
3. Use clear file names: `{topic}.md`
4. Include only actionable directives

---

### Phase 4: Build File Structure

**Output structure:**
```
project-root/
├── CLAUDE.md                     # Minimal root with links
└── .claude/
    ├── typescript.md
    ├── testing.md
    ├── code-style.md
    ├── git-workflow.md
    └── architecture.md
```

**Root file template:**
```markdown
# Project Name

One-sentence project description.

## Quick Reference

- **Package manager:** pnpm
- **Build:** `pnpm build`
- **Test:** `pnpm test`
- **Typecheck:** `pnpm typecheck`

## Detailed Guidelines

- [TypeScript Conventions](.claude/typescript.md)
- [Testing Guidelines](.claude/testing.md)
- [Code Style](.claude/code-style.md)
- [Git Workflow](.claude/git-workflow.md)
- [Architecture Patterns](.claude/architecture.md)
```

---

### Phase 5: Mark Items for Deletion

**Deletion criteria:**
| Criterion | Example | Reason |
|-----------|---------|--------|
| Redundant | "Use TypeScript" (in a .ts project) | Agent already knows this |
| Too vague | "Write clean code" | Not actionable |
| Obvious | "Don't introduce bugs" | Wastes context |
| Default behavior | "Use meaningful variable names" | Standard practice |
| Outdated | References to deprecated APIs | Not applicable |

---

## Execution Checklist

```
[ ] Phase 1: All contradictions identified and resolved
[ ] Phase 2: Root file contains only core content
[ ] Phase 3: All remaining directives categorized
[ ] Phase 4: File structure created with correct links
[ ] Phase 5: Duplicate / ambiguous directives removed
[ ] Verify: Each linked file is self-contained
[ ] Verify: Root file is under 50 lines
[ ] Verify: All links work correctly
```

---

## Anti-Patterns

| Avoid | Reason | Instead |
|-------|--------|---------|
| Keep everything in root | Becomes bloated and hard to maintain | Split into linked files |
| Too many categories | Creates fragmentation | Merge related topics |
| Vague directives | Wastes tokens | Be specific or delete |
| Duplicating defaults | Agent already knows them | Only specify overrides |
| Deep nesting | Hard to navigate | Use a flat structure with links |

---

## Validation

After refactoring:

1. **Root file is minimal** — under 50 lines, only global information
2. **Links work** — all referenced files exist
3. **No contradictions** — directives are consistent
4. **Actionable content** — all directives are concrete
5. **Full coverage** — nothing missing except items marked for deletion
6. **Self-contained files** — each linked file stands alone
