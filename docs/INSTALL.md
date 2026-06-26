# Installing & Removing QE Framework — Safely

QE's baseline install is the Claude Code plugin. The installer copies `skills/`,
`agents/`, `core/`, `hooks/`, and `scripts/` into your Claude config. When a
Codex home exists, QE also installs native Codex assets under `~/.codex`. This
page documents exactly what it touches and how to preview, back up, and roll
back.

## Where assets go

| Mode | Trigger | Destination |
|------|---------|-------------|
| **plugin** | qe-framework is registered in `~/.claude/plugins/installed_plugins.json` | the plugin cache dir + `~/.claude/scripts/` (absolute-path fallback) |
| **standalone** | no plugin registration | `~/.claude/commands`, `~/.claude/agents`, `~/.claude/core`, `~/.claude/hooks`, `~/.claude/scripts` |
| **codex-native** | `~/.codex` exists | `~/.codex/skills`, `~/.codex/agents/*.toml`, `~/.codex/scripts`, and managed fences in `~/.codex/config.toml` |

Claude writes stay under `~/.claude/`. Codex writes stay under `~/.codex/`.
Symlinks in the source are skipped (traversal guard).

After a Codex install, run `/hooks` inside Codex once to review and trust the QE
`PreToolUse` safety hook. QE does not document hook-trust bypass as the normal
path.

## Preview before you install — `--dry-run`

```bash
qe-framework-install --dry-run
```

Writes **nothing**. Prints the resolved mode and, for every file, whether it would be
`create` (new) or `overwrite` (an existing file would be replaced). Use this to see the
blast radius before committing.

## Inspect current state — `doctor`

```bash
qe-framework-install doctor
```

Read-only. Reports: install mode, framework version, each asset location
(present/absent), and how many reversible backups exist.

## Install — automatic backup

```bash
qe-framework-install
```

Before overwriting **any** existing file, the installer copies the original into:

```
~/.claude/.qe-backup/<timestamp>/…   (+ manifest.json)
```

So an install can always be undone. New files (no conflict) are not backed up — they
are simply removed on uninstall.

## Roll back — `uninstall --restore`

```bash
qe-framework-uninstall            # remove what QE installed
qe-framework-uninstall --restore  # …and restore originals from the latest backup
```

`--restore` reads the most recent `~/.claude/.qe-backup/*/manifest.json` and copies each
saved original back to its location (after removing the installed copy). Restore is
clamped to `~/.claude` — a stale or relocated manifest can never write elsewhere.

Plain `uninstall` removes **only files byte-identical to what QE shipped** — anything
you modified after install, or your own file that merely shares a name with a shipped
asset, is left untouched. Empty directories are pruned.

> The install/uninstall/backup/restore contract is pinned by
> `scripts/check-installer-safety.mjs` (run in CI via `npm run check:all`), which
> exercises the full lifecycle against a temporary HOME — your real `~/.claude` is
> never touched by the test.

Codex install and hook behavior is covered by temp-HOME tests:
`scripts/lib/__tests__/codex-install.test.mjs` and
`scripts/lib/__tests__/codex-install-hooks.test.mjs`. These tests also preserve
user-authored `mcp_servers` and project config outside QE-managed fences.

## Not yet: `--profile minimal|full`

Profile-scoped installs (ship only a curated core skill set vs. everything) are
**deferred** until skills carry `tier` metadata (trust-hardening Phase 5). Until then,
install copies the full set. The `hook_profile` setting (`minimal|safe|full`, see
`docs/HOOKS.md`) is a separate, already-available knob for hook enforcement.
