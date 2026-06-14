---
name: Qupdate
description: 'Updates QE Framework for Claude and Codex depending on how it was installed. Use for "update plugin", "upgrade", "update qe".'
allowed-tools: "Bash(claude plugin:*), Bash(npm:*), Bash(node:*), Bash(git fetch:*), Bash(git show:*), Bash(git pull:*)"
invocation_trigger: When framework initialization, maintenance, or audit is required.
recommendedModel: haiku
---

# Qupdate — Framework Self-Update

## Role
Updates QE Framework to the latest version using the correct path for the current installation method.

## Execution Procedure

### Step 0: Pre-flight — is the latest release actually reachable?
The tarball path below runs `git pull`, which only helps if the newest release was
pushed to `origin`. `Mrelease` makes the push step **optional**, so a freshly cut
release can live only in the local checkout (commit + tag present, `origin` behind).

Before choosing a path, check for an unpushed release:

```bash
git fetch origin --tags --quiet
LOCAL=$(node -p "require('./package.json').version" 2>/dev/null)
REMOTE=$(git show origin/main:package.json 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0)).version" 2>/dev/null)
echo "local=$LOCAL  origin=$REMOTE"
```

- If `local` is **ahead of** `origin` (release not pushed), `git pull` brings nothing —
  **skip the tarball path and use the repository-local install (path 2)** to sync the
  already-released local assets. Optionally remind the user that `git push origin main --tags`
  is still needed to publish the release.
- If `origin` is ahead or equal, the tarball path is safe.

### Step 1: Detect installation path
Choose exactly one of the following:

1. **Checked-out release tarball install**
   Preferred for both Claude and Codex **when the latest release is reachable on `origin`**
   (see Step 0). The tarball filename is derived from `package.json` — never hardcode a version.

   ```bash
   git pull
   VER=$(node -p "require('./package.json').version")
   npm pack --cache /tmp/qe-npm-cache
   npm install -g "./inho-team-qe-framework-${VER}.tgz"
   qe-framework-install
   ```

2. **Repository-local direct install**
   Use when the user is already in a QE checkout and wants to sync assets without rebuilding
   the global tarball — **also the correct fallback when Step 0 shows an unpushed local release**.

   ```bash
   node install.js
   ```

### Step 2: Preferred selection rule
- If Step 0 shows the local checkout is **ahead of** `origin` (unpushed release), prefer `node install.js`.
- Otherwise prefer the checked-out release tarball flow.
- If the user is already inside a QE repository checkout and only needs asset sync, prefer `node install.js`.
- Do not recommend `npm update -g @inho-team/qe-framework` unless the package is actually published to npm.

### Step 3: Report result
Report:
- which update path was used
- whether Claude assets were updated
- whether Codex assets were updated
- that Claude/Codex should be restarted if required

## Will
- Update QE Framework using the correct installer path
- Keep Claude and Codex installation targets in sync when the chosen path supports both
- Report the applied update path and next restart step

## Will Not
- Modify any project files
- Run without user invocation
