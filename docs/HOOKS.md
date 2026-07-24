# QE Framework — Hooks Reference & Safety Policy

QE registers lifecycle behavior through the active client adapter. Claude uses
Claude Code plugin hooks; Codex uses installed hook fences, wrapper scripts, and
command proxies where the Codex runtime exposes an equivalent surface. The
generic lifecycle contract lives in `core/LIFECYCLE_ADAPTER.md`; interaction
and command-prefix behavior lives in `core/INTERACTION_ADAPTER.md`. Phase 4
public-doc parity evidence is recorded in
`.qe/planning/plans/claude-codex-generalization/phases/4/PARITY_VERIFICATION_REPORT.md`.

## Claude Adapter: Registered Hooks

| Event | Matcher | Script | Timeout | Can block? |
|-------|---------|--------|--------:|-----------|
| SessionStart | — | `session-start.mjs` | 10s | no |
| PreToolUse | `*` | `pre-tool-use.mjs` | 5s | **yes** (exit 2) |
| PreCompact | — | `pre-compact.mjs` | 10s | no |
| PostToolUse | `Write\|Edit\|Bash` | `post-tool-use.mjs` | 15s | no (hints only) |
| Stop | — | `stop-handler.mjs` | 5s | yes (reinforcement) |
| UserPromptSubmit | — | `prompt-check.mjs` | 8s | no |
| Notification | — | `notification.mjs` | 5s | no |
| TeammateIdle | — | `teammate-idle.mjs` | 10s | no |
| TaskCompleted | — | `task-completed.mjs` | 10s | no |

## Environment variables

| Variable | Effect |
|----------|--------|
| `QE_NO_TRANSLATE=1` | Disables the non-English prompt translation call in `prompt-check.mjs`. By default, a non-English (CJK) prompt is sent to the Anthropic Messages API (Haiku) to extract English routing keywords, using the same OAuth token and endpoint the conversation already uses. Set this to opt out of that extra network call; intent routing then falls back to literal English-keyword matching only. |

## Codex Adapter: Compatibility Contract

`hooks/hooks.json` defines the Claude-side lifecycle contract. Codex receives the
same QE safety and routing contract through Codex-native assets installed under
`~/.codex`: skills in `~/.codex/skills`, agents in `~/.codex/agents`, scripts in
`~/.codex/scripts`, plus managed native hook entries in `~/.codex/config.toml`
pointing at the installed QE hook bundle.

After installing or refreshing the Codex assets, run `/hooks` in Codex once and
explicitly trust the QE hook bundle. Do not rely on hook-trust bypass as a normal
workflow; the supported path is explicit trust review.

| Event | Codex implementation | Codex-side behavior |
|-------|----------------------|---------------------|
| PreToolUse | native hook + Codex wrapper | Runs the QE safety/context guard through `hooks/scripts/codex/lifecycle-codex.mjs`. |
| SessionStart | native hook + Codex wrapper | Runs QE bootstrap context and client-prefix reminders when Codex emits the event. |
| UserPromptSubmit | native hook + interaction adapter | Runs prompt routing when Codex emits the event; skills still use the interaction adapter for client-neutral choices. |
| PostToolUse | native hook + Codex wrapper | Runs memo/lint/build-lock/security follow-up checks for tool outputs. |
| PreCompact | native hook + Codex wrapper | Runs QE compaction handoff rules where Codex exposes the event. |
| Stop | native hook + Codex wrapper | Runs stop-time verification, sweep, style, and persistence checks. |
| Notification | native hook + Codex wrapper | Runs configured notification handling where available. |
| TeammateIdle | native hook + Codex wrapper | Runs teammate idle handling where available. |
| TaskCompleted | native hook + Codex wrapper | Runs completion-state maintenance where available. |

Codex hook block messages render Codex-native skill commands with the `$`
prefix, for example `$Qcommit`. Version/release mutation blocks route to
`$Qrelease`; read-only version lookup routes to `$Qversion`. Claude hook block
messages keep the Claude slash-command prefix for core skills.

The Codex lifecycle wrapper forwards the original hook payload to the shared QE
hook script, sets `QE_CLIENT=codex`, and rewrites slash-command hints (`/Q...`)
to Codex commands (`$Q...`) in stdout/stderr. If a Codex runtime version does not
emit a particular lifecycle event, the corresponding entry is inert; the fallback
is the installed skill/state/interaction-adapter contract, not a narrower hook
surface.

Runtime status is surfaced inside the session through SessionStart context and
hook messages, so Claude and Codex share the same visible guidance path.

## Safety-Critical Parity

The following behavior must stay equivalent across Claude and Codex:

1. Raw commit and raw PR creation are routed to QE skills.
2. Direct version edits are routed to the client-native `Qrelease` command.
3. Dangerous autonomous-mode actions are blocked before execution.
4. Hook failures fail open unless an intentional policy block is emitted.
5. User-facing QE command hints render with the active client prefix.

Non-safety lifecycle events can be `wrapper`, `proxy`, `shim`, or
`unsupported`, but the docs must state that status explicitly.

## Why PreToolUse matcher stays `*` (not narrowed)

It is tempting to narrow `PreToolUse` to `Bash|Write|Edit` so it only runs before
"dangerous" tools. **We deliberately do not.** The matcher is load-bearing:

