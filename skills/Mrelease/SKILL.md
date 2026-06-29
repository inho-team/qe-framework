---
name: Mrelease
description: "Cuts a batched release from accumulated [Unreleased] CHANGELOG entries. Determines bump level, updates plugin.json/package.json/marketplace.json, commits the version bump with the changelog section, creates an annotated tag, and optionally pushes + creates a GitHub Release. Replaces the old pattern of bumping on every fix — use /Mrelease when a batch is ready, not per commit."
metadata:
  author: qe-framework
  version: "1.0.0"
argument-hint: "[major|minor|patch]  (omit to infer from CHANGELOG section headers)"
invocation_trigger: "When the framework is ready to cut a batched release. Trigger phrases: 'release', 'cut a version', 'publish framework update', 'ship changelog', 'release train'."
recommendedModel: sonnet
---

# Mrelease — Batched Version Release

## Role
You coordinate a formal release from `CHANGELOG.md` → version files → git tag → GitHub Release.

This skill exists because per-commit version bumps cause user-facing churn (plugin cache invalidation, noisy release notifications). Mrelease enforces a **release train** — accumulate changes in `CHANGELOG.md [Unreleased]`, then cut a deliberate release when the batch is meaningful.

## When to Use

- `[Unreleased]` section in `CHANGELOG.md` has meaningful entries
- Cadence: weekly (patch batch), monthly (minor batch), or on-demand hotfix
- User is ready to publish — this is a user-visible action

## When NOT to Use

- **Between commits** — commits should update `[Unreleased]`, not release
- **For hotfixes** — use `/Mrelease patch` only if the bug is security/data-loss/framework-unusable. Normal edge-case fixes wait for the next scheduled batch.
- **Without CHANGELOG entries** — if `[Unreleased]` is empty, abort; there's nothing to release

## Pre-flight Checks (all MUST pass)

1. `git rev-parse --abbrev-ref HEAD` → `main` (never release from a feature branch)
2. `git status --short` → clean (no uncommitted changes)
3. `git fetch && git status` → up-to-date with origin (or one ahead is OK — the bump commit)
4. `CHANGELOG.md` exists and has non-empty `[Unreleased]` section

If any fails: report to user and abort. Do NOT try to fix automatically.

## Workflow

### Step 1 — Parse `[Unreleased]` section

Read `CHANGELOG.md`. Find the `## [Unreleased]` heading and capture everything until the next `## [` heading.

Collect subsections:
- `### Added`
- `### Changed`
- `### Fixed`
- `### Removed`
- `### Security`

Count entries in each. Empty `[Unreleased]` → **abort** with message: "No unreleased changes. Commits should add entries to CHANGELOG.md [Unreleased] before invoking /Mrelease."

### Step 2 — Determine bump level

If the user passed `major`, `minor`, or `patch` explicitly, use that.

Otherwise infer:

| Rule | → |
|---|---|
| Any entry contains `[BREAKING]` marker OR `### Removed` has entries | **major** |
| `### Added` has entries OR `### Changed` has substantive entries | **minor** |
| Only `### Fixed` or `### Security` entries | **patch** |

**Always confirm through the QE interaction adapter** before proceeding — present the inferred level + reasoning + the actual changelog content.

### Step 3 — Calculate new version

Read current version from `.claude-plugin/plugin.json`.

- **patch**: `X.Y.Z` → `X.Y.(Z+1)`
- **minor**: `X.Y.Z` → `X.(Y+1).0`
- **major**: `X.Y.Z` → `(X+1).0.0`

### Step 4 — Rewrite CHANGELOG.md

