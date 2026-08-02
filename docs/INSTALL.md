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

## Distribution vs runtime capability

The Claude plugin remains the distribution anchor: marketplace install,
`.claude-plugin/plugin.json`, and the plugin cache decide how the framework is
packaged. Runtime capability is broader than that package anchor:

| Runtime surface | Claude | Codex |
|-----------------|--------|-------|
| Skills | plugin/standalone assets under `~/.claude` | native skills under `~/.codex/skills` |
| Agents | Markdown agents under `~/.claude/agents` | TOML native agents under `~/.codex/agents` |
| Hooks | Claude Code plugin hook registration | managed Codex hook fences in `~/.codex/config.toml` |
| Status guidance | Session context and hook messages | Session context and hook messages |
| SIVS bridge | Claude can delegate Codex stages through `codex-plugin-cc` | Codex can use native skills, native agents, and reverse Claude bridge surfaces when present |

This means installation docs should not treat `.claude-plugin` as a runtime
limit. It is the packaging root. The runtime contract is defined by
`core/INTERACTION_ADAPTER.md`, `core/LIFECYCLE_ADAPTER.md`, and the Phase 1
adapter contract under
`.qe/planning/plans/claude-codex-generalization/phases/1/ADAPTER_CONTRACT.md`.

## Supported package entrypoints

External automation should use `qe-framework-install`,
`qe-framework-uninstall`, or a command declared in `package.json`. The package
also contains `scripts/`, `hooks/`, and `core/` as installer payloads; their
undeclared deep paths are internal and unsupported as module or CLI APIs.

If older automation invoked retired audit scripts, replace that call with
`npm run check:all` for repository validation or
`npm run qe:query -- analysis` for stored analysis. Do not invoke the removed
`scripts/preuninstall.mjs`: `npm uninstall` uses the declared lifecycle cleanup,
and `qe-framework-uninstall` is the supported explicit removal command.

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
user-authored `mcp_servers` and project config outside QE-managed fences. During
install, any deprecated `[features].codex_hooks` setting in `~/.codex/config.toml`
is migrated to `[features].hooks` to avoid Codex startup warnings. Codex skill
copies also compact long frontmatter descriptions while preserving the skill body,
so Codex spends less of its skills context budget on metadata.

### Verify Codex skill cache freshness

After install or update, the source skill files and the Codex cache should agree
on client-neutral initialization behavior. A quick read-only check:

```bash
grep -n "QE.md.*CLAUDE.md\\|QE.md.*AGENTS.md" \
  ~/.codex/skills/Qplan/SKILL.md
```

The `Qplan` pre-check recognizes the shared `QE.md` and the client instruction
artifacts (`CLAUDE.md` or `AGENTS.md`) together with `.qe/`. An explicit QE entry
creates a missing `QE.md` and the active client's managed pointer. If the installed
Codex skill does not describe this behavior, rerun `qe-framework-install` from the
updated framework package and restart the Codex session.

## Not yet: `--profile minimal|full`

Profile-scoped installs (ship only a curated core skill set vs. everything) are
**deferred** until skills carry `tier` metadata (trust-hardening Phase 5). Until then,
install copies the full set. The `hook_profile` setting (`minimal|safe|full`, see
`docs/HOOKS.md`) is a separate, already-available knob for hook enforcement.