- **ContextMemo dedup** (`pre-tool-use.mjs`) hard-blocks redundant `Read`s of files
  already in context — a core token-saving feature. It only fires on `Read`.
- **Analysis hints** fire on `Glob`/`Grep`/`Read`.
- **SIVS option guard** fires on the Claude `AskUserQuestion` adapter surface; delegation/routing guards fire on `Agent`.

Narrowing the matcher to write-tools would silently disable all of the above. The
correct fix for over-blocking is **precise block rules + fail-open**, not a narrower
matcher. The block rules themselves are scoped to the tool they apply to (e.g. the
`git commit`/version-write guards only inspect `Bash`).

## Fail-open policy

A hook must never wedge a session because of its own bug. Both
`pre-tool-use.mjs` and `post-tool-use.mjs` register:

```js
process.on('uncaughtException', failOpen);   // failOpen → continue:true, exit 0
process.on('unhandledRejection', failOpen);
```

So an unexpected error → the tool call is **allowed**. Intentional hard-blocks are
the only exception: they go through `emitBlock()` → `process.exit(2)`, which is not a
thrown error and therefore bypasses the safety net by design.

## Block rules (PreToolUse) and how to bypass

| Trigger | Routed to | Notes |
|---------|-----------|-------|
| `git commit ...` (Bash) | Claude `/Qcommit`, Codex `$Qcommit` | raw commit blocked |
| **write sink** into `plugin.json` + `version` (Bash) | Claude `/Qrelease`, Codex `$Qrelease` | redirect (`> plugin.json`), `tee`, or `dd of=` — not reads like `grep version plugin.json`. cp/mv and interpreter writes are not shell-detectable; the Edit rule below covers the normal path |
| `sed`/`perl`/`ruby -i` / `--in-place` (Bash) | Edit tool | use the Edit tool |
| Edit of `plugin.json` whose new text has `"version"` | Claude `/Qrelease`, Codex `$Qrelease` | version mutation is release-owned; use `Qversion` only for read-only lookup |

Before each protected release stage, `Qrelease` rewrites `.qe/state/skill-bypass.json` with
the exact next Bash input bound in `command`:

```json
{"active":true,"skill":"qe-release-version","ts":ISSUED_AT_NUMBER,"command":"EXACT_NEXT_BASH_TOOL_INPUT"}
```

The original numeric `ts` is retained across stages and remains valid for 120 seconds;
a missing, empty, or mismatched `command` grants no bypass.

## hook_profile — dialing down enforcement

`.qe/config.json`:

```json
{ "hooks": { "hook_profile": "minimal" } }
```

| Profile | PreToolUse override blocks | ContextMemo / hints |
|---------|----------------------------|---------------------|
| `minimal` | downgraded to **soft hints** (nothing hard-blocks) | unchanged |
| `safe` (default) | enforced (exit 2) | unchanged |
| `full` | enforced; reserved for future stricter policy | unchanged |

`minimal` is the escape hatch when a guard misfires or you want a friction-free
session — you still see a hint, but the tool call proceeds. **Note: `minimal` is
all-or-nothing** — it downgrades *every* override block (git commit, gh pr, version,
in-place edit) at once. There is no per-rule granularity yet; for a one-off bypass of
a single rule, prefer `.qe/state/skill-bypass.json` instead.

## Utopia safety rails

When autonomous mode (`/Qexecute -utopia` on Claude, `$Qexecute -utopia` on Codex) is active (`.qe/state/utopia-state.json` →
`enabled: true`), the PreToolUse hook calls `hooks/scripts/lib/utopia-guard.mjs` and
**hard-blocks** irreversible / high-blast-radius actions before they run:

| Category | Blocked |
|----------|---------|
| Remote push | `git push`, `git push --force` |
| Destructive git | `reset --hard`, `clean -f`, `checkout/restore .`, `branch -D`, `stash drop/clear` |
| Destructive shell | `rm -r`, redirect-clobber (`> file`), `find -delete`, `truncate`, `dd of=` |
| Sensitive files (Write/Edit) | `.env`, `migrations/`, `*.tf`, `Dockerfile`, `secrets/`, `*.pem`/`*.key`, k8s manifests |
| Protected branch | modifying non-`.qe/` files on `main`/`master` |

**Inert when Utopia is off** — a normal session is never affected (verified by
`scripts/check-utopia-guard.mjs`, which asserts active→block, inactive→pass).
The rail call is wrapped in try/catch, so a guard error fails open.

**Escape hatch:** `allowUnsafe: true` in `.qe/state/utopia-state.json` disables every
rail. Dangerous — never use in a shared/company repo. The Qexecute -utopia Enable flow also
requires a clean tree, refuses protected branches (auto-creates a `utopia/<ts>` sandbox
branch), prints a scope summary up front, and a diff report + rollback command after.

## False-positive regression guard

`scripts/check-hook-falsepositive.mjs` (run by `npm run check:all`) drives the real
hooks and asserts both that the known false positives stay fixed (read-only commands
mentioning `plugin.json`+`version`; markdown containing "secret"/"token") **and** that
the guard is not weakened (raw `git commit`, version writes, and security keywords in
code files are still caught). Edit a block rule and this guard tells you immediately if
you opened a hole.
