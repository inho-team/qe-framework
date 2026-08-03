# Semantic Tool Adapter

QE treats local LSP and AST tools as optional capabilities. Discovery is read-only: it scans `PATH`, never downloads or installs a server, and never starts a language server merely to decide whether one exists.

## State model

Each capability reports:

- `kind`: `lsp` or `ast`
- `availability`: `available` or `unavailable`
- `health.state`: `unknown`, `healthy`, `degraded`, or `unhealthy`
- `usable`: whether the current policy permits selection

Discovery yields `available/unknown`. A successful runtime operation changes health to `healthy`. One consecutive failure is `degraded` and remains usable; a second consecutive failure is `unhealthy` and disables semantic selection. A later success resets the failure count and restores `healthy`.

When no usable capability matches the requested kind, callers receive an explicit `text-search` fallback. The workflow may continue with bounded text search, but must not describe that result as semantic analysis.

## Doctor

Run `node scripts/qe-doctor.mjs` for a readable local report or add `--json` for automation. Absence of every semantic tool is a supported state and exits successfully with the fallback reason.

