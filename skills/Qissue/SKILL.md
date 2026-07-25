---
name: Qissue
description: File GitHub issues against the qe-framework repo from the CLI. Use for requests like "file a bug", "report an issue", "feature request", "이슈 올려줘", or "버그 리포트". Onboards first-time users with a one-time PAT prompt, then delegates to the `gh` CLI. Default target: `inho-team/qe-framework`.
user_invocable: false
invocation_trigger: When the user wants to submit a bug report, feature request, or question to the qe-framework repository (or another repo via `--repo owner/name`).
recommendedModel: haiku
---

# Qissue — File GitHub Issues from the CLI

## Role
Let qe-framework users open GitHub issues without leaving the terminal. The skill wraps the `gh` CLI, handles one-time token onboarding via `gh auth login --with-token`, and drives issue creation through the QE interaction adapter. No custom token storage, no HTTP client — the skill delegates entirely to `gh`.

> **MANDATORY:** All user confirmations MUST use the QE interaction adapter. Claude uses `AskUserQuestion`; Codex uses equivalent concise choices.
> **NEVER** echo the raw PAT into the terminal, log files, or any committed artifact.

## Defaults

| Setting | Value | Override |
|---------|-------|----------|
| Target repository | `inho-team/qe-framework` | `/Qissue --repo owner/name` |
| Required PAT scope (public repo) | `public_repo` | `repo` when `--repo` points to a private repo |
| Issue types | `bug` / `feature` / `question` | Fixed — maps to same-name labels |

## Pre-check (always run first)

**Step 0.1 — `gh` installed?**
```bash
command -v gh >/dev/null 2>&1
```
If missing, print the install guide for the user's platform and **stop** (do not attempt auto-install):
- macOS: `brew install gh`
- Linux (Debian/Ubuntu): follow https://github.com/cli/cli/blob/trunk/docs/install_linux.md
- Windows: `winget install --id GitHub.cli` or `scoop install gh`

After the user installs `gh`, ask them to re-run `/Qissue`.

**Step 0.2 — `gh` authenticated?**
```bash
gh auth status 2>&1
```
- Exit 0 → authenticated, skip onboarding, jump to Step 2.
- Non-zero → run Step 1 (PAT onboarding).

## Step 1: One-time PAT onboarding

**Step 1.1 — Surface the token-creation link up-front.** Before asking for the token, always print the two pre-filled creation URLs so a user without a PAT can click straight through:

- **Classic token (recommended, one-click scope):**
  `https://github.com/settings/tokens/new?scopes=public_repo&description=QE%20Framework%20%2FQissue`
  (For a private repo via `--repo`, swap `scopes=public_repo` → `scopes=repo`.)
- **Fine-grained token (newer, per-repo):**
  `https://github.com/settings/personal-access-tokens/new`
  Select repository `inho-team/qe-framework` (or your target) and grant **Issues: Read and write**.

Then use the interaction adapter with two options — include the classic URL in the question description so the user can open it directly from the prompt:

- **"I have a PAT ready"** → jump to Step 1.2.
- **"Open the token page for me"** → restate the classic URL as the primary action, remind the user to pick **`public_repo`** (or **`repo`** for private targets), then re-run `/Qissue` after copying the token.

Scope recap:
- Public target (default `inho-team/qe-framework`): **`public_repo`**.
- Private target (via `--repo`): **`repo`**.

**Step 1.2 — Collect the PAT securely.** Use the interaction adapter with a single free-text question. Mark the question clearly so the user knows the value will be piped, not saved in the repo.

> When reading the user's answer, do **not** echo it back, do **not** write it to any file in the project, do **not** include it in log output. Treat the value as write-only into `gh auth login --with-token`.

**Step 1.3 — Authenticate.** Pipe the token to `gh` via stdin in a single isolated subshell. Never pass the token on the command line, never `export` it, and always `unset` it before the command returns.

```bash
(
  PAT="<value from interaction adapter, passed in at invocation time only>"
  printf '%s' "$PAT" | gh auth login --with-token
  unset PAT
)
```

Hard rules for the runtime:
- Do **not** set `PAT` on the `gh` command line (leaks via `ps`, `/proc/<pid>/cmdline`, shell job control).
- Do **not** `export PAT` — that propagates it to every child process for the rest of the session.
- Do **not** write the value to a heredoc file, temp file, or log.
- Keep the assignment in a subshell `( … )` so the variable cannot survive into the parent shell or later commands.
- Shell history is not a concern because this block is executed by Claude Code, not typed interactively.

**Step 1.4 — Verify.**
```bash
gh auth status
```
On failure (bad token, wrong scopes, network), surface the `gh` error message verbatim and ask the user whether to retry with a new token or abort.

## Step 2: Compose the issue

**Step 2.1 — Pick an issue type.** Use the interaction adapter with three options:

| Label | Description |
|-------|-------------|
| `bug` | Something doesn't work as documented |
| `feature` | Request for a new capability |
| `question` | Usage question or clarification |

**Step 2.2 — Title.** Ask for a short title (under ~80 chars). Do not prepend `[Bug]` / `[Feature]` — the label handles categorization.

**Step 2.3 — Body.** Ask for the body. Suggest a template based on the type (the user may overwrite wholesale):

