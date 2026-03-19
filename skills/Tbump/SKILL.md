---
name: Tbump
description: "Bumps the QE Framework version in plugin.json and package.json. Use for version bump, 버전업, bump version, release, 릴리스, 버전 올려. Supports major, minor, and patch levels."
allowed-tools: Bash(git *)
---
> Core philosophy: see core/PHILOSOPHY.md

# Tbump — QE Framework Version Bump

## Purpose

Bumps the QE Framework version number across all version files and creates a git commit.

**Scope:** QE Framework internals only. Not for user project tasks.

---

## Versioning Rules

Format: `MAJOR.MINOR.PATCH` (e.g., `2.1.3`)

| Level | When | Examples |
|-------|------|----------|
| **patch** (default) | Bugfix, skill tweak, small change | `2.0.0` → `2.0.1` |
| **minor** | New skill, new agent, feature addition | `2.0.1` → `2.1.0` |
| **major** | Breaking change, large restructure | `2.1.0` → `3.0.0` |

---

## Execution Procedure

### Step 1 — Determine bump level

If the user specifies `major`, `minor`, or `patch`, use that.
If not specified, infer from context:
- Mentioned bugfix/tweak/tune → **patch**
- Mentioned new skill/agent/feature → **minor**
- Mentioned breaking/restructure → **major**
- No context → ask the user

### Step 2 — Read current version

Read `.claude-plugin/plugin.json` and extract the current `version` field.

### Step 3 — Calculate new version

Apply the bump:
- **patch:** increment PATCH, keep MAJOR.MINOR
- **minor:** increment MINOR, reset PATCH to 0
- **major:** increment MAJOR, reset MINOR and PATCH to 0

### Step 4 — Update version files

Update the `version` field in both files:
1. `.claude-plugin/plugin.json`
2. `package.json`

### Step 5 — Commit

Create a git commit with message:

```
chore: bump plugin version to {new_version}
```

### Step 6 — Report

Print:

```
QE Framework {old_version} → {new_version}
```

---

## Will
- Read and update version in plugin.json and package.json
- Create a version bump commit

## Will Not
- Push to remote (user decides when to push)
- Modify any skill/agent/hook files
- Bump without user confirmation on the level
