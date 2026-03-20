---
name: Qbranch
description: "Git branch workflow manager — creates branches, commits via Qcommit, and opens PRs. Blocks direct push to main. Use when starting a feature, fix, hotfix, or any branch-based work. Korean: '브랜치', '기능 개발', 'PR 생성', '피처 브랜치'. Chinese: '分支', '功能开发'. Japanese: 'ブランチ', '機能開発'. Arabic: 'فرع'. Hindi: 'ब्रांच'. Spanish: 'rama'. Portuguese: 'branch'. French: 'branche'. German: 'Branch'. Russian: 'ветка'. Indonesian: 'cabang'."
user_invocable: true
---

# Qbranch — Git Branch Workflow Manager

## Role
Manages the full branch lifecycle: create branch, commit changes (via Qcommit), push, and open PR. Prevents direct push to main.

> **MANDATORY:** All user confirmations MUST use the `AskUserQuestion` tool. Do NOT output options as plain text — always call the tool.

## Examples

```
User: "로그인 기능 개발할게"
→ Qbranch: creates feat/add-login, switches to it

User: "이거 PR 올려줘"
→ Qbranch: pushes current branch, creates PR via gh

User: "긴급 수정 필요해"
→ Qbranch: creates hotfix/ branch from main

User: "브랜치 정리해줘"
→ Qbranch: deletes merged branches (local + remote)
```

## Branch Types

| Type | Prefix | Purpose | Example |
|------|--------|---------|---------|
| Feature | `feat/` | New functionality | `feat/add-login` |
| Bug fix | `fix/` | General bug fix | `fix/order-calc` |
| Hotfix | `hotfix/` | Production emergency patch | `hotfix/auth-crash` |
| Chore | `chore/` | Config, deps, cleanup | `chore/cleanup-deps` |
| Refactor | `refactor/` | Code improvement, no behavior change | `refactor/extract-utils` |
| Docs | `docs/` | Documentation only | `docs/update-readme` |

## Main Branch Protection (Absolute Rule)

**Direct push to main is blocked.** If the current branch is `main` or `master`:
1. Warn the user that direct push to main is not allowed
2. Offer to create a branch first via `AskUserQuestion`
3. Only exception: if user explicitly overrides with "main에 직접 올려" or "push to main directly"

## Workflow

### Mode 1: Start Branch (`/Qbranch` or `/Qbranch start`)

**Step 1: Select branch type**
Use `AskUserQuestion` with 4 options:
- Feature (feat/) — new functionality
- Fix (fix/) — bug fix
- Hotfix (hotfix/) — emergency patch
- Other — chore, refactor, docs (ask follow-up)

**Step 2: Get branch description**
Use `AskUserQuestion` to ask for a short description (2-4 words, kebab-case).
Auto-convert spaces to hyphens, remove special characters.

**Step 3: Create and switch**
```bash
git checkout -b {type}/{description}
```
Report: `Created and switched to {type}/{description}`

### Mode 2: Commit (`/Qbranch commit`)

Delegates to Qcommit (Ecommit-executor). Identical to `/Qcommit` but adds a safety check:
1. Verify current branch is NOT main/master
2. If on main → warn and offer to create a branch first
3. If on feature branch → delegate to Ecommit-executor

### Mode 3: PR (`/Qbranch pr`)

**Step 1: Push current branch**
```bash
git push -u origin {current-branch}
```

**Step 2: Generate PR content**
Analyze commits on this branch (vs main) to auto-generate:
- **Title:** conventional format, derived from branch name and commits
- **Body:** summary of changes, checklist items if from a TASK_REQUEST

**Step 3: Create PR**
```bash
gh pr create --title "{title}" --body "{body}" --base main
```

**Step 4: Report**
Show PR URL and summary.

### Mode 4: Cleanup (`/Qbranch cleanup`)

**Step 1: Find merged branches**
```bash
git branch --merged main | grep -v 'main\|master\|\*'
```

**Step 2: Confirm deletion**
Use `AskUserQuestion` to show the list and confirm:
- Delete all merged branches
- Select which to keep
- Cancel

**Step 3: Delete**
```bash
git branch -d {branch}          # local
git push origin --delete {branch} # remote
```

### Mode 5: Status (`/Qbranch status`)

Show current branch info:
- Current branch name and type
- Commits ahead/behind main
- Uncommitted changes count
- Related PR (if exists, via `gh pr list --head {branch}`)

## Auto-detection

When no explicit mode is given, infer from context:
- No arguments + on main → offer to start a new branch
- No arguments + on feature branch → show status
- "PR", "올려", "push" mentioned → Mode 3 (PR)
- "정리", "cleanup", "삭제" mentioned → Mode 4 (Cleanup)
- "커밋", "commit", "저장" mentioned → Mode 2 (Commit)

## Integration with Qcommit

Qbranch orchestrates the workflow. Qcommit handles the commit execution.
- Qbranch: branch creation, PR creation, branch protection, cleanup
- Qcommit/Ecommit-executor: staging, commit message, committing, pushing

Never duplicate Qcommit's responsibilities. Always delegate commit operations.

## Will
- Create and manage feature branches
- Block direct push to main
- Create PRs with auto-generated content
- Clean up merged branches
- Integrate with Qcommit for commits

## Will Not
- Run git commit directly (delegates to Ecommit-executor via Qcommit)
- Force push without explicit user request
- Delete unmerged branches without confirmation
- Merge PRs (user reviews and merges manually)
