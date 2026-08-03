# Architecture Boundaries

QE uses a one-way dependency rule for host integrations:

```text
Claude adapter ─┐
                ├──> harness-neutral core
Codex adapter ──┘
```

The neutral core must not import a Claude- or Codex-specific adapter. One host
adapter must not import the other directly; shared behavior belongs in neutral
core and both adapters depend on that abstraction.

## Enforced zones

- `core/**`, `scripts/lib/**`, and `hooks/scripts/lib/**` are neutral core unless
  a path or filename explicitly identifies `claude` or `codex`.
- `adapters/claude/**` and explicit `claude-*`/`claude_*` modules are Claude
  adapters.
- `adapters/codex/**`, `hooks/scripts/codex/**`, and explicit
  `codex-*`/`codex_*` modules are Codex adapters.
- Adapter-to-core and same-adapter imports are allowed.
- Core-to-adapter and cross-adapter imports fail
  `scripts/check-architecture-boundaries.mjs` with the importer line and target.

The guard is discovered automatically by `scripts/check-all.mjs`.

## Zero-exception policy

The original four pre-contract imports have been removed. The legacy allowlist
is empty, so every core-to-adapter or cross-adapter import is now a violation.
Shared context, process status, durable job projection, and credential mechanics
live in neutral modules; host adapters retain only compatibility wrappers and
provider-specific configuration.

Adding an exception requires an explicit architecture decision. An unexplained
checker bypass is not permitted.
