---
name: Mbump
description: "Bumps the QE Framework version in plugin.json and package.json. Use for version bump, bump version, release. Supports major, minor, and patch levels."
allowed-tools: Bash(git *)
---

# Mbump — QE Framework Version Bump

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

### Step 5 — Sync plugin cache

Claude Code loads skills from the cached snapshot at `~/.claude/plugins/cache/`, not from the local repo. After updating version files, sync the local repo to the cache so new/changed skills are immediately available.

1. Find the plugin cache path from `~/.claude/plugins/installed_plugins.json` (read the `installPath` field for `qe-framework`).
2. Run `rsync -a --delete` from the local repo to the cache path, excluding `.git/`:
   ```
   rsync -a --delete --exclude='.git/' {repo_root}/ {cache_install_path}/
   ```
3. Update `installed_plugins.json`: set `version` to `{new_version}` and `gitCommitSha` to the current HEAD commit SHA.

### Step 6 — Commit via Ecommit-executor

Delegate the commit to the `Ecommit-executor` agent via the Agent tool with message:

```
Commit the version bump. Message: "chore: bump plugin version to {new_version}"
Do not push.
```

**Do NOT run `git commit` directly.** The PreToolUse hook blocks raw git commit — only Ecommit-executor has the bypass.

### Step 7 — Report

Print:

```
QE Framework {old_version} → {new_version}
Plugin cache synced — restart Claude Code to load new skills.
```

---

## Will
- Read and update version in plugin.json and package.json
- Sync local repo to plugin cache so new skills are immediately available
- Create a version bump commit

## Will Not
- Push to remote (user decides when to push)
- Modify any skill/agent/hook files
- Bump without user confirmation on the level
