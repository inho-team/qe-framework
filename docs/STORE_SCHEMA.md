# QE Store Schema and Migration Guide

QE keeps `.qe/` documents in the local SQLite store and maintains rebuildable
indexes for tasks, verification failures, and project knowledge. The framework
release and database schema are versioned separately: framework lines `8.3.x`
and `9.x` require schema `v4`.

## Authoritative specification

- Compatibility manifest: [`../core/store/schema-manifest.json`](../core/store/schema-manifest.json)
- Current ERD: [`../core/store/erd/v4.md`](../core/store/erd/v4.md)
- Runtime migrations: [`../hooks/scripts/lib/store-sqlite.mjs`](../hooks/scripts/lib/store-sqlite.mjs)

The manifest is the release-facing contract. The runtime migration list is
append-only; do not rewrite or reorder an already released migration.

## Operator commands

```bash
npm run qe:schema -- status
npm run qe:schema -- verify
npm run qe:schema -- plan
npm run qe:schema -- migrate
```

`status` reports the declared and installed schema. `verify` fails if the
database does not contain every table declared by the manifest. `plan` reports
whether an upgrade is needed. `migrate` opens the store and applies the existing
idempotent append-only migrations. It also initializes a fresh project's `.qe/`
database directory and authoritative `qe_files` table.

## Adding a schema version

1. Append a new migration in `store-sqlite.mjs`; never modify released SQL.
2. Add `core/store/erd/v{N}.md`, documenting tables, indexes, authority, and
   CLI exposure policy.
3. Add schema `N` and its framework version range to `schema-manifest.json`.
4. Run `npm run qe:schema -- migrate` and `npm run qe:schema -- verify` on a
   fresh database and an upgraded database.
5. When releasing a framework version, update `package.json` and
   `.claude-plugin/plugin.json` together and ensure the manifest range covers it.
   The release CLI rejects an uncovered version before writing any manifest.

Derived tables must remain rebuildable from `qe_files` or documented source
artifacts. Do not expose sensitive cache content through the public CLI.
