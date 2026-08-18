# Installing & Removing QE Framework — Safely

QE's baseline install is the Claude Code plugin. The installer copies `skills/`,
`agents/`, `core/`, `hooks/`, and `scripts/` into your Claude config. When a
Codex home exists, QE also installs native Codex assets under `~/.codex`. This
page documents exactly what it touches and how to preview, back up, and roll
back.

QE v9 requires Node.js 22.5 or newer because its DB-backed state layer uses the
built-in `node:sqlite` API. CI verifies the supported Node 22 and 24 lines.

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

### Run QE with Ollama through Codex

Codex exposes Ollama as an OSS provider. Install QE's Codex agents in local-model
inheritance mode so their generated TOML files do not force OpenAI model names or
reasoning settings:

```bash
qe-framework-install --codex-provider ollama
codex --oss --local-provider ollama
```

The provider choice is stored in `~/.codex/.qe-codex-version`, so package
lifecycle reinstalls preserve it. Use `qe-framework-install --codex-provider
openai` to restore QE's normal Codex model routing. This setting affects the
generated QE agent roles; installing and starting the Ollama daemon and pulling
a tool-capable model remain user-managed prerequisites. When switching an older
unowned QE-generated agent to a local provider, the installer first saves its
previous TOML under `~/.codex/.qe-agent-backup/`; files without QE's generated
agent signature remain untouched. Provider switching intentionally replaces a
signature-bearing QE agent even when it was locally edited, but the byte-exact
backup remains available for manual recovery or edit reapplication.

## Distribution vs runtime capability

The Claude plugin remains the distribution anchor: marketplace install,
`.claude-plugin/plugin.json`, and the plugin cache decide how the framework is
packaged. Runtime capability is broader than that package anchor:

For v9, the supported public distribution channel is the GitHub-backed Claude
marketplace shown in the README. The npm tarball is a reproducible build and
provenance artifact; publication to the public npm registry is optional and
must be an explicit release decision, not an installation prerequisite.

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
qe-framework-install --dry-run --codex-provider ollama
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

## Verify a packed artifact before installation

Create the package and its immutable provenance in a trusted build environment,
without publishing it:

```bash
npm pack --ignore-scripts
node scripts/check-package-provenance.mjs --artifact inho-team-qe-framework-<version>.tgz --out qe.provenance.json
```

Verify the received artifact before installation:

```bash
node scripts/check-package-provenance.mjs --artifact inho-team-qe-framework-<version>.tgz --provenance qe.provenance.json
node scripts/check-packaged-install.mjs --artifact inho-team-qe-framework-<version>.tgz --provenance qe.provenance.json
```

To bind the provenance to an existing Ed25519 release key, create a detached
signature in the trusted build environment:

```bash
node scripts/check-package-provenance.mjs \
  --artifact inho-team-qe-framework-<version>.tgz \
  --out qe.provenance.json \
  --sign-private-key release-ed25519-private.pem \
  --signature qe.provenance.sig
```

Verify with a separately trusted public key before installation:

```bash
node scripts/check-package-provenance.mjs \
  --artifact inho-team-qe-framework-<version>.tgz \
  --provenance qe.provenance.json \
  --signature qe.provenance.sig \
  --verify-public-key release-ed25519-public.pem

node scripts/check-packaged-install.mjs \
  --artifact inho-team-qe-framework-<version>.tgz \
  --provenance qe.provenance.json \
  --signature qe.provenance.sig \
  --verify-public-key release-ed25519-public.pem
```

The verifier recomputes the compressed artifact SHA-256, every packed regular
file digest, package name/version, safe tar paths, and required assets for the
`darwin`, `linux`, and `win32` install matrix. npm install and uninstall use the
same Node lifecycle entrypoint on all three platforms and do not require a host
shell. A missing asset or digest mismatch
fails before installation. Unsigned provenance remains available for local
preflight. When signature verification is requested, the detached signature and
trusted public key are both mandatory; a changed artifact, provenance, signature,
or key fails closed. The signature covers a domain-separated canonical JSON
encoding of the complete provenance record. QE does not generate, store, rotate,
or distribute release keys: private-key custody and public-key trust must be
provided by the release process through a channel separate from the artifact.

For a repository-local preflight that creates and removes its own temporary
artifact, run both commands without arguments. Neither command publishes or
changes the package version.

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
