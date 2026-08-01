---
name: Qrelease
user_invocable: false
description: Creates a QE Framework version bump, changelog entry, release commit, annotated tag, optional push, and optional GitHub Release. Use for release, bump, tag, or publish requests; use Qversion for read-only version inspection.
invocation_trigger: When the user asks to bump, tag, publish, or release QE Framework.
recommendedModel: haiku
tier: core
---

> **`.qe` reads → DB:** `.qe/` content is stored in the SQLite store (`qe_files`), so a path may have **no file on disk**. Read `.qe/` content with `node scripts/qe-cat.mjs <path>` (or `--ls`/`--exists`) and structured state with `node scripts/qe-query.mjs …` — do not assume the raw file exists. See `QE_CONVENTIONS.md`.

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

### 4. Use the hook-owned release bypass (do NOT write skill-bypass.json)

The protected capability is `qe-release-version`. As of the defect-4 hardening the
hook **issues this capability itself** in unified-state the moment the `Qrelease`
skill is entered (`source: "skill-entry-hook"`), and **every tool write to
`.qe/state/skill-bypass.json` is hard-blocked** — do NOT create, rewrite, or
delete that file. Forging it is impossible through the tool layer.

The hook-owned flag authorizes the release stages below within a single
120-second TTL from skill entry and is retained across the version write →
changelog → commit → tag sequence. If the sequence cannot finish within 120s,
stop and run the failure procedure, then re-enter the `Qrelease` skill to reissue
a fresh flag; never attempt to write or extend the flag by hand.

Execute these four exact, separate Bash tool inputs in order:

```bash
tee .claude-plugin/plugin.json < .qe/state/qrelease.lock/plugin.json.next >/dev/null # qe-release-version plugin version write
```

The trailing comment is retained for readability; the hook's plugin-write guard engages on the manifest sink regardless, and the write is authorized by the hook-owned `qe-release-version` capability issued at skill entry (no per-stage rebinding).

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

Confirm `git rev-list -n 1 vX.Y.Z` equals `RELEASE_COMMIT`. The hook-owned bypass self-expires with its 120s TTL — there is no `skill-bypass.json` to delete (and writing/deleting it is blocked). Tag and changelog commands are not independently blocked by the hook; the retained hook-owned capability covers the whole four-stage sequence within one TTL window.

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

On any failure, stop invoking release stages and let the hook-owned bypass lapse with its 120s TTL (there is no `skill-bypass.json` to remove — writing/deleting it is blocked). Preserve `owner.json` until recovery is verified.

- Before the release commit: because preflight required a clean tree, restore only the release-owned tracked files with `git restore -- package.json .claude-plugin/plugin.json CHANGELOG.md` and inspect `git status --short`.
- After the local tag: delete it with `git tag -d vX.Y.Z`.
- After a GitHub Release exists: after explicit confirmation, delete it with `gh release delete vX.Y.Z --yes`.
- After the tag was pushed: after separate explicit confirmation, delete the remote tag with `git push origin :refs/tags/vX.Y.Z`; verify absence with `git ls-remote --exit-code --tags origin refs/tags/vX.Y.Z` (exit 2 expected).
- After the release commit: do not rewrite shared history. Create a rollback commit with `git revert --no-edit RELEASE_COMMIT`. If the release commit was pushed, ask explicitly before `git push origin HEAD` for the revert.
- Always confirm `git tag --list vX.Y.Z` is empty locally, the remote tag is absent when deletion was requested, package/plugin versions match the intended rollback version, and `git status --short` contains no unexplained changes. Then remove the lock files individually and `rmdir` the lock.

Never force-push, move an existing tag, delete another release's lock, or continue after a version/tag mismatch.