- `bug` → Reproduction steps, Expected, Actual, Logs (optional).
- `feature` → Problem, Proposed solution, Alternatives considered.
- `question` → Context, What you tried, What's unclear.

**Step 2.4 — Append environment metadata automatically.** Before submitting, append a fenced block to the body (do not ask the user). Gather values via:

```bash
QE_VERSION=$(cat plugin.json 2>/dev/null | grep -oE '"version"\s*:\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
NODE_VERSION=$(node --version 2>/dev/null || echo "n/a")
OS_INFO=$(uname -srm 2>/dev/null || echo "$OSTYPE")
```

Append:
```
---

**Environment**
- QE Framework: {QE_VERSION}
- OS: {OS_INFO}
- Node: {NODE_VERSION}

<sub>Submitted via QE Framework /Qissue</sub>
```

## Step 3: Submit

Default target repo is `inho-team/qe-framework`. If the invocation included `--repo owner/name`, validate the shape against `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` before using it; reject anything else and ask again via the interaction adapter.

```bash
gh issue create \
  --repo="${TARGET_REPO:-inho-team/qe-framework}" \
  --label="$TYPE" \
  --title="$TITLE" \
  --body="$BODY_WITH_METADATA"
```

**Shell-construction rules (mandatory).** `gh` does not re-shell its flag values, but the skill must never build the call via string interpolation that gives the shell a second pass:

- **Forbidden**: `bash -c "gh issue create --title $TITLE ..."`, `sh -c "..."`, `eval`, backtick/`$()` substitution of user input.
- **Required**: pass `$TITLE` / `$BODY_WITH_METADATA` as **direct shell variables** whose values came straight from the interaction adapter — no concatenation into a single command string.
- **Required**: use the `--flag="$VALUE"` form (with `=`) so the value is inline-bound to the flag even if it begins with `-`. Do **not** use `--flag -- "$VALUE"` — `gh` (Cobra) treats `--` as end-of-flags, and `gh issue create` does not accept positional args, so it fails with `unknown arguments`.
- **Required**: `$TARGET_REPO` is only ever the post-regex-validated literal above.

The command returns the new issue URL on stdout. Capture it and show it to the user as the final output:

```
Issue created: https://github.com/inho-team/qe-framework/issues/{N}
```

If `gh` returns an error, surface it verbatim and map common cases per the Troubleshooting table below.

## Will

- Use `gh` CLI exclusively for auth and issue creation.
- Use the interaction adapter for every user input (PAT, type, title, body, retries).
- Default target to `inho-team/qe-framework` and accept `--repo owner/name` override.
- Auto-append environment metadata (QE version, OS, Node) to every issue body.
- Print the created issue URL as the last line of output.

## Will Not

- Store the PAT anywhere in the project (`.qe/`, dotfiles, repo).
- `export` the PAT, place it on a command line, or let it survive the Step 1.3 subshell.
- Build the `gh` invocation through `bash -c`, `sh -c`, `eval`, or string concatenation of user input.
- Call the GitHub REST API directly or bundle an SDK — `gh` is the single source of truth.
- Echo, log, or commit the token value.
- Auto-install `gh` on the user's machine.
- Create custom labels — only `bug` / `feature` / `question` are submitted (the repo must have these labels configured, or `gh` will warn).
- Push to main, commit, or touch any source file outside the issue flow.

## Examples

```
User: "Qissue에 버그 리포트 올리고 싶어"
→ Qissue:
   1. gh 설치/인증 확인
   2. 미인증 시 PAT 입력 (interaction adapter, 1회성)
   3. 타입=bug 선택
   4. 제목 · 본문 수집
   5. 환경 정보 자동 첨부
   6. gh issue create 호출
   7. 생성된 이슈 URL 출력
```

```
User: "/Qissue --repo my-org/private-repo"
→ Qissue:
   - 대상 repo를 override
   - PAT scope 'repo' 필요 안내
   - 이후 플로우 동일
```

```
User: "feature request 올려줄래"
→ Qissue: 타입=feature 자동 선택, 나머지 플로우 동일
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `gh: command not found` | `gh` not installed | Show Step 0.1 install guide, stop |
| `You are not logged into any GitHub hosts` | Not authenticated | Run Step 1 onboarding |
| `HTTP 401: Bad credentials` | PAT revoked or expired | Re-run Step 1 with a new token |
| `HTTP 403: Resource not accessible by integration` | Scope insufficient | Public repo needs `public_repo`; private repo needs `repo` |
| `HTTP 404: Not Found` | Repo path wrong or PAT cannot see it | Verify `--repo owner/name`; for private repos, confirm PAT has `repo` |
| `could not add label: 'bug' not found` | Target repo missing the label | Ask the user to create the label in the repo settings, or retry without `--label` |
| `HTTP 403: API rate limit exceeded` | Unauthenticated or low-rate PAT | Wait for reset window shown in response, or use a PAT with higher quota |

## Role Constraints

- Only handles issue filing. Does not read, edit, or close existing issues — that is out of scope for this skill.
- Never modifies repository files other than appending content to `.qe/TASK_LOG.md` when invoked as part of a PSE chain (not in normal standalone use).
- If the user asks to file many issues at once, process them sequentially through the same flow — no batch or parallel filing.
