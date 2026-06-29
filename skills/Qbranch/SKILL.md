---
name: Qbranch
description: Git branch workflow manager — creates branches, commits via Qcommit, and opens PRs. Use when starting a feature, fix, hotfix, or any branch-based work.
user_invocable: true
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

# Qbranch — Git Branch Workflow Manager

## Role
Manages the full branch lifecycle: create branch, commit changes (via Qcommit), push, and open PR. Prevents direct push to main.

> **MANDATORY:** All user confirmations MUST use the QE interaction adapter. Claude uses `AskUserQuestion`; Codex uses equivalent concise choices.

## Examples

```
User: "I'll develop a login feature"
→ Qbranch: creates feat/add-login, switches to it

User: "Push this as a PR"
→ Qbranch: pushes current branch, creates PR via gh

User: "Need an emergency fix"
→ Qbranch: creates hotfix/ branch from main

User: "Clean up branches"
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
3. Only exception: if user explicitly overrides with "push directly to main" or "push to main directly"

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
- "PR", "push", "push" mentioned → Mode 3 (PR)
- "cleanup", "cleanup", "delete" mentioned → Mode 4 (Cleanup)
- "commit", "commit", "save" mentioned → Mode 2 (Commit)

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
