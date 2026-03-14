# Git Workflow Rules -- Execution-Level Checklist

> Referenced by: Ecommit-executor

Complements PRINCIPLES.md "Git Operations" rule. This file provides commit and branch standards.

## Conventional Commit Format

```
type: subject line (70 chars max, lowercase start)

Optional body explaining why (not what).
```

### Allowed Types

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `chore` | Build, tooling, dependency updates |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `style` | Formatting, whitespace (no logic change) |
| `perf` | Performance improvement |

### Subject Rules

- 70 characters or fewer
- Lowercase start (no capital first letter)
- No period at the end
- Imperative mood: "add feature" not "added feature"

## One Change Per Commit

- Each commit contains one logical change
- Split unrelated changes into separate commits
- Refactoring and feature changes go in separate commits

## Never Commit Secrets

- Check for `.env`, credentials, API keys before staging
- Use `.gitignore` to exclude sensitive files
- If accidentally committed, rotate the secret immediately

## Branch Naming

- Feature: `feature/{short-description}`
- Bugfix: `fix/{short-description}`
- Chore: `chore/{short-description}`

## All Commits Via Qcommit

As specified in PRINCIPLES.md, all git commit and push operations MUST go through `/Qcommit`.
