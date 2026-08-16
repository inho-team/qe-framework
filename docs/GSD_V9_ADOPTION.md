# Latest GSD Review for QE v9

Review date: 2026-08-16

## Source snapshot

- Repository: [`gsd-build/get-shit-done`](https://github.com/gsd-build/get-shit-done)
- Reviewed commit: `bdcaab2`
- Package version at that commit: `1.50.0-canary.0`
- Latest stable version recorded in its changelog: `1.42.1`
- Primary references: [Architecture](https://github.com/gsd-build/get-shit-done/blob/main/docs/ARCHITECTURE.md), [User Guide](https://github.com/gsd-build/get-shit-done/blob/main/docs/USER-GUIDE.md)

Versions describe the inspected upstream snapshot; they are not QE dependencies
and do not imply command or state-format compatibility.

## Disposition

| Recent GSD capability | QE v9 disposition | Evidence |
|---|---|---|
| Post-execute structural drift detection | **Adopted** | `analysis-drift.mjs`, SessionStart advisory, and Qplan live-source fallback |
| Namespace meta-skills to reduce eager prompt cost | Already covered | QE v9 ships 12 skills with a 10-skill public surface |
| Post-merge build and test gate | Already covered more strictly | Goal acceptance locks regression and distinct verification evidence before completion |
| Context utilization health thresholds | Already covered | QE context meter, monitor, compaction, and persistent-mode limits |
| State consistency validation and repair | Already covered | SQLite schema verification, append-only Goal ledger, and Qdoctor diagnostics |
| Automatic targeted remapping | Deferred | QE v9 no longer ships a semantic mapper agent; silently generating analysis would weaken provenance |
| File-based workstream inheritance | Not adopted | Named Plans and session bindings already isolate concurrent QE work in the DB-backed model |

## Adopted behavior

`npm run qe:analysis-drift -- --json` resolves the recorded analysis baseline
from `.qe/analysis/files.json` or `file-ledger-snapshot.json`, validates that the
value is a safe ancestor commit, and compares it with committed plus untracked
structural additions. It recognizes:

- new directory roots;
- package or app barrel exports;
- route and API modules;
- common database migration layouts.

Three distinct structural elements trigger the default advisory. SessionStart
surfaces the affected paths, and Qplan must read those paths from live source
before planning or verification. Missing, malformed, unrelated, or inaccessible
baselines fail open and never block a session.
An analysis commit that exists but is no longer an ancestor of `HEAD`—for
example after a rebase or history rewrite—surfaces a whole-analysis stale
advisory instead of silently comparing unrelated trees.

Automatic remapping was deliberately excluded. QE analysis contains semantic
documents, so a deterministic detector can prove staleness but cannot prove that
an automatically rewritten explanation is correct. The adopted boundary prevents
stale analysis from being treated as evidence without weakening the existing Goal
acceptance and SIVS gates.
