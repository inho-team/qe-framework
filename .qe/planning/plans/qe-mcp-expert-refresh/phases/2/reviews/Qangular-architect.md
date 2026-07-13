# Qangular-architect Review Evidence

- expert: Qangular-architect
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: 2026-06 for Angular v22 release content when available
- currentMajor: 22
- verifiedMajor: 22
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: none

## sourceUrls

- https://angular.dev/events/v22
- https://angular.dev/reference/releases
- https://blog.angular.dev/announcing-angular-v22-c52bb83a4664

## sourceCommands

- `npm view @angular/core version`

## raw command output / API summary

- `npm view @angular/core version` -> `22.0.6`
- Angular release policy page states the usual 18-month support window with active and LTS periods.

## official-doc provenance

Angular official docs/blog supplied release and support policy guidance.

## registry provenance

npm package metadata confirmed the current `@angular/core` major.

## changedSections

- Frontmatter description/triggers now target Angular 22.
- Added Current Version Notes.
- Preserved standalone/signal guidance and clarified NgModule compatibility status.

## residualRisk

Individual Angular APIs can remain experimental/developer-preview. Verify API stability before generating implementation code.
