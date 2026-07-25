---
name: Qrelease
user_invocable: false
description: Creates a QE Framework version bump, changelog entry, release commit, annotated tag, optional push, and optional GitHub Release. Use for release, bump, tag, or publish requests; use Qversion for read-only version inspection.
invocation_trigger: When the user asks to bump, tag, publish, or release QE Framework.
recommendedModel: haiku
tier: core
---

# Qrelease — Release Orchestrator

## Role

`Qrelease` is the only skill allowed to mutate QE Framework version or release state. `Qversion` is read-only: it may inspect and print `.claude-plugin/plugin.json` version, but it must never edit a version, changelog, commit, tag, or release.

## Input Contract

Require exactly one bump input: `major`, `minor`, `patch`, or an exact stable SemVer `X.Y.Z`. Also record whether the user requested `push` and `GitHub Release`; both default to false. Reject prerelease/build suffixes, missing input, multiple bump inputs, and versions that are not greater than the current version.

Use `origin` as the remote only after confirming `git remote get-url origin`. Use annotated tags named exactly `vX.Y.Z`. Never reuse, move, or force-update a release tag.

## Procedure

### 1. Inspect and compute without writing

1. Invoke `Qversion`, then independently read both version files:

   ```bash
   node -e 'const fs=require("fs");for(const f of ["package.json",".claude-plugin/plugin.json"]){console.log(f,JSON.parse(fs.readFileSync(f,"utf8")).version)}'
   ```

   Abort if the two values differ. Do not repair an unexplained mismatch during a release.

2. Resolve `major`, `minor`, or `patch` from the current version using SemVer arithmetic; an exact `X.Y.Z` is used as supplied. Validate the result with this command, passing the resolved value as its only argument:

   ```bash
   node -e 'const v=process.argv[1];if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))process.exit(1)' X.Y.Z
   ```

   Here and below, replace `X.Y.Z` with the validated value from this run. Compare numeric major/minor/patch tuples and abort unless the target is strictly greater than the current version.

3. Verify repository and remote state:

   ```bash
   git status --porcelain
   git branch --show-current
   git remote get-url origin
   git fetch --tags origin
   git tag --list 'vX.Y.Z'
   git ls-remote --exit-code --tags origin 'refs/tags/vX.Y.Z'
   ```

   The status output must be empty. Abort on a detached HEAD, a missing `origin`, any local tag output, or exit 0 from `git ls-remote` (remote tag exists). Exit 2 from `git ls-remote` means no matching remote tag and is expected.

4. Acquire the process-local release lock atomically:

   ```bash
   mkdir .qe/state/qrelease.lock
   ```

   If `mkdir` fails because the directory exists, stop. Read `.qe/state/qrelease.lock/owner.json`; if its PID is alive (`kill -0 PID`), another release owns the lock. If the PID is dead, show the owner data and require explicit user confirmation before removing that stale lock and retrying `mkdir`. Never run two Qrelease executions concurrently.

5. Write `.qe/state/qrelease.lock/owner.json` with the Write tool, containing the current PID, repository absolute path, starting `git rev-parse HEAD`, current version, target version, tag, and UTC start time. This file is the rollback record.

### 2. Dry run gate

Before changing tracked files, print all of the following:

- current version and target `X.Y.Z`;
- tag `vX.Y.Z` and current branch;
- the exact new `CHANGELOG.md` release heading and entries;
- planned tracked files (`package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`, plus files changed by `npm run sync:metadata`);
- whether push and GitHub Release are requested.

Run `npm run sync:metadata` only against a temporary copy or use `git diff --no-index` to preview its expected output; do not alter the working tree during dry-run. Ask the user to approve the displayed dry run. On rejection, delete only `.qe/state/qrelease.lock` and stop.

### 3. Prepare validated next files

1. Create `.qe/state/qrelease.lock/package.json.next` and `.qe/state/qrelease.lock/plugin.json.next` from the current JSON with the version set to `X.Y.Z`. Use a Node command whose output targets the lock directory, never the live input file. Parse both generated files again and require both versions to equal `X.Y.Z`.

2. Create `.qe/state/qrelease.lock/CHANGELOG.next` with the Write tool. Move the current unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, preserve all historical sections byte-for-byte, and create a fresh empty `Unreleased` section if the changelog convention uses one. Abort if the new release section is empty or its heading/version/date is wrong. Review it with:

   ```bash
   git diff --no-index -- CHANGELOG.md .qe/state/qrelease.lock/CHANGELOG.next
   ```

3. Apply the canonical package version first:

   ```bash
   tee package.json < .qe/state/qrelease.lock/package.json.next >/dev/null
   ```

### 4. Use the hook bypass exactly as implemented

The protected capability is `qe-release-version`. Its file is `.qe/state/skill-bypass.json`. The capability always requires a non-empty `command` that trim-matches the complete next Bash tool input exactly. A missing, empty, non-string, mismatched, unrelated, or expired binding grants no bypass.

Immediately before the protected plugin write, record `issuedAt = Date.now()` once. Before every release stage below, replace `.qe/state/skill-bypass.json` with the Write tool using this shape:

```json
{"active":true,"skill":"qe-release-version","ts":ISSUED_AT_NUMBER,"command":"EXACT_NEXT_BASH_TOOL_INPUT"}
```

