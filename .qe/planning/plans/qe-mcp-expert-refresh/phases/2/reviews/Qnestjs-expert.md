# Qnestjs-expert Review Evidence

- expert: Qnestjs-expert
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: NestJS migration page has no stable published date in the checked snippet
- currentMajor: 11
- verifiedMajor: 11
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: none

## sourceUrls

- https://docs.nestjs.com/migration-guide

## sourceCommands

- `npm view @nestjs/core version`

## raw command output / API summary

- `npm view @nestjs/core version` -> `11.1.28`
- Official migration guide describes migration from NestJS 10 to 11.

## official-doc provenance

NestJS official migration guide supplied migration caveats.

## registry provenance

npm package metadata confirmed current `@nestjs/core` major.

## changedSections

- Frontmatter description/triggers now target NestJS 11.
- Added Current Version Notes.
- Added Express v5, package compatibility, and migration verification caveats.

## residualRisk

Nest applications depend on adapter and ecosystem package compatibility. Verify all `@nestjs/*` packages together.
