# Qvitest Review Evidence

- expert: Qvitest
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: 2026-03/2026-04 for Vitest 4.x release/migration pages when available
- currentMajor: 4
- verifiedMajor: 4
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: none

## sourceUrls

- https://vitest.dev/guide/migration.html
- https://vitest.dev/blog/vitest-4
- https://vitest.dev/blog/vitest-4-1.html

## sourceCommands

- `npm view vitest version`

## raw command output / API summary

- `npm view vitest version` -> `4.1.10`
- Official migration guide says Vitest 4 requires Node.js >= 20 and Vite >= 6.
- Official Vitest 4.1 page reports Vite 8 support.

## official-doc provenance

Vitest official migration and release pages supplied migration constraints.

## registry provenance

npm package metadata confirmed current Vitest major/minor.

## changedSections

- Description now targets Vitest 4.1.
- Added Current Version Notes.
- Replaced stale Vitest 3.x basis note with Vitest 4.1 review note.

## residualRisk

Browser mode and coverage defaults can change by minor release. Inspect the project config before migration.