`ISSUED_AT_NUMBER` is the same numeric first timestamp at every stage; never refresh it. JSON-escape the exact command string. The hook retains this release-capability flag after a successful stage, and Qrelease rewrites only its `command` for the next stage. The entire version write → changelog → commit → tag sequence must finish within 120 seconds of that original timestamp. Before each stage, if `Date.now() - issuedAt >= 120000`, stop, remove the bypass file, and run the failure procedure; do not open a new TTL window mid-release.

Rebind and execute these four exact, separate Bash tool inputs in order:

```bash
tee .claude-plugin/plugin.json < .qe/state/qrelease.lock/plugin.json.next >/dev/null # qe-release-version plugin version write
```

The trailing comment is mandatory: it keeps the word `version` in the raw command, so the hook's plugin-write guard engages and this write is authorized only through the bound `qe-release-version` flag instead of slipping past an idle guard. A forgotten or mismatched rebind therefore hard-blocks here, before any protected file changes.

```bash
tee CHANGELOG.md < .qe/state/qrelease.lock/CHANGELOG.next >/dev/null
```

After those two writes, run `npm run sync:metadata`, inspect every changed file, and verify:

```bash
node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync("package.json","utf8")).version;const b=JSON.parse(fs.readFileSync(".claude-plugin/plugin.json","utf8")).version;if(a!==b||a!=="X.Y.Z")process.exit(1);console.log(a)'
git diff --check
npm run qe:validate
```

Abort before commit on any mismatch or failed validation. Then rebind the exact release commit command and run it as the third stage:

```bash
git commit -m "chore(release): vX.Y.Z"
```

Record `RELEASE_COMMIT=$(git rev-parse HEAD)` in the lock owner record, confirm the commit contains the version files and changelog, then repeat the local and remote tag collision checks. Rebind and run the fourth stage:

```bash
git tag -a vX.Y.Z -m "QE Framework vX.Y.Z" "$RELEASE_COMMIT"
```

Confirm `git rev-list -n 1 vX.Y.Z` equals `RELEASE_COMMIT`, then delete `.qe/state/skill-bypass.json`. Tag and changelog commands are not independently blocked by the current hook, but rebinding all four stages keeps the retained flag bound to one exact command at every point and matches the implemented multi-step release protocol.

### 5. First cut-over release only

An installed cached hook from before `qe-release-version` may still recognize only the retired admin capability, so the first release that deploys the new hook can deadlock. Detect this by a block message that does not name `Qrelease`/`qe-release-version`. Stop and ask for explicit approval to set `.qe/config.json` `hooks.hook_profile` to `minimal` for this cut-over only. Back up the file inside `qrelease.lock`, make the same validated version/changelog/commit/tag sequence, and restore the exact backup immediately after the local tag is created or on any failure. Do not use the retired capability and do not leave `minimal` enabled. Confirm the installed hook now names `Qrelease` before any later release.

### 6. Optional remote publication

Local commit and tag creation do not authorize a remote mutation.

1. Show `git log -1 --oneline`, `git show --stat vX.Y.Z`, and `git remote get-url origin`. Ask: "Push the release commit and annotated tag vX.Y.Z to origin?" Only an explicit yes permits:

   ```bash
   git push origin HEAD
   git push origin refs/tags/vX.Y.Z
   ```

2. If GitHub Release was requested, show the final release notes and ask separately: "Create GitHub Release vX.Y.Z from these notes?" Only an explicit yes permits:

   ```bash
   gh release create vX.Y.Z --verify-tag --title "QE Framework vX.Y.Z" --notes-file .qe/state/qrelease.lock/release-notes.md
   ```

3. Verify `git ls-remote --tags origin refs/tags/vX.Y.Z` and, when created, `gh release view vX.Y.Z`. Remove the lock only after verification:

   ```bash
   rm .qe/state/qrelease.lock/owner.json .qe/state/qrelease.lock/package.json.next .qe/state/qrelease.lock/plugin.json.next .qe/state/qrelease.lock/CHANGELOG.next .qe/state/qrelease.lock/release-notes.md
   rmdir .qe/state/qrelease.lock
   ```

   Omit nonexistent optional files from the `rm` arguments; never use recursive deletion.

## Failure and Rollback

On any failure, remove `.qe/state/skill-bypass.json` first and preserve `owner.json` until recovery is verified.

- Before the release commit: because preflight required a clean tree, restore only the release-owned tracked files with `git restore -- package.json .claude-plugin/plugin.json CHANGELOG.md` and inspect `git status --short`.
- After the local tag: delete it with `git tag -d vX.Y.Z`.
- After a GitHub Release exists: after explicit confirmation, delete it with `gh release delete vX.Y.Z --yes`.
- After the tag was pushed: after separate explicit confirmation, delete the remote tag with `git push origin :refs/tags/vX.Y.Z`; verify absence with `git ls-remote --exit-code --tags origin refs/tags/vX.Y.Z` (exit 2 expected).
- After the release commit: do not rewrite shared history. Create a rollback commit with `git revert --no-edit RELEASE_COMMIT`. If the release commit was pushed, ask explicitly before `git push origin HEAD` for the revert.
- Always confirm `git tag --list vX.Y.Z` is empty locally, the remote tag is absent when deletion was requested, package/plugin versions match the intended rollback version, and `git status --short` contains no unexplained changes. Then remove the lock files individually and `rmdir` the lock.

Never force-push, move an existing tag, delete another release's lock, or continue after a version/tag mismatch.
