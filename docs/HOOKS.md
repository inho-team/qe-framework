# QE Framework — Hooks Reference & Safety Policy

QE registers nine Claude Code lifecycle hooks. This document is the contract for
what they do, how they fail, and how to dial down their intervention.

## Registered hooks

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

## Codex hook parity

`hooks/hooks.json` defines the Claude-side lifecycle contract. Codex parity is
documented conservatively here: only `PreToolUse` is treated as a native Codex
hook with hard safety semantics. The rest are shims, no-ops, or explicit
future-research gaps.

After installing or refreshing the Codex assets, run `/hooks` in Codex once and
explicitly trust the QE hook bundle. Do not document or rely on hook-trust
bypass as a normal workflow; the supported path is explicit trust review.

| Event | Codex parity class | Codex-side description |
|-------|--------------------|------------------------|
| PreToolUse | native-supported | Native Codex `PreToolUse` hard safety hook. The installer matches `Bash`, `Shell`, `shell`, and `exec_command`; trust must be granted before the hook bundle is active. |
| SessionStart | shim | `AGENTS.md` / startup-instruction shim. Use it for once-per-run bootstrap text, not as a claim of exact lifecycle parity. |
| UserPromptSubmit | shim | Prompt/instruction shim for routing and hints. This is not exact Codex event parity. |
| PostToolUse | shim | Post-tool observation shim. Use follow-up instructions or hints after tool completion. |
| PreCompact | future-research | No exact Codex parity is documented in this repo yet. Treat it as a future investigation item. |
| Stop | shim | Stop/persistence shim driven by instructions or session state, not a guaranteed native stop event. |
| Notification | shim | Notification shim. Use native alerts or `notify` integration when available; otherwise it can degrade to no-op. |
| TeammateIdle | unsupported-noop | No exact Codex parity today. Use polling only if a workflow needs periodic follow-up; otherwise leave it as no-op. |
| TaskCompleted | unsupported-noop | No exact Codex parity today. Use polling or completion-state checks; do not present it as native event support. |

Codex hook block messages render Codex-native skill commands with the `$`
prefix, for example `$Qcommit`, `$Qbranch`, and `$Mbump`. Claude hook block
messages keep the Claude slash-command prefix.

Codex HUD support is intentionally **not** documented as hook parity. Codex has
no native `statusLine` hook equivalent here; QE installs `~/.codex/scripts/qe-hud.mjs`
as a command proxy that renders the same HUD from project state for manual,
shell-prompt, or tmux-status use.

## Why PreToolUse matcher stays `*` (not narrowed)

It is tempting to narrow `PreToolUse` to `Bash|Write|Edit` so it only runs before
"dangerous" tools. **We deliberately do not.** The matcher is load-bearing:

- **ContextMemo dedup** (`pre-tool-use.mjs`) hard-blocks redundant `Read`s of files
  already in context — a core token-saving feature. It only fires on `Read`.
- **Analysis hints** fire on `Glob`/`Grep`/`Read`.
- **SIVS option guard** fires on `AskUserQuestion`; delegation/routing guards fire on `Agent`.

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
| `git commit …` (Bash) | `/Qcommit` | raw commit blocked |
| `gh pr create …` (Bash) | `/Qbranch` | raw PR creation blocked |
| **write sink** into `plugin.json` + `version` (Bash) | `/Mbump` | redirect (`> plugin.json`), `tee`, or `dd of=` — not reads like `grep version plugin.json`. cp/mv and interpreter writes are not shell-detectable; the Edit rule below covers the normal path |
| `sed`/`perl`/`ruby -i` / `--in-place` (Bash) | Edit tool | use the Edit tool |
| Edit of `plugin.json` whose new text has `"version"` | `/Mbump` | version field is Mbump-owned |

Per-call bypass: write `.qe/state/skill-bypass.json` `{ "active": true, "skill": "Mbump", "ts": <now> }`
(valid 60s). The matching skill sets this automatically when it legitimately needs the action.

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

When autonomous mode (`/Qutopia`) is active (`.qe/state/utopia-state.json` →
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
rail. Dangerous — never use in a shared/company repo. The `/Qutopia` Enable flow also
requires a clean tree, refuses protected branches (auto-creates a `utopia/<ts>` sandbox
branch), prints a scope summary up front, and a diff report + rollback command after.

## False-positive regression guard

`scripts/check-hook-falsepositive.mjs` (run by `npm run check:all`) drives the real
hooks and asserts both that the known false positives stay fixed (read-only commands
mentioning `plugin.json`+`version`; markdown containing "secret"/"token") **and** that
the guard is not weakened (raw `git commit`, version writes, and security keywords in
code files are still caught). Edit a block rule and this guard tells you immediately if
you opened a hole.