- Move everything under `## [Unreleased]` (excluding the heading itself) to a new section: `## [NEW_VERSION] - YYYY-MM-DD` (today's date, ISO format).
- Insert a fresh empty `## [Unreleased]` header with the 5 empty subsections at the top.
- Preserve all prior version sections below unchanged.

Template for fresh `[Unreleased]`:

```markdown
## [Unreleased]

### Added

### Changed

### Fixed

### Removed

### Security
```

### Step 5 — Bump version files

Set the Mbump skill-bypass flag (`.qe/state/skill-bypass.json` with `{active:true, skill:"Mbump", ts:<now>}`), then edit:
- `.claude-plugin/plugin.json` — `"version"` field
- `package.json` — `"version"` field
- `.claude-plugin/marketplace.json` — `"version"` field **inside the `qe-framework` entry** under `plugins[]` (nested, not top-level). This is the source the marketplace clone reads; skipping it makes the marketplace version drift behind the other two.

### Step 6 — Sync plugin cache

Find the plugin cache path in `~/.claude/plugins/installed_plugins.json`. The file's
top level is `{ "version": ..., "plugins": { ... } }` — the install records are nested
**under `plugins`**, NOT at the root. The full lookup path is:

```
installed_plugins.json → .plugins["qe-framework@inho-team-qe-framework"][0].installPath
```

Extract it safely (verify the structure first; do not assume the key sits at the root):
```bash
CACHE="$(python3 -c "import json;print(json.load(open('$HOME/.claude/plugins/installed_plugins.json'))['plugins']['qe-framework@inho-team-qe-framework'][0]['installPath'])")"
```

> ⚠️ **MANDATORY destination guard — never skip (see MISTAKE M002).** A bad/empty
> `installPath` extraction makes `"$CACHE/"` expand to `/`, and `rsync --delete ./ /`
> then tries to mirror your repo onto the filesystem root. Validate the destination
> with all three checks and **abort** if any fails — never run the rsync with an
> unvalidated variable:

```bash
set -euo pipefail
PREFIX="$HOME/.claude/plugins/cache/inho-team-qe-framework/"
[ -n "$CACHE" ]                || { echo "ABORT: empty cache path"; exit 1; }
[[ "$CACHE" == "$PREFIX"* ]]   || { echo "ABORT: cache path outside expected prefix: $CACHE"; exit 1; }
[ -d "$CACHE" ]                || { echo "ABORT: cache path is not a directory: $CACHE"; exit 1; }

rsync -a --delete --exclude='.git/' "{repo_root}/" "$CACHE/"
```

Update `installed_plugins.json` — set the nested entry's `version` to the new version
and `gitCommitSha` to `null` (updated post-commit in step 7).

### Step 7 — Commit via Ecommit-executor

Delegate to `Ecommit-executor` agent. Message: `chore: release v{NEW_VERSION}`

Files staged: `CHANGELOG.md`, `.claude-plugin/plugin.json`, `package.json`, `.claude-plugin/marketplace.json`.

After commit, update `installed_plugins.json` with the actual commit SHA.

### Step 8 — Create annotated tag

```bash
git tag -a v{NEW_VERSION} -m "{one-line summary extracted from CHANGELOG section}" {commit_sha}
```

Tag message: first non-empty line of the new version's CHANGELOG section, or `Release v{NEW_VERSION}` if no clear summary.

### Step 9 — User confirmations (two questions via the interaction adapter)

**Q1 — Push?**
- Push `main` + `v{NEW_VERSION}` tag to `origin`
- Skip push (stays local)

**Q2 — GitHub Release? (only if push was selected)**
- Create via `gh release create v{NEW_VERSION} --notes-file <temp file with CHANGELOG section>`
- Skip (tag only)

### Step 10 — Report

```
## Released v{NEW_VERSION}

- CHANGELOG section: {entry count summary}
- Commit: {sha}
- Tag: v{NEW_VERSION}
- Pushed: yes|no
- GitHub Release: created|skipped
- Plugin cache: synced — restart Claude Code to load new version
```

## Rules

### Language Matching
Report output language matches the user's input language. CHANGELOG itself stays English (international convention).

### Never
- Release from non-`main` branch
- Release with dirty working tree
- Release with empty `[Unreleased]`
- Skip user confirmation for push or GitHub Release
- Auto-infer bump level as `major` without confirmation (always ask)

### Always
- Use `Ecommit-executor` for the bump commit (direct `git commit` is blocked; the bypass is only for plugin.json/package.json edits)
- Include the CHANGELOG section body in the tag annotation
- Sync plugin cache so users who install via plugin registry get the new version immediately

## Will
- Cut a clean, documented release from accumulated changelog entries
- Enforce the release-train pattern

## Will Not
- Add new CHANGELOG entries (that's a commit-time responsibility of every PR/change)
- Override semver rules (bump level reflects content)
- Release without user explicit confirmation at Q1 and Q2
